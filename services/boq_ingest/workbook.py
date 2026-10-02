"""Bounded, read-only OOXML inspection. No Excel macros, links or cached-value trust."""
from __future__ import annotations

import ast
import hashlib
import io
import json
import posixpath
import re
import zipfile
from decimal import Decimal, InvalidOperation, localcontext
from xml.etree import ElementTree as ET

MAX_UPLOAD = 20 * 1024 * 1024
MAX_UNPACKED = 100 * 1024 * 1024
MAX_CELLS = 100_000
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
CELL = re.compile(r"^([A-Z]{1,3})([1-9][0-9]{0,6})$")


class ImportBlocked(ValueError):
    """An explicit data-quality or unsupported-workbook error, never a zero."""


def digest(value) -> str:
    raw = value if isinstance(value, bytes) else json.dumps(value, sort_keys=True, ensure_ascii=False).encode()
    return hashlib.sha256(raw).hexdigest()


def decimal(value) -> Decimal:
    if isinstance(value, bool) or value is None:
        raise ImportBlocked("MISSING_OR_INVALID_NUMBER")
    s = str(value).strip().translate(str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789"))
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1]
    if not re.fullmatch(r"[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?", s):
        raise ImportBlocked("MISSING_OR_INVALID_NUMBER")
    try:
        n = Decimal(s.replace(",", ""))
    except InvalidOperation as exc:
        raise ImportBlocked("INVALID_NUMBER") from exc
    if not n.is_finite() or abs(n) > Decimal("1000000000000") or len(n.as_tuple().digits) > 28:
        raise ImportBlocked("NUMBER_OUT_OF_RANGE")
    return n


def address(ref: str) -> tuple[str, int]:
    m = CELL.fullmatch(ref)
    if not m:
        raise ImportBlocked("INVALID_CELL_ADDRESS")
    col, row = m[1], int(m[2])
    if row > 30000 or column_number(col) > 512:
        raise ImportBlocked("WORKSHEET_LIMIT")
    return col, row


def column_number(col: str) -> int:
    result = 0
    for ch in col:
        result = result * 26 + ord(ch) - 64
    return result


def column_name(n: int) -> str:
    result = ""
    while n:
        n, v = divmod(n - 1, 26)
        result = chr(65 + v) + result
    return result


class Workbook:
    def __init__(self, raw: bytes):
        if len(raw) > MAX_UPLOAD:
            raise ImportBlocked("UPLOAD_TOO_LARGE")
        self.sha256 = digest(raw)
        self.sheets = {}
        self._resolved = {}
        self.rows = {}
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                entries = archive.infolist()
                names = [x.filename for x in entries]
                if len(entries) > 1500 or len(names) != len(set(names)):
                    raise ImportBlocked("INVALID_ARCHIVE_ENTRIES")
                if sum(x.file_size for x in entries) > MAX_UNPACKED:
                    raise ImportBlocked("WORKBOOK_TOO_LARGE")
                for item in entries:
                    if (item.flag_bits & 1 or item.file_size > MAX_UNPACKED // 2
                            or item.file_size / max(item.compress_size, 1) > 250):
                        raise ImportBlocked("UNSAFE_ARCHIVE")
                    path = item.filename.lower()
                    if path.startswith("/") or ".." in path.split("/") or "\\" in path:
                        raise ImportBlocked("UNSAFE_ARCHIVE_PATH")
                    if any(x in path for x in ("vbaproject", "externallink", "connections.xml", "activex/", "embeddings/")):
                        raise ImportBlocked("ACTIVE_OR_EXTERNAL_CONTENT_NOT_SUPPORTED")

                def xml(path):
                    text = archive.read(path).decode("utf-8-sig")
                    if "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper():
                        raise ImportBlocked("XML_ENTITY_FORBIDDEN")
                    return ET.fromstring(text)

                for name in names:
                    if name.endswith(".rels"):
                        for rel in xml(name):
                            if rel.get("TargetMode") == "External":
                                raise ImportBlocked("EXTERNAL_RELATIONSHIP_NOT_SUPPORTED")
                shared = []
                if "xl/sharedStrings.xml" in names:
                    shared = ["".join(x.itertext()) for x in xml("xl/sharedStrings.xml").findall("s:si", NS)]
                self.styles = []
                if "xl/styles.xml" in names:
                    styles = xml("xl/styles.xml")
                    fills = [ET.tostring(x, encoding="unicode") for x in styles.findall("s:fills/s:fill", NS)]
                    formats = {x.get("numFmtId"): x.get("formatCode") for x in styles.findall("s:numFmts/s:numFmt", NS)}
                    for x in styles.findall("s:cellXfs/s:xf", NS):
                        fill = int(x.get("fillId", "0"))
                        self.styles.append({"attributes": dict(x.attrib), "numberFormat": formats.get(x.get("numFmtId")),
                                            "fill": fills[fill] if fill < len(fills) else None})
                rels = {x.get("Id"): x.get("Target") for x in xml("xl/_rels/workbook.xml.rels")}
                main = xml("xl/workbook.xml")
                self.calculation = dict(main.find("s:calcPr", NS).attrib) if main.find("s:calcPr", NS) is not None else {}
                count = 0
                for sheet in main.findall("s:sheets/s:sheet", NS):
                    name = sheet.get("name")
                    if not name or name in self.sheets or len(self.sheets) >= 40:
                        raise ImportBlocked("INVALID_SHEETS")
                    target = rels.get(sheet.get(RID), "")
                    path = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
                    if not path.startswith("xl/") or ".." in path.split("/"):
                        raise ImportBlocked("INVALID_SHEET_TARGET")
                    root = xml(path)
                    cells = {}
                    row_index = {}
                    hidden = []
                    for row in root.findall("s:sheetData/s:row", NS):
                        if row.get("hidden") in ("1", "true"):
                            hidden.append(int(row.get("r")))
                        for item in row.findall("s:c", NS):
                            ref = item.get("r", "")
                            address(ref)
                            if ref in cells:
                                raise ImportBlocked("DUPLICATE_CELL")
                            typ = item.get("t", "n")
                            raw_value = item.findtext("s:v", None, NS)
                            formula = item.find("s:f", NS)
                            value = raw_value
                            if typ == "s":
                                index = int(raw_value)
                                if not 0 <= index < len(shared):
                                    raise ImportBlocked("INVALID_SHARED_STRING_INDEX")
                                value = shared[index]
                            elif typ == "inlineStr":
                                value = "".join(x.text or "" for x in item.findall("s:is//s:t", NS))
                            cells[ref] = {"value": value, "type": typ, "style": int(item.get("s", "0")),
                                          "formula": formula.text or "" if formula is not None else None,
                                          "formulaAttributes": dict(formula.attrib) if formula is not None else {}}
                            row_index.setdefault(address(ref)[1], []).append(cells[ref])
                            count += 1
                            if count > MAX_CELLS:
                                raise ImportBlocked("CELL_LIMIT_EXCEEDED")
                    self.rows[name] = row_index
                    self.sheets[name] = {"cells": cells, "state": sheet.get("state", "visible"), "hiddenRows": hidden,
                        "hiddenColumns": [dict(x.attrib) for x in root.findall("s:cols/s:col", NS) if x.get("hidden") in ("1", "true")],
                        "merges": [x.get("ref") for x in root.findall("s:mergeCells/s:mergeCell", NS)],
                        "conditionalFormatting": [ET.tostring(x, encoding="unicode") for x in root.findall("s:conditionalFormatting", NS)]}
        except ImportBlocked:
            raise
        except (zipfile.BadZipFile, KeyError, ValueError, TypeError, IndexError, ET.ParseError, UnicodeError, RuntimeError) as exc:
            raise ImportBlocked("INVALID_OR_UNSUPPORTED_XLSX") from exc
        if not self.sheets:
            raise ImportBlocked("NO_WORKSHEETS")
        self.layout_hash = digest({"styles": self.styles, "sheets": {name: {**{k: v for k, v in s.items() if k != "cells"},
            "cells": [(ref, c["type"], c["style"], c["formula"], c["formulaAttributes"]) for ref, c in s["cells"].items()]}
            for name, s in self.sheets.items()}})

    def cell(self, sheet: str, ref: str) -> dict:
        address(ref)
        if sheet not in self.sheets:
            raise ImportBlocked("UNKNOWN_SHEET")
        return self.sheets[sheet]["cells"].get(ref, {"value": None, "type": "n", "formula": None})

    def text(self, sheet: str, ref: str) -> str:
        c = self.cell(sheet, ref)
        if c["formula"] is not None or c["type"] in ("e", "b") or c["value"] is None:
            raise ImportBlocked(f"INVALID_ID_OR_HEADER:{sheet}!{ref}")
        return str(c["value"]).strip()

    def number(self, sheet: str, ref: str, trail=()) -> Decimal:
        """Financial fields must be numeric, never coerced text/formula results."""
        value = self.value(sheet, ref, trail)
        if not isinstance(value, Decimal):
            raise ImportBlocked(f"NON_NUMERIC_FINANCIAL_CELL:{sheet}!{ref}")
        return value

    def value(self, sheet: str, ref: str, trail=()) -> Decimal | str | bool | None:
        """Evaluate the supported subset while preserving Excel reference types.

        Cached results/types never determine a formula's evaluated value. Unsupported
        coercions fail closed; this is not an implementation of all Excel semantics.
        """
        key = (sheet, ref)
        if key in self._resolved:
            return self._resolved[key]
        if key in trail or len(trail) >= 64:
            raise ImportBlocked(f"CIRCULAR_OR_DEEP_FORMULA:{sheet}!{ref}")
        c = self.cell(sheet, ref)
        if c["formula"] is None:
            if c["type"] == "e":
                raise ImportBlocked(f"CELL_ERROR:{sheet}!{ref}")
            if c["type"] in ("s", "inlineStr", "str"):
                result = c["value"] if c["value"] is not None else ""
            elif c["type"] == "b" and c["value"] in ("0", "1"):
                result = c["value"] == "1"
            elif c["type"] == "n":
                result = None if c["value"] is None else decimal(c["value"])
            else:
                raise ImportBlocked(f"UNSUPPORTED_CELL_TYPE:{sheet}!{ref}")
        else:
            if c["formulaAttributes"].get("t") in ("shared", "array", "dataTable"):
                raise ImportBlocked(f"UNSUPPORTED_FORMULA:{sheet}!{ref}")
            expression = c["formula"].removeprefix("=").strip()
            # Literal strings are evaluated from the formula, NOT from cached <v>.
            if len(expression) <= 1000 and re.fullmatch(r'"(?:[^\"]|"")*"', expression):
                result = expression[1:-1].replace('""', '"')
                self._resolved[key] = result
                return result
            expression = expression.upper().replace("$", "")
            if len(expression) > 1000 or any(ch in expression for ch in "![]\"'"):
                raise ImportBlocked(f"UNSUPPORTED_FORMULA:{sheet}!{ref}")
            values = {}
            def bind(value):
                label = f"v{len(values)}"
                values[label] = value
                return label
            def total(match):
                a, b = address(match[1]), address(match[2])
                ac, bc = column_number(a[0]), column_number(b[0])
                if b[1] < a[1] or bc < ac or (b[1] - a[1] + 1) * (bc - ac + 1) > MAX_CELLS:
                    raise ImportBlocked("INVALID_SUM_RANGE")
                nums = []
                for row in range(a[1], b[1] + 1):
                    for col in range(ac, bc + 1):
                        target = f"{column_name(col)}{row}"
                        value = self.value(sheet, target, trail + (key,))
                        # SUM over references ignores text, booleans and blanks,
                        # including text returned by a formula. Errors still block.
                        if isinstance(value, Decimal):
                            nums.append(value)
                return bind(sum(nums, Decimal(0)))
            expression = re.sub(r"SUM\(\s*([A-Z]+[1-9]\d*)\s*:\s*([A-Z]+[1-9]\d*)\s*\)", total, expression)
            expression = re.sub(r"\b[A-Z]{1,3}[1-9]\d*\b", lambda m: bind(self.value(sheet, m[0], trail + (key,))), expression)
            try:
                tree = ast.parse(expression, mode="eval")
                def evaluate(node):
                    if isinstance(node, ast.Expression):
                        return evaluate(node.body)
                    if isinstance(node, ast.Name) and node.id in values:
                        return values[node.id]
                    if isinstance(node, ast.Constant) and type(node.value) in (int, float):
                        return decimal(ast.get_source_segment(expression, node))
                    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
                        operand = evaluate(node.operand)
                        if not isinstance(operand, Decimal):
                            raise ImportBlocked("UNSUPPORTED_FORMULA_COERCION")
                        return operand * (-1 if isinstance(node.op, ast.USub) else 1)
                    if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
                        left, right = evaluate(node.left), evaluate(node.right)
                        if not isinstance(left, Decimal) or not isinstance(right, Decimal):
                            raise ImportBlocked("UNSUPPORTED_FORMULA_COERCION")
                        if isinstance(node.op, ast.Add): return left + right
                        if isinstance(node.op, ast.Sub): return left - right
                        if isinstance(node.op, ast.Mult): return left * right
                        return left / right
                    raise ImportBlocked("UNSUPPORTED_FORMULA")
                with localcontext() as ctx:
                    ctx.prec = 28
                    result = evaluate(tree)
            except (SyntaxError, ArithmeticError, RecursionError) as exc:
                raise ImportBlocked(f"FORMULA_ERROR:{sheet}!{ref}") from exc
            # The cached <v> value is never used for formula cells.
            if isinstance(result, Decimal):
                result = decimal(format(result, "f"))
        self._resolved[key] = result
        return result

    def inspect(self, limit=800) -> dict:
        output = {"sha256": self.sha256, "layoutHash": self.layout_hash, "styles": self.styles,
                  "formulaPolicy": "recompute arithmetic and SUM ranges; block everything else", "sheets": []}
        for name, sheet in self.sheets.items():
            cells = list(sheet["cells"].items())
            output["sheets"].append({"name": name, **{k: v for k, v in sheet.items() if k != "cells"},
                "cellCount": len(cells), "omittedCells": max(0, len(cells) - limit),
                "cells": [{"address": ref, **c} for ref, c in cells[:limit]]})
        return output

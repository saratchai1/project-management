"""Reviewed mapping -> exact extraction -> scope reconciliation -> candidate snapshot."""
from __future__ import annotations

import copy
import re
from collections import defaultdict
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from .workbook import Workbook, ImportBlocked, address, decimal, digest

FIELDS = {"boq", "paid"}
TOLERANCE = Decimal("0.01")


class YearAnchor(BaseModel):
    """Machine-checked operating year, not a reviewer-supplied default."""
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["sheet_name", "cell"]
    cell: str | None = None

    @model_validator(mode="after")
    def validate_anchor(self):
        if self.kind == "cell":
            if self.cell is None:
                raise ValueError("A year cell is required")
            address(self.cell)
        elif self.cell is not None:
            raise ValueError("Sheet-name anchors cannot specify a cell")
        return self


class Region(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    sheet: str = Field(min_length=1, max_length=100)
    portfolio: str = Field(min_length=1, max_length=100)
    year: int = Field(ge=1, le=100)
    year_anchor: YearAnchor
    start_row: int = Field(ge=1, le=30000)
    end_row: int = Field(ge=1, le=30000)
    columns: dict[Literal["plotCode", "contractNo", "projectCode", "boq", "paid"], str]
    header_cells: dict[str, str]
    totals: dict[Literal["boq", "paid"], str]
    ignored_rows: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_mapping(self):
        fields = set(self.columns) & FIELDS
        if not fields or not {"plotCode", "contractNo", "projectCode"}.issubset(self.columns) or set(self.totals) != fields:
            raise ValueError("Map plotCode, contractNo, projectCode and financial fields with control totals")
        if self.year_anchor.kind == "cell" and address(self.year_anchor.cell)[1] >= self.start_row:
            raise ValueError("Operating-year context must precede data rows")
        if self.end_row < self.start_row or not self.header_cells:
            raise ValueError("Invalid data region or missing header anchors")
        if len(set(self.columns.values())) != len(self.columns):
            raise ValueError("Mapped columns must be distinct")
        for col in self.columns.values():
            address(col + "1")
        anchored = set()
        for ref, label in self.header_cells.items():
            col, row = address(ref)
            if row >= self.start_row or not label.strip():
                raise ValueError("Header anchors must precede data and be nonempty")
            anchored.add(col)
        if not set(self.columns.values()).issubset(anchored):
            raise ValueError("Every mapped column needs a reviewed header anchor")
        for ref in self.totals.values():
            _, row = address(ref)
            if self.start_row <= row <= self.end_row:
                raise ValueError("Source total must be outside the data rows")
        for row, reason in self.ignored_rows.items():
            if not row.isdecimal() or not self.start_row <= int(row) <= self.end_row or len(reason.strip()) < 4:
                raise ValueError("Ignored rows need an in-range row number and reason")
        return self


class Profile(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    schema_version: Literal[2]
    name: str = Field(min_length=3, max_length=120)
    layout_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    regions: list[Region] = Field(min_length=1, max_length=80)
    ignored_sheets: dict[str, str] = Field(default_factory=dict)
    semantics: Literal["boq-budget_and_or_cumulative-ap-postings"]


def validate_profile(workbook: Workbook, profile: Profile):
    if profile.layout_hash != workbook.layout_hash:
        raise ImportBlocked("TEMPLATE_CHANGED_REVIEW_REQUIRED")
    covered = {r.sheet for r in profile.regions}
    ignored = set(profile.ignored_sheets)
    if covered & ignored or covered | ignored != set(workbook.sheets):
        raise ImportBlocked("EVERY_SHEET_MUST_BE_MAPPED_OR_EXPLICITLY_IGNORED")
    if any(len(x.strip()) < 4 for x in profile.ignored_sheets.values()):
        raise ImportBlocked("IGNORED_SHEET_REASON_REQUIRED")
    for r in profile.regions:
        context = r.sheet if r.year_anchor.kind == "sheet_name" else workbook.text(r.sheet, r.year_anchor.cell)
        context = context.strip().translate(str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789"))
        match = re.fullmatch(r"(?:(?:ปี(?:ที่|ดูแลที่)?|(?:care\s+)?year)\s*)?([1-9]\d{0,2})", context, re.I)
        if not match or int(match[1]) != r.year:
            raise ImportBlocked(f"OPERATING_YEAR_MISMATCH:{r.sheet}")
        for ref, expected in r.header_cells.items():
            if workbook.text(r.sheet, ref) != expected.strip():
                raise ImportBlocked(f"HEADER_CHANGED:{r.sheet}!{ref}")


def baseline_keys(data):
    keys = {}
    for p in data.get("plots", []):
        for y in p.get("years", []):
            key = (p["portfolio"], p["plotCode"], int(y["year"]))
            if key in keys:
                raise ImportBlocked("DUPLICATE_BASELINE_KEY")
            keys[key] = (p, y)
    if not keys:
        raise ImportBlocked("EMPTY_BASELINE")
    return keys


def make_preview(baseline: dict, inputs: list[tuple[Workbook, Profile]]) -> dict:
    """Complete replacement within each portfolio/year/field, never additive ERP replay."""
    keys = baseline_keys(baseline)
    changes, checks, issues, provenance = {}, [], [], []
    seen_scopes = set()
    for workbook, profile in inputs:
        try:
            validate_profile(workbook, profile)
            for r in profile.regions:
                expected = {k for k in keys if k[0] == r.portfolio and k[2] == r.year}
                if not expected:
                    raise ImportBlocked("UNKNOWN_PORTFOLIO_OR_YEAR")
                fields = set(r.columns) & FIELDS
                scopes = {(r.portfolio, r.year, f) for f in fields}
                if scopes & seen_scopes:
                    raise ImportBlocked("DUPLICATE_FIELD_SCOPE_ACROSS_SHEETS_OR_FILES")
                seen_scopes.update(scopes)
                seen, sums = set(), {f: Decimal(0) for f in fields}
                for row in range(r.start_row, r.end_row + 1):
                    if str(row) in r.ignored_rows:
                        continue
                    row_cells = workbook.rows[r.sheet].get(row, [])
                    if not any(c["value"] not in (None, "") or c["formula"] is not None for c in row_cells):
                        continue
                    code = workbook.text(r.sheet, r.columns["plotCode"] + str(row))
                    key = (r.portfolio, code, r.year)
                    if key not in expected:
                        raise ImportBlocked(f"UNMAPPED_PLOT:{r.sheet}!{r.columns['plotCode']}{row}")
                    if key in seen:
                        raise ImportBlocked(f"DUPLICATE_PLOT:{r.sheet}!{row}")
                    p, y = keys[key]
                    contract = y["contractNo"] if "contractNo" in y else p.get("contractNo")
                    expected_ids = {"contractNo": contract, "projectCode": p.get("projectCode")}
                    for identity, expected_id in expected_ids.items():
                        if not isinstance(expected_id, str) or not expected_id.strip():
                            raise ImportBlocked(f"BASELINE_IDENTITY_REQUIRED:{identity}:{code}")
                        source_id = workbook.text(r.sheet, r.columns[identity] + str(row))
                        if source_id != expected_id.strip():
                            raise ImportBlocked(f"SOURCE_IDENTITY_MISMATCH:{identity}:{r.sheet}!{r.columns[identity]}{row}")
                    seen.add(key)
                    record = changes.setdefault(key, {})
                    for f in sorted(fields):
                        ref = r.columns[f] + str(row)
                        value = workbook.number(r.sheet, ref)
                        if value < 0:
                            raise ImportBlocked(f"NEGATIVE_CUMULATIVE_BALANCE:{r.sheet}!{ref}")
                        record[f] = value
                        sums[f] += value
                        provenance.append({"portfolio": r.portfolio, "plotCode": code, "year": r.year, "field": f,
                            "sourceSha256": workbook.sha256, "sheet": r.sheet, "cell": ref,
                            "sourceDecimal": format(value, "f"), "formula": workbook.cell(r.sheet, ref)["formula"],
                            "contractNo": contract, "projectCode": p["projectCode"],
                            "identityCells": {f: r.columns[f] + str(row) for f in expected_ids},
                            "yearAnchor": r.year_anchor.model_dump()})
                if seen != expected:
                    raise ImportBlocked(f"INCOMPLETE_SCOPE:expected={len(expected)},parsed={len(seen)}")
                checks.append({"kind": "scope", "portfolio": r.portfolio, "year": r.year, "expected": len(expected), "parsed": len(seen), "pass": True})
                for f in sorted(fields):
                    total = workbook.number(r.sheet, r.totals[f])
                    delta = sums[f] - total
                    ok = abs(delta) <= TOLERANCE
                    checks.append({"kind": "control_total", "sheet": r.sheet, "cell": r.totals[f], "field": f,
                        "source": str(total), "parsed": str(sums[f]), "difference": str(delta), "pass": ok})
                    if not ok:
                        raise ImportBlocked(f"TOTAL_MISMATCH:{r.sheet}!{r.totals[f]}")
        except ImportBlocked as exc:
            issues.append({"sourceSha256": workbook.sha256, "code": str(exc)})
    if not inputs:
        issues.append({"code": "NO_INPUTS"})
    if issues:
        return {"status": "BLOCKED", "issues": issues, "checks": checks, "provenance": provenance, "diff": [], "candidate": None}

    candidate = copy.deepcopy(baseline)
    updated = baseline_keys(candidate)
    code_delta = defaultdict(Decimal)
    portfolio_budget_delta = defaultdict(Decimal)
    diffs = []
    evidence = {(x["portfolio"], x["plotCode"], x["year"], x["field"]): x for x in provenance}
    evidence_fields = ("possiblePaid", "possibleBalance", "paymentDataAvailable", "paymentConfidence",
                       "status", "installmentDataAvailable", "fieldProvenance")
    for key, values in sorted(changes.items()):
        p, y = updated[key]
        before_year = copy.deepcopy(y)
        old = {f: decimal(y.get(f)) for f in FIELDS}
        new = {**old, **values}
        if new["paid"] > new["boq"] + TOLERANCE:
            issues.append({"code": "PAYMENT_EXCEEDS_BOQ_REVIEW_REQUIRED", "plotCode": key[1], "year": key[2]})
            continue
        if y.get("status") in ("future", "not_contracted") and new["paid"] > 0:
            issues.append({"code": "PAYMENT_FOR_INACTIVE_CONTRACT_REVIEW_REQUIRED", "plotCode": key[1], "year": key[2]})
            continue
        budget_delta = new["boq"] - old["boq"]
        paid_delta = new["paid"] - old["paid"]
        numeric_changed = any(old[f] != new[f] for f in FIELDS)
        code_delta[p["projectCode"]] += paid_delta
        portfolio_budget_delta[p["portfolio"]] += budget_delta
        if budget_delta:
            p["total10y"] = float(decimal(p["total10y"]) + budget_delta)
        # Only the supplied source owns the corresponding field/authority.
        y.update({f: float(values[f]) for f in values})
        y.update(balance=float(max(Decimal(0), new["boq"] - new["paid"])),
                 over=float(max(Decimal(0), new["paid"] - new["boq"])))
        if "paid" in values:
            y.update(paymentDataAvailable=True, paymentConfidence="reviewed_cumulative_ap_snapshot",
                     possiblePaid=float(new["paid"]))
        upper = y.get("possiblePaid", new["paid"])
        y["possibleBalance"] = None if upper is None else float(max(Decimal(0), new["boq"] - decimal(upper)))
        if y.get("status") not in ("future", "not_contracted") and ("paid" in values or
                (y.get("paymentDataAvailable") is True and y.get("status") != "no_data")):
            y["status"] = "paid" if y["balance"] <= .01 else "partial" if new["paid"] > 0 else "not_started"
        # A confirmed zero is evidence even when its numeric delta is zero.
        y.setdefault("fieldProvenance", {}).update({f: evidence[(*key, f)] for f in values})
        if budget_delta or "paid" in values:
            # Never manufacture installment allocations from annual evidence.
            y.update(installments=[], pendingInstallments=[], latestFullInstallment=0, latestPaymentInstallments=[],
                     latestPaymentDate=None, latestPaymentAmount=None, installmentDataAvailable=False,
                     installmentDataReason="Annual source reviewed; installment allocation requires a separate reviewed source")
        before_evidence = {f: before_year.get(f) for f in evidence_fields}
        after_evidence = {f: copy.deepcopy(y.get(f)) for f in evidence_fields}
        diffs.append({"portfolio": key[0], "plotCode": key[1], "year": key[2],
                      "before": {f: str(old[f]) for f in sorted(FIELDS)}, "after": {f: str(new[f]) for f in sorted(FIELDS)},
                      "numericChanged": numeric_changed, "evidenceChanged": before_evidence != after_evidence,
                      "beforeEvidence": before_evidence, "afterEvidence": after_evidence,
                      "changed": before_year != y})

    projects = {p["code"]: p for p in candidate["projectCodes"]}
    for code, delta in code_delta.items():
        if code not in projects:
            issues.append({"code": "PROJECT_CODE_NOT_IN_REGISTER", "projectCode": code})
            continue
        record = projects[code]
        record["amounts"]["boq_contract"] = float(decimal(record["amounts"]["boq_contract"]) + delta)
        record["totalAp"] = float(decimal(record["totalAp"]) + delta)
        if abs(sum((decimal(v) for v in record["amounts"].values()), Decimal(0)) - decimal(record["totalAp"])) > TOLERANCE:
            issues.append({"code": "PROJECT_TOTAL_NOT_RECONCILED", "projectCode": code})
    for pf in candidate["portfolios"]:
        delta = sum((d for code, d in code_delta.items() if code in projects and projects[code]["portfolio"] == pf["id"]), Decimal(0))
        if delta:
            pf["amounts"]["boq_contract"] = float(decimal(pf["amounts"]["boq_contract"]) + delta)
            pf["totalAp"] = float(decimal(pf["totalAp"]) + delta)
            if "boqPaid" in pf: pf["boqPaid"] = float(decimal(pf["boqPaid"]) + delta)
        if "boqTotal" in pf and portfolio_budget_delta[pf["id"]]:
            pf["boqTotal"] = float(decimal(pf["boqTotal"]) + portfolio_budget_delta[pf["id"]])
        if abs(sum((decimal(v) for v in pf["amounts"].values()), Decimal(0)) - decimal(pf["totalAp"])) > TOLERANCE:
            issues.append({"code": "PORTFOLIO_TOTAL_NOT_RECONCILED", "portfolio": pf["id"]})
    candidate.setdefault("meta", {})["ingestion"] = {"previousErpAsOf": baseline.get("meta", {}).get("erpAsOf"), "kind": "reviewed_scoped_snapshot", "sourceHashes": [w.sha256 for w, _ in inputs],
        "scope": [{"portfolio": p, "year": y, "field": f} for p, y, f in sorted(seen_scopes)],
        "warnings": ["AP postings are not bank-cleared cash", "Annual totals do not establish installment allocations", "Unchanged scopes retain their previous source date"]}
    if any(f == "paid" for _, _, f in seen_scopes):
        candidate["meta"]["erpAsOf"] = "หลายแหล่งข้อมูล — ดูประวัตินำเข้า"
    return {"status": "BLOCKED" if issues else "PASS", "issues": issues, "checks": checks, "provenance": provenance,
            "diff": diffs, "candidate": None if issues else candidate}

"""Private immutable inputs/profiles/previews and transactional versioned publication."""
from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from .core import Profile, baseline_keys, make_preview, validate_profile
from .workbook import Workbook, ImportBlocked, MAX_UPLOAD, digest


def now():
    return datetime.now(timezone.utc).isoformat()


def dump(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


class Store:
    def __init__(self, directory: Path, baseline: dict):
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(directory, 0o700)
        self.path = directory / "ingestion.sqlite3"
        baseline_keys(baseline)
        with self.connection() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY, name TEXT NOT NULL, bytes BLOB NOT NULL, created TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY, body TEXT NOT NULL, review TEXT NOT NULL, created TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY, parent TEXT, body TEXT NOT NULL, event TEXT NOT NULL, created TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS current(singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS previews(id TEXT PRIMARY KEY, base TEXT NOT NULL, inputs TEXT NOT NULL, report TEXT NOT NULL, result TEXT, created TEXT NOT NULL);
            """)
            if not db.execute("SELECT revision FROM current WHERE singleton=1").fetchone():
                revision = uuid4().hex
                db.execute("INSERT INTO snapshots VALUES(?,?,?,?,?)", (revision, None, dump(baseline), dump({"kind": "baseline"}), now()))
                db.execute("INSERT INTO current VALUES(1,?)", (revision,))
        os.chmod(self.path, 0o600)

    @contextmanager
    def connection(self, write=False):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            if write:
                db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def current(self):
        with self.connection() as db:
            row = db.execute("SELECT s.* FROM snapshots s JOIN current c ON s.id=c.revision").fetchone()
            return {"revision": row["id"], "data": json.loads(row["body"]), "createdAt": row["created"]}

    def upload(self, raw: bytes, name: str):
        workbook = Workbook(raw)
        name = name.replace("\\", "/").split("/")[-1][:180]
        with self.connection(write=True) as db:
            count, total = db.execute("SELECT COUNT(*),COALESCE(SUM(LENGTH(bytes)),0) FROM uploads").fetchone()
            exists = db.execute("SELECT 1 FROM uploads WHERE id=?", (workbook.sha256,)).fetchone()
            if not exists and (count >= 100 or total + len(raw) > MAX_UPLOAD * 20):
                raise ImportBlocked("PRIVATE_STORAGE_QUOTA_EXCEEDED")
            db.execute("INSERT OR IGNORE INTO uploads VALUES(?,?,?,?)", (workbook.sha256, name, raw, now()))
        matched = []
        with self.connection() as db:
            for row in db.execute("SELECT id,body FROM profiles"):
                profile = Profile.model_validate_json(row["body"])
                try:
                    validate_profile(workbook, profile)
                    matched.append({"id": row["id"], "name": profile.name, "profile": profile.model_dump()})
                except ImportBlocked:
                    pass
        return {"uploadId": workbook.sha256, "name": name, "inspection": workbook.inspect(), "matchingProfiles": matched}

    def raw(self, upload_id):
        with self.connection() as db:
            row = db.execute("SELECT bytes FROM uploads WHERE id=?", (upload_id,)).fetchone()
            if row is None:
                raise ImportBlocked("UPLOAD_NOT_FOUND")
            return row[0]

    def approve(self, upload_id: str, profile: Profile, review: str):
        if len(review.strip()) < 10:
            raise ImportBlocked("MEANINGFUL_MAPPING_REVIEW_REQUIRED")
        validate_profile(Workbook(self.raw(upload_id)), profile)
        body = profile.model_dump()
        profile_id = digest(body)
        with self.connection(write=True) as db:
            db.execute("INSERT OR IGNORE INTO profiles VALUES(?,?,?,?)", (profile_id, dump(body), review, now()))
        return {"profileId": profile_id, "approved": True}

    def _inputs(self, db, inputs):
        resolved = []
        if not 1 <= len(inputs) <= 8 or len({x["uploadId"] for x in inputs}) != len(inputs):
            raise ImportBlocked("INVALID_OR_DUPLICATE_UPLOAD_BATCH")
        for item in inputs:
            raw = db.execute("SELECT bytes FROM uploads WHERE id=?", (item["uploadId"],)).fetchone()
            profile = db.execute("SELECT body FROM profiles WHERE id=?", (item["profileId"],)).fetchone()
            if raw is None or profile is None:
                raise ImportBlocked("UPLOAD_OR_APPROVED_PROFILE_NOT_FOUND")
            resolved.append((Workbook(raw[0]), Profile.model_validate_json(profile[0])))
        return resolved

    def preview(self, inputs, expected_revision):
        with self.connection(write=True) as db:
            current = db.execute("SELECT revision FROM current").fetchone()[0]
            if current != expected_revision:
                raise ImportBlocked("STALE_BASE_REVISION")
            baseline = json.loads(db.execute("SELECT body FROM snapshots WHERE id=?", (current,)).fetchone()[0])
            result = make_preview(baseline, self._inputs(db, inputs))
            preview_id = uuid4().hex
            report = {k: v for k, v in result.items() if k != "candidate"}
            report.update(previewId=preview_id, baseRevision=current)
            db.execute("INSERT INTO previews VALUES(?,?,?,?,?,?)", (preview_id, current, dump(inputs), dump(report), None, now()))
            return report

    def publish(self, preview_id, expected_revision):
        with self.connection(write=True) as db:
            preview = db.execute("SELECT * FROM previews WHERE id=?", (preview_id,)).fetchone()
            current = db.execute("SELECT revision FROM current").fetchone()[0]
            if preview is None:
                raise ImportBlocked("PREVIEW_NOT_FOUND")
            if preview["result"]:
                return {"revision": preview["result"], "currentRevision": current, "alreadyPublished": True}
            if preview["base"] != current or current != expected_revision:
                raise ImportBlocked("STALE_BASE_REVISION")
            baseline = json.loads(db.execute("SELECT body FROM snapshots WHERE id=?", (current,)).fetchone()[0])
            result = make_preview(baseline, self._inputs(db, json.loads(preview["inputs"])))
            if result["status"] != "PASS":
                raise ImportBlocked("PUBLICATION_BLOCKED")
            revision = uuid4().hex
            event = {"kind": "publish", "previewId": preview_id, "inputs": json.loads(preview["inputs"]), "actor": "local-admin"}
            db.execute("INSERT INTO snapshots VALUES(?,?,?,?,?)", (revision, current, dump(result["candidate"]), dump(event), now()))
            db.execute("UPDATE current SET revision=? WHERE singleton=1", (revision,))
            db.execute("UPDATE previews SET result=? WHERE id=?", (revision, preview_id))
            return {"revision": revision, "alreadyPublished": False}

    def history(self):
        with self.connection() as db:
            return [{"revision": r["id"], "parent": r["parent"], "event": json.loads(r["event"]), "createdAt": r["created"]}
                    for r in db.execute("SELECT * FROM snapshots ORDER BY rowid DESC LIMIT 50")]

    def rollback(self, revision, expected_revision, reason):
        if len(reason.strip()) < 10:
            raise ImportBlocked("ROLLBACK_REASON_REQUIRED")
        with self.connection(write=True) as db:
            current = db.execute("SELECT revision FROM current").fetchone()[0]
            if current != expected_revision:
                raise ImportBlocked("STALE_BASE_REVISION")
            row = db.execute("SELECT body FROM snapshots WHERE id=?", (revision,)).fetchone()
            if row is None:
                raise ImportBlocked("REVISION_NOT_FOUND")
            new_revision = uuid4().hex
            db.execute("INSERT INTO snapshots VALUES(?,?,?,?,?)", (new_revision, current, row[0],
                dump({"kind": "rollback", "target": revision, "reason": reason, "actor": "local-admin"}), now()))
            db.execute("UPDATE current SET revision=?", (new_revision,))
            return {"revision": new_revision, "restoredFrom": revision}

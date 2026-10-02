"""Single-workspace pilot API. Loopback default; private state is never statically served."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import time
from pathlib import Path
from urllib.parse import urlsplit, unquote
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field
from .ai import mapping_payload, suggest_mapping
from .core import Profile, baseline_keys
from .store import Store
from .workbook import ImportBlocked, MAX_UPLOAD, Workbook


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Approval(StrictBody):
    uploadId: str
    profile: Profile
    review: str = Field(min_length=10, max_length=2000)
    confirmSemantics: bool


class Input(StrictBody):
    uploadId: str
    profileId: str


class Preview(StrictBody):
    inputs: list[Input] = Field(min_length=1, max_length=8)
    expectedRevision: str


class Publish(StrictBody):
    previewId: str
    expectedRevision: str
    confirm: bool


class Rollback(StrictBody):
    revision: str
    expectedRevision: str
    reason: str = Field(min_length=10, max_length=2000)
    confirm: bool


class Suggest(StrictBody):
    uploadId: str
    consentToSendSamples: bool


def create_app(store: Store, assets: Path, ui: Path, admin_token: str) -> FastAPI:
    if len(admin_token) < 32:
        raise ValueError("Admin token must be at least 32 characters")
    app = FastAPI(title="BOQ Ingestion Pilot", docs_url=None, redoc_url=None, openapi_url=None)
    sessions = {}

    @app.middleware("http")
    async def guard(request: Request, call_next):
        host = request.headers.get("host", "")
        origin = request.headers.get("origin")
        if urlsplit("http://" + host).hostname not in ("localhost", "127.0.0.1", "testserver"):
            return JSONResponse({"error": "LOOPBACK_ONLY"}, status_code=403)
        if origin and (urlsplit(origin).netloc != host or urlsplit(origin).scheme not in ("http", "https")):
            return JSONResponse({"error": "CROSS_ORIGIN_FORBIDDEN"}, status_code=403)
        path = request.url.path
        if path.startswith("/api/") or path in ("/boq/", "/boq/index.html"):
            bearer = request.headers.get("authorization", "")
            authenticated = secrets.compare_digest(bearer, "Bearer " + admin_token)
            cookie = request.cookies.get("boq_session", "")
            session = sessions.get(hashlib.sha256(cookie.encode()).hexdigest())
            valid_session = bool(session and session["expires"] > time.time())
            if not authenticated and not valid_session:
                return JSONResponse({"error": "AUTH_REQUIRED"}, status_code=401)
            if not authenticated and request.method not in ("GET", "HEAD"):
                if not secrets.compare_digest(request.headers.get("x-csrf-token", ""), session["csrf"]):
                    return JSONResponse({"error": "CSRF_REQUIRED"}, status_code=403)
            request.state.session = session if valid_session else None
        if request.method in ("POST", "PUT", "PATCH") and path != "/api/uploads":
            try:
                length = int(request.headers.get("content-length", "0"))
            except ValueError:
                return JSONResponse({"error": "INVALID_CONTENT_LENGTH"}, status_code=400)
            if request.headers.get("transfer-encoding") or length > 512 * 1024 or length < 0:
                return JSONResponse({"error": "REQUEST_TOO_LARGE"}, status_code=413)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"
        return response

    @app.exception_handler(ImportBlocked)
    async def blocked(request, error):
        code = str(error)
        status = 409 if "STALE" in code else 503 if code.startswith(("AI_NOT_CONFIGURED", "AI_PROVIDER", "AI_INVALID", "AI_INCOMPLETE")) else 422
        return JSONResponse({"error": code}, status_code=status)

    @app.post("/api/session")
    def login(request: Request):
        if not secrets.compare_digest(request.headers.get("authorization", ""), "Bearer " + admin_token):
            raise HTTPException(401)
        for key in list(sessions):
            if sessions[key]["expires"] <= time.time():
                del sessions[key]
        if len(sessions) >= 50:
            raise HTTPException(429, "Session limit")
        cookie, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        sessions[hashlib.sha256(cookie.encode()).hexdigest()] = {"csrf": csrf, "expires": time.time() + 8 * 3600}
        response = JSONResponse({"csrf": csrf})
        response.set_cookie("boq_session", cookie, httponly=True, samesite="strict", secure=request.url.scheme == "https", max_age=8 * 3600)
        return response

    @app.get("/api/session")
    def session(request: Request):
        return {"csrf": (request.state.session or {}).get("csrf", "")}

    @app.post("/api/logout")
    def logout(request: Request):
        sessions.pop(hashlib.sha256(request.cookies.get("boq_session", "").encode()).hexdigest(), None)
        response = JSONResponse({"ok": True})
        response.delete_cookie("boq_session")
        return response

    @app.get("/api/current")
    def current():
        return store.current()

    @app.get("/api/history")
    def history():
        return store.history()

    @app.post("/api/uploads")
    async def upload(request: Request):
        filename = unquote(request.headers.get("x-filename", "workbook.xlsx"))
        if not filename.lower().endswith(".xlsx"):
            raise HTTPException(415, "Only .xlsx supported; .xls/.xlsm require a separate adapter")
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > MAX_UPLOAD:
                raise HTTPException(413, "Upload exceeds 20 MiB")
        return await run_in_threadpool(store.upload, bytes(raw), filename)

    @app.post("/api/profiles/approve")
    def approve(body: Approval):
        if not body.confirmSemantics:
            raise ImportBlocked("SEMANTIC_REVIEW_REQUIRED")
        return store.approve(body.uploadId, body.profile, body.review)

    @app.post("/api/preview")
    def preview(body: Preview):
        return store.preview([x.model_dump() for x in body.inputs], body.expectedRevision)

    @app.post("/api/publish")
    def publish(body: Publish):
        if not body.confirm:
            raise ImportBlocked("PUBLISH_CONFIRMATION_REQUIRED")
        return store.publish(body.previewId, body.expectedRevision)

    @app.post("/api/rollback")
    def rollback(body: Rollback):
        if not body.confirm:
            raise ImportBlocked("ROLLBACK_CONFIRMATION_REQUIRED")
        return store.rollback(body.revision, body.expectedRevision, body.reason)

    def ai_payload(upload_id):
        current = store.current()["data"]
        counts = {}
        for portfolio, _, year in baseline_keys(current):
            counts[(portfolio, year)] = counts.get((portfolio, year), 0) + 1
        scopes = [{"portfolio": p, "year": y, "count": n} for (p, y), n in sorted(counts.items())]
        return mapping_payload(Workbook(store.raw(upload_id)), scopes)

    @app.get("/api/ai-payload/{upload_id}")
    def ai_sample(upload_id: str):
        return ai_payload(upload_id)

    @app.post("/api/ai-suggest")
    def ai_suggest(body: Suggest):
        if not body.consentToSendSamples:
            raise ImportBlocked("AI_SAMPLE_SHARING_CONSENT_REQUIRED")
        return suggest_mapping(ai_payload(body.uploadId))

    @app.get("/")
    def index():
        return FileResponse(ui / "index.html")

    @app.get("/ui/{filename}")
    def ui_file(filename: str):
        if filename not in ("app.js", "styles.css"):
            raise HTTPException(404)
        return FileResponse(ui / filename)

    @app.get("/boq/bootstrap.js")
    def dashboard_bridge():
        return Response("""window.FINANCE_DATA_PROMISE=fetch('/api/current',{credentials:'same-origin'}).then(async r=>{if(!r.ok)throw Error('Session expired');const s=await r.json();window.BOQ_REVISION=s.revision;return s.data;});
window.FINANCE_DATA_PROMISE.then(d=>{window.addEventListener('load',()=>{const e=document.querySelector('.notice span');if(e)e.textContent='Private reviewed snapshot • Revision '+window.BOQ_REVISION.slice(0,12)+' • AP ไม่ใช่ยอดเงินผ่านธนาคาร; งวดจ่ายที่ไม่ได้ยืนยันจะไม่ถูกแบ่งจากยอดรายปี';});});
""", media_type="text/javascript")

    @app.get("/boq/")
    @app.get("/boq/index.html")
    def dashboard():
        target = assets / "index.html"
        if not target.exists():
            raise HTTPException(503, "Dashboard assets unavailable; run bootstrap from a full repository checkout")
        html = target.read_text(encoding="utf-8")
        # The original data loader injects historical hardcoded notes. Replace it only in this private service.
        import re
        html, count = re.subn(r'<script\s+src="data.js[^\"]*"\s*></script>', '<script src="/boq/bootstrap.js"></script>', html)
        if count != 1:
            raise HTTPException(503, "Legacy data loader changed; adapter review required")
        html = html.replace('href="../"', 'href="/"').replace('href="../work-monitor/"', 'href="/"')
        return HTMLResponse(html)

    @app.get("/boq/{filename}")
    def dashboard_asset(filename: str):
        if filename not in ("app.js", "styles.css") or not (assets / filename).is_file():
            raise HTTPException(404)
        if filename == "app.js":
            source = (assets / filename).read_text(encoding="utf-8")
            for marker in ("function latestLabel(y){", "function pendingLabel(y){"):
                if source.count(marker) != 1:
                    raise HTTPException(503, "Legacy dashboard contract changed; adapter review required")
                source = source.replace(marker, marker + " if(y?.installmentDataAvailable===false)return 'ยังไม่ยืนยันรายงวด';")
            marker = "function renderSource(){"
            if source.count(marker) != 1:
                raise HTTPException(503, "Legacy source label contract changed; adapter review required")
            source = source.replace(marker, marker + " $('sourceNote').textContent='Private revision '+window.BOQ_REVISION+' • ขอบเขตและวันที่อ้างอิง: ดูประวัตินำเข้า'; return;")
            return Response(source, media_type="text/javascript")
        return FileResponse(assets / filename)

    return app


def main():
    parser = argparse.ArgumentParser(description="BOQ private ingestion pilot (loopback only)")
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--assets", type=Path, default=Path("boq"))
    parser.add_argument("--port", type=int, default=8788)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    state = args.state.resolve()
    if state == repo or repo in state.parents:
        raise SystemExit("State must be outside the public repository")
    token = os.environ.get("BOQ_ADMIN_TOKEN")
    if not token or len(token) < 32:
        raise SystemExit("BOQ_ADMIN_TOKEN must be a random secret with at least 32 characters")
    baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
    store = Store(state, baseline)
    import uvicorn
    uvicorn.run(create_app(store, args.assets.resolve(), repo / "boq-import", token), host="127.0.0.1", port=args.port, access_log=False)


if __name__ == "__main__":
    main()

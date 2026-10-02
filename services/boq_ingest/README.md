# BOQ reviewed Excel ingestion — local pilot

**Status: implementation and synthetic tests, not production-ready.** No real BOQ/ERP workbook was accessible during this implementation. The original public `/boq/` and its deployment workflow are unchanged. This service is intentionally loopback-only. Publishing here changes the private service snapshot, **not GitHub Pages**.

## Implemented

Upload up to eight `.xlsx` files; inspect values, formulas, cached values, merges, hidden rows/sheets, number-format IDs and fills. Immutable, manually approved mapping profiles are matched by structural fingerprint **and exact header anchors**, plus a machine-verified operating year and exact source contract/project identities. Each mapped financial field must replace the complete existing portfolio/year scope. Missing values, unknown plot IDs, duplicates, incomplete scopes, mismatched control totals, unexpected sheets and unsupported formulas block publication.

Financial arithmetic uses `Decimal`. Financial source cells must evaluate to numeric values; numeric text is blocked rather than coerced. `SUM` preserves reference types and ignores text/boolean/blank references, including supported formula-result text. Unknown formula/coercion semantics block. Formula caches are never trusted: only same-sheet arithmetic and `SUM(A1:B2)` ranges are recomputed. **This is not a general Excel calculation engine**: XLOOKUP/VLOOKUP/IF, cross-sheet formulas, shared/array formulas, external relationships, macros and legacy `.xls` are blocked rather than silently approximated. Styles are inspected, not interpreted as payment semantics. Borders/fonts/comments are not yet included in the inspector.

Review -> preview/diff/cell provenance -> explicit publish. SQLite stores private original bytes, approved profiles, immutable snapshots and audit events. Publication re-extracts on the server, checks the current revision transactionally and is idempotent. Rollback creates a new revision. Raw files/DBs are never statically served, placed in the repo or published to GitHub.

The adapter accepts **annual BOQ budget and/or cumulative AP balance tables**, including multiple sheet regions with different columns/years. It does not yet classify raw transaction descriptions, infer fiscal/care years, interpret highlighted rows, split mixed-year ERP postings, allocate installments, or import new plots/contracts. A raw transaction export must NOT be approved as an annual balance table. The current JSON mapping editor is intended for the initial data reviewer; staff can reuse approved profiles afterward.

## Run from a complete checkout (Python 3.11+ and Node)

```bash
python -m venv .venv
# Activate .venv for your shell first.
python -m pip install -r services/boq_ingest/requirements.txt
python -m services.boq_ingest.bootstrap --state ../boq-private
export BOQ_ADMIN_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
python -m services.boq_ingest.api \
  --state ../boq-private \
  --baseline ../boq-private/baseline.json \
  --assets ../boq-private/assets
```

Open `http://127.0.0.1:8788`, enter the local admin token, then upload. On Windows use the equivalent PowerShell environment-variable syntax. POSIX permissions are tightened to 0700/0600; on Windows configure private-directory ACLs separately. Never put the admin token or OpenAI key into a URL, source file, PR or browser storage. Do not share a local admin token with a production team.

Bootstrap runs the existing legacy validator/build in a **temporary copy** and copies only the built snapshot and dashboard assets into private storage. It refuses to overwrite an existing state. Baseline generation from the full repo is not verified in this restricted runtime; run it locally before UAT. Existing assets are served through an explicit allowlist. The original `data.js` (which injects historical hardcoded notices) is replaced at runtime with an authenticated loader. Annual changes invalidate previously inferred installment allocations; the private dashboard labels them unconfirmed rather than fabricating a new allocation.

## Mapping profile example (coordinates are examples, not the user's real format)

```json
{
  "schema_version": 2,
  "name": "Reviewed annual AP balances",
  "layout_hash": "COPY_THE_LAYOUT_HASH_FROM_INSPECTION",
  "semantics": "boq-budget_and_or_cumulative-ap-postings",
  "regions": [{
    "sheet": "ปี3", "portfolio": "forest65_external", "year": 3,
    "year_anchor": {"kind": "sheet_name"},
    "start_row": 2, "end_row": 161,
    "columns": {"plotCode": "A", "contractNo": "D", "projectCode": "G", "boq": "B", "paid": "C"},
    "header_cells": {"A1": "รหัสแปลง", "B1": "BOQ", "C1": "AP สะสม", "D1": "เลขที่สัญญา", "G1": "รหัสโครงการ"},
    "totals": {"boq": "B162", "paid": "C162"},
    "ignored_rows": {}
  }],
  "ignored_sheets": {"คำอธิบาย": "Reviewed explanatory sheet, no financial rows"}
}
```

A region can map only `boq` or only `paid`, but always needs `plotCode`, `contractNo`, `projectCode` and a control-total cell for every financial field. Different files can provide different fields for the same scope; overlapping field scopes are blocked. Every mapped column needs a nonempty exact header anchor before the data rows. The required `year_anchor` reads either the sheet name or a cell before the data rows (e.g. `{"kind":"cell","cell":"H1"}`). Its entire value must be an operating-year number or a supported label such as `ปี3`, `ปีที่ 3`, `Year 3` or `care year 3`, matching `year`. Calendar years or ambiguous prose are not inferred. Use a reviewed source-specific adapter for unsupported layouts; there is no unchecked year default. Source contract IDs must match the baseline year-specific contract when present, otherwise the plot contract. An explicitly empty year contract never falls back to a different year's contract. Missing identity columns, blank contract identities and ambiguous baseline keys block; the pilot does not invent a contract for uncontracted community rows. The displayed scope must still be checked for every publication.

The current adapter updates category totals using the difference between old and new scoped AP balances, preserving other years/categories and the existing unmatched AP residual. **This assumes old and new paid balances use the same AP recognition/allocation basis.** A reviewer must verify that assumption, the preserved unmatched residual and baseline authority. Workbook-highlight estimates must not be replaced with an unrelated cash or transaction total under this mapping. Mixed-basis data requires a source-specific adapter, not manual bypass of gates. Control totals within 0.01 are a numerical check, not proof of semantic correctness.

## AI boundary

AI is optional and off until a server-side OpenAI key and `BOQ_AI_MODEL` are configured. Use the secure OpenAI key setup flow; never paste the key into the mapping editor. The UI first shows the exact masked-amount/text sample, requires explicit consent, then requests a suggestion. Text samples may still contain names or identifiers. Requests use the Responses API with `store:false` and no tools. `store:false` is not a promise of zero provider retention.

Model output is validated against an allowlisted Pydantic profile. It cannot execute code, invent cell values, approve its own mapping or publish. Missing configuration, incomplete output and provider failures produce explicit errors. A live provider call was **not tested**; only the offline boundary tests were run. Official contract: https://developers.openai.com/api/docs/guides/structured-outputs

## Verify

```bash
python -m unittest discover -s services/boq_ingest/tests -v
node --check boq-import/app.js
```

Fixtures are synthetic and generated in memory, not company files. Tests cover missing values, formula caches, unsupported formulas, exact `(1)` IDs, duplicate/unmapped rows, controls, complete scopes, profile drift, rejected active content, replay, concurrent revisions, rollback, authentication, CSRF, private storage and AI consent.

## Remaining release gates

1. Validate actual BOQ65, community66, external66 and raw ERP/AP files against an accountant-approved golden dataset; implement the source-specific adapters that the evidence requires. Verify color semantics, merged hierarchies, formula coverage, VAT/withholding/credit notes, duplicate worksheets, mixed-year postings and unmatched residuals.
2. Verify the fully built legacy dashboard and all aggregate/contract-card metrics with real data. In particular, BOQ contract-total metadata and source-specific dates need explicit source adapters, not inferred promises.
3. Run a live AI suggestion with the configured account/model and approved sample-sharing policy. Review suggestions independently of model confidence.
4. Before shared deployment: replace the local shared token with SSO and per-user roles, TLS, CSRF review, process-isolated workbook workers, request/time/memory limits, backups, retention/deletion controls, malware scanning and deployment-specific operational testing. Current actor is honestly recorded as `local-admin`.

No automatic merge, CI changes, production deployment, or public data publication is included.

## Validation recorded for this branch

- Python unit/API tests: 48 passed on synthetic fixtures.
- JavaScript syntax check: passed.
- Chromium DOM workflow using an in-process FastAPI transport: login, upload, mapping approval, preview, explicit publication, rollback and profile reuse passed; mobile width 390px had no horizontal overflow and no JavaScript runtime errors.
- Actual browser navigation to the local HTTP server was blocked by the execution environment (`ERR_BLOCKED_BY_ADMINISTRATOR`). The DOM test is **not network end-to-end verification**.
- Full legacy dashboard visual QA, baseline bootstrap from a complete checkout, original company Excel reconciliation, and a live AI provider call remain unverified.

## Review fixes R1-R6 (2026-10-02)

This is a breaking safety upgrade of the pilot mapping/API contract, not a production release.

- V1 profiles are not auto-reused. Upload skips legacy profiles safely; selecting an old profile explicitly returns `PROFILE_UPGRADE_REVIEW_REQUIRED`. Re-review and approve a V2 profile with operating-year evidence and source identity columns. Old inputs, profiles and snapshots are retained for audit; no silent migration/deletion occurs.
- BOQ-only updates preserve payment bounds/confidence and the existing ERP date. Dependent balances use the existing bounds; an unknown upper bound remains unknown. A new reviewed AP source, not a budget change, may resolve an AP range.
- Confirmed zero updates payment evidence/status even without a numeric delta. Preview includes `numericChanged`, `evidenceChanged`, before/after evidence and per-field provenance; the UI identifies evidence-only changes. No annual update invents installment allocation.
- Every input/profile edit invalidates the frontend generation. Delayed preview results for an older generation or different input set are discarded, even after changing a selection back. Invalid/partial uploads also clear prior publication consent.
- `POST /api/publish` now requires `inputs: [{uploadId, profileId}]` in addition to `previewId`, `expectedRevision` and `confirm`. The server compares the exact input/profile set with the immutable preview **before** publication or idempotent replay; mismatches return HTTP 409. Empty inputs or old API bodies return 422. The current revision guard and server re-extraction remain enforced.

Regression commands:

```bash
python -m unittest discover -s services/boq_ingest/tests -v
node --check boq-import/app.js
# Optional test-only dependency: Python Playwright and an installed Chromium browser.
python services/boq_ingest/tests/ui_review_regressions.py --output /tmp/boq-ui-results.json
```

Verified for this fix: 74 Python unit/API tests (48 original assertions retained under V2 fixtures plus 26 regression test methods), 8 Chromium DOM/mocked-HTTP scenarios and JavaScript syntax. The exact old text-formula case now sums to 80, blocks the financial row, and cannot publish through the API. A real loopback HTTP API responds 200; Chromium HTTP navigation is still blocked by the execution environment. DOM/mock results are not network E2E. The original raw-workbook, full legacy dashboard, live-AI and shared-deployment gates above remain open.

# BOQ upload runtime

The files in `app.bundle-*.b64` are pinned input templates, not the final deployed runtime. Do not edit or combine those templates by hand.

From a clean checkout run:

```sh
python boq/build.py
node --check boq/upload.source.js
BOQ_SOURCE_PATH=boq/upload.source.js node boq/tests/runtime-regression.cjs
```

`build-runtime.py` applies reviewed reconciliation changes to a SHA-256-pinned source. `build.py` then enforces the distinction between work stages and ERP payment installments. The output is plain `upload.source.js`, gzip bundles, an updated loader/index version and `BUILD-AUDIT.json`. GitHub Pages builds and runs regression tests before deployment. The dedicated runtime workflow also checks the actual SheetJS 0.20.3 dependency and exports a build/test artifact.

A bare source checkout must be built before serving. Re-running the build requires a clean checkout because build inputs are pinned. The SHA guard deliberately stops deployment when base templates change unexpectedly.

## Financial evidence rules

- ERP records can only match the same project, exact plot/unit and operation year. Unknown and mixed years remain separate.
- Missing payment data is unknown, not zero or proof of nonpayment.
- Progress/completion/submission is not evidence of a cash payment.
- Work-stage numbers in Progress/monitor files must not be equated to ERP installment numbers without an explicitly verified payment-plan mapping. Supplied unpaid-installment values in a direct report are retained.
- ERP/AP amounts are ledger evidence; this application does not independently verify bank transfers.
- Production workbooks and transaction-level financial data are not committed to the repository or CI fixtures. Regression fixtures are synthetic.

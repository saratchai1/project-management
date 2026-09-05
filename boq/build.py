"""Build the upload application from pinned templates, enforcing financial evidence rules."""
from pathlib import Path
import runpy, base64, gzip, hashlib, json
ROOT = Path(__file__).resolve().parent
runpy.run_path(str(ROOT / 'build-runtime.py'))
source = (ROOT / 'upload.source.js').read_text(encoding='utf-8')
old = "if (matched && typeof record.operationYear === 'number' && record.knownInstallments?.length) {"
new = "if (matched && record.installmentBasis === 'erp-payment-plan' && typeof record.operationYear === 'number' && record.knownInstallments?.length) {"
if source.count(old) != 1:
    raise SystemExit('Unexpected installment inference code: manual review required')
source = source.replace(old, new)
anchor = "    record.unpaidInstallments = sortInstallments(record.unpaidInstallments || []);"
warning = """    if (!record.unpaidProvided && matched && (record.sourceKinds.has('progress') || record.sourceKinds.has('monitor')) && record.installmentBasis !== 'erp-payment-plan') {
      record.qualityHints.push('ยังไม่ยืนยันตารางเทียบงวดงาน/BOQ กับงวดเงิน ERP จึงไม่สรุปงวดค้างอัตโนมัติ');
    }
"""
if source.count(anchor) != 1:
    raise SystemExit('Unexpected finalization code: manual review required')
source = source.replace(anchor, warning + anchor)
source = source.replace("item.includes('ไม่สอดคล้อง')", "item.includes('ไม่สอดคล้อง') || item.includes('ตารางเทียบงวด')")
(ROOT / 'upload.source.js').write_text(source, encoding='utf-8')
parts = ['app.bundle-01.b64', 'app.bundle-02a.b64', 'app.bundle-02b.b64', 'app.bundle-03.b64']
archive = base64.b64encode(gzip.compress(source.encode('utf-8'), mtime=0)).decode('ascii')
if len(archive) > 40000:
    raise SystemExit('Bundle manifest capacity exceeded')
for i, part in enumerate(parts):
    (ROOT / part).write_text(archive[i * 10000:(i + 1) * 10000], encoding='ascii')
version = '20260905-2'
for name in ['app.js', 'index.html']:
    content = (ROOT / name).read_text(encoding='utf-8').replace('20260905-1', version)
    if name == 'index.html':
        content = content.replace('งวดคงเหลือเทียบเฉพาะรายการที่นำเข้า</p>', 'งวดงานและงวดเงินอาจใช้คนละนิยาม ต้องยืนยันตารางเทียบก่อนสรุปงวดค้าง</p>')
    (ROOT / name).write_text(content, encoding='utf-8')
audit = json.loads((ROOT / 'BUILD-AUDIT.json').read_text())
audit.update(version=version, compiledSourceSha256=hashlib.sha256(source.encode()).hexdigest(), installmentPolicy='No automatic work-stage to ERP-installment mapping without explicit payment-plan basis')
(ROOT / 'BUILD-AUDIT.json').write_text(json.dumps(audit, indent=2), encoding='utf-8')
print('Built final BOQ runtime', version, audit['compiledSourceSha256'])

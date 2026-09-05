from pathlib import Path
import re, gzip, base64, hashlib, json
R=Path(__file__).resolve().parent
PARTS=['app.bundle-01.b64','app.bundle-02a.b64','app.bundle-02b.b64','app.bundle-03.b64']
s=gzip.decompress(base64.b64decode(''.join((R/p).read_text().strip() for p in PARTS))).decode()
BASE_SHA='76cc4fab41e3b79f4ac5911577a5e6d9c7883fad522b2d0e25c1f7534d42f390'
if hashlib.sha256(s.encode()).hexdigest()!=BASE_SHA: raise SystemExit('Base upload source changed; review build inputs before applying corrections')
def function(name, code):
 global s
 start=s.index('  function '+name+'(')
 end=s.find('\n  function ',start+1)
 if end<0: raise ValueError(name)
 s=s[:start]+code.rstrip()+'\n'+s[end:]
# Keep worksheet row coordinates intact until after merged cells are expanded.
s=s.replace("header: 1, raw: true, defval: '', blankrows: false", "header: 1, raw: true, defval: '', blankrows: true")
# A direct report is a snapshot: blanks must not inherit a different project's metadata.
start=s.index("      ['projectCode', 'category', 'tverName', 'tokenType', 'operationYear'].forEach")
end=s.index('\n\n      const contractValue',start)
s=s[:start]+"      if (Object.values(values).every(isBlank)) continue;"+s[end:]
s=s.replace("knownInstallments: [],\n          submittedInstallments: [],", "knownInstallments: [],\n          installmentValues: {},\n          submittedInstallments: [],",1)
s=s.replace("const installmentContract = toNumber(row[contractCol]);", "const installmentContract = toNumber(row[contractCol]);\n          if (installmentContract !== null) current.installmentValues[installment] = installmentContract;")
# Do not infer the category from task comments such as a community-fund activity.
s=s.replace("category: inferCategory(`${contextText} ${rowText}`, '', rawSheet.fileName),", "category: inferCategory(contextText, '', rawSheet.fileName),")
function('rebuildRecords',r'''  function rebuildRecords() {
    const transactions = dedupeTransactions(state.sources.transactions);
    const transactionGroups = groupTransactions(transactions);
    const projectByUnit = new Map();
    const categoryByProject = new Map();
    transactions.forEach((t) => {
      const unit = normalizePlotKey(t.plotCode);
      if (!projectByUnit.has(unit)) projectByUnit.set(unit, new Set());
      if (t.projectCode) projectByUnit.get(unit).add(t.projectCode);
      if (t.projectCode && t.category) categoryByProject.set(compactText(t.projectCode), t.category);
    });
    const baseSources = [...state.sources.direct, ...state.sources.progress, ...state.sources.monitor, ...state.manualRecords];
    const bases = [];
    baseSources.forEach((record) => {
      const incoming = cloneBaseRecord(record);
      const projects = [...(projectByUnit.get(normalizePlotKey(incoming.plotCode)) || [])];
      if (!incoming.projectCode && projects.length === 1) incoming.projectCode = projects[0];
      if (!incoming.projectCode && projects.length > 1) incoming.qualityHints.push('รหัสแปลงเดียวกันพบหลายรหัสโครงการ จึงไม่เติมรหัสโครงการอัตโนมัติ');
      if (!['direct', 'manual'].includes(incoming.sourceKind) && categoryByProject.has(compactText(incoming.projectCode))) {
        incoming.category = categoryByProject.get(compactText(incoming.projectCode));
      }
      const candidates = bases.filter((target) => baseRecordsCompatible(target, incoming));
      if (candidates.length === 1) mergeBaseRecord(candidates[0], incoming);
      else {
        if (candidates.length > 1) incoming.qualityHints.push('พบข้อมูลฐานรหัสแปลง/ปีเดียวกันหลายแถว จึงยังไม่รวมอัตโนมัติ');
        bases.push(incoming);
      }
    });
    // Match against base records only. Never reuse an ERP-only row as a base for another year.
    const records = [...bases];
    transactionGroups.forEach((group) => {
      const unitCandidates = bases.filter((r) => group.plotCode && normalizePlotKey(r.plotCode) === normalizePlotKey(group.plotCode)
        && (!r.projectCode || !group.projectCode || compactText(r.projectCode) === compactText(group.projectCode)));
      const exact = group.operationYear != null
        ? unitCandidates.filter((r) => operationYearKey(r.operationYear) === operationYearKey(group.operationYear)) : [];
      if (exact.length === 1) applyTransactionGroup(exact[0], group);
      else {
        const warning = group.mixedYear ? 'รายการ ERP รวมหลายปี จึงเก็บยอดแยกและไม่กระจายเข้าปีใดปีหนึ่ง'
          : group.operationYear == null ? 'ERP ไม่ระบุปีดำเนินงาน จึงไม่เดาปีจาก BOQ'
          : exact.length > 1 ? 'พบข้อมูลฐานปีเดียวกันมากกว่า 1 แถว จึงยังไม่จัดสรรยอด'
          : 'ไม่พบ BOQ/ข้อมูลฐานที่ตรงทั้งรหัสโครงการ รหัสแปลง และปีดำเนินงาน';
        records.push(createErpOnlyRecord(group, warning));
      }
    });
    records.forEach((r) => finalizeRecord(r, transactions.length > 0));
    state.records = records.filter((r) => r.projectCode || r.plotCode || r.tverName || r.contractValue !== null || r.paidAmount !== null);
    state.records.sort((a, b) => compareRecords(a, b, 'balance-desc'));
  }

  function operationYearKey(value) {
    const parsed = parseOperationYear(value);
    return parsed == null ? '' : String(parsed);
  }

  function dedupeTransactions(items) {
    // Same ledger line copied between sheets/files is counted once. Preserve occurrence count within one sheet.
    const localCounts = new Map();
    const seen = new Set();
    return items.filter((item) => {
      const local = JSON.stringify([item.sourceFile, item.sourceSheet, item.id]);
      const occurrence = (localCounts.get(local) || 0) + 1;
      localCounts.set(local, occurrence);
      const key = JSON.stringify([item.id, occurrence]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }''')
function('baseRecordsCompatible',r'''  function baseRecordsCompatible(target, incoming) {
    const tp = compactText(target.projectCode), ip = compactText(incoming.projectCode);
    if (tp && ip && tp !== ip) return false;
    if (operationYearKey(target.operationYear) !== operationYearKey(incoming.operationYear)) return false;
    const tplot = normalizePlotKey(target.plotCode), iplot = normalizePlotKey(incoming.plotCode);
    if (tplot || iplot) return Boolean(tplot && iplot && tplot === iplot);
    const tt = compactText(target.tverName), it = compactText(incoming.tverName);
    if (tt || it) return Boolean(tt && it && tt === it && (!tp || !ip || tp === ip));
    return Boolean(tp && ip && tp === ip && compactText(target.category) === compactText(incoming.category));
  }''')
# Preserve monetary installment values when merging BOQ and monitoring records.
s=s.replace("target.knownInstallments = uniqueInstallments(", "target.installmentValues = { ...(target.installmentValues || {}), ...(incoming.installmentValues || {}) };\n    target.knownInstallments = uniqueInstallments(",1)
# Track unallocated multi-installment amounts separately from single-installment evidence.
s=s.replace("installmentNet: new Map(),", "installmentNet: new Map(),\n          ambiguousInstallments: new Set(),",1)
s=s.replace("if (!group.mixedYear) {\n        installments.forEach", "if (installments.length > 1) installments.forEach((i) => group.ambiguousInstallments.add(i));\n      if (!group.mixedYear) {\n        installments.forEach",1)
s=s.replace("record._erpPaid += group.amount;", "record._ambiguousInstallments = new Set([...(record._ambiguousInstallments || []), ...(group.ambiguousInstallments || [])]);\n    record._erpPaid += group.amount;",1)
function('finalizeRecord',r'''  function finalizeRecord(record, hasErp) {
    record.qualityHints = [...new Set((record.qualityHints || []).filter(Boolean))];
    record.sourceRefs = [...new Set(record.sourceRefs || [])];
    record.sourceKinds = record.sourceKinds instanceof Set ? record.sourceKinds : new Set(record.sourceKinds || []);
    const matched = Boolean(record._erpMatched);
    record.paymentEvidence = record.paidProvided ? 'provided' : matched ? 'erp-ap' : 'none';
    if (!record.paidProvided) record.paidAmount = matched ? roundMoney(record._erpPaid) : null;
    if (record.paidProvided && matched && Math.abs(record.paidAmount - record._erpPaid) > 0.01) {
      record.qualityHints.push('ยอดรายงานที่ระบุเองต่างจาก ERP ที่จับคู่ได้ — ใช้ยอดจากรายงานและไม่บวก ERP ซ้ำ');
    }
    const net = record._erpInstallmentNet || new Map();
    const positive = [...net.entries()].filter(([, amount]) => amount > 0.005).map(([i]) => String(i));
    if (!record.latestProvided && positive.length) record.latestPaidInstallment = sortInstallments(positive).at(-1) || '';
    record.unpaidStatusKnown = Boolean(record.unpaidProvided);
    if (!record.unpaidProvided) {
      record.unpaidInstallments = [];
      if (matched && typeof record.operationYear === 'number' && record.knownInstallments?.length) {
        record.unpaidStatusKnown = true;
        record.unpaidInstallments = record.knownInstallments.filter((installment) => {
          const amount = net.get(String(installment));
          if (amount == null || amount <= 0.005) return true;
          const expected = record.installmentValues?.[installment];
          if (expected != null && record._ambiguousInstallments?.has(String(installment))) {
            record.qualityHints.push('ERP รวมหลายงวดและไม่มีจำนวนเงินแยกงวด จึงยังยืนยันการจ่ายครบรายงวดไม่ได้');
            return true;
          }
          return expected != null && amount < expected - 0.01;
        });
        record.qualityHints.push('งวดคงเหลือเทียบเฉพาะ ERP ที่นำเข้า ไม่ใช่การยืนยันว่าโอนเงินหรือค้างชำระจริง');
      }
    }
    record.unpaidInstallments = sortInstallments(record.unpaidInstallments || []);
    if (!record.balanceProvided) record.balance = record.contractValue !== null && record.paidAmount !== null
      ? roundMoney(record.contractValue - record.paidAmount) : null;
    if (!record.category) record.category = inferCategory(record.tverName, record.projectCode, record.sourceFile);
    if (!record.tokenType) record.tokenType = inferTokenType(`${record.tverName} ${record.sourceFile}`);
    const quality = [...record.qualityHints];
    if (!record.projectCode) quality.push('ไม่มีรหัสโครงการ');
    if (!record.plotCode) quality.push('ไม่มีรหัสแปลง');
    if (record.contractValue === null) quality.push('ไม่มีมูลค่าสัญญา');
    if (record.paidAmount === null) quality.push(hasErp ? 'ยังไม่พบ ERP ที่จับคู่ได้ตรงปี — ไม่ถือว่ายอดจ่ายเป็นศูนย์' : 'ไม่มีข้อมูลยอดจ่าย');
    if (record.contractValue !== null && record.paidAmount !== null && record.paidAmount > record.contractValue + 1) quality.push('ยอดจ่ายสูงกว่ามูลค่าสัญญา');
    if (record.balanceProvided && record.contractValue !== null && record.paidAmount !== null && Math.abs(record.balance - (record.contractValue - record.paidAmount)) > 1) quality.push('ยอดคงเหลือไม่สัมพันธ์กับมูลค่าสัญญาและยอดจ่าย');
    record.quality = [...new Set(quality)];
    record.status = paymentStatus(record);
    record.paymentRate = record.contractValue && record.paidAmount !== null ? record.paidAmount / record.contractValue * 100 : null;
    record.id = JSON.stringify([record.projectCode, normalizePlotKey(record.plotCode), operationYearKey(record.operationYear), record.tverName, record.sourceRow]);
    delete record._erpPaid; delete record._erpMatched; delete record._erpInstallmentNet; delete record._erpFiles; delete record._ambiguousInstallments;
  }''')
function('parseOperationYear',r'''  function parseOperationYear(value) {
    if (isBlank(value)) return null;
    if (typeof value === 'number') return Number.isInteger(value) && value > 0 && value < 100 ? value : null;
    const source = toArabicDigits(text(value));
    const stripped = source.replace(/ปี(?:ดำเนินงาน)?\s*(?:ที่)?/g, '').trim();
    if (/^\d{1,2}(?:\s*\+\s*\d{1,2})+$/.test(stripped)) {
      const years = [...new Set(stripped.split('+').map(Number))].filter((v) => v > 0 && v < 100).sort((a,b) => a-b);
      return years.length > 1 ? years.join(' + ') : years[0] || null;
    }
    const match = source.match(/ปีที่\s*(\d{1,2})(?!\d)/);
    if (match) return Number(match[1]);
    return /^\d{1,2}$/.test(stripped) && Number(stripped) > 0 ? Number(stripped) : null;
  }''')
function('normalizeInstallmentValue',r'''  function normalizeInstallmentValue(value) {
    const source = text(value);
    // A mixed-year label is explanatory text, not a bag of installment numbers.
    if (/ปี/.test(source)) return source;
    const list = parseInstallmentList(value);
    return list.length === 1 ? list[0] : list.join(', ');
  }''')
# Add counts to retain the distinction between unknown values and real zeros.
s=s.replace("contract: roundMoney(contract),", "contractCount: records.filter((r) => r.contractValue !== null).length,\n      paidCount: records.filter((r) => r.paidAmount !== null).length,\n      balanceCount: records.filter((r) => r.balance !== null && r.contractValue !== null && r.paidAmount !== null).length,\n      installmentCount: records.filter((r) => r.unpaidStatusKnown).length,\n      contract: roundMoney(contract),",1)
s=s.replace("rate: contract > 0 ? (matchedPaid / contract) * 100 : 0", "rate: contract > 0 && records.some((r) => r.contractValue !== null && r.paidAmount !== null) ? (matchedPaid / contract) * 100 : null",1)
s=s.replace("const paidSub = metrics.unmatchedPaid > 0", "const paidSub = !metrics.paidCount ? 'ยังไม่มีข้อมูลยอดจ่าย — ไม่ถือว่าเป็นศูนย์' : metrics.unmatchedPaid > 0",1)
s=s.replace("value: formatMoney(metrics.contract),", "value: metrics.contractCount ? formatMoney(metrics.contract) : '—',",1)
s=s.replace("value: formatMoney(metrics.allPaid),", "value: metrics.paidCount ? formatMoney(metrics.allPaid) : '—',",1)
s=s.replace("value: formatMoney(metrics.balance),", "value: metrics.balanceCount ? formatMoney(metrics.balance) : '—',",1)
s=s.replace("value: `${integerFormat.format(unpaidInstallments)} งวด`, sub: `ยืนยันยอดจ่ายแล้ว ${numberFormat.format(metrics.rate)}% ของมูลค่าสัญญา`", "value: metrics.installmentCount ? `${integerFormat.format(unpaidInstallments)} งวด` : '—', sub: metrics.installmentCount ? 'เทียบข้อมูลรายงวด / ERP เฉพาะที่มีหลักฐาน' : 'ยังไม่มีข้อมูลเพียงพอให้ระบุงวดค้าง'",1)
s=s.replace("$('donutRate').textContent = `${numberFormat.format(metrics.rate)}%`;", "$('donutRate').textContent = metrics.rate == null ? '—' : `${numberFormat.format(metrics.rate)}%`;")
s=s.replace("'ยืนยันต่อสัญญา'", "'ERP / สัญญาที่ทราบ'")
# Export Summary must also leave unknown financial values blank.
s=s.replace("['มูลค่าสัญญารวม (บาท)', metrics.contract]", "['มูลค่าสัญญารวม (บาท)', metrics.contractCount ? metrics.contract : '']")
s=s.replace("['ยอดเงินที่จ่ายแล้วทั้งหมด (บาท)', metrics.allPaid]", "['ยอดเงินที่จ่ายแล้วทั้งหมด (บาท)', metrics.paidCount ? metrics.allPaid : '']")
s=s.replace("['ยอดคงเหลือที่คำนวณได้ (บาท)', metrics.balance]", "['ยอดคงเหลือที่คำนวณได้ (บาท)', metrics.balanceCount ? metrics.balance : '']")
s=s.replace("['อัตรายอดจ่ายยืนยันต่อมูลค่าสัญญา (%)', metrics.rate]", "['อัตรายอด ERP ต่อมูลค่าสัญญา (%)', metrics.rate ?? '']")
# Applying manual mapping replaces that sheet, not overlays a second set of values.
pos="    state.manualRecords = state.manualRecords.filter((record) => record.manualSheetId !== raw.id);"
s=s.replace(pos,"    Object.keys(state.sources).forEach((key) => { state.sources[key] = state.sources[key].filter((record) => record.sourceFile !== raw.fileName || record.sourceSheet !== raw.sheetName); });\n"+pos,1)
# Preserve project year from explicit project context / source filename, never voucher digits.
function('inferCategory',r'''  function inferCategory(value, projectCode = '', fileName = '') {
    const source = toArabicDigits(text(value));
    const known = { TCGMCR6508: ['2565', 'สำหรับบุคคลภายนอก'], TCGMCR6607: ['2565', 'สำหรับบุคคลภายนอก'], TCGMCR6609: ['2566', 'สำหรับชุมชน'], TCGMCR67003: ['2566', 'สำหรับบุคคลภายนอก'], TCGMCR67004: ['2566', 'สำหรับบุคคลภายนอก'] };
    const code = baseProjectCode(projectCode);
    const master = known[code];
    const explicit = source.match(/(?:ประจำปี(?:\s*พ\.?\s*ศ\.?)?|พ\.?\s*ศ\.?)\s*(25\d{2})(?!\d)/i) || source.match(/\(\s*ปี\s*(\d{2})\s*\)/i);
    const fileYear = toArabicDigits(fileName).match(/โครงการปลูกป่า\s*(25\d{2})(?!\d)/);
    const year = explicit ? (explicit[1].length === 2 ? '25' + explicit[1] : explicit[1]) : master?.[0] || fileYear?.[1] || '';
    const audience = master?.[1] || (/สำหรับชุมชน/.test(source) ? 'สำหรับชุมชน' : /บุคคลภายนอก|บุคลลภายนอก|ภายนอก|\b(?:STC|VSD)\b/i.test(source) ? 'สำหรับบุคคลภายนอก' : '');
    if (!/ปลูกป่า|คาร์บอน|mangrove|forest/i.test(source + ' ' + fileName) && !/^TCG/.test(code)) return '';
    return 'โครงการปลูกป่าชายเลน เพื่อประโยชน์จากคาร์บอนเครดิต' + (audience ? ' (' + audience + ')' : '') + (year ? ' ปี ' + year : '');
  }''')

# Keep totals and the absence of evidence clear in the visible report.
s=s.replace("const totalTransactions = dedupeBy(state.sources.transactions, (item) => item.id).length;", "const totalTransactions = dedupeTransactions(state.sources.transactions).length;")
s=s.replace("มูลค่าสัญญา ${formatMoney(metrics.contract)} • จ่ายแล้ว ${formatMoney(metrics.allPaid)}", "มูลค่าสัญญา ${metrics.contractCount ? formatMoney(metrics.contract) : 'ยังไม่มีข้อมูล'} • ยอดตามข้อมูลที่นำเข้า ${metrics.paidCount ? formatMoney(metrics.allPaid) : 'ยังไม่มีข้อมูล'}")
s=s.replace("item.includes('หลายโครงการ')", "item.includes('หลายโครงการ') || item.includes('ไม่สอดคล้อง')")
s=s.replace("label: 'งวดที่ยังไม่จ่าย'", "label: 'งวดคงเหลือ / ยังไม่พบ ERP'")
s=s.replace("sub: metrics.balance < 0 ? 'มียอดจ่ายเกินสัญญา' : 'เฉพาะแถวที่มีทั้งสัญญาและยอดจ่าย'", "sub: metrics.balance < 0 ? 'มียอดตามข้อมูลสูงกว่าสัญญา' : `คำนวณได้ ${metrics.balanceCount} จาก ${metrics.contractCount} แถวสัญญา`")
s=s.replace("if (donutLabel) donutLabel.textContent = 'ERP / สัญญาที่ทราบ';", "if (donutLabel) donutLabel.textContent = 'ERP ที่พบ / สัญญารวม';")


# The user's original 13-column workbook has a repeated Thai particle in the unpaid header.
s=s.replace("'งวดเงินที่ยังไม่จ่ายเงิน', 'งวดที่ยังไม่จ่ายเงิน'", "'งวดเงินที่ยังไม่จ่ายเงิน', 'งวดเงินที่... ที่ยังไม่จ่ายเงิน', 'งวดที่ยังไม่จ่ายเงิน'")
s=s.replace("const source = toArabicDigits(text(value));\n    const matches = [...source.matchAll(/\\d+(?:\\.\\d+)?/g)]", "const source = toArabicDigits(text(value)).replace(/\\*[^*]*\\*/g, '');\n    const matches = [...source.matchAll(/\\d+(?:\\.\\d+)?/g)]")
s=s.replace("$('stepUpload').classList.add('active');\n    showToast('ล้างข้อมูลทั้งหมดแล้ว');", "$('stepUpload').classList.add('active');\n    $('search').value = '';\n    ['categoryFilter', 'yearFilter', 'provinceFilter', 'tokenFilter', 'statusFilter'].forEach((id) => { $(id).value = ''; });\n    $('sortBy').value = 'balance-desc';\n    showToast('ล้างข้อมูลทั้งหมดแล้ว');")
function('renderYearChart', r"""  function renderYearChart(records) {
    const groups = new Map();
    records.forEach((r) => {
      const label = r.operationYear == null ? 'ไม่ระบุ' : String(r.operationYear);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(r);
    });
    const rows = [...groups].sort(([a], [b]) => numericLabelSort(a, b));
    if (!rows.length) { $('yearChart').innerHTML = '<div class="bar-empty">ยังไม่มีข้อมูลปีดำเนินงาน</div>'; return; }
    $('yearChart').innerHTML = rows.map(([label, group]) => {
      const m = paymentMetrics(group);
      const rate = m.rate == null ? 0 : clamp(m.rate, 0, 100);
      const balancePart = m.contractCount && m.paidCount ? 100 - rate : 0;
      const paid = group.some((r) => r.contractValue !== null && r.paidAmount !== null) ? formatCompactMoney(m.matchedPaid) : '—';
      const total = m.contractCount ? formatCompactMoney(m.contract) : '—';
      const note = m.unmatchedPaid > 0 ? ' • ERP ยังไม่มีสัญญา ' + formatCompactMoney(m.unmatchedPaid) : '';
      return `<div class="bar-row"><div class="bar-label">${label === 'ไม่ระบุ' ? 'ไม่ระบุปี' : 'ปีที่ ' + escapeHtml(label)}</div><div class="stacked-track" style="--paid:${rate}%;--remain:${balancePart}%"><span class="stacked-paid"></span><span class="stacked-remain"></span></div><div class="bar-value">${paid} / ${total}${note}</div></div>`;
    }).join('');
  }""")

(R/'upload.source.js').write_text(s,encoding='utf-8')
archive=base64.b64encode(gzip.compress(s.encode(),mtime=0)).decode()
if len(archive)>40000: raise SystemExit('Update the bundle manifest for the larger source')
for i,part in enumerate(PARTS):
    (R/part).write_text(archive[i*10000:(i+1)*10000],encoding='utf-8')
VERSION='20260905-1'
for name in ['app.js','index.html']:
    content=(R/name).read_text().replace('20260904-6',VERSION)
    if name=='index.html':
        note='<p class="review-note" id="dataBasisNote">v7 · ยอด ERP/AP เป็นยอดรายการบัญชี ไม่ใช่หลักฐานยืนยันการโอนเงิน · ช่องว่างหรือ — หมายถึงข้อมูลยังไม่พอ ไม่ใช่ศูนย์ · งวดคงเหลือเทียบเฉพาะรายการที่นำเข้า</p>'
        content=content.replace('<div class="filters">',note+'\n        <div class="filters">')
    (R/name).write_text(content,encoding='utf-8')
(R/'BUILD-AUDIT.json').write_text(json.dumps({'version':VERSION,'baseSourceSha256':BASE_SHA,'compiledSourceSha256':hashlib.sha256(s.encode()).hexdigest()},indent=2))
print('Built BOQ',VERSION,hashlib.sha256(s.encode()).hexdigest())

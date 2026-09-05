'use strict';
// Synthetic regression tests only. Never commit production financial workbooks.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const sourcePath = process.env.BOQ_SOURCE_PATH || path.resolve(__dirname, '../upload.source.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const init = "if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);\n  else init();";
assert.equal(source.split(init).length, 2, 'Exactly one UI initialization hook must exist');
const expose = 'globalThis.testApi = {state,rebuildRecords,baseRecordsCompatible,parseOperationYear,normalizePlotKey,extractPaymentContexts,reportRecordToArray,paymentMetrics,detectAndParseSheet,fillMergedCells,dedupeTransactions,inferCategory};';
function app() {
  const context = { console, Intl, Date, Set, Map, document: {}, window: {} };
  vm.createContext(context);
  vm.runInContext(source.replace(init, expose), context, { timeout: 5000 });
  return context.testApi;
}
function base(year, extra = {}) {
  return {projectCode:'TCGMCR6508',plotCode:'900-TEST',category:'',tverName:'',tokenType:'',province:'',contractArea:null,operationYear:year,contractValue:100,paidAmount:null,balance:null,latestPaidInstallment:'',knownInstallments:['1','2','3'],unpaidInstallments:[],submittedInstallments:[],completedInstallments:[],sourceKind:'progress',sourceFile:'synthetic.xlsx',sourceSheet:'BOQ',sourceRow:2,contractProvided:true,paidProvided:false,balanceProvided:false,latestProvided:false,unpaidProvided:false,qualityHints:[],...extra};
}
function transaction(year, amount, extra = {}) {
  return {id:'synthetic-'+String(year),projectCode:'TCGMCR6508',plotCode:'900-TEST',operationYear:year,operationYears:typeof year==='number'?[year]:[],amount,installments:['1'],sourceFile:'synthetic.xlsx',sourceSheet:'ERP',category:'test-category',qualityHints:[],...extra};
}
const results = [];
function test(name, fn) { try { fn(); results.push({name,ok:true}); console.log('PASS '+name); } catch(e) {results.push({name,ok:false,error:e.message}); console.error('FAIL '+name+': '+e.message);} }
function equal(a,b) {assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));}
test('ERP-only records never absorb a different operation year', () => {
 const a=app();a.state.sources.transactions=[transaction(1,10),transaction(2,20),transaction(3,30)];a.rebuildRecords();
 equal(a.state.records.map(r=>[r.operationYear,r.paidAmount]).sort(),[[1,10],[2,20],[3,30]]);
});
test('BOQ year 3 only matches ERP year 3',()=>{
 const a=app();a.state.sources.progress=[base(3)];a.state.sources.transactions=[transaction(1,10),transaction(2,20),transaction(3,30)];a.rebuildRecords();
 const r=a.state.records.find(r=>r.operationYear===3);assert.equal(r.paidAmount,30);assert.equal(r.balance,70);assert.equal(a.state.records.length,3);
});
test('Missing payment evidence is not zero or unpaid',()=>{
 const a=app();a.state.sources.progress=[base(3)];a.rebuildRecords();const r=a.state.records[0];
 assert.equal(r.paidAmount,null);assert.equal(r.balance,null);equal(r.unpaidInstallments,[]);assert.equal(r.unpaidStatusKnown,false);assert.equal(a.paymentMetrics(a.state.records).rate,null);
});
test('ERP without an operation year is not guessed from the only BOQ',()=>{
 const a=app();a.state.sources.progress=[base(3)];a.state.sources.transactions=[transaction(null,40)];a.rebuildRecords();assert.equal(a.state.records.find(r=>r.operationYear===3).paidAmount,null);assert.equal(a.state.records.length,2);
});
test('No matching ERP in the same year stays unknown',()=>{
 const a=app();a.state.sources.progress=[base(3)];a.state.sources.transactions=[transaction(1,40)];a.rebuildRecords();assert.equal(a.state.records.find(r=>r.operationYear===3).paidAmount,null);
});
test('Mixed-year records remain separate',()=>{
 const a=app();a.state.sources.progress=[base(2),base(3)];a.state.sources.transactions=[transaction('2 + 3',50,{mixedYear:true,operationYears:[2,3],installments:[],paymentContextLabel:'ปี 2 งวด 4 / ปี 3 งวด 1'})];a.rebuildRecords();assert.equal(a.state.records.length,3);assert.equal(a.state.records.find(r=>r.operationYear==='2 + 3').paidAmount,50);assert.equal(a.state.records.filter(r=>r.paidAmount===null).length,2);
});
test('Mixed-year snapshot plus ERP does not invent unpaid installments',()=>{
 const a=app();a.state.sources.direct=[base('2 + 3',{sourceKind:'direct',contractValue:null,paidAmount:50,paidProvided:true,latestPaidInstallment:'ปี 2 งวด 4 / ปี 3 งวด 1',latestProvided:true,knownInstallments:['ปี 2 งวด 4 / ปี 3 งวด 1']})];a.state.sources.transactions=[transaction('2 + 3',50,{mixedYear:true,installments:[]})];a.rebuildRecords();assert.equal(a.state.records.length,1);assert.equal(a.state.records[0].paidAmount,50);equal(a.state.records[0].unpaidInstallments,[]);assert.equal(a.state.records[0].unpaidStatusKnown,false);
});
test('No implicit payment of earlier missing installments',()=>{
 const a=app();a.state.sources.progress=[base(3,{installmentBasis:'erp-payment-plan'})];a.state.sources.transactions=[transaction(3,30,{installments:['3']})];a.rebuildRecords();equal(a.state.records[0].unpaidInstallments,['1','2']);
});
test('Partial installment is not marked fully settled',()=>{
 const a=app();a.state.sources.progress=[base(3,{installmentBasis:'erp-payment-plan',knownInstallments:['1'],installmentValues:{'1':100}})];a.state.sources.transactions=[transaction(3,30)];a.rebuildRecords();equal(a.state.records[0].unpaidInstallments,['1']);
});
test('Combined-installment amount counted once, allocation not invented',()=>{
 const a=app();a.state.sources.progress=[base(3,{installmentBasis:'erp-payment-plan',knownInstallments:['1','2'],installmentValues:{'1':50,'2':50}})];a.state.sources.transactions=[transaction(3,60,{installments:['1','2']})];a.rebuildRecords();assert.equal(a.state.records[0].paidAmount,60);equal(a.state.records[0].unpaidInstallments,['1','2']);assert(a.state.records[0].quality.some(s=>s.includes('ERP รวมหลายงวด')));
});
test('Duplicate sheets retain same-sheet multiplicity',()=>{
 const a=app();const t=transaction(1,10);a.state.sources.transactions=[t,{...t},{...t,sourceSheet:'ERP copy'},{...t,sourceSheet:'ERP copy'}];a.rebuildRecords();assert.equal(a.state.records[0].paidAmount,20);
});
test('Parenthesized plot IDs are distinct',()=>{const a=app();assert.notEqual(a.normalizePlotKey('1(1)-STC'),a.normalizePlotKey('11-STC'));});
test('Mixed and unknown operation years are lossless and distinct',()=>{const a=app();assert.equal(a.parseOperationYear('ปีที่ 2 + 3'),'2 + 3');assert.equal(a.parseOperationYear('3 + 2'),'2 + 3');assert.equal(a.baseRecordsCompatible(base(null),base(3)),false);assert.equal(a.baseRecordsCompatible(base('2 + 3'),base(3)),false);});
test('Community project metadata is not inferred from voucher digits',()=>{const a=app();const c=a.inferCategory('WO25120021 ปี 2569','TCGMCR6609','ledger.xlsx');assert(c.includes('สำหรับชุมชน'));assert(c.includes('2566'));assert(!c.includes('2512'));assert(!c.includes('2569'));});
test('Installment before year is retained',()=>{const a=app();equal(a.extractPaymentContexts('ค่าจ้าง งวดที่ 4 ปีที่ 1','S091001'),[{year:1,installments:['4']}]);});
test('Direct report round-trip retains mixed years and amounts',()=>{
 const a=app();const headers=['รหัสโครงการ','หมวดหมู่/ประเภทโครงการ','ชื่อโครงการ T-VER','ประเภท TOKEN X','รหัสแปลง','จังหวัด','เนื้อที่สัญญา (ไร่)','การดำเนินงานปีที่ ...','มูลค่าสัญญาปีที่ ....','งวดเงินล่าสุดที่จ่ายเงินแล้ว','งวดเงินที่ยังไม่จ่ายเงิน','ยอดเงินที่จ่ายแล้ว (บาท)','ยอดคงเหลือ (บาท)'];
 const rows=[headers,...[1,2,3,'2 + 3'].map((y,i)=>a.reportRecordToArray(base(y,{contractValue:null,paidAmount:(i+1)*10,latestPaidInstallment:typeof y==='string'?'ปี 2 งวด 4 / ปี 3 งวด 1':'1'})))];
 const parsed=a.detectAndParseSheet({rows,fileName:'synthetic-report.xlsx',sheetName:'Report'});assert.equal(parsed.kind,'direct');a.state.sources.direct=parsed.records;a.rebuildRecords();assert.equal(a.state.records.length,4);assert.equal(a.paymentMetrics(a.state.records).allPaid,100);assert(a.state.records.some(r=>r.operationYear==='2 + 3'));
});
test('Unknown money stays blank in the 13-column export',()=>{const a=app();const r=base(3,{contractValue:null});const row=a.reportRecordToArray(r);assert.equal(row.length,13);equal([row[8],row[11],row[12]],['','','']);});
test('Worksheet merges preserve physical blank-row coordinates',()=>{assert(source.includes("header: 1, raw: true, defval: '', blankrows: true"));const a=app();const rows=[['Header'],[],['X'],[]];a.fillMergedCells(rows,[{s:{r:2,c:0},e:{r:3,c:0}}]);assert.equal(rows[3][0],'X');assert.equal(rows[1][0],undefined);});
test('Progress work-stage numbers are not ERP payment installment numbers',()=>{
 const a=app();a.state.sources.progress=[base(3,{knownInstallments:['1','2','3'],installmentValues:{'1':40,'2':30,'3':30}})];a.state.sources.transactions=[transaction(3,10,{id:'p1'}),transaction(3,30,{id:'p2',installments:['2']}),transaction(3,30,{id:'p3',installments:['3']})];a.rebuildRecords();const r=a.state.records[0];assert.equal(r.paidAmount,70);assert.equal(r.balance,30);assert.equal(r.latestPaidInstallment,'3');assert.equal(r.unpaidStatusKnown,false);equal(r.unpaidInstallments,[]);assert(r.quality.some(q=>q.includes('ตารางเทียบงวด')));
});
test('A report with a latest installment alone is not a complete payment plan',()=>{
 const a=app();a.state.sources.direct=[base(3,{sourceKind:'direct',paidProvided:true,paidAmount:30,knownInstallments:['3'],latestProvided:true,latestPaidInstallment:'3'})];a.state.sources.transactions=[transaction(3,30,{installments:['3']})];a.rebuildRecords();assert.equal(a.state.records[0].unpaidStatusKnown,false);
});
if (process.env.BOQ_XLSX_PATH) test('Actual SheetJS 0.20.3 workbook read/write',()=>{
 const XLSX=require(path.resolve(process.env.BOQ_XLSX_PATH));assert.equal(XLSX.version,'0.20.3');const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['year','paid'],['2 + 3',50],[3,30]]),'Synthetic');const bytes=XLSX.write(w,{type:'buffer',bookType:'xlsx'});const back=XLSX.read(bytes,{type:'buffer'});equal(XLSX.utils.sheet_to_json(back.Sheets.Synthetic,{header:1}),[['year','paid'],['2 + 3',50],[3,30]]);
});
const report={ok:results.every(r=>r.ok),checks:results,sourceSha256:require('node:crypto').createHash('sha256').update(source).digest('hex')};
if(process.env.BOQ_TEST_REPORT) fs.writeFileSync(process.env.BOQ_TEST_REPORT,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(!report.ok) process.exitCode=1;

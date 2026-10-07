const fs=require('fs');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
const near=(a,b,t=0.05)=>Math.abs(Number(a)-Number(b))<=t;
const round2=n=>Number(Number(n||0).toFixed(2));
const dataPath='boq/finance-data.json';
const deltaPath='boq/erp-20261007-delta.json';
const data=JSON.parse(fs.readFileSync(dataPath,'utf8'));
const delta=JSON.parse(fs.readFileSync(deltaPath,'utf8'));
const changed=delta.payments||{};
const projectIncrements=delta.projectIncrements||{};
const portfolioIncrements=delta.portfolioIncrements||{};

function reallocateYear(y,paid,info){
  const p=Math.min(Math.max(0,Number(paid||0)),Number(y.boq||0));
  let left=p;
  const installments=(y.installments||[]).map((inst,idx)=>{
    const b=Number(inst.boq||0);
    const pp=Math.min(b,left);
    left=Math.max(0,left-pp);
    const remaining=Math.max(0,b-pp);
    return {...inst,no:inst.no||idx+1,boq:b,paid:round2(pp),remaining:round2(remaining),fullyPaid:remaining<=0.01};
  });
  y.paid=round2(p);
  y.possiblePaid=round2(p);
  y.balance=round2(Math.max(0,Number(y.boq||0)-p));
  y.possibleBalance=y.balance;
  y.over=0;
  y.status=y.balance<=0.01?'paid':p>0?'partial':'not_started';
  y.paymentDataAvailable=true;
  y.paymentConfidence='erp_ap_20261007';
  y.installments=installments;
  y.latestFullInstallment=Math.max(0,...installments.filter(x=>x.fullyPaid).map(x=>Number(x.no)||0));
  y.pendingInstallments=installments.filter(x=>x.remaining>0.01).map(x=>x.no);
  if(info){
    y.latestPaymentDate=info.date;
    y.latestPaymentInstallments=info.installments||[];
    y.latestPaymentAmount=Number(info.latestAmount||0);
  }
}

function addAmounts(target,inc){
  const out={...target};
  for(const [k,v] of Object.entries(inc||{})) out[k]=round2(Number(out[k]||0)+Number(v||0));
  return out;
}

assert(data.meta?.erpAsOf===delta.baselineAsOf,`ERP incremental baseline mismatch ${data.meta?.erpAsOf} != ${delta.baselineAsOf}`);
assert(delta.source==='บรหารเงิน TC-ROK 07.10.2569.xlsx','ERP 7 Oct source mismatch');
assert(delta.sourceSha256==='ced4f7d980257bff748873a71bf78f62d7a6a56fda52c3cd9662fadaaabe812a','ERP 7 Oct source sha mismatch');
assert(delta.erpAsOf==='2026-10-05','ERP 7 Oct as-of mismatch');

const changedEntries=Object.entries(changed);
assert(changedEntries.length===67,`ERP 7 Oct changed plot count mismatch ${changedEntries.length}`);
assert(Number(delta.changedPlotCount)===67,'ERP 7 Oct declared changed plot count mismatch');
const boqDelta=round2(changedEntries.reduce((s,[,info])=>s+Number(info.delta||0),0));
assert(near(boqDelta,4457894.72),`ERP 7 Oct BOQ delta mismatch ${boqDelta}`);
assert(near(delta.boqDelta,boqDelta),'ERP 7 Oct declared BOQ delta mismatch');
assert(changedEntries.filter(([,x])=>x.date==='2026-09-18').length===53,'ERP 7 Oct 18 Sep row count mismatch');
assert(changedEntries.filter(([,x])=>x.date==='2026-10-05').length===14,'ERP 7 Oct 5 Oct row count mismatch');
for(const [code,amount,inst] of [
  ['37-STC',756240.00,'2,3'],
  ['13-STC',350851.50,'4'],
  ['99-VSD',141988.20,'2'],
  ['100-VSD',201141.90,'2'],
  ['92-STC',68268.60,'2'],
  ['96-VSD',38529.00,'2']
]){
  assert(changed[code]&&near(changed[code].delta,amount),`ERP 7 Oct spot amount mismatch ${code}`);
  assert((changed[code].installments||[]).join(',')===inst,`ERP 7 Oct installment tag mismatch ${code}`);
}

const ext65=data.plots.filter(p=>p.portfolio==='forest65_external');
const byPlot=new Map(ext65.map(p=>[p.plotCode,p]));
const beforeY3=round2(ext65.reduce((s,p)=>s+Number(p.years[2]?.paid||0),0));
assert(near(beforeY3,17878844.85),`ERP 7 Oct pre-update year3 paid mismatch ${beforeY3}`);
for(const [code,info] of changedEntries){
  const plot=byPlot.get(code);
  assert(plot,`ERP 7 Oct year3 plot missing ${code}`);
  const y=plot.years[2];
  assert(y&&Number(y.year)===3,`ERP 7 Oct year3 structure missing ${code}`);
  reallocateYear(y,Number(y.paid||0)+Number(info.delta||0),info);
}

for(const pc of data.projectCodes){
  const inc=projectIncrements[pc.code];
  if(!inc)continue;
  pc.amounts=addAmounts(pc.amounts||{},inc.amounts||{});
  pc.totalAp=round2(Number(pc.totalAp||0)+Number(inc.totalAp||0));
  if(Number.isFinite(Number(pc.rowCount))) pc.rowCount=Number(pc.rowCount)+Number(inc.apRowCount||0);
}
const pmap=Object.fromEntries(data.projectCodes.map(x=>[x.code,x]));
assert(near(pmap.TCGMCR6508.totalAp,139156556.98),'TCGMCR6508 final AP mismatch');
assert(near(pmap.TCGMCR6607.totalAp,124799136.28),'TCGMCR6607 final AP mismatch');

for(const [portfolioId,inc] of Object.entries(portfolioIncrements)){
  const pf=data.portfolios.find(p=>p.id===portfolioId);
  assert(pf,`ERP 7 Oct portfolio missing ${portfolioId}`);
  pf.amounts=addAmounts(pf.amounts||{},inc.amounts||{});
  pf.totalAp=round2(Number(pf.totalAp||0)+Number(inc.totalAp||0));
}

const pf65=data.portfolios.find(p=>p.id==='forest65_external');
assert(pf65,'ERP 7 Oct forest65 portfolio missing');
const sumYear=(year,key)=>ext65.reduce((s,p)=>s+Number(p.years[year-1]?.[key]||0),0);
const y1Paid=round2(sumYear(1,'paid'));
const y2Paid=round2(sumYear(2,'paid'));
const y3Paid=round2(sumYear(3,'paid'));
assert(near(y1Paid,167863542.46),`ERP 7 Oct year1 paid changed unexpectedly ${y1Paid}`);
assert(near(y2Paid,54508982.24),`ERP 7 Oct year2 paid changed unexpectedly ${y2Paid}`);
assert(near(y3Paid,22336739.57),`ERP 7 Oct latest year3 paid mismatch ${y3Paid}`);
assert(near(y3Paid-beforeY3,boqDelta),`ERP 7 Oct applied BOQ delta mismatch ${y3Paid-beforeY3}`);
pf65.boqPaid=round2(y1Paid+y2Paid+y3Paid);

assert(near(pf65.amounts.boq_contract,244521264.14),'ERP 7 Oct forest65 BOQ AP mismatch');
assert(near(pf65.amounts.field_visit,721634.71),'ERP 7 Oct forest65 Clear Advance mismatch');
assert(near(pf65.amounts.survival,502345.81),'ERP 7 Oct forest65 survival mismatch');
assert(near(pf65.amounts.other,3178969.60),'ERP 7 Oct forest65 other mismatch');
assert(near(pf65.totalAp,263955693.26),'ERP 7 Oct forest65 total AP mismatch');

data.meta={...data.meta,
  generatedAt:'2026-10-07',
  erpPreviousAsOf:delta.baselineAsOf,
  erpAsOf:delta.erpAsOf,
  erpSource:delta.source,
  erpSourceSha256:delta.sourceSha256,
  erpLatestUpdate:'ERP 07.10.2569: เพิ่มเฉพาะรายการหลัง 26/08/2569; ป่า 65 ปี 3 เพิ่มยอดปลูก/บำรุง 4,457,894.72 บาทใน 67 แปลง และเพิ่มตรวจรอดตาย/Clear Advance/Management Fee ตาม AP ล่าสุด',
  erpIncrementalApDelta:round2(delta.apDelta),
  external65Year3PaidLatest:y3Paid,
  external65Year3DeltaFromPrevious:boqDelta,
  external65Year3ChangedPlotCount:changedEntries.length
};

for(const pf of data.portfolios){
  const sum=round2(Object.values(pf.amounts||{}).reduce((s,v)=>s+Number(v||0),0));
  assert(near(sum,pf.totalAp,0.1),`ERP 7 Oct portfolio AP categories do not reconcile ${pf.id} ${sum} != ${pf.totalAp}`);
}

fs.writeFileSync(dataPath,JSON.stringify(data));
console.log(JSON.stringify({
  ok:true,
  erpAsOf:data.meta.erpAsOf,
  source:data.meta.erpSource,
  incrementalApDelta:round2(delta.apDelta),
  external65:{year1Paid,y2Paid:round2(y2Paid),year3Paid,year3Delta:boqDelta,changedPlots:changedEntries.length,totalAp:pf65.totalAp},
  output:dataPath
}));
const fs=require('fs');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
const near=(a,b,t=0.05)=>Math.abs(Number(a)-Number(b))<=t;
const round2=n=>Number(Number(n||0).toFixed(2));
const dataPath='boq/finance-data.json';
const deltaPath='boq/erp-20260907-delta.json';
const data=JSON.parse(fs.readFileSync(dataPath,'utf8'));
const delta=JSON.parse(fs.readFileSync(deltaPath,'utf8'));
const changed=delta.payments||{};
const projectUpdates=delta.projectUpdates||{};
const portfolioUpdates=delta.portfolioUpdates||{};

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
  y.paymentConfidence='erp_ap_20260907';
  y.installments=installments;
  y.latestFullInstallment=Math.max(0,...installments.filter(x=>x.fullyPaid).map(x=>Number(x.no)||0));
  y.pendingInstallments=installments.filter(x=>x.remaining>0.01).map(x=>x.no);
  if(info){
    y.latestPaymentDate=info.date;
    y.latestPaymentInstallments=info.installments||[];
    y.latestPaymentAmount=Number(info.latestAmount||0);
  }
}

assert(delta.source==='Export v_gl_rpt313 (7-9-69)(1).xlsx','latest ERP source mismatch');
assert(delta.sourceSha256==='bed2fe410060358fa0605074099a1c67f37019d077a86ef8caa9d233fb160871','latest ERP source sha mismatch');
assert(delta.erpAsOf==='2026-08-26','latest ERP as-of mismatch');
const changedEntries=Object.entries(changed);
assert(changedEntries.length===122,`latest ERP changed plot count mismatch ${changedEntries.length}`);
assert(Number(delta.changedPlotCount)===122,'latest ERP declared changed plot count mismatch');
const appliedDelta=round2(changedEntries.reduce((s,[,info])=>s+Number(info.delta||0),0));
assert(near(appliedDelta,10865211.89),`latest ERP year3 delta mismatch ${appliedDelta}`);
assert(near(delta.delta,appliedDelta),'latest ERP declared delta mismatch');
assert(changedEntries.filter(([,x])=>x.date==='2026-08-14').length===114,'latest ERP 14 Aug row count mismatch');
assert(changedEntries.filter(([,x])=>x.date==='2026-08-24').length===8,'latest ERP 24 Aug row count mismatch');
for(const [code,amount,inst] of [
  ['88-STC',605235.28,'2,3'],['89-STC',232944.00,'2,3'],['90-STC',2571574.80,'2,3'],
  ['22-VSD',721542.91,'3'],['85-VSD',827420.40,'2,3'],['86-VSD',1575904.80,'2,3'],
  ['23-VSD',480296.19,'3'],['90(1)-STC',586914.00,'2,3']
]){
  assert(changed[code]&&near(changed[code].delta,amount),`latest ERP 24 Aug amount mismatch ${code}`);
  assert((changed[code].installments||[]).join(',')===inst,`latest ERP installment tag mismatch ${code}`);
}

const ext65=data.plots.filter(p=>p.portfolio==='forest65_external');
const byPlot=new Map(ext65.map(p=>[p.plotCode,p]));
for(const [code,info] of changedEntries){
  const plot=byPlot.get(code);
  assert(plot,`latest ERP year3 plot missing ${code}`);
  const y=plot.years[2];
  assert(y&&Number(y.year)===3,`latest ERP year3 structure missing ${code}`);
  reallocateYear(y,Number(y.paid||0)+Number(info.delta||0),info);
}

for(const pc of data.projectCodes){
  const u=projectUpdates[pc.code];
  if(!u)continue;
  pc.amounts={...u.amounts};
  pc.totalAp=Number(u.totalAp);
  pc.rowCount=Number(u.rowCount);
}
const pmap=Object.fromEntries(data.projectCodes.map(x=>[x.code,x]));
for(const [code,u] of Object.entries(projectUpdates)){
  assert(pmap[code],`project code missing ${code}`);
  assert(near(pmap[code].totalAp,u.totalAp),`project total AP mismatch ${code}`);
}

const pf65=data.portfolios.find(p=>p.id==='forest65_external');
const pfComm=data.portfolios.find(p=>p.id==='forest66_community');
const pf66=data.portfolios.find(p=>p.id==='forest66_external');
assert(pf65&&pfComm&&pf66,'portfolio missing for ERP update');
for(const pf of [pf65,pfComm,pf66]){
  const u=portfolioUpdates[pf.id];
  assert(u,`portfolio update missing ${pf.id}`);
  pf.amounts={...u.amounts};
  pf.totalAp=Number(u.totalAp);
}

const sumYear=(year,key)=>ext65.reduce((s,p)=>s+Number(p.years[year-1]?.[key]||0),0);
const y1Paid=sumYear(1,'paid');
const y2Paid=sumYear(2,'paid');
const y3Paid=sumYear(3,'paid');
assert(near(y1Paid,167863542.46),`external65 year1 paid changed unexpectedly ${y1Paid}`);
assert(near(y2Paid,54508982.24),`external65 year2 paid changed unexpectedly ${y2Paid}`);
assert(near(y3Paid,17878844.85),`external65 latest year3 paid mismatch ${y3Paid}`);
pf65.boqPaid=round2(y1Paid+y2Paid+y3Paid);

data.meta={...data.meta,
  generatedAt:'2026-09-07',
  erpAsOf:delta.erpAsOf,
  erpSource:delta.source,
  erpSourceSha256:delta.sourceSha256,
  erpLatestUpdate:'ERP export 7-9-69: ป่า 65 ปี 3 เพิ่มยอดปลูก/บำรุง 10,865,211.89 บาทใน 122 แปลง; ปรับ Clear Advance/ตรวจรอดตายและค่าใช้จ่ายประกอบตาม AP ล่าสุด',
  external65Year3PaidLatest:round2(y3Paid),
  external65Year3DeltaFromPrevious:10865211.89,
  external65Year3ChangedPlotCount:122
};

for(const pf of data.portfolios){
  const sum=Object.values(pf.amounts||{}).reduce((s,v)=>s+Number(v||0),0);
  assert(near(sum,pf.totalAp,0.1),`portfolio AP categories do not reconcile ${pf.id} ${sum} != ${pf.totalAp}`);
}
assert(near(pf65.amounts.boq_contract,240063369.42),'external65 BOQ AP latest mismatch');
assert(near(pfComm.amounts.field_visit,399288.19)&&near(pfComm.amounts.other,85417.12),'community latest ancillary AP mismatch');

fs.writeFileSync(dataPath,JSON.stringify(data));
console.log(JSON.stringify({
  ok:true,
  erpAsOf:data.meta.erpAsOf,
  source:data.meta.erpSource,
  external65:{year1Paid:round2(y1Paid),year2Paid:round2(y2Paid),year3Paid:round2(y3Paid),year3Delta:10865211.89,changedPlots:122,totalAp:pf65.totalAp},
  community66:{boqPaid:pfComm.amounts.boq_contract,fieldVisit:pfComm.amounts.field_visit,other:pfComm.amounts.other,totalAp:pfComm.totalAp},
  external66:{totalAp:pf66.totalAp},
  output:dataPath
}));

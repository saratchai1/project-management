const fs=require('fs');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
const near=(a,b,t=0.05)=>Math.abs(Number(a)-Number(b))<=t;
const round2=n=>Number(Number(n||0).toFixed(2));
function splitInstallments(total,pcts){
  const t=Number(total||0);
  const out=pcts.map(p=>round2(t*p));
  out[out.length-1]=round2(t-out.slice(0,-1).reduce((s,v)=>s+v,0));
  return out;
}
function makeYear({year,boq,paid=0,boqIns=[],contractNo,areaRai,statusOverride=null,paymentDataAvailable=true,template=''}) {
  const b=Number(boq||0), p=Math.min(Math.max(0,Number(paid||0)),b);
  let left=p;
  const installments=boqIns.map((x,idx)=>{
    const amount=Number(x||0), paidPart=Math.min(amount,left);
    left=Math.max(0,left-paidPart);
    const remaining=Math.max(0,amount-paidPart);
    return {no:idx+1,boq:amount,paid:paidPart,remaining,fullyPaid:remaining<=0.01};
  });
  const balance=Math.max(0,b-p);
  const latestFull=Math.max(0,...installments.filter(x=>x.fullyPaid).map(x=>x.no));
  const status=statusOverride||(balance<=0.01?'paid':p>0?'partial':'not_started');
  return {
    year,boq:b,paid:p,possiblePaid:p,balance,possibleBalance:balance,over:0,status,
    paymentDataAvailable,paymentConfidence:paymentDataAvailable?'embedded_erp_ap':'no_data',
    latestPaymentInstallments:[],latestFullInstallment:latestFull,latestPaymentDate:null,latestPaymentAmount:null,
    pendingInstallments:statusOverride==='future'?[]:installments.filter(x=>x.remaining>0.01).map(x=>x.no),
    installments,template,exception:false,contractNo,areaRai:Number(areaRai||0),contractStatus:'ทำสัญญาแล้ว'
  };
}

const dataPath='boq/finance-data.json';
const sourcePath='boq/external66-boq.json';
const data=JSON.parse(fs.readFileSync(dataPath,'utf8'));
const src=JSON.parse(fs.readFileSync(sourcePath,'utf8'));
assert(Array.isArray(src.rows)&&src.rows.length===10,'external66 BOQ row count mismatch');

const group1='โครงการปลูกป่าชายเลนเพื่อเพิ่มพื้นที่สีเขียว และลดก๊าซเรือนกระจกอย่างยั่งยืนของประเทศไทย กลุ่ม 1';
const group2='โครงการปลูกป่าชายเลนเพื่อเพิ่มพื้นที่สีเขียว และลดก๊าซเรือนกระจกอย่างยั่งยืนของประเทศไทย กลุ่ม 2';
const rows=src.rows.map(row=>{
  const [plotCode,province,areaType,areaRai,total10y,year1Boq,year2to6Boq,year7to10Boq,paidCurrentYear1,contractNo]=row;
  const company=plotCode.includes('-VSD-')?'VSD':'STC';
  const tokenType=/Premium$/i.test(plotCode)?'PREMIUM':'STANDARD';
  const projectCode=company==='STC'?'TCGMCR67003':'TCGMCR67004';
  const basePlotCode=plotCode.replace(/-(Standard|Premium)$/i,'');
  const years=Array.from({length:10},(_,idx)=>{
    const year=idx+1;
    const boq=year===1?year1Boq:year<=6?year2to6Boq:year7to10Boq;
    const pcts=year===1?[.3,.2,.2,.3]:[.1,.3,.3,.3];
    return makeYear({
      year,boq,paid:year===1?paidCurrentYear1:0,boqIns:splitInstallments(boq,pcts),
      contractNo,areaRai,statusOverride:year===1?null:'future',
      paymentDataAvailable:year===1,template:year===1?'30%/20%/20%/30%':'10%/30%/30%/30%'
    });
  });
  return {
    portfolio:'forest66_external',projectCode,plotCode,basePlotCode,contractNo,
    projectName:tokenType==='PREMIUM'?group1:group2,tokenType,company,
    moo:'',village:'',subdistrict:'',district:'',province,areaType:areaType||'',
    areaRai:Number(areaRai||0),total10y:Number(total10y||0),years
  };
});

data.plots=(data.plots||[]).filter(x=>x.portfolio!=='forest66_external').concat(rows);
const portfolio=data.portfolios.find(p=>p.id==='forest66_external');
assert(portfolio,'forest66_external portfolio missing');
Object.assign(portfolio,{
  boqAvailable:true,plotDataAvailable:true,boqYears:[1,2,3,4,5,6,7,8,9,10],
  unitLabel:'รายการ BOQ',boqTotal:Number(src.boqTotal10y),boqPaid:Number(src.paidCurrentYear1),
  contractedUnitCount:Number(src.physicalContractCount),contractedBoqTotal:Number(src.boqTotal10y),
  boqScopeLabel:'BOQ ปี 1–10',defaultYear:1,boqRowCount:Number(src.rowCount),
  physicalContractCount:Number(src.physicalContractCount),unmatchedBoqAp:Number(src.erpOutsideBoqMaster.amount)
});
const p65=data.portfolios.find(p=>p.id==='forest65_external'); if(p65)p65.defaultYear=3;
const c66=data.portfolios.find(p=>p.id==='forest66_community'); if(c66)c66.defaultYear=1;

data.meta={
  ...data.meta,
  generatedAt:'2026-09-07',
  boqSourceExternal66:src.source,
  boqSourceExternal66Sha256:src.sourceSha256,
  external66BoqRowCount:Number(src.rowCount),
  external66PhysicalContractCount:Number(src.physicalContractCount),
  external66BoqTotal:Number(src.boqTotal10y),
  external66MatchedBoqAp:Number(src.paidCurrentYear1),
  external66UnmatchedBoqAp:Number(src.erpOutsideBoqMaster.amount),
  external66UnmatchedBoqApPlot:src.erpOutsideBoqMaster.plot,
  external66UnmatchedBoqApContract:src.erpOutsideBoqMaster.contractNo,
  totalPlotLikeUnits:(data.plots||[]).length
};

const ext=data.plots.filter(p=>p.portfolio==='forest66_external');
const sum=(year,key)=>ext.reduce((s,p)=>s+Number(p.years[year-1]?.[key]||0),0);
assert(ext.length===10,'external66 generated rows mismatch');
assert(new Set(ext.map(p=>p.contractNo)).size===6,'external66 physical contract count mismatch');
assert(near(ext.reduce((s,p)=>s+p.total10y,0),29741155),'external66 10-year BOQ mismatch');
assert(near(sum(1,'boq'),8337929.8)&&near(sum(1,'paid'),3582517)&&near(sum(1,'balance'),4755412.8),'external66 year1 mismatch');
for(let y=2;y<=6;y++)assert(near(sum(y,'boq'),2787093.04)&&near(sum(y,'paid'),0),`external66 year${y} mismatch`);
for(let y=7;y<=10;y++)assert(near(sum(y,'boq'),1866940)&&near(sum(y,'paid'),0),`external66 year${y} mismatch`);
assert(near(portfolio.amounts.boq_contract,3673921),'external66 ERP BOQ AP total mismatch');
assert(near(portfolio.amounts.boq_contract-sum(1,'paid'),91404),'external66 unmatched AP mismatch');
const byCode=Object.fromEntries(data.projectCodes.filter(x=>x.portfolio==='forest66_external').map(x=>[x.code,x]));
assert(near(ext.filter(p=>p.projectCode==='TCGMCR67003').reduce((s,p)=>s+p.years[0].paid,0),3394900),'external66 STC matched AP mismatch');
assert(near(ext.filter(p=>p.projectCode==='TCGMCR67004').reduce((s,p)=>s+p.years[0].paid,0),187617),'external66 VSD matched AP mismatch');
assert(near(byCode.TCGMCR67003.amounts.boq_contract-3394900,91404),'external66 STC outside-master AP mismatch');
assert(near(byCode.TCGMCR67004.amounts.boq_contract,187617),'external66 VSD AP mismatch');

fs.writeFileSync(dataPath,JSON.stringify(data));
console.log(JSON.stringify({
  ok:true,external66:{boqRows:10,physicalContracts:6,boq10y:29741155,year1Boq:8337929.8,
  matchedPaid:3582517,unmatchedBoqAp:91404,totalBoqAp:3673921},output:dataPath
}));

const fs=require('fs');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
const near=(a,b,t=0.05)=>Math.abs(Number(a)-Number(b))<=t;
const path='boq/finance-data.json';
const data=JSON.parse(fs.readFileSync(path,'utf8'));
const rows=data.plots.filter(p=>p.portfolio==='forest65_external');
assert(rows.length===160,`expected 160 external65 plots, got ${rows.length}`);

const latestVillageNames={
  '72-STC':'ท่าควน,บ้านท่าใหญ่',
  '78-STC':'บ้านหมากปรก',
  '79-STC':'บ้านผักฉีด',
  '88-STC':'บ้านเกาะนก (คลองน้ำเวียน)',
  '56(1)-STC':'บ้านคลองย่าหนัด',
  '57(1)-STC':'บ้านคลองย่าหนัด',
  '58(1)-STC':'บ้านคลองย่าหนัด',
  '9-VSD':'ท่าขาหย่าง',
  '10-VSD':'ท่าขาหย่าง',
  '37-VSD':'คลองหิน',
  '69-VSD':'บ้านเกาะนก (คลองน้ำเวียน)'
};

// Source workbook: tab “BOQ ป่าใหม่ 65 ปี1”. The 9 filtered/highlighted rows
// have only installment 3 (30%) still unpaid; installments 1 and 2 are paid.
const year1PendingInstallment3={
  '1-STC':236280.00,
  '35-STC':141000.00,
  '36-STC':740625.00,
  '68-STC':105901.0323,
  '69-STC':159376.8582,
  '13-VSD':435072.00,
  '36-VSD':10164.00,
  '91-VSD':83100.00,
  '92-VSD':27225.00
};
const expectedPendingCodes=Object.keys(year1PendingInstallment3).sort();
const byCode=new Map(rows.map(p=>[p.plotCode,p]));

for(const [code,village] of Object.entries(latestVillageNames)){
  const plot=byCode.get(code);assert(plot,`missing latest external65 plot ${code}`);plot.village=village;
}

function setInstallmentState(yearObj, paidAmount){
  let left=Math.max(0,Number(paidAmount||0));
  yearObj.installments=(yearObj.installments||[]).map(inst=>{
    const boq=Number(inst.boq||0);
    const paid=Math.min(boq,left);
    left=Math.max(0,left-paid);
    const remaining=Math.max(0,boq-paid);
    return {...inst,paid,remaining,fullyPaid:remaining<=0.01};
  });
  yearObj.latestFullInstallment=Math.max(0,...yearObj.installments.filter(x=>x.fullyPaid).map(x=>Number(x.no||0)));
  yearObj.pendingInstallments=yearObj.installments.filter(x=>x.remaining>0.01).map(x=>x.no);
}

for(const plot of rows){
  const y1=plot.years[0];
  assert(y1&&Number(y1.year)===1,`missing year1 ${plot.plotCode}`);
  const pending=year1PendingInstallment3[plot.plotCode];
  const paid=pending==null?Number(y1.boq||0):Math.max(0,Number(y1.boq||0)-Number(pending));
  y1.paid=paid;
  y1.possiblePaid=paid;
  y1.balance=Math.max(0,Number(y1.boq||0)-paid);
  y1.possibleBalance=y1.balance;
  y1.over=0;
  y1.status=y1.balance<=0.01?'paid':'partial';
  y1.paymentDataAvailable=true;
  y1.paymentConfidence='boq_workbook_highlight';
  y1.latestPaymentInstallments=[];
  y1.latestPaymentDate=null;
  y1.latestPaymentAmount=null;
  setInstallmentState(y1,paid);
  if(pending!=null){
    assert(y1.pendingInstallments.length===1&&Number(y1.pendingInstallments[0])===3,`year1 pending installment mismatch ${plot.plotCode}`);
    assert(near(y1.balance,pending,0.01),`year1 pending amount mismatch ${plot.plotCode}`);
  }else{
    assert(y1.pendingInstallments.length===0,`unexpected year1 pending installment ${plot.plotCode}`);
  }
}

const sum=(year,key)=>rows.reduce((s,p)=>s+Number(p.years[year-1]?.[key]||0),0);
const y1PendingCodes=rows.filter(p=>Number(p.years[0].balance||0)>0.01).map(p=>p.plotCode).sort();
const y2UnpaidCodes=rows.filter(p=>Number(p.years[1]?.paid||0)<=0.01).map(p=>p.plotCode).sort();
assert(JSON.stringify(y1PendingCodes)===JSON.stringify(expectedPendingCodes),`year1 pending plot set mismatch: ${y1PendingCodes.join(',')}`);
assert(JSON.stringify(y2UnpaidCodes)===JSON.stringify(expectedPendingCodes),`year2 unpaid plot set mismatch: ${y2UnpaidCodes.join(',')}`);
assert(near(sum(1,'boq'),169802286.3495,0.01),'latest external65 year1 BOQ mismatch');
assert(near(sum(1,'balance'),1938743.8905,0.01),`latest external65 year1 balance mismatch: ${sum(1,'balance')}`);
assert(near(sum(1,'paid'),167863542.459,0.01),`latest external65 year1 paid mismatch: ${sum(1,'paid')}`);
assert(near(sum(2,'balance'),2277962.4515,0.01),'latest external65 year2 balance changed unexpectedly');
assert(rows.filter(p=>Number(p.years[1]?.paid||0)<=0.01).length===9,'latest external65 year2 unpaid plot count mismatch');
assert(near(rows.reduce((s,p)=>s+Number(p.total10y||0),0),616601357.59025),'latest external65 10-year total changed unexpectedly');
assert(near(rows.reduce((s,p)=>s+Number(p.areaRai||0),0),20358.0434785),'latest external65 area changed unexpectedly');
for(const [code,village] of Object.entries(latestVillageNames))assert(byCode.get(code).village===village,`latest village not applied ${code}`);

data.meta={...data.meta,
  external65Source:'BOQ เงินโครงการปี 65 ปีที่ 1-10 ระหว่าง TC-ROK(1).xlsx',
  external65SourceSha256:'68c30653b81c1cc2c98e14a47dd008ca47535e8361097a4f179c887eda292b62',
  external65SnapshotDate:'2026-09-07',
  external65Year1PaymentReference:'แท็บ BOQ ป่าใหม่ 65 ปี1: 9 แปลงที่ไฮไลท์ค้างเฉพาะงวด 3 (30%) รวม 1,938,743.89 บาท; แปลงอื่นจ่ายครบปี 1',
  external65LatestUpdate:'อัปเดตตามไฟล์ล่าสุด: ปี 1 จ่ายแล้ว 167,863,542.46 บาท คงเหลืองวด 3 ของ 9 แปลง 1,938,743.89 บาท; ปี 2 ยังมี 9 แปลงคงเหลือ 2,277,962.45 บาท; อัปเดตชื่อหมู่บ้าน 11 แปลง'
};
fs.writeFileSync(path,JSON.stringify(data));
console.log(JSON.stringify({ok:true,external65Plots:rows.length,year1:{boq:sum(1,'boq'),paid:sum(1,'paid'),balance:sum(1,'balance'),pendingPlots:y1PendingCodes},year2:{paid:sum(2,'paid'),balance:sum(2,'balance'),unpaidPlots:y2UnpaidCodes},correctedVillageLabels:Object.keys(latestVillageNames).length,source:data.meta.external65Source,sourceSha256:data.meta.external65SourceSha256}));

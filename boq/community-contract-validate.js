const fs=require('fs');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
const near=(a,b,t=0.05)=>Math.abs(Number(a)-Number(b))<=t;
const data=JSON.parse(fs.readFileSync('boq/finance-data.json','utf8'));
const community=data.plots.filter(p=>p.portfolio==='forest66_community');
assert(community.length===93,`community unit count expected 93, got ${community.length}`);

function stats(year){
  const rows=community.map(p=>({p,r:p.years[year-1]})).filter(x=>x.r);
  const signed=rows.filter(x=>x.r.contractStatus==='ทำสัญญาแล้ว');
  const unsigned=rows.filter(x=>x.r.contractStatus!=='ทำสัญญาแล้ว');
  const sum=(arr,key)=>arr.reduce((s,x)=>s+Number((key==='area'?x.r.areaRai:x.r[key])||0),0);
  return {
    planBoq:sum(rows,'boq'),
    signedCount:signed.length,
    unsignedCount:unsigned.length,
    signedBoq:sum(signed,'boq'),
    signedPaid:sum(signed,'paid'),
    signedBalance:sum(signed,'balance'),
    unsignedBoq:sum(unsigned,'boq'),
    signedArea:sum(signed,'area')
  };
}
const y1=stats(1), y2=stats(2);
assert(near(y1.planBoq,69677122.05),`community y1 plan BOQ mismatch ${y1.planBoq}`);
assert(y1.signedCount===5&&y1.unsignedCount===88,`community y1 contract counts mismatch ${y1.signedCount}/${y1.unsignedCount}`);
assert(near(y1.signedBoq,4116627),`community y1 signed BOQ mismatch ${y1.signedBoq}`);
assert(near(y1.signedPaid,4116627),`community y1 signed paid mismatch ${y1.signedPaid}`);
assert(near(y1.signedBalance,0),`community y1 signed balance mismatch ${y1.signedBalance}`);
assert(near(y1.unsignedBoq,65560495.05),`community y1 unsigned plan mismatch ${y1.unsignedBoq}`);
assert(near(y1.signedArea,9148.06),`community y1 signed area mismatch ${y1.signedArea}`);

assert(near(y2.planBoq,30967343.80),`community y2 plan BOQ mismatch ${y2.planBoq}`);
assert(y2.signedCount===5&&y2.unsignedCount===88,`community y2 contract counts mismatch ${y2.signedCount}/${y2.unsignedCount}`);
assert(near(y2.signedBoq,1829346),`community y2 signed BOQ mismatch ${y2.signedBoq}`);
assert(near(y2.signedPaid,0),`community y2 signed paid mismatch ${y2.signedPaid}`);
assert(near(y2.signedBalance,1829346),`community y2 signed balance mismatch ${y2.signedBalance}`);
assert(near(y2.unsignedBoq,29137997.80),`community y2 unsigned plan mismatch ${y2.unsignedBoq}`);
assert(near(y2.signedArea,9146.73),`community y2 signed area mismatch ${y2.signedArea}`);

assert(near(y1.planBoq+y2.planBoq,100644465.85),'community combined plan BOQ mismatch');
assert(near(y1.signedBoq+y2.signedBoq,5945973),'community combined signed contract mismatch');
const pf=data.portfolios.find(p=>p.id==='forest66_community');
assert(pf,'community portfolio missing');
assert(near(pf.amounts.community_fund,18600000),'community fund must stay separate from BOQ');

const app=fs.readFileSync('boq/app.js','utf8');
const index=fs.readFileSync('boq/index.html','utf8');
for(const marker of ['มูลค่าสัญญาที่ทำแล้ว','คงเหลือในสัญญาที่ทำแล้ว','ไม่ถือเป็นยอดค้างจ่าย','ประมาณการ — ยังไม่ทำสัญญา']){
  assert(app.includes(marker)||index.includes(marker),`community UI marker missing: ${marker}`);
}
console.log(JSON.stringify({ok:true,community:{year1:y1,year2:y2,combinedPlan:y1.planBoq+y2.planBoq,combinedSigned:y1.signedBoq+y2.signedBoq,fund:pf.amounts.community_fund}}));

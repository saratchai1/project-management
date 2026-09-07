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
const byCode=new Map(rows.map(p=>[p.plotCode,p]));
for(const [code,village] of Object.entries(latestVillageNames)){
  const plot=byCode.get(code);assert(plot,`missing latest external65 plot ${code}`);plot.village=village;
}
const sum=(year,key)=>rows.reduce((s,p)=>s+Number(p.years[year-1]?.[key]||0),0);
assert(near(sum(1,'boq'),169802286.35)&&near(sum(2,'boq'),56786944.69)&&near(sum(3,'boq'),56786944.69),'latest external65 BOQ totals changed unexpectedly');
assert(near(rows.reduce((s,p)=>s+Number(p.total10y||0),0),616601357.59025),'latest external65 10-year total changed unexpectedly');
assert(near(rows.reduce((s,p)=>s+Number(p.areaRai||0),0),20358.0434785),'latest external65 area changed unexpectedly');
for(const [code,village] of Object.entries(latestVillageNames))assert(byCode.get(code).village===village,`latest village not applied ${code}`);
data.meta={...data.meta,
  external65Source:'BOQ เงินโครงการปี 65 ปีที่ 1-10 ระหว่าง TC-ROK(1).xlsx',
  external65SourceSha256:'68c30653b81c1cc2c98e14a47dd008ca47535e8361097a4f179c887eda292b62',
  external65SnapshotDate:'2026-09-07',
  external65LatestUpdate:'ตรวจเทียบไฟล์ล่าสุดแล้ว: BOQ/พื้นที่/งวดทั้ง 160 แปลงไม่เปลี่ยนจากฐานเดิม; อัปเดตชื่อหมู่บ้าน 11 แปลงตามไฟล์ล่าสุด'
};
fs.writeFileSync(path,JSON.stringify(data));
console.log(JSON.stringify({ok:true,external65Plots:rows.length,correctedVillageLabels:Object.keys(latestVillageNames).length,source:data.meta.external65Source,sourceSha256:data.meta.external65SourceSha256}));

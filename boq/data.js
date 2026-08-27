window.BOQ_DATA_PROMISE=(async()=>{
  const BASE="https://raw.githubusercontent.com/saratchai1/project-management/a397f7713be0292d3e14cc3f495ff13ed77a4717/data/boq-2565-tc-rok-20260827/";
  const get=async file=>{const r=await fetch(BASE+file,{cache:"force-cache"});if(!r.ok)throw new Error(`โหลด ${file} ไม่สำเร็จ (${r.status})`);return r.json();};
  const m=await get("manifest.json");
  const parts=await Promise.all(m.parts.map(get));
  const d=m.dictionaries;
  const clean=v=>v==null?"":String(v).trim();
  const fixVillage=v=>({
    "ท่าควนบ้านท่าไหญ่":"ท่าควน,บ้านท่าใหญ่",
    "บ้านหมากปรกส":"บ้านหมากปรก",
    "บ้านฟักฉีด":"บ้านผักฉีด",
    "บ้านเกาะนกรวมน้ำเวียน)":"บ้านเกาะนก (คลองน้ำเวียน)",
    "บ้านคลอย่าหนัด":"บ้านคลองย่าหนัด",
    "ท่าขาหย่ง":"ท่าขาหย่าง",
    "คลอหิน":"คลองหิน"
  }[clean(v)]||clean(v));
  const template=y=>(m.year_templates[String(y)]||[]).map(x=>`${Math.round(x*100)}%`).join("/");
  const plots=parts.flatMap(x=>x.plots).map(r=>({
    seq:r[0],id:clean(r[1]),project:clean(d.project_name[r[2]]),token:clean(d.token_type[r[3]]),company:clean(d.company[r[4]]),
    moo:clean(d.moo[r[5]]),village:fixVillage(d.village[r[6]]),subdistrict:clean(d.subdistrict[r[7]]),district:clean(d.district[r[8]]),province:clean(d.province[r[9]]),areaType:clean(d.area_type[r[10]]),
    area:Number(r[11]||0),contract:clean(r[12]),total10y:Number(r[13]||0),
    years:r[14].map(y=>({y:y[0],value:Number(y[1]||0),ins:y.slice(2,6).map(v=>Number(v||0)),template:template(y[0]),exception:!!y[6]}))
  }));
  plots.sort((a,b)=>a.seq-b.seq);
  const yearTotals=Array.from({length:10},(_,i)=>{const y=i+1;return{y,value:plots.reduce((s,p)=>s+(p.years.find(v=>v.y===y)?.value||0),0),exceptions:plots.filter(p=>p.years.find(v=>v.y===y)?.exception).length};});
  return {meta:{asOf:m.snapshot_date,source:m.source_filename,sourceSha256:m.source_sha256,plotCount:plots.length,areaRai:m.total_area_rai,total10y:m.ten_year_total_baht,defaultYear:3,yearTotals},plots};
})().catch(err=>{console.error(err);throw err;});

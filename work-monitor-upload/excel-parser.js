(()=>{'use strict';
const PLOT_RE=/^(\d+(?:\(\d+\))?-[A-Za-z]+)\b/;
const REQUIRED=['description','wbs','planPct','progressPct','status'];

function text(v){return v==null?'':String(v).trim()}
function num(v){if(typeof v==='number'&&Number.isFinite(v))return v;const n=Number(String(v??'').replace(/,/g,''));return Number.isFinite(n)?n:0}
function norm(v){return text(v).toLowerCase().replace(/\s+/g,'').replace(/[().]/g,'').replace(/บาท/g,'฿')}
function fmtDate(v){
  if(!v)return '';
  if(v instanceof Date&&!Number.isNaN(v.valueOf()))return new Intl.DateTimeFormat('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'}).format(v);
  if(typeof v==='number'&&window.XLSX?.SSF){const d=XLSX.SSF.parse_date_code(v);if(d)return `${String(d.d).padStart(2,'0')}/${String(d.m).padStart(2,'0')}/${d.y}`}
  return text(v);
}
function findHeader(rows){
  for(let r=0;r<Math.min(rows.length,12);r++){
    const h=rows[r].map(norm);
    const map={
      description:h.findIndex(x=>x==='description'||x==='รายละเอียด'),
      wbs:h.findIndex(x=>x==='wbsno'||x==='wbs'),
      start:h.findIndex(x=>x==='startdate'||x.includes('วันที่เริ่ม')),
      end:h.findIndex(x=>x==='enddate'||x.includes('วันที่สิ้นสุด')),
      contract:h.findIndex(x=>x==='contract฿'||x==='contract'),
      planValue:h.findIndex(x=>x==='plan฿'||x==='plan'),
      planPct:h.findIndex(x=>x==='plan%'||x==='planเปอร์เซ็นต์'),
      progressValue:h.findIndex(x=>x==='progress฿'||x==='progress'),
      progressPct:h.findIndex(x=>x==='progress%'||x==='progressเปอร์เซ็นต์'),
      status:h.findIndex(x=>x==='status'||x==='สถานะ'),
      variancePct:h.findIndex(x=>x.includes('+เร็ว/-ช้า%')||x.includes('เร็ว/-ช้า%')||x.includes('variance%')),
      varianceDays:h.findIndex(x=>x.includes('+เร็ว/-ช้าd')||x.includes('เร็ว/-ช้าd')||x.includes('varianced'))
    };
    if(REQUIRED.every(k=>map[k]>=0))return {row:r,map,headers:rows[r]};
  }
  return null;
}
function yearFromSheet(name,rows){
  const a=text(name).match(/ปี(?:ที่)?\s*(\d+)/i);if(a)return a[1];
  for(let i=0;i<Math.min(rows.length,6);i++)for(const v of rows[i]||[]){const m=text(v).match(/ปี(?:ที่)?\s*(\d+)/i);if(m)return m[1]}
  return null;
}
function provinceFromDescription(desc){const m=text(desc).match(/จ\.\s*([^\s()\-]+)/);return m?m[1]:'ไม่ระบุ'}
function plotId(desc){const m=text(desc).match(PLOT_RE);return m?m[1]:null}
function riskFor(status,plan,progress,gapPp,delayDays){
  const s=text(status).toUpperCase();
  if(s==='C'&&progress>=0.999)return 'completed';
  if(s==='N'&&plan<=0.0001)return 'future';
  if(gapPp>=25||delayDays>=90)return 'critical';
  if(gapPp>=10||delayDays>=30)return 'high';
  if(gapPp>2||delayDays>7)return 'watch';
  return 'on_track';
}
function parseSheet(sheetName,rows){
  const header=findHeader(rows);if(!header)return {ok:false,sheetName,error:'ไม่พบหัวตาราง Description / WBS / Plan / Progress / Status'};
  const year=yearFromSheet(sheetName,rows);if(!year)return {ok:false,sheetName,error:'พบโครงสร้างงาน แต่หาเลขปีงานไม่ได้'};
  const m=header.map,body=rows.slice(header.row+1),plotStarts=[];
  body.forEach((row,i)=>{const id=plotId(row[m.description]);if(id)plotStarts.push({i,id})});
  const plots=[],seen=new Set(),warnings=[];
  for(let p=0;p<plotStarts.length;p++){
    const cur=plotStarts[p],next=plotStarts[p+1]?.i??body.length,row=body[cur.i],desc=text(row[m.description]);
    if(seen.has(cur.id)){warnings.push(`Plot ID ซ้ำ: ${cur.id}`);continue}seen.add(cur.id);
    const plan=num(row[m.planPct]),progress=num(row[m.progressPct]),variancePct=m.variancePct>=0?num(row[m.variancePct]):0,varianceDays=m.varianceDays>=0?num(row[m.varianceDays]):0;
    const gapPp=variancePct<0?Math.abs(variancePct):Math.max((plan-progress)*100,0),delayDays=varianceDays<0?Math.abs(varianceDays):0;
    const segment=body.slice(cur.i+1,next),installments=[];
    for(let i=0;i<segment.length;i++){
      const sr=segment[i],wbs=text(sr[m.wbs]);if(!/^\d+$/.test(wbs))continue;
      const no=Number(wbs),prefix=`${no}.`,activityCount=segment.filter(x=>text(x[m.wbs]).startsWith(prefix)).length;
      const ip=num(sr[m.planPct]),ig=num(sr[m.progressPct]),ivp=m.variancePct>=0?num(sr[m.variancePct]):0,ivd=m.varianceDays>=0?num(sr[m.varianceDays]):0;
      installments.push({no,status:text(sr[m.status]).toUpperCase(),plan:ip,progress:ig,gapPp:ivp<0?Math.abs(ivp):Math.max((ip-ig)*100,0),varianceDays:ivd,start:fmtDate(sr[m.start]),end:fmtDate(sr[m.end]),activityCount});
    }
    plots.push({
      id:cur.id,province:provinceFromDescription(desc),description:desc,start:fmtDate(row[m.start]),end:fmtDate(row[m.end]),
      contractValue:m.contract>=0?num(row[m.contract]):0,planValue:m.planValue>=0?num(row[m.planValue]):0,progressValue:m.progressValue>=0?num(row[m.progressValue]):0,
      plan,progress,gapPp,delayDays,status:text(row[m.status]).toUpperCase(),risk:riskFor(row[m.status],plan,progress,gapPp,delayDays),installments
    });
  }
  if(!plots.length)return {ok:false,sheetName,year,error:'ไม่พบแถวระดับแปลง เช่น 37-STC'};
  return {ok:true,sheetName,year,plots,warnings,headerRow:header.row+1,installmentCount:plots.reduce((s,p)=>s+p.installments.length,0)};
}
function parseWorkbook(workbook,fileName=''){
  const results=[],skipped=[];
  for(const sheetName of workbook.SheetNames){
    const ws=workbook.Sheets[sheetName];
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
    const result=parseSheet(sheetName,rows);
    if(result.ok)results.push(result);else skipped.push(result);
  }
  if(!results.length)throw new Error(`ไม่พบ sheet ปีงานที่อ่านได้ใน ${fileName||'ไฟล์นี้'}\nต้องมีหัวตาราง Description, WBS No, Plan (%), Progress(%), Status`);
  const years={};
  for(const r of results){
    let key=r.year;if(years[key]){let n=2;while(years[`${key}.${n}`])n++;key=`${key}.${n}`;r.warnings.push(`มีปี ${r.year} มากกว่า 1 sheet จึงแยกเป็น ${key}`)}
    years[key]={yearLabel:r.year,sheetName:r.sheetName,plots:r.plots,warnings:r.warnings,installmentCount:r.installmentCount,headerRow:r.headerRow};
  }
  return {fileName,years,recognized:results.map(r=>({sheetName:r.sheetName,year:r.year,plots:r.plots.length,installments:r.installmentCount,warnings:r.warnings})),skipped:skipped.map(x=>({sheetName:x.sheetName,error:x.error}))};
}
window.ExcelMonitorParser={parseWorkbook,parseSheet};
})();

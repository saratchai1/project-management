(()=>{'use strict';
const PLOT_RE=/^(\d+(?:\(\d+\))?-[A-Za-z]+)\b/;
const text=v=>v==null?'':String(v).trim();
const norm=v=>text(v).toLowerCase().replace(/\s+/g,'').replace(/[()\[\].:_\-]/g,'');
const num=v=>{if(typeof v==='number'&&Number.isFinite(v))return v;const n=Number(text(v).replace(/,/g,''));return Number.isFinite(n)?n:null};
const todayUtc=()=>{const d=new Date();return Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())};
function excelDate(serial){
  if(typeof serial!=='number'||!Number.isFinite(serial)||serial<20000||serial>80000)return null;
  const p=window.XLSX?.SSF?.parse_date_code?.(serial);if(!p||!p.y||!p.m||!p.d)return null;
  return new Date(Date.UTC(p.y,p.m-1,p.d));
}
function stringDate(v){
  const s=text(v);if(!s)return null;
  let m=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if(m){let y=Number(m[3]);if(y<100)y+=y>=60?2500:2000;if(y>2400)y-=543;const d=new Date(Date.UTC(y,Number(m[2])-1,Number(m[1])));if(!Number.isNaN(d.valueOf())&&d.getUTCDate()===Number(m[1]))return d}
  const direct=new Date(s);if(!Number.isNaN(direct.valueOf())&&/\d/.test(s))return new Date(Date.UTC(direct.getFullYear(),direct.getMonth(),direct.getDate()));
  return null;
}
function asDate(v){if(v instanceof Date&&!Number.isNaN(v.valueOf()))return new Date(Date.UTC(v.getFullYear(),v.getMonth(),v.getDate()));return excelDate(v)||stringDate(v)}
function fmtDate(d){if(!d)return '';const y=d.getUTCFullYear()+543;return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${y}`}
function statusOf(v,na=false){
  const d=asDate(v);if(d)return {key:'submitted',label:'ส่งแล้ว',raw:fmtDate(d),date:d.toISOString().slice(0,10),future:d.valueOf()>todayUtc()};
  const s=text(v);
  if(/ยุติ/.test(s))return {key:'terminated',label:'ยุติ',raw:s,date:null,future:false};
  if(/ชะลอ|หยุด/.test(s))return {key:'suspended',label:'ชะลอ',raw:s,date:null,future:false};
  if(na)return {key:'na',label:'N/A',raw:s,date:null,future:false};
  if(!s)return {key:'pending',label:'ยังไม่ส่ง',raw:'',date:null,future:false};
  return {key:'pending',label:'ยังไม่ส่ง',raw:s,date:null,future:false,nonDateText:true};
}
function findHeader(rows){
  for(let r=0;r<Math.min(rows.length,30);r++){
    const h=rows[r].map(norm);
    const plot=h.findIndex(x=>x.includes('รหัสแปลง'));
    const province=h.findIndex(x=>x==='จังหวัด'||x.includes('จังหวัด'));
    const submit=h.findIndex(x=>x.includes('ผรมส่งงานวันที่'));
    if(plot>=0&&province>=0&&submit>=0)return r;
  }
  return -1;
}
function colFind(row,tests){for(let c=0;c<row.length;c++){const n=norm(row[c]);if(tests.some(t=>typeof t==='string'?n.includes(t):t.test(n)))return c}return -1}
function findProjectYear(sheetName,rows,headerRow){
  const pool=[sheetName];for(let r=0;r<Math.min(rows.length,headerRow+1);r++)pool.push(...(rows[r]||[]).map(text));
  for(const s of pool){const m=s.match(/(?:ปี\s*|พ\.ศ\.\s*)(25\d{2}|26\d{2})/);if(m)return m[1]}
  return '';
}
function groupHeaders(rows,headerRow){
  const hits=[];const start=Math.max(0,headerRow-5);
  for(let r=start;r<headerRow;r++)for(let c=0;c<(rows[r]||[]).length;c++){
    const s=text(rows[r][c]);const m=s.match(/ปีที่\s*(\d+)\s*งวดที่\s*(\d+).*ROK\s*[-–]\s*ผรม/i);
    if(m)hits.push({row:r,col:c,workYear:Number(m[1]),installment:Number(m[2]),label:s});
  }
  hits.sort((a,b)=>a.col-b.col||a.row-b.row);
  const uniq=[];for(const x of hits){if(!uniq.some(y=>y.col===x.col&&y.workYear===x.workYear&&y.installment===x.installment))uniq.push(x)}
  return uniq;
}
function submissionColumns(rows,headerRow){
  const header=rows[headerRow]||[],groups=groupHeaders(rows,headerRow),out=[];
  for(let i=0;i<groups.length;i++){
    const g=groups[i],next=groups.slice(i+1).find(x=>x.col>g.col);const end=next?next.col-1:header.length-1;
    let submit=-1;for(let c=Math.max(0,g.col-1);c<=Math.min(end,header.length-1);c++)if(norm(header[c]).includes('ผรมส่งงานวันที่')){submit=c;break}
    if(submit<0){for(let c=g.col;c<=Math.min(g.col+4,header.length-1);c++)if(norm(header[c]).includes('ผรมส่งงานวันที่')){submit=c;break}}
    if(submit>=0)out.push({...g,submitCol:submit});
  }
  if(!out.length){
    const submitCols=[];for(let c=0;c<header.length;c++)if(norm(header[c]).includes('ผรมส่งงานวันที่'))submitCols.push(c);
    submitCols.forEach((c,i)=>out.push({row:headerRow-1,col:c,workYear:null,installment:i+1,label:`งวดที่ ${i+1}`,submitCol:c}));
  }
  return out.sort((a,b)=>(a.workYear||0)-(b.workYear||0)||a.installment-b.installment);
}
function detectWorkYear(sheetName,rows,headerRow,cols){
  const known=cols.map(x=>x.workYear).filter(Boolean);if(known.length)return String(known[0]);
  const pool=[sheetName];for(let r=0;r<headerRow;r++)pool.push(...(rows[r]||[]).map(text));
  for(const s of pool){const m=s.match(/ปีที่\s*(\d+)/);if(m)return m[1]}
  return '';
}
function plannedInstallments(groupText,maxInstallment){const s=text(groupText);const m=s.match(/(\d+)\s*งวด/);return m?Math.min(Number(m[1]),maxInstallment):maxInstallment}
function parseSheet(sheetName,rows){
  const headerRow=findHeader(rows);if(headerRow<0)return {ok:false,sheetName,error:'ไม่พบหัวตาราง รหัสแปลง / จังหวัด / ผรม. ส่งงานวันที่'};
  const h=rows[headerRow]||[],subs=submissionColumns(rows,headerRow);if(!subs.length)return {ok:false,sheetName,error:'ไม่พบ section ปีที่ … งวดที่ … ROK-ผรม.'};
  const projectYear=findProjectYear(sheetName,rows,headerRow);const workYear=detectWorkYear(sheetName,rows,headerRow,subs);
  const plotCol=colFind(h,['รหัสแปลง']);const provinceCol=colFind(h,['จังหวัด']);const companyCol=colFind(h,['บริษัท']);
  const contractCol=colFind(h,['เลขสัญญาrokttc','เลขสัญญาroktc']);const contractAreaCol=colFind(h,['เนื้อที่สัญญา','เนื้อที่ใช้ทำสัญญา']);
  const approvedAreaCol=colFind(h,['เนื้อที่ได้รับอนุมัติ','กรมทชอนุมัติ']);const districtCol=colFind(h,['อำเภอ']);const subdistrictCol=colFind(h,['ตำบล']);const villageCol=colFind(h,['บ้าน']);
  const groupCol=colFind(h,['กลุ่มทำสัญญา']);const inspectorCol=colFind(h,['ผู้รับผิดชอบในการตรวจงาน']);const directorCol=colFind(h,['ผอประจำแปลง']);
  const maxInst=Math.max(...subs.map(s=>s.installment));const data=[];const warnings=[];const seen=new Set();let nonDateText=0,futureDates=0,continuations=0;
  for(let r=headerRow+1;r<rows.length;r++){
    const row=rows[r]||[],rawPlot=text(row[plotCol]),m=rawPlot.match(PLOT_RE);if(!m)continue;const plotId=m[1].trim();if(seen.has(plotId)){continuations++;continue}seen.add(plotId);
    const groupText=groupCol>=0?text(row[groupCol]):'';const planned=plannedInstallments(groupText,maxInst);
    const installments=subs.filter(s=>!workYear||!s.workYear||String(s.workYear)===String(workYear)).map(s=>{
      const na=s.installment>planned;const st=statusOf(row[s.submitCol],na);if(st.future)futureDates++;if(st.nonDateText)nonDateText++;
      return {no:s.installment,status:st.key,label:st.label,raw:st.raw,date:st.date,future:st.future,sourceCol:s.submitCol+1};
    });
    data.push({plotId,company:companyCol>=0?text(row[companyCol]):'',province:provinceCol>=0?text(row[provinceCol]):'',district:districtCol>=0?text(row[districtCol]):'',subdistrict:subdistrictCol>=0?text(row[subdistrictCol]):'',village:villageCol>=0?text(row[villageCol]):'',contractNo:contractCol>=0?text(row[contractCol]):'',contractArea:contractAreaCol>=0?num(row[contractAreaCol]):null,approvedArea:approvedAreaCol>=0?num(row[approvedAreaCol]):null,contractGroup:groupText,inspector:inspectorCol>=0?text(row[inspectorCol]):'',director:directorCol>=0?text(row[directorCol]):'',plannedInstallments:planned,installments});
  }
  if(!data.length)return {ok:false,sheetName,error:'พบหัวตาราง แต่ไม่พบรหัสแปลง เช่น 37-STC'};
  if(continuations)warnings.push(`${continuations} แถวรหัสแปลงซ้ำ/ต่อเนื่องถูกไม่นับซ้ำในจำนวนแปลง`);
  if(nonDateText)warnings.push(`${nonDateText} ช่องใน “ผรม. ส่งงานวันที่” มีข้อความที่ไม่ใช่วันที่ จึงไม่นับเป็นส่งแล้ว`);
  if(futureDates)warnings.push(`${futureDates} วันที่อยู่หลังวันที่ปัจจุบัน จะแสดงเป็น Submitted พร้อม Future-date warning`);
  return {ok:true,sheetName,projectYear,workYear,plots:data,installments:[...new Set(data.flatMap(p=>p.installments.map(i=>i.no)))].sort((a,b)=>a-b),warnings,headerRow:headerRow+1,recognizedSubmissionColumns:subs.map(s=>({workYear:s.workYear,installment:s.installment,column:s.submitCol+1,label:s.label}))};
}
function parseWorkbook(workbook,fileName=''){
  const recognized=[],skipped=[];
  for(const sheetName of workbook.SheetNames){const rows=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:true});const r=parseSheet(sheetName,rows);if(r.ok)recognized.push(r);else skipped.push({sheetName,error:r.error})}
  if(!recognized.length)throw new Error(`อ่าน ${fileName||'ไฟล์นี้'} ไม่ได้: ไม่พบ sheet รูปแบบทะเบียนคุมที่มี “รหัสแปลง” และ “ผรม. ส่งงานวันที่”`);
  return {fileName,recognized,skipped};
}
window.ContractSubmissionParser={parseWorkbook,parseSheet,asDate,statusOf,fmtDate};
})();

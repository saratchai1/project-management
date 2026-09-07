(()=>{'use strict';
const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const PROJECT_NAME=(params.get('name')||'').trim();
const PROJECT_ID=(params.get('project')||'standalone').trim();
const PLOT_RE=/^\s*(\d+(?:\(\d+\))?-[A-Za-z]+)\b/;
const M={files:[],seq:0,filters:{q:'',year:'',projectType:'',token:'',province:'',delayed:false},warnings:[]};
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const text=v=>v==null?'':String(v).trim();
const norm=v=>text(v).toLowerCase().replace(/\s+/g,'').replace(/[().]/g,'');
const num=v=>{if(typeof v==='number'&&Number.isFinite(v))return v;const n=Number(String(v??'').replace(/,/g,''));return Number.isFinite(n)?n:0};
const pctValue=v=>{let n=num(v);if(n>1.5)n/=100;return Math.max(0,n)};
const fmtArea=v=>Number.isFinite(v)&&v>0?new Intl.NumberFormat('th-TH',{maximumFractionDigits:2}).format(v):'—';
const natural=(a,b)=>String(a).localeCompare(String(b),'th',{numeric:true,sensitivity:'base'});

function headerMap(row){
  const h=row.map(norm);
  const find=(...tests)=>h.findIndex(x=>tests.some(t=>typeof t==='string'?x===t:t.test(x)));
  return {
    description:find('description','รายละเอียด'),
    wbs:find('wbsno','wbs'),
    progress:find('progress%','progressเปอร์เซ็นต์'),
    status:find('status','สถานะ'),
    plan:find('plan%','planเปอร์เซ็นต์')
  };
}
function findHeader(rows){
  for(let i=0;i<Math.min(rows.length,12);i++){
    const m=headerMap(rows[i]||[]);
    if(m.description>=0&&m.wbs>=0&&m.progress>=0&&m.status>=0)return {row:i,map:m};
  }
  return null;
}
function plotId(desc){const m=text(desc).match(PLOT_RE);return m?m[1]:''}
function province(desc){const m=text(desc).match(/จ\.\s*([^\s()\-]+)/);return m?m[1].trim():'ไม่ระบุ'}
function area(desc){const matches=[...text(desc).matchAll(/([\d,]+(?:\.\d+)?)\s*ไร่/g)];if(!matches.length)return 0;return num(matches[matches.length-1][1])}
function tokenType(desc){
  const s=text(desc);
  const m=s.match(/-((?:[A-Za-z0-9]+-)?TOKEN\d+)\s*$/i);
  if(m)return m[1].toUpperCase();
  const t=s.match(/\b(TOKEN\s*\d+)\b/i);return t?t[1].replace(/\s+/g,'').toUpperCase():'';
}
function cleanProjectType(v){return text(v).replace(/\s*ปีที่\s*\d+\s*$/i,'').replace(/\s+/g,' ').trim()}
function yearFrom(sheetName,rows,headerRow){
  const a=text(sheetName).match(/ปี(?:ที่)?\s*(\d+)/i);if(a)return a[1];
  for(let r=Math.max(0,headerRow-2);r<Math.min(rows.length,headerRow+8);r++){
    for(const v of rows[r]||[]){const m=text(v).match(/ปีที่\s*(\d+)/i);if(m)return m[1]}
  }
  return '';
}
function projectTitleBefore(rows,idx,descCol,headerRow){
  let title='';
  for(let r=headerRow+1;r<=idx;r++){
    const s=text(rows[r]?.[descCol]);
    if(s&&!plotId(s)&&/^โครงการ/.test(s))title=s;
  }
  return cleanProjectType(title);
}
function isIntegerWbs(v){return /^\d+$/.test(text(v))}
function isDelivery(desc){return /ส่งมอบ/.test(text(desc))}

function parseSheet(sheetName,rows,fileName){
  const header=findHeader(rows);if(!header)return null;
  const m=header.map,year=yearFrom(sheetName,rows,header.row);if(!year)return null;
  const starts=[];
  for(let i=header.row+1;i<rows.length;i++){const id=plotId(rows[i]?.[m.description]);if(id)starts.push({i,id})}
  if(!starts.length)return null;
  const records=[];
  for(let p=0;p<starts.length;p++){
    const cur=starts[p],end=starts[p+1]?.i??rows.length,plotRow=rows[cur.i]||[],desc=text(plotRow[m.description]);
    const instStarts=[];
    for(let r=cur.i+1;r<end;r++)if(isIntegerWbs(rows[r]?.[m.wbs]))instStarts.push(r);
    const installments=[];
    for(let j=0;j<instStarts.length;j++){
      const r=instStarts[j],stop=instStarts[j+1]??end,row=rows[r]||[],no=Number(text(row[m.wbs]));
      const children=[];
      for(let k=r+1;k<stop;k++){
        const child=rows[k]||[],wbs=text(child[m.wbs]);
        if(!wbs||!wbs.startsWith(`${no}.`))continue;
        children.push({desc:text(child[m.description]),progress:pctValue(child[m.progress]),status:text(child[m.status]).toUpperCase()});
      }
      const work=children.filter(x=>!isDelivery(x.desc));
      const delivery=children.filter(x=>isDelivery(x.desc));
      const workDone=work.length>0&&work.every(x=>x.progress>=0.999);
      const deliveryProgress=delivery.reduce((mx,x)=>Math.max(mx,x.progress),0);
      const status=text(row[m.status]).toUpperCase();
      installments.push({no,status,workDone,deliveryProgress,delayed:status==='O'||status==='D'});
    }
    installments.sort((a,b)=>a.no-b.no);
    let workThrough=0;
    for(const i of installments){
      if(i.no===workThrough+1&&i.workDone)workThrough=i.no;
      else if(i.no>workThrough+1||!i.workDone)break;
    }
    records.push({
      key:`${year}|${cur.id}`,year,id:cur.id,projectType:projectTitleBefore(rows,cur.i,m.description,header.row),
      token:tokenType(desc),province:province(desc),area:area(desc),description:desc,
      workThrough,delayed:installments.filter(x=>x.delayed).map(x=>x.no),
      rok:installments.filter(x=>x.deliveryProgress>=0.8).map(x=>x.no),
      tc:installments.filter(x=>x.deliveryProgress>=0.999).map(x=>x.no),
      installments,sourceFile:fileName,sourceSheet:sheetName
    });
  }
  return {sheetName,year,records};
}
function parseWorkbook(wb,fileMeta){
  const parsed=[],skipped=[];
  for(const sheetName of wb.SheetNames){
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,defval:'',raw:true});
    const x=parseSheet(sheetName,rows,fileMeta.name);
    if(x)parsed.push(x);else skipped.push(sheetName);
  }
  if(!parsed.length)throw new Error('ไม่พบ Sheet งานที่มี Description / WBS No / Progress(%) / Status');
  return {parsed,skipped,records:parsed.flatMap(x=>x.records)};
}
async function parseBuffer(buffer,meta){
  if(!window.XLSX)throw new Error('ตัวอ่าน Excel ยังไม่พร้อม');
  const wb=XLSX.read(buffer,{type:'array',cellDates:true});
  return parseWorkbook(wb,meta);
}
function signature(meta){return `${meta.name}|${meta.size||0}|${meta.lastModified||0}`}
async function addLocalFiles(fileList){
  const files=[...(fileList||[])];
  for(const file of files){
    const sig=signature(file);if(M.files.some(x=>x.signature===sig))continue;
    try{
      const parsed=await parseBuffer(await file.arrayBuffer(),file);
      M.files.push({id:`mw${++M.seq}`,signature:sig,name:file.name,size:file.size,lastModified:file.lastModified,added:M.seq,appFileId:null,...parsed});
    }catch(error){M.warnings.push(`${file.name}: ${error.message||'อ่าน Monitor งานไม่สำเร็จ'}`)}
  }
  setTimeout(()=>{assignFileIds();render()},180);
}
async function addMessageFiles(items){
  for(const item of items||[]){
    const meta={name:item.name||'monitor.xlsx',size:Number(item.size)||0,lastModified:Number(item.lastModified)||0};
    const sig=signature(meta);if(M.files.some(x=>x.signature===sig))continue;
    let buffer=item.buffer;
    if(ArrayBuffer.isView(buffer))buffer=buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength);
    if(!(buffer instanceof ArrayBuffer))continue;
    try{
      const parsed=await parseBuffer(buffer,meta);
      M.files.push({id:`mw${++M.seq}`,signature:sig,...meta,added:M.seq,appFileId:null,...parsed});
    }catch(error){M.warnings.push(`${meta.name}: ${error.message||'อ่าน Monitor งานไม่สำเร็จ'}`)}
  }
  setTimeout(()=>{assignFileIds();render()},250);
}
function assignFileIds(){
  const cards=[...document.querySelectorAll('#fileList .file-card')];
  const used=new Set(M.files.map(x=>x.appFileId).filter(Boolean));
  for(const rec of M.files.filter(x=>!x.appFileId)){
    const card=cards.find(c=>!used.has(c.dataset.fileId)&&(c.querySelector('.file-card-main strong')?.textContent?.trim()||'')===rec.name);
    if(card){rec.appFileId=card.dataset.fileId;used.add(rec.appFileId)}
  }
}
function syncRemovedFiles(){
  assignFileIds();
  const ids=new Set([...document.querySelectorAll('#fileList .file-card')].map(x=>x.dataset.fileId));
  const before=M.files.length;
  M.files=M.files.filter(x=>!x.appFileId||ids.has(x.appFileId));
  if(M.files.length!==before)render();
}
function combinedRows(){
  const byKey=new Map();
  for(const file of [...M.files].sort((a,b)=>a.added-b.added))for(const r of file.records)byKey.set(r.key,{...r,sourceFile:file.name});
  return [...byKey.values()];
}
function optionValues(rows,key){return [...new Set(rows.map(x=>x[key]).filter(Boolean))].sort(natural)}
function fillSelect(id,values,label='ทั้งหมด'){
  const el=$(id);if(!el)return;const current=el.value;
  el.innerHTML=`<option value="">${label}</option>`+values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
  if(values.includes(current))el.value=current;else el.value='';
}
function filteredRows(){
  const all=combinedRows(),f=M.filters,q=f.q.toLowerCase().trim();
  return all.filter(r=>(!f.year||r.year===f.year)&&(!f.projectType||r.projectType===f.projectType)&&(!f.token||r.token===f.token)&&(!f.province||r.province===f.province)&&(!f.delayed||r.delayed.length)&&(!q||[r.id,r.projectType,r.token,r.province,r.description,r.sourceFile,PROJECT_NAME].join(' ').toLowerCase().includes(q)));
}
function chips(values,kind='ok'){
  return values?.length?values.map(n=>`<span class="mw-chip ${kind}">${esc(n)}</span>`).join(''):'<span class="mw-none">—</span>';
}
function projectName(){return PROJECT_NAME||'ยังไม่ระบุชื่อโครงการ T-VER'}
function renderKpis(rows){
  const delayed=rows.filter(x=>x.delayed.length).length;
  const rok=rows.filter(x=>x.rok.length).length;
  const tc=rows.filter(x=>x.tc.length).length;
  const waiting=rows.filter(x=>x.rok.some(n=>!x.tc.includes(n))).length;
  $('mwKpis').innerHTML=[
    ['แปลงในผลกรอง',rows.length,`จาก ${combinedRows().length} แปลง`],
    ['มีงวดล่าช้า',delayed,'อิง Status = O / D'],
    ['ROK ส่งมอบแล้ว',rok,'พบ 80% ขึ้นไปที่แถว “ส่งมอบ”'],
    ['TC ตรวจรับแล้ว',tc,'พบ 100% ที่แถว “ส่งมอบ”'],
    ['ROK รอ TC ตรวจรับ',waiting,'มี 80% แต่ยังไม่ถึง 100%']
  ].map(([a,b,c])=>`<article class="mw-kpi"><span>${a}</span><strong>${b}</strong><small>${c}</small></article>`).join('');
}
function renderTable(rows){
  rows=[...rows].sort((a,b)=>Number(a.year)-Number(b.year)||natural(a.id,b.id));
  $('mwMeta').textContent=`${rows.length} แปลง · ${M.files.length} ไฟล์ · ชื่อโครงการ T-VER: ${projectName()}`;
  $('mwRows').innerHTML=rows.length?rows.map(r=>{
    const rokWaiting=r.rok.filter(n=>!r.tc.includes(n));
    return `<tr>
      <td class="mw-long" title="${esc(r.projectType)}">${esc(r.projectType||'—')}</td>
      <td class="mw-long" title="${esc(projectName())}">${esc(projectName())}</td>
      <td>${r.token?`<span class="mw-token">${esc(r.token)}</span>`:'—'}</td>
      <td class="mw-plot">${esc(r.id)}</td>
      <td>${esc(r.province)}</td>
      <td class="mw-num">${fmtArea(r.area)}</td>
      <td>ปีที่ ${esc(r.year)}</td>
      <td class="mw-center">${r.workThrough?`<span class="mw-through">${r.workThrough}</span>`:'—'}</td>
      <td>${chips(r.delayed,'danger')}</td>
      <td>${chips(r.rok,rokWaiting.length?'warn':'ok')}</td>
      <td>${chips(r.tc,'ok')}</td>
      <td><span class="source-chip">${esc(r.sourceFile)}</span></td>
    </tr>`;
  }).join(''):'<tr><td colspan="12"><div class="empty">ไม่พบรายการตามตัวกรอง</div></td></tr>';
}
function renderWarnings(){
  const box=$('mwWarnings');if(!box)return;
  if(!M.warnings.length){box.hidden=true;box.innerHTML='';return}
  box.hidden=false;box.innerHTML=`<b>Monitor งานอ่านบางไฟล์ไม่ครบ:</b> ${M.warnings.map(esc).join(' · ')}`;
}
function render(){
  const all=combinedRows();
  fillSelect('mwYear',optionValues(all,'year'),'ทุกปีงาน');
  fillSelect('mwProjectType',optionValues(all,'projectType'),'ทุกประเภทโครงการ');
  fillSelect('mwToken',optionValues(all,'token'),'ทุก TOKEN');
  fillSelect('mwProvince',optionValues(all,'province'),'ทุกจังหวัด');
  const rows=filteredRows();renderKpis(rows);renderTable(rows);renderWarnings();
}
function resetFilters(){
  M.filters={q:'',year:'',projectType:'',token:'',province:'',delayed:false};
  ['mwSearch','mwYear','mwProjectType','mwToken','mwProvince'].forEach(id=>{if($(id))$(id).value=''});if($('mwDelayedOnly'))$('mwDelayedOnly').checked=false;render();
}
function csv(){
  const h=['ประเภทโครงการ','ชื่อโครงการ T-VER','ประเภท TOKEN X','รหัสแปลง','จังหวัด','เนื้อที่สัญญา (ไร่)','การดำเนินงานปีที่','ดำเนินงานเสร็จถึงงวดที่','งวดงานที่ล่าช้า','ROK ส่งมอบงานถึงงวดที่','TC ตรวจรับมอบงานถึงงวดที่','Source file'];
  const data=filteredRows().map(r=>[r.projectType,projectName(),r.token,r.id,r.province,r.area,r.year,r.workThrough||'',r.delayed.join(','),r.rok.join(','),r.tc.join(','),r.sourceFile]);
  const out=[h,...data].map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob(['\ufeff'+out],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`monitor-work-${PROJECT_ID}.csv`;a.click();URL.revokeObjectURL(a.href);
}
function syncView(){const btn=document.querySelector('.view-btn[data-view="monitor-work"]'),content=$('monitorWorkContent');if(!btn||!content)return;const active=btn.classList.contains('active');content.classList.toggle('active',active);document.querySelector('.filters')?.classList.toggle('mw-hidden',active);$('yearNav')?.classList.toggle('mw-hidden',active);if(active)render()}
function bind(){
  const input=$('fileInput'),dz=$('dropzone');
  input?.addEventListener('change',e=>addLocalFiles(e.target.files));
  dz?.addEventListener('drop',e=>addLocalFiles(e.dataTransfer?.files));
  window.addEventListener('message',e=>{if(e.origin===location.origin&&e.data?.type==='work-monitor:add-excel')addMessageFiles(e.data.files)});
  const fileList=$('fileList');if(fileList)new MutationObserver(()=>setTimeout(syncRemovedFiles,120)).observe(fileList,{childList:true,subtree:true});
  document.addEventListener('click',e=>{const b=e.target.closest?.('[data-remove-file]');if(!b)return;const id=b.dataset.removeFile;M.files=M.files.filter(x=>x.appFileId!==id);setTimeout(render,0)},true);
  const viewNav=document.querySelector('.view-nav');if(viewNav)new MutationObserver(syncView).observe(viewNav,{subtree:true,attributes:true,attributeFilter:['class']});
  document.querySelector('.view-btn[data-view="monitor-work"]')?.addEventListener('click',()=>setTimeout(syncView,0));
  const link=(id,key,event='change')=>$(id)?.addEventListener(event,e=>{M.filters[key]=event==='input'?e.target.value:e.target.value;render()});
  link('mwSearch','q','input');link('mwYear','year');link('mwProjectType','projectType');link('mwToken','token');link('mwProvince','province');
  $('mwDelayedOnly')?.addEventListener('change',e=>{M.filters.delayed=e.target.checked;render()});
  $('mwReset')?.addEventListener('click',resetFilters);$('mwExport')?.addEventListener('click',csv);
  syncView();render();
}
bind();
})();

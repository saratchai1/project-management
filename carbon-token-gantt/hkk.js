(()=>{
'use strict';
const DAY=86400000,$=s=>document.querySelector(s);
const E={file:$('#workbookFile'),source:$('#sourceState'),range:$('#factRange'),tasks:$('#factTasks'),groups:$('#factGroups'),owners:$('#factOwners'),search:$('#taskSearch'),package:$('#packageFilter'),owner:$('#ownerFilter'),status:$('#statusFilter'),today:$('#todayButton'),reset:$('#resetButton'),scroll:$('#scheduleScroll'),grid:$('#scheduleGrid'),audit:$('#auditLine'),check:$('#dataCheck'),dialog:$('#taskDialog'),dialogClose:$('#dialogClose'),dialogKicker:$('#dialogKicker'),dialogTitle:$('#dialogTitle'),dialogDetails:$('#dialogDetails')};
const S={tasks:[],visible:[],groups:[],periods:[],years:[],scale:'quarter',today:new Date(),collapsed:new Set(),fileName:'',audit:null};S.today.setHours(0,0,0,0);
const text=v=>String(v??'').replace(/\s+/g,' ').trim();
const norm=v=>text(v).toLowerCase().replace(/[\s\n\r_\-().:%/]+/g,'').replace(/วันที่/g,'').replace(/ชื่อ/g,'');
const esc=v=>text(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),dayDiff=(a,b)=>Math.round((b-a)/DAY);
function excelCol(i){let n=i+1,s='';while(n){const r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26)}return s}
function beYear(y){return y>2400?y:y+543}
function normalizeJsDate(d){const x=new Date(d);if(x.getFullYear()>2400)x.setFullYear(x.getFullYear()-543);x.setHours(0,0,0,0);return isNaN(x)?null:x}
const MONTHS={jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11};
function parseDate(v){
  if(v==null||v==='')return null;
  if(v instanceof Date&&!isNaN(v))return normalizeJsDate(v);
  if(typeof v==='number'&&v>20000&&v<100000){const p=XLSX.SSF.parse_date_code(v);if(p){let y=p.y;if(y>2400)y-=543;return new Date(y,p.m-1,p.d)}}
  const s=text(v);if(!s)return null;let m;
  m=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);if(m){let y=+m[3];if(y<100)y+=2000;if(y>2400)y-=543;return new Date(y,+m[2]-1,+m[1])}
  m=s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);if(m){let y=+m[1];if(y>2400)y-=543;return new Date(y,+m[2]-1,+m[3])}
  m=s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);if(m&&MONTHS[m[2].toLowerCase()]!=null){let y=+m[3];if(y>2400)y-=543;return new Date(y,MONTHS[m[2].toLowerCase()],+m[1])}
  m=s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);if(m&&MONTHS[m[1].toLowerCase()]!=null){let y=+m[3];if(y>2400)y-=543;return new Date(y,MONTHS[m[1].toLowerCase()],+m[2])}
  const rewritten=s.replace(/\b(25\d{2})\b/g,y=>String(+y-543));const d=new Date(rewritten);return isNaN(d)?null:normalizeJsDate(d)
}
function pct(v){if(v==null||v==='')return null;let n=parseFloat(String(v).replace('%','').replace(/,/g,''));if(!isFinite(n))return null;if(!String(v).includes('%')&&n<=1)n*=100;return clamp(n,0,100)}
function num(v){const n=parseFloat(String(v??'').replace(/,/g,''));return isFinite(n)?n:null}
function fmtDate(d){return d?new Intl.DateTimeFormat('th-TH',{day:'2-digit',month:'short',year:'numeric'}).format(d):'—'}
const aliases={
 task:['tasklist','task','taskname','activity','description','รายการงาน','รายการ','กิจกรรม','งาน','รายละเอียด'],
 start:['plannedstart','plannedstartdate','start','startdate','วันที่เริ่ม','วันเริ่ม','เริ่มต้น'],
 end:['plannedfinish','plannedend','finish','finishdate','end','enddate','วันที่สิ้นสุด','วันสิ้นสุด','สิ้นสุด'],
 duration:['duration','days','ระยะเวลา','จำนวนวัน'],
 progress:['progress','complete','percentcomplete','ความก้าวหน้า','เปอร์เซ็นต์'],
 owner:['accountibility','accountability','accountable','assignedto','owner','responsible','pic','assignee','ผู้รับผิดชอบ','ผู้ดำเนินการ','เจ้าของงาน','ผู้ประสานงาน','ผู้เกี่ยวข้อง'],
 status:['status','สถานะ'],phase:['phase','workstream','group','section','category','หมวด','กลุ่ม','เฟส','ประเภทงาน']
};
function headerScore(row){const ns=row.map(norm);let score=0;for(const[k,list]of Object.entries(aliases)){if(ns.some(v=>list.some(a=>v===norm(a)||v.includes(norm(a)))))score+=['task','start','end'].includes(k)?4:1}return score}
function findHeader(rows){let best={i:-1,s:-1};for(let i=0;i<Math.min(45,rows.length);i++){const s=headerScore(rows[i]);if(s>best.s)best={i,s}}return best.s>=8?best.i:-1}
function findCols(headers,key){const list=aliases[key].map(norm);return headers.map((h,i)=>({i,n:norm(h)})).filter(x=>x.n&&list.some(a=>x.n===a||x.n.includes(a)||a.includes(x.n))).map(x=>x.i)}
function firstCol(headers,key){return findCols(headers,key)[0]??-1}
function mergeMap(sheet){const map=new Map();for(const g of(sheet['!merges']||[])){const top=sheet[XLSX.utils.encode_cell(g.s)];if(!top||top.v==null)continue;for(let r=g.s.r;r<=g.e.r;r++)for(let c=g.s.c;c<=g.e.c;c++)map.set(`${r}:${c}`,top.v)}return map}
function cellVal(rows,merges,r,c,useMerge=true){if(c<0)return null;const v=rows[r]?.[c];if(v!=null&&text(v)!=='')return v;return useMerge?(merges.get(`${r}:${c}`)??null):null}
function inferWbsColumns(rows,headerRow,taskCol){const candidates=[];for(let c=0;c<taskCol;c++){let score=0;for(let r=headerRow+1;r<Math.min(rows.length,headerRow+240);r++){const v=text(rows[r]?.[c]);if(/^\d+(?:\.\d+){0,4}$/.test(v))score+=v.includes('.')?3:1}if(score)candidates.push({c,score})}return candidates.sort((a,b)=>a.c-b.c).map(x=>x.c)}
function rowWbs(rows,r,wbsCols){const vals=wbsCols.map(c=>text(rows[r]?.[c])).filter(v=>/^\d+(?:\.\d+){0,4}$/.test(v));return vals.length?vals[vals.length-1]:''}
function statusClass(s){const n=norm(s);if(/complete|completed|done|approve[d]?|เสร็จ|สำเร็จ/.test(n))return'done';if(/progress|doing|working|ดำเนิน|review/.test(n))return'progress';if(/pending|approval|รอ|hold/.test(n))return'pending';return''}
function wbsLevel(w){return w?String(w).split('.').length:0}
function prefix(w,n){return w?String(w).split('.').slice(0,n).join('.'):''}
function parseWorkbook(sheet){
  const rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:null,blankrows:false});const h=findHeader(rows);if(h<0)throw Error('ไม่พบแถวหัวตาราง Task List / Planned Start / Planned Finish ใน Project Plan');
  const H=rows[h].map((v,i)=>text(v)||`Column ${i+1}`),taskCol=firstCol(H,'task'),startCol=firstCol(H,'start'),endCol=firstCol(H,'end'),durationCol=firstCol(H,'duration'),progressCol=firstCol(H,'progress'),statusCol=firstCol(H,'status'),phaseCol=firstCol(H,'phase');
  const accountCols=H.map((v,i)=>/^(accountibility|accountability)$/i.test(norm(v))?i:-1).filter(i=>i>=0),ownerCols=accountCols.length?accountCols:findCols(H,'owner');
  if(taskCol<0||startCol<0||(endCol<0&&durationCol<0))throw Error('Project Plan ต้องมี Task List, Planned Start และ Planned Finish/Duration');
  const merges=mergeMap(sheet),wbsCols=inferWbsColumns(rows,h,taskCol);let named=0,dated=0,undated=0;const tasks=[];let currentWbs='',currentPhase='';
  for(let r=h+1;r<rows.length;r++){
    const name=text(cellVal(rows,merges,r,taskCol,false));if(!name)continue;named++;
    let start=parseDate(cellVal(rows,merges,r,startCol,false)),end=endCol>=0?parseDate(cellVal(rows,merges,r,endCol,false)):null,duration=durationCol>=0?num(cellVal(rows,merges,r,durationCol,false)):null;
    if(start&&!end&&duration!=null)end=new Date(start.getTime()+Math.max(0,duration-1)*DAY);if(start&&end&&end<start)[start,end]=[end,start];
    const explicitWbs=rowWbs(rows,r,wbsCols);if(explicitWbs)currentWbs=explicitWbs;const wbs=explicitWbs;
    const owners=[];for(const c of ownerCols){const v=cellVal(rows,merges,r,c,true);if(v!=null&&text(v)!=='')owners.push(text(v))}const owner=[...new Set(owners)].join(' / ');
    const status=statusCol>=0?text(cellVal(rows,merges,r,statusCol,true)):'',phase=phaseCol>=0?text(cellVal(rows,merges,r,phaseCol,true)):'';if(phase)currentPhase=phase;
    if(!start||!end){undated++;continue}dated++;if(duration==null)duration=dayDiff(start,end)+1;
    const progress=progressCol>=0?pct(cellVal(rows,merges,r,progressCol,false)):null,level=wbsLevel(wbs),summary=level>0&&level<=2&&!/^[-–•]/.test(name),milestone=dayDiff(start,end)===0||/milestone|deadline|decision|gate|อนุมัติ|ส่งมอบ|sign.?off/i.test(name);
    tasks.push({id:r+1,row:r+1,name,wbs,contextWbs:currentWbs,start,end,duration,owner,status,phase:phase||currentPhase,progress:progress??0,hasProgress:progress!=null,summary,milestone});
  }
  if(!tasks.length)throw Error('ไม่พบรายการที่มี Planned Start/Finish ใช้งานได้');
  return{tasks,audit:{rows:Math.max(0,rows.length-h-1),named,dated,undated,taskCol,startCol,endCol,ownerCols,statusCol,wbsCols},headers:H}
}
function buildGroups(tasks){
  const parentByWbs=new Map(tasks.filter(t=>t.wbs).map(t=>[t.wbs,t]));const groups=[],map=new Map();
  const get=(key,label)=>{if(!map.has(key)){const g={key,label,tasks:[],start:null,end:null};map.set(key,g);groups.push(g)}return map.get(key)};
  for(const t of tasks){let key,label;if(t.wbs){const p2=wbsLevel(t.wbs)>=2?prefix(t.wbs,2):t.wbs;const parent=parentByWbs.get(p2);key=`w:${p2}`;label=parent?.name||`WBS ${p2}`}else if(t.contextWbs){const p2=wbsLevel(t.contextWbs)>=2?prefix(t.contextWbs,2):t.contextWbs;const parent=parentByWbs.get(p2);key=`w:${p2}`;label=parent?.name||`WBS ${p2}`}else if(t.phase){key=`p:${t.phase}`;label=t.phase}else{key='other';label='Other activities'}const g=get(key,label);g.tasks.push(t);g.start=!g.start||t.start<g.start?t.start:g.start;g.end=!g.end||t.end>g.end?t.end:g.end}
  return groups
}
function buildPeriods(min,max,scale){const out=[];let d;if(scale==='month'){d=new Date(min.getFullYear(),min.getMonth(),1);while(d<=max){out.push({start:new Date(d),end:new Date(d.getFullYear(),d.getMonth()+1,0),label:new Intl.DateTimeFormat('th-TH',{month:'short'}).format(d),year:d.getFullYear()});d=new Date(d.getFullYear(),d.getMonth()+1,1)}}else{d=new Date(min.getFullYear(),Math.floor(min.getMonth()/3)*3,1);while(d<=max){out.push({start:new Date(d),end:new Date(d.getFullYear(),d.getMonth()+3,0),label:`Q${Math.floor(d.getMonth()/3)+1}`,year:d.getFullYear()});d=new Date(d.getFullYear(),d.getMonth()+3,1)}}return out}
function buildYears(periods){const out=[];periods.forEach((p,i)=>{let y=out[out.length-1];if(!y||y.year!==p.year){y={year:p.year,start:i+1,end:i+1};out.push(y)}else y.end=i+1});return out}
function periodIndex(d){for(let i=0;i<S.periods.length;i++){const p=S.periods[i];if(d>=p.start&&d<=p.end)return i}return d<S.periods[0].start?0:S.periods.length-1}
function setupTimeline(){const min=new Date(Math.min(...S.tasks.map(t=>t.start))),max=new Date(Math.max(...S.tasks.map(t=>t.end)));S.periods=buildPeriods(min,max,S.scale);S.years=buildYears(S.periods);const w=S.scale==='month'?72:78;document.documentElement.style.setProperty('--period-count',S.periods.length);document.documentElement.style.setProperty('--period-width',`${w}px`);document.documentElement.style.setProperty('--timeline-width',`${w*S.periods.length}px`)}
function taskGroup(t){return S.groups.find(g=>g.tasks.includes(t))}
function renderHeaders(frag){
  const yr=document.createElement('div');yr.className='year-row';const left=document.createElement('div');left.className='left-head';left.innerHTML='<span>WBS</span><span>ACTIVITY / TASK</span><span>ACCOUNTIBILITY</span><span>STATUS</span>';yr.append(left);
  S.years.forEach(y=>{const c=document.createElement('div');c.className='year-cell';c.style.gridColumn=`${y.start+1}/${y.end+2}`;c.innerHTML=`<b>พ.ศ. ${beYear(y.year)}</b><small>${y.end-y.start+1} ${S.scale==='month'?'เดือน':'ไตรมาส'}</small>`;yr.append(c)});frag.append(yr);
  const pr=document.createElement('div');pr.className='period-row';const pl=document.createElement('div');pl.className='left-head';pl.innerHTML='<span></span><span>Control Window</span><span></span><span></span>';pr.append(pl);S.periods.forEach((p,i)=>{const c=document.createElement('div');c.className='period-cell-head'+(i===0||p.year!==S.periods[i-1].year?' year-start':'');c.style.gridColumn=String(i+2);c.textContent=p.label;pr.append(c)});frag.append(pr)
}
function openDialog(t){E.dialogKicker.textContent=t.milestone?'MILESTONE DETAIL':t.summary?'SUMMARY ACTIVITY':'ACTIVITY DETAIL';E.dialogTitle.textContent=t.name;E.dialogDetails.innerHTML=`<dt>WBS</dt><dd>${esc(t.wbs||'—')}</dd><dt>Accountibility</dt><dd>${esc(t.owner||'—')}</dd><dt>Status</dt><dd>${esc(t.status||'—')}</dd><dt>Planned Start</dt><dd>${esc(fmtDate(t.start))}</dd><dt>Planned Finish</dt><dd>${esc(fmtDate(t.end))}</dd><dt>Duration</dt><dd>${t.duration.toLocaleString('th-TH')} วัน</dd><dt>ปี พ.ศ.</dt><dd>${beYear(t.start.getFullYear())}${t.start.getFullYear()!==t.end.getFullYear()?`–${beYear(t.end.getFullYear())}`:''}</dd><dt>Progress</dt><dd>${t.hasProgress?Math.round(t.progress)+'%':'—'}</dd><dt>Excel row</dt><dd>${t.row}</dd>`;E.dialog.showModal()}
function createPackageRow(g){const r=document.createElement('div');r.className='package-row';const lab=document.createElement('div');lab.className='package-label';const collapsed=S.collapsed.has(g.key);lab.innerHTML=`<button class="package-toggle" type="button" aria-label="${collapsed?'ขยาย':'ย่อ'}">${collapsed?'+':'−'}</button><span>${esc(g.label)}</span><small>${g.tasks.length} activities</small>`;lab.querySelector('button').onclick=()=>{collapsed?S.collapsed.delete(g.key):S.collapsed.add(g.key);render()};r.append(lab);S.periods.forEach((p,i)=>{const c=document.createElement('div');c.className='package-time';c.style.gridColumn=String(i+2);r.append(c)});const a=periodIndex(g.start),b=periodIndex(g.end);const band=document.createElement('div');band.className='package-band';band.style.gridColumn=`${a+2}/${b+3}`;r.append(band);return r}
function createTaskRow(t,index){const r=document.createElement('div');r.className='task-row'+(index%2?' alt':'');const left=document.createElement('div');left.className='task-left';const sc=statusClass(t.status);left.innerHTML=`<div class="wbs-cell">${esc(t.wbs||'')}</div><div><div class="task-title">${esc(t.name)}</div><div class="task-sub">${esc(fmtDate(t.start))} → ${esc(fmtDate(t.end))}${t.hasProgress?` · Progress ${Math.round(t.progress)}%`:''}</div></div><div class="owner-cell${t.owner?'':' empty'}">${esc(t.owner||'—')}</div><div><span class="status-badge ${sc}">${esc(t.status||'—')}</span></div>`;left.onclick=()=>openDialog(t);r.append(left);
  S.periods.forEach((p,i)=>{const c=document.createElement('div');c.className='timeline-cell'+(i===0||p.year!==S.periods[i-1].year?' year-start':'');c.style.gridColumn=String(i+2);r.append(c)});const a=periodIndex(t.start),b=periodIndex(t.end);if(t.milestone){const m=document.createElement('div');m.className='milestone';m.style.gridColumn=String(a+2);m.onclick=()=>openDialog(t);r.append(m)}else{const bar=document.createElement('div');bar.className='task-bar'+(t.summary?' summary':'')+(t.end<S.today&&t.progress<100&&!t.summary?' overdue':'');bar.style.gridColumn=`${a+2}/${b+3}`;bar.innerHTML=`${t.hasProgress?`<i class="progress-fill" style="width:${clamp(t.progress,0,100)}%"></i>`:''}<span>${esc(t.name)}</span>`;bar.onclick=()=>openDialog(t);r.append(bar)}return r}
function todayMarker(){if(!S.periods.length||S.today<S.periods[0].start||S.today>S.periods[S.periods.length-1].end)return null;const i=periodIndex(S.today),p=S.periods[i],days=dayDiff(p.start,p.end)+1,frac=clamp(dayDiff(p.start,S.today)/days,0,1),w=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--period-width'));const line=document.createElement('div');line.className='today-marker';line.style.left=`calc(var(--task-width) + ${i*w+frac*w}px)`;return line}
function render(){const frag=document.createDocumentFragment();renderHeaders(frag);const visibleGroups=S.groups.map(g=>({...g,tasks:g.tasks.filter(t=>S.visible.includes(t))})).filter(g=>g.tasks.length);let rowIndex=0;for(const g of visibleGroups){frag.append(createPackageRow(g));if(!S.collapsed.has(g.key))for(const t of g.tasks)frag.append(createTaskRow(t,rowIndex++))}if(!visibleGroups.length){const e=document.createElement('div');e.className='empty-state';e.innerHTML='<strong>ไม่พบรายการตามเงื่อนไข</strong><span>ลองล้างตัวกรองหรือเปลี่ยนคำค้นหา</span>';frag.append(e)}E.grid.replaceChildren(frag);const line=todayMarker();if(line)E.grid.append(line)}
function uniq(values){return [...new Set(values.map(text).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'th'))}
function fillSelect(el,items,label){el.innerHTML=`<option value="all">${label}</option>`+items.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('')}
function updateFacts(){const min=new Date(Math.min(...S.tasks.map(t=>t.start))),max=new Date(Math.max(...S.tasks.map(t=>t.end))),owners=uniq(S.tasks.map(t=>t.owner));E.range.textContent=`${fmtDate(min)} – ${fmtDate(max)}`;E.tasks.textContent=S.tasks.length.toLocaleString('th-TH');E.groups.textContent=S.groups.length.toLocaleString('th-TH');E.owners.textContent=owners.length.toLocaleString('th-TH')}
function applyFilters(){const q=norm(E.search.value),pkg=E.package.value,owner=E.owner.value,status=E.status.value;S.visible=S.tasks.filter(t=>{const g=taskGroup(t);return(pkg==='all'||g?.key===pkg)&&(owner==='all'||t.owner===owner)&&(status==='all'||t.status===status)&&(!q||norm([t.name,t.wbs,t.owner,t.status].join(' ')).includes(q))});render()}
function enableControls(){[E.search,E.package,E.owner,E.status,E.today,E.reset,...document.querySelectorAll('[data-scale]')].forEach(x=>x.disabled=false)}
async function load(file){try{if(typeof XLSX==='undefined')throw Error('โหลดตัวอ่าน Excel ไม่สำเร็จ');const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});if(!wb.SheetNames.includes('Project Plan'))throw Error(`ไฟล์นี้ไม่มี worksheet “Project Plan”`);const parsed=parseWorkbook(wb.Sheets['Project Plan']);S.tasks=parsed.tasks;S.visible=[...S.tasks];S.groups=buildGroups(S.tasks);S.fileName=file.name;S.collapsed.clear();setupTimeline();fillSelect(E.package,S.groups.map(g=>g.key),'ทั้งหมด');E.package.querySelectorAll('option').forEach(o=>{const g=S.groups.find(x=>x.key===o.value);if(g)o.textContent=g.label});fillSelect(E.owner,uniq(S.tasks.map(t=>t.owner)),'ทั้งหมด');fillSelect(E.status,uniq(S.tasks.map(t=>t.status)),'ทั้งหมด');updateFacts();enableControls();E.source.classList.add('loaded');E.source.querySelector('span').textContent=file.name;const a=parsed.audit,ownerCols=a.ownerCols.length?a.ownerCols.map(i=>`${excelCol(i)}: ${parsed.headers[i]}`).join(', '):'ไม่พบ';const wbsCols=a.wbsCols.length?a.wbsCols.map(i=>excelCol(i)).join(', '):'ไม่พบ';E.audit.innerHTML=`<strong>Project Plan audit</strong> · แถวหลัง header ${a.rows} · มี Task ${a.named} · วาดใน Gantt ${a.dated} · ไม่มี Start/Finish ${a.undated} · Accountibility ${ownerCols} · WBS source ${wbsCols}`;E.check.textContent=`ใช้เฉพาะ Project Plan · ${a.dated}/${a.named} แถวที่มีชื่อถูกวาดบน Gantt · ${uniq(S.tasks.map(t=>t.owner)).length} Accountibility · ปีแสดงเป็น พ.ศ. จาก Planned Start/Finish ที่ normalize แล้ว`;render();E.scroll.scrollLeft=0}catch(err){console.error(err);E.audit.innerHTML=`<span style="color:#9C0006"><strong>อ่านไฟล์ไม่สำเร็จ:</strong> ${esc(err.message)}</span>`}}
E.file.onchange=e=>{const f=e.target.files?.[0];if(f)load(f)};
E.search.oninput=applyFilters;E.package.onchange=applyFilters;E.owner.onchange=applyFilters;E.status.onchange=applyFilters;
document.querySelectorAll('[data-scale]').forEach(b=>b.onclick=()=>{if(!S.tasks.length)return;S.scale=b.dataset.scale;document.querySelectorAll('[data-scale]').forEach(x=>x.classList.toggle('active',x===b));setupTimeline();render()});
E.reset.onclick=()=>{E.search.value='';E.package.value='all';E.owner.value='all';E.status.value='all';S.visible=[...S.tasks];render()};
E.today.onclick=()=>{if(!S.tasks.length)return;if(S.today<S.periods[0].start||S.today>S.periods[S.periods.length-1].end){E.audit.innerHTML+=' · <span style="color:#9C0006">วันนี้อยู่นอกช่วงโครงการ</span>';return}const i=periodIndex(S.today),w=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--period-width'));E.scroll.scrollTo({left:Math.max(0,i*w-E.scroll.clientWidth*.45),top:E.scroll.scrollTop,behavior:'smooth'})};
E.dialogClose.onclick=()=>E.dialog.close();E.dialog.addEventListener('click',e=>{if(e.target===E.dialog)E.dialog.close()});
})();
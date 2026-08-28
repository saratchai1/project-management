(()=>{'use strict';
const $=id=>document.getElementById(id);
const STORAGE_KEY='work-monitor-projects-v2';
const LEGACY_STORAGE_KEY='work-monitor-projects-v1';
const ORIGIN=location.origin;
const S={projects:[],activeId:null,editingId:null,detailId:null,mode:'hub',pendingUploads:new Map()};
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const normalize=value=>String(value??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('th');
const uid=prefix=>globalThis.crypto?.randomUUID?.()||`${prefix||'id'}-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
const formatSize=bytes=>{const n=Number(bytes)||0;if(n<1024)return `${n} B`;if(n<1024*1024)return `${(n/1024).toFixed(1)} KB`;return `${(n/1024/1024).toFixed(1)} MB`};

function createRuntimeProject(meta){
  return {id:String(meta.id),name:String(meta.name),note:String(meta.note||''),createdAt:Number(meta.createdAt)||Date.now(),status:'ยังไม่มีไฟล์ Progress',metrics:{files:0,years:[],plots:0,dataFiles:[]},attachments:[],iframe:null,observer:null,resizeObserver:null,statusTimer:null};
}
function loadProjects(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY)||localStorage.getItem(LEGACY_STORAGE_KEY)||'[]';
    const saved=JSON.parse(raw);
    if(Array.isArray(saved))S.projects=saved.filter(x=>x&&x.id&&x.name).map(createRuntimeProject);
    persistProjects();
  }catch(error){console.warn('Project metadata could not be restored',error)}
}
function persistProjects(){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(S.projects.map(({id,name,note,createdAt})=>({id,name,note,createdAt}))))}
  catch(error){console.warn('Project metadata could not be saved',error)}
}
function projectById(id){return S.projects.find(p=>p.id===id)||null}
function currentProject(){return projectById(S.activeId)}
function detailProject(){return projectById(S.detailId)}
function hasDuplicateName(name,exceptId=null){const key=normalize(name);return S.projects.some(p=>p.id!==exceptId&&normalize(p.name)===key)}
function bodyLock(){document.body.style.overflow=(!$('projectDetailModal').hidden||!$('projectModal').hidden)?'hidden':''}

function frameMetrics(p){
  const base={files:0,years:[],plots:0,dataFiles:[]};
  if(!p?.iframe)return base;
  try{
    const doc=p.iframe.contentDocument;if(!doc)return base;
    const cards=[...doc.querySelectorAll('.file-card')];
    const dataFiles=cards.map(card=>({name:card.querySelector('.file-card-main strong')?.textContent?.trim()||'Excel',meta:card.querySelector('.file-card-main small')?.textContent?.trim()||'',years:[...card.querySelectorAll('.file-tags span')].map(x=>x.textContent.trim())}));
    const years=[...doc.querySelectorAll('#yearNav .year-btn span')].map(x=>x.textContent.trim()).filter(Boolean);
    const summary=doc.getElementById('fileSummary')?.textContent?.trim()||'';
    const match=summary.match(/([\d,]+)\s*แปลง/);
    return {files:cards.length,years,plots:match?Number(match[1].replace(/,/g,'')):0,dataFiles};
  }catch(error){console.warn('Unable to read project metrics',error);return base}
}
function projectStatus(p){
  const m=p.metrics||frameMetrics(p),parts=[];
  if(m.files)parts.push(`${m.files} ไฟล์`,`${m.years.length} ปีงาน`,`${m.plots} แปลงก่อนรวมซ้ำ`);else parts.push('ยังไม่มีไฟล์ Progress');
  if(p.attachments.length)parts.push(`${p.attachments.length} เอกสารแนบ`);
  return parts.join(' · ');
}
function renderSelector(){
  const select=$('projectSelect'),projects=[...S.projects].sort((a,b)=>a.createdAt-b.createdAt);
  select.disabled=!projects.length;
  select.innerHTML=`<option value="">${projects.length?'เลือกโครงการ…':'ยังไม่มีโครงการ'}</option>`+projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  select.value=S.activeId||S.detailId||'';$('showProjectsBtn').disabled=!projects.length;
}
function renderSummary(){const p=currentProject();$('activeProjectSummary').innerHTML=p?`โครงการที่กำลังดู<br><b>${esc(p.name)}</b>`:`เลือกโครงการก่อนดู Progress<br><b>${S.projects.length} โครงการในรายการ</b>`}
function renderCards(){
  const container=$('projectCards');
  if(!S.projects.length){container.innerHTML=`<button class="project-add-card empty-project-add" type="button" data-action="add"><span>＋</span><strong>สร้างโครงการแรก</strong><small>ตั้งชื่อโครงการก่อนเพิ่ม Excel และเอกสาร</small></button>`;return}
  const cards=[...S.projects].sort((a,b)=>a.createdAt-b.createdAt).map(p=>{const m=p.metrics||frameMetrics(p),badges=[m.years.length?`${m.years.length} ปีงาน`:null,m.plots?`${m.plots} แปลง`:null,p.attachments.length?`${p.attachments.length} เอกสาร`:null].filter(Boolean);return `<article class="project-card ${p.id===S.activeId?'active':''}" data-project="${esc(p.id)}"><div class="project-card-top"><span class="project-mark">PROJECT</span><div class="project-card-menu"><button type="button" class="icon-btn" data-action="edit" data-project="${esc(p.id)}" aria-label="แก้ไขโครงการ">✎</button><button type="button" class="icon-btn danger" data-action="delete" data-project="${esc(p.id)}" aria-label="ลบโครงการ">×</button></div></div><h3>${esc(p.name)}</h3><p>${esc(p.note||'ยังไม่ได้ระบุรายละเอียดโครงการ')}</p><div class="project-card-facts">${badges.length?badges.map(x=>`<span>${esc(x)}</span>`).join(''):'<span>รอเพิ่มไฟล์ Progress</span>'}</div><div class="project-status"><i></i><span>${esc(projectStatus(p))}</span></div><button type="button" class="project-open-btn" data-action="open" data-project="${esc(p.id)}">ดูรายละเอียดโครงการ</button></article>`}).join('');
  container.innerHTML=cards+`<button class="project-add-card" type="button" data-action="add"><span>＋</span><strong>เพิ่มโครงการ</strong><small>สร้างพื้นที่ข้อมูลและเอกสารแยกอีกชุด</small></button>`;
}
function renderWorkspaceHead(){const p=currentProject();if(!p)return;$('workspaceProjectName').textContent=p.name;$('workspaceProjectNote').textContent=p.note||'Dashboard และไฟล์ของโครงการนี้แยกจากโครงการอื่น';$('workspaceStatus').textContent=projectStatus(p)}
function renderAll(){renderSelector();renderSummary();renderCards();if(currentProject())renderWorkspaceHead()}
function setMode(mode){S.mode=mode;$('projectHub').hidden=mode!=='hub';$('projectWorkspace').hidden=mode!=='workspace';$('projectToolbar').classList.toggle('workspace-mode',mode==='workspace');if(mode==='workspace'){const p=currentProject();if(!p){showHub();return}showOnlyFrame(p.id);renderWorkspaceHead();requestAnimationFrame(()=>syncFrameHeight(p))}renderAll()}
function showHub(){S.activeId=null;document.title='Work Progress Monitor · Project Hub';setMode('hub')}
function selectProject(id){const p=projectById(id);if(!p)return;S.activeId=id;ensureFrame(p);closeProjectDetail();setMode('workspace');document.title=`${p.name} · Work Progress Monitor`}
function frameUrl(p){return `dashboard.html?embedded=1&project=${encodeURIComponent(p.id)}&name=${encodeURIComponent(p.name)}`}
function ensureFrame(p){if(p.iframe)return p.iframe;const frame=document.createElement('iframe');frame.className='project-iframe';frame.title=`Dashboard: ${p.name}`;frame.src=frameUrl(p);frame.loading='eager';frame.dataset.project=p.id;frame.hidden=true;$('frameStack').appendChild(frame);p.iframe=frame;frame.addEventListener('load',()=>attachFrameObservers(p));return frame}
function showOnlyFrame(id){S.projects.forEach(p=>{if(p.iframe)p.iframe.hidden=p.id!==id})}
function syncFrameHeight(p){if(!p?.iframe||p.iframe.hidden)return;p.iframe.style.height=`${Math.max(760,window.innerHeight-185)}px`}
function updateProjectStatus(p){if(!p?.iframe)return;p.metrics=frameMetrics(p);p.status=projectStatus(p);renderCards();if(p.id===S.activeId)renderWorkspaceHead();if(p.id===S.detailId&&!$('projectDetailModal').hidden)renderProjectDetail();syncFrameHeight(p)}
function scheduleStatusUpdate(p){clearTimeout(p.statusTimer);p.statusTimer=setTimeout(()=>updateProjectStatus(p),120)}
function attachFrameObservers(p){try{const doc=p.iframe.contentDocument;if(!doc?.body)return;p.observer?.disconnect();p.resizeObserver?.disconnect();p.observer=new MutationObserver(()=>scheduleStatusUpdate(p));p.observer.observe(doc.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','class','style']});if('ResizeObserver'in window){p.resizeObserver=new ResizeObserver(()=>syncFrameHeight(p));p.resizeObserver.observe(doc.body)}updateProjectStatus(p)}catch(error){console.warn('Unable to observe project dashboard',error)}}

function renderProjectDetail(){
  const p=detailProject();if(!p)return;p.metrics=frameMetrics(p);const m=p.metrics;
  const yearTags=m.years.length?m.years.map(y=>`<span>${esc(y)}</span>`).join(''):'<span class="muted-tag">ยังไม่มีปีงาน</span>';
  const dataFiles=m.dataFiles.length?m.dataFiles.map(f=>`<div class="project-data-file"><div class="project-data-icon">XLS</div><div><strong>${esc(f.name)}</strong><small>${esc(f.meta||f.years.join(' · '))}</small></div></div>`).join(''):'<div class="project-empty-state">ยังไม่มี Excel Progress ในโครงการนี้</div>';
  const attachments=p.attachments.length?p.attachments.map(a=>`<div class="attachment-item"><div class="attachment-icon">DOC</div><div class="attachment-main"><strong title="${esc(a.name)}">${esc(a.name)}</strong><small>${esc(formatSize(a.size))} · แนบเมื่อ ${esc(a.addedAtLabel)}</small></div><div class="attachment-actions"><a class="mini-btn" href="${a.url}" download="${esc(a.name)}">เปิด/ดาวน์โหลด</a><button class="mini-btn danger" type="button" data-detail-action="remove-attachment" data-attachment="${esc(a.id)}">ลบ</button></div></div>`).join(''):'<div class="project-empty-state">ยังไม่มีเอกสารแนบ</div>';
  $('projectDetailContent').innerHTML=`<header class="project-detail-head"><div class="eyebrow">PROJECT DETAIL</div><h2 id="projectDetailTitle">${esc(p.name)}</h2><p>${esc(p.note||'ยังไม่ได้ระบุรายละเอียดเพิ่มเติม')}</p></header><div class="project-detail-body"><section class="project-metric-grid"><div><span>ไฟล์ Progress</span><strong>${m.files}</strong></div><div><span>ปีงาน</span><strong>${m.years.length}</strong></div><div><span>แปลงก่อนรวมซ้ำ</span><strong>${m.plots}</strong></div><div><span>เอกสารแนบ</span><strong>${p.attachments.length}</strong></div></section><section class="project-detail-section"><div class="project-section-head"><div><h3>Progress รายปี</h3><p>Dashboard ใช้มาตรฐานเดียวกันทุกโครงการและแยกตามปีงาน</p></div><button class="btn ghost compact" type="button" data-detail-action="add-excel">＋ เพิ่ม Excel</button></div><div class="project-year-tags">${yearTags}</div><div class="project-data-files">${dataFiles}</div></section><section class="project-detail-section"><div class="project-section-head"><div><h3>เอกสารแนบโครงการ</h3><p>แนบสัญญา แผนงาน รายงาน หรือเอกสารประกอบของโครงการนี้</p></div><button class="btn ghost compact" type="button" data-detail-action="add-attachment">＋ แนบเอกสาร</button></div><div class="attachment-list">${attachments}</div><div class="attachment-note">เอกสารอยู่ในแท็บนี้เท่านั้น ไม่ถูกอัปโหลดขึ้น server และจะหายเมื่อ Refresh หรือปิดแท็บ</div></section></div><footer class="project-detail-actions"><div><button class="btn ghost" type="button" data-detail-action="edit">แก้ไขข้อมูลโครงการ</button><button class="btn danger-outline" type="button" data-detail-action="delete">ลบโครงการ</button></div><button class="btn project-primary" type="button" data-detail-action="open-dashboard">เปิด Dashboard โครงการนี้</button></footer>`;
}
function openProjectDetail(id){const p=projectById(id);if(!p)return;S.detailId=id;ensureFrame(p);renderProjectDetail();$('projectDetailModal').hidden=false;bodyLock();renderSelector()}
function closeProjectDetail(){$('projectDetailModal').hidden=true;S.detailId=null;bodyLock();renderSelector()}

function waitForDashboard(frame,timeout=10000){
  if(frame.contentWindow?.__WORK_MONITOR_FILE_BRIDGE_READY__)return Promise.resolve();
  return new Promise((resolve,reject)=>{const started=Date.now();const timer=setInterval(()=>{try{if(frame.contentWindow?.__WORK_MONITOR_FILE_BRIDGE_READY__){clearInterval(timer);resolve()}else if(Date.now()-started>timeout){clearInterval(timer);reject(new Error('Dashboard โหลดตัวรับไฟล์ไม่ทันเวลา'))}}catch(error){clearInterval(timer);reject(error)}},80)});
}
async function sendExcelFiles(p,fileList){
  const files=[...(fileList||[])];if(!p||!files.length)return;
  const frame=ensureFrame(p),requestId=uid('upload');
  try{
    const payload=[];
    for(const file of files){payload.push({name:file.name,type:file.type,size:file.size,lastModified:file.lastModified,buffer:await file.arrayBuffer()})}
    await waitForDashboard(frame);
    S.pendingUploads.set(requestId,{projectId:p.id,fileNames:files.map(f=>f.name)});
    frame.contentWindow.postMessage({type:'work-monitor:add-excel',projectId:p.id,requestId,files:payload},ORIGIN,payload.map(x=>x.buffer));
    selectProject(p.id);
  }catch(error){console.error(error);alert(`เพิ่ม Excel ไม่สำเร็จ\n${error?.message||'กรุณาลองใหม่'}`)}finally{$('projectExcelInput').value=''}
}
function addAttachments(p,files){if(!p)return;[...(files||[])].forEach(file=>{const duplicate=p.attachments.some(a=>a.name===file.name&&a.size===file.size&&a.lastModified===file.lastModified);if(duplicate)return;p.attachments.push({id:uid('attachment'),name:file.name,size:file.size,type:file.type,lastModified:file.lastModified,url:URL.createObjectURL(file),addedAtLabel:new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short'}).format(new Date())})});renderProjectDetail();renderCards();if(p.id===S.activeId)renderWorkspaceHead();$('projectAttachmentInput').value=''}
function removeAttachment(p,id){const item=p?.attachments.find(a=>a.id===id);if(!item)return;URL.revokeObjectURL(item.url);p.attachments=p.attachments.filter(a=>a.id!==id);renderProjectDetail();renderCards();if(p.id===S.activeId)renderWorkspaceHead()}

function openProjectModal(mode,id=null){S.editingId=mode==='edit'?id:null;const p=S.editingId?projectById(S.editingId):null;$('projectModalTitle').textContent=p?'แก้ไขข้อมูลโครงการ':'สร้างโครงการใหม่';$('projectName').value=p?.name||'';$('projectNote').value=p?.note||'';$('projectFormError').textContent='';$('projectModal').hidden=false;bodyLock();setTimeout(()=>$('projectName').focus(),0)}
function closeProjectModal(){$('projectModal').hidden=true;S.editingId=null;bodyLock()}
function saveProject(){const name=$('projectName').value.trim().replace(/\s+/g,' '),note=$('projectNote').value.trim();if(!name){$('projectFormError').textContent='กรุณาระบุชื่อโครงการ';$('projectName').focus();return}if(hasDuplicateName(name,S.editingId)){$('projectFormError').textContent='มีโครงการชื่อนี้อยู่แล้ว';$('projectName').focus();return}if(S.editingId){const p=projectById(S.editingId);if(!p)return;p.name=name;p.note=note;if(p.iframe){p.iframe.title=`Dashboard: ${name}`;try{p.iframe.contentDocument.title=`${name} · Work Progress Monitor`}catch{}}persistProjects();closeProjectModal();renderAll();if(p.id===S.detailId)renderProjectDetail()}else{const p=createRuntimeProject({id:uid('project'),name,note,createdAt:Date.now()});S.projects.push(p);persistProjects();closeProjectModal();renderAll();openProjectDetail(p.id)}}
function deleteProject(id){const p=projectById(id);if(!p)return;const extra=(p.metrics?.files||p.attachments.length)?'\n\nไฟล์ Excel และเอกสารที่เลือกไว้จะถูกนำออกจากหน้าเว็บด้วย':'';if(!confirm(`ลบโครงการ “${p.name}” หรือไม่?${extra}`))return;p.attachments.forEach(a=>URL.revokeObjectURL(a.url));p.observer?.disconnect();p.resizeObserver?.disconnect();clearTimeout(p.statusTimer);p.iframe?.remove();S.projects=S.projects.filter(x=>x.id!==id);if(S.detailId===id)closeProjectDetail();if(S.activeId===id){S.activeId=null;S.mode='hub';document.title='Work Progress Monitor · Project Hub'}persistProjects();renderAll();setMode(S.activeId?'workspace':'hub')}
function handleProjectAction(target){const action=target.closest('[data-action]')?.dataset.action,id=target.closest('[data-project]')?.dataset.project||target.closest('[data-action]')?.dataset.project;if(action==='add')openProjectModal('add');else if(action==='open'&&id)openProjectDetail(id);else if(action==='edit'&&id)openProjectModal('edit',id);else if(action==='delete'&&id)deleteProject(id)}
function handleDetailAction(target){const button=target.closest('[data-detail-action]');if(!button)return;const p=detailProject();if(!p)return;const action=button.dataset.detailAction;if(action==='open-dashboard')selectProject(p.id);else if(action==='add-excel'){$('projectExcelInput').value='';$('projectExcelInput').click()}else if(action==='add-attachment'){$('projectAttachmentInput').value='';$('projectAttachmentInput').click()}else if(action==='remove-attachment')removeAttachment(p,button.dataset.attachment);else if(action==='edit')openProjectModal('edit',p.id);else if(action==='delete')deleteProject(p.id)}

window.addEventListener('message',event=>{
  if(event.origin!==ORIGIN)return;
  const data=event.data||{},p=projectById(data.projectId);if(!p)return;
  if(data.type==='work-monitor:dashboard-ready'){scheduleStatusUpdate(p);return}
  if(data.type==='work-monitor:excel-added'){
    S.pendingUploads.delete(data.requestId);setTimeout(()=>updateProjectStatus(p),150);return;
  }
  if(data.type==='work-monitor:excel-error'){
    S.pendingUploads.delete(data.requestId);console.error(data.message);alert(`อ่านไฟล์ไม่สำเร็จ\n${data.message||'กรุณาตรวจรูปแบบ Excel แล้วลองใหม่'}`);selectProject(p.id);
  }
});

$('projectCards').addEventListener('click',e=>handleProjectAction(e.target));
$('projectSelect').addEventListener('change',e=>{if(e.target.value)openProjectDetail(e.target.value);renderSelector()});
$('showProjectsBtn').onclick=showHub;$('addProjectBtn').onclick=()=>openProjectModal('add');$('workspaceAddProjectBtn').onclick=()=>openProjectModal('add');$('switchProjectBtn').onclick=showHub;$('projectInfoBtn').onclick=()=>{if(S.activeId)openProjectDetail(S.activeId)};$('renameProjectBtn').onclick=()=>{if(S.activeId)openProjectModal('edit',S.activeId)};$('deleteProjectBtn').onclick=()=>{if(S.activeId)deleteProject(S.activeId)};
$('projectDetailContent').addEventListener('click',e=>handleDetailAction(e.target));$('projectDetailClose').onclick=closeProjectDetail;$('projectDetailModal').addEventListener('click',e=>{if(e.target===$('projectDetailModal'))closeProjectDetail()});
$('projectExcelInput').onchange=e=>{const p=detailProject();if(p)sendExcelFiles(p,e.target.files)};$('projectAttachmentInput').onchange=e=>{const p=detailProject();if(p)addAttachments(p,e.target.files)};
$('projectSave').onclick=saveProject;$('projectCancel').onclick=closeProjectModal;$('projectModalClose').onclick=closeProjectModal;$('projectModal').addEventListener('click',e=>{if(e.target===$('projectModal'))closeProjectModal()});$('projectName').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();saveProject()}});
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(!$('projectModal').hidden)closeProjectModal();else if(!$('projectDetailModal').hidden)closeProjectDetail()});window.addEventListener('resize',()=>{const p=currentProject();if(p)syncFrameHeight(p)});window.addEventListener('beforeunload',()=>S.projects.forEach(p=>p.attachments.forEach(a=>URL.revokeObjectURL(a.url))));

loadProjects();renderAll();setMode('hub');
})();

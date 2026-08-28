(()=>{'use strict';
const $=id=>document.getElementById(id);
const STORAGE_KEY='work-monitor-projects-v1';
const S={projects:[],activeId:null,editingId:null,mode:'hub'};
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const normalize=value=>String(value??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('th');
const uid=()=>globalThis.crypto?.randomUUID?.()||`project-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;

function loadProjects(){
  try{
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');
    if(Array.isArray(saved))S.projects=saved.filter(x=>x&&x.id&&x.name).map(x=>({
      id:String(x.id),name:String(x.name),note:String(x.note||''),createdAt:Number(x.createdAt)||Date.now(),
      status:'ยังไม่มีไฟล์ · ต้องเลือกไฟล์ใหม่หลัง Refresh',iframe:null,observer:null,resizeObserver:null,statusTimer:null
    }));
  }catch(err){console.warn('Project metadata could not be restored',err)}
}
function persistProjects(){
  try{
    localStorage.setItem(STORAGE_KEY,JSON.stringify(S.projects.map(({id,name,note,createdAt})=>({id,name,note,createdAt}))));
  }catch(err){console.warn('Project metadata could not be saved',err)}
}
function projectById(id){return S.projects.find(p=>p.id===id)||null}
function currentProject(){return projectById(S.activeId)}
function hasDuplicateName(name,exceptId=null){const key=normalize(name);return S.projects.some(p=>p.id!==exceptId&&normalize(p.name)===key)}

function renderSelector(){
  const select=$('projectSelect');
  const projects=[...S.projects].sort((a,b)=>a.createdAt-b.createdAt);
  select.disabled=!projects.length;
  select.innerHTML=`<option value="">${projects.length?'เลือกโครงการ…':'ยังไม่มีโครงการ'}</option>`+projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  select.value=S.activeId||'';
  $('showProjectsBtn').disabled=!projects.length;
}
function renderSummary(){
  const p=currentProject();
  $('activeProjectSummary').innerHTML=p?`โครงการที่เลือก<br><b>${esc(p.name)}</b>`:`เลือกโครงการก่อนอัปโหลด Excel<br><b>${S.projects.length} โครงการในรายการ</b>`;
}
function renderCards(){
  const container=$('projectCards');
  if(!S.projects.length){
    container.innerHTML=`<button class="project-add-card empty-project-add" type="button" data-action="add"><span>＋</span><strong>สร้างโครงการแรก</strong><small>ตั้งชื่อโครงการก่อน แล้วจึงอัปโหลด Excel</small></button>`;
    return;
  }
  const cards=[...S.projects].sort((a,b)=>a.createdAt-b.createdAt).map(p=>`
    <article class="project-card ${p.id===S.activeId?'active':''}" data-project="${esc(p.id)}">
      <div class="project-card-top">
        <span class="project-mark">PROJECT</span>
        <div class="project-card-menu">
          <button type="button" class="icon-btn" data-action="edit" data-project="${esc(p.id)}" aria-label="แก้ไขโครงการ">✎</button>
          <button type="button" class="icon-btn danger" data-action="delete" data-project="${esc(p.id)}" aria-label="ลบโครงการ">×</button>
        </div>
      </div>
      <h3>${esc(p.name)}</h3>
      <p>${esc(p.note||'ยังไม่ได้ระบุรายละเอียดโครงการ')}</p>
      <div class="project-status"><i></i><span>${esc(p.status)}</span></div>
      <button type="button" class="project-open-btn" data-action="open" data-project="${esc(p.id)}">เปิดโครงการ</button>
    </article>`).join('');
  container.innerHTML=cards+`<button class="project-add-card" type="button" data-action="add"><span>＋</span><strong>เพิ่มโครงการ</strong><small>สร้างพื้นที่ข้อมูลแยกอีกชุด</small></button>`;
}
function renderWorkspaceHead(){
  const p=currentProject();
  if(!p)return;
  $('workspaceProjectName').textContent=p.name;
  $('workspaceProjectNote').textContent=p.note||'ไฟล์และ dashboard ของโครงการนี้จะแยกจากโครงการอื่น';
  $('workspaceStatus').textContent=p.status;
}
function renderAll(){renderSelector();renderSummary();renderCards();if(currentProject())renderWorkspaceHead()}

function setMode(mode){
  S.mode=mode;
  $('projectHub').hidden=mode!=='hub';
  $('projectWorkspace').hidden=mode!=='workspace';
  $('projectToolbar').classList.toggle('workspace-mode',mode==='workspace');
  if(mode==='workspace'){
    const p=currentProject();
    if(!p){showHub();return}
    showOnlyFrame(p.id);
    renderWorkspaceHead();
    requestAnimationFrame(()=>syncFrameHeight(p));
  }
  renderAll();
}
function showHub(){S.activeId=null;document.title='Work Progress Monitor · Project Hub';setMode('hub')}
function selectProject(id){
  const p=projectById(id);if(!p)return;
  S.activeId=id;
  ensureFrame(p);
  setMode('workspace');
  document.title=`${p.name} · Work Progress Monitor`;
}

function frameUrl(p){return `dashboard.html?embedded=1&project=${encodeURIComponent(p.id)}&name=${encodeURIComponent(p.name)}`}
function ensureFrame(p){
  if(p.iframe)return p.iframe;
  const frame=document.createElement('iframe');
  frame.className='project-iframe';
  frame.title=`Dashboard: ${p.name}`;
  frame.src=frameUrl(p);
  frame.loading='eager';
  frame.dataset.project=p.id;
  frame.hidden=true;
  $('frameStack').appendChild(frame);
  p.iframe=frame;
  frame.addEventListener('load',()=>attachFrameObservers(p));
  return frame;
}
function showOnlyFrame(id){
  S.projects.forEach(p=>{if(p.iframe)p.iframe.hidden=p.id!==id});
}
function syncFrameHeight(p){
  if(!p?.iframe||p.iframe.hidden)return;
  const height=Math.max(760,window.innerHeight-185);
  p.iframe.style.height=`${height}px`;
}
function updateProjectStatus(p){
  if(!p?.iframe)return;
  try{
    const doc=p.iframe.contentDocument;
    const workspace=doc?.getElementById('workspace');
    const summary=doc?.getElementById('fileSummary')?.textContent?.trim();
    const next=workspace&&!workspace.hidden?(summary||'มีข้อมูลแล้ว'):'ยังไม่มีไฟล์';
    if(p.status!==next){p.status=next;renderCards();if(p.id===S.activeId)renderWorkspaceHead()}
    syncFrameHeight(p);
  }catch(err){console.warn('Unable to read project dashboard status',err)}
}
function scheduleStatusUpdate(p){clearTimeout(p.statusTimer);p.statusTimer=setTimeout(()=>updateProjectStatus(p),100)}
function attachFrameObservers(p){
  try{
    const doc=p.iframe.contentDocument;
    if(!doc?.body)return;
    p.observer?.disconnect();p.resizeObserver?.disconnect();
    p.observer=new MutationObserver(()=>scheduleStatusUpdate(p));
    p.observer.observe(doc.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','class','style']});
    if('ResizeObserver'in window){p.resizeObserver=new ResizeObserver(()=>syncFrameHeight(p));p.resizeObserver.observe(doc.body)}
    updateProjectStatus(p);
  }catch(err){console.warn('Unable to observe project dashboard',err)}
}

function openProjectModal(mode,id=null){
  S.editingId=mode==='edit'?id:null;
  const p=S.editingId?projectById(S.editingId):null;
  $('projectModalTitle').textContent=p?'แก้ไขชื่อโครงการ':'สร้างโครงการใหม่';
  $('projectName').value=p?.name||'';
  $('projectNote').value=p?.note||'';
  $('projectFormError').textContent='';
  $('projectModal').hidden=false;
  document.body.style.overflow='hidden';
  setTimeout(()=>$('projectName').focus(),0);
}
function closeProjectModal(){
  $('projectModal').hidden=true;S.editingId=null;
  document.body.style.overflow='';
}
function saveProject(){
  const name=$('projectName').value.trim().replace(/\s+/g,' '),note=$('projectNote').value.trim();
  if(!name){$('projectFormError').textContent='กรุณาระบุชื่อโครงการ';$('projectName').focus();return}
  if(hasDuplicateName(name,S.editingId)){$('projectFormError').textContent='มีโครงการชื่อนี้อยู่แล้ว';$('projectName').focus();return}
  if(S.editingId){
    const p=projectById(S.editingId);if(!p)return;
    p.name=name;p.note=note;
    if(p.iframe){p.iframe.title=`Dashboard: ${name}`;try{p.iframe.contentDocument.title=`${name} · Work Progress Monitor`}catch{} }
    persistProjects();closeProjectModal();renderAll();
  }else{
    const p={id:uid(),name,note,createdAt:Date.now(),status:'ยังไม่มีไฟล์',iframe:null,observer:null,resizeObserver:null,statusTimer:null};
    S.projects.push(p);persistProjects();closeProjectModal();renderAll();selectProject(p.id);
  }
}
function deleteProject(id){
  const p=projectById(id);if(!p)return;
  const extra=p.status!=='ยังไม่มีไฟล์'?`\n\nไฟล์ที่เลือกไว้ในโครงการนี้จะถูกนำออกจากหน้าเว็บด้วย` : '';
  if(!confirm(`ลบโครงการ “${p.name}” หรือไม่?${extra}`))return;
  p.observer?.disconnect();p.resizeObserver?.disconnect();clearTimeout(p.statusTimer);p.iframe?.remove();
  S.projects=S.projects.filter(x=>x.id!==id);
  if(S.activeId===id){S.activeId=null;S.mode='hub';document.title='Work Progress Monitor · Project Hub'}
  persistProjects();renderAll();setMode(S.activeId?'workspace':'hub');
}

function handleProjectAction(target){
  const action=target.closest('[data-action]')?.dataset.action;
  const id=target.closest('[data-project]')?.dataset.project||target.closest('[data-action]')?.dataset.project;
  if(action==='add')openProjectModal('add');
  else if(action==='open'&&id)selectProject(id);
  else if(action==='edit'&&id)openProjectModal('edit',id);
  else if(action==='delete'&&id)deleteProject(id);
}

$('projectCards').addEventListener('click',e=>handleProjectAction(e.target));
$('projectSelect').addEventListener('change',e=>{if(e.target.value)selectProject(e.target.value)});
$('showProjectsBtn').onclick=showHub;
$('addProjectBtn').onclick=()=>openProjectModal('add');
$('workspaceAddProjectBtn').onclick=()=>openProjectModal('add');
$('switchProjectBtn').onclick=showHub;
$('renameProjectBtn').onclick=()=>{if(S.activeId)openProjectModal('edit',S.activeId)};
$('deleteProjectBtn').onclick=()=>{if(S.activeId)deleteProject(S.activeId)};
$('projectSave').onclick=saveProject;
$('projectCancel').onclick=closeProjectModal;
$('projectModalClose').onclick=closeProjectModal;
$('projectModal').addEventListener('click',e=>{if(e.target===$('projectModal'))closeProjectModal()});
$('projectName').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();saveProject()}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('projectModal').hidden)closeProjectModal()});
window.addEventListener('resize',()=>{const p=currentProject();if(p)syncFrameHeight(p)});

loadProjects();
renderAll();
setMode('hub');
})();

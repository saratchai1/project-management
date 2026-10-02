(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = {csrf:'', current:null, uploads:[], selected:null, report:null, busy:false, generation:0};
  const fmt = new Intl.NumberFormat('th-TH', {maximumFractionDigits:2});
  const money = v => v == null ? 'ไม่ทราบ' : fmt.format(Number(v));
  const el = (tag, text, cls) => {const node=document.createElement(tag); if(text!=null)node.textContent=text; if(cls)node.className=cls; return node;};
  const message = (text, error=false) => { $('message').textContent=text; $('message').classList.toggle('error',error); };
  async function api(path, {method='GET', body, headers={}}={}) {
    const options={method, credentials:'same-origin', headers:{'X-CSRF-Token':state.csrf,...headers}};
    if(body!==undefined){options.body=body instanceof File?body:JSON.stringify(body);if(!(body instanceof File))options.headers['Content-Type']='application/json';}
    const response=await fetch(path,options);
    const result=await response.json();
    if(!response.ok){if(response.status===401){$('login').hidden=false;$('workspace').hidden=true;}throw Error(typeof result.error==='string'?result.error:JSON.stringify(result.detail||result));}
    return result;
  }
  const inputs = () => state.uploads.map(x=>({uploadId:x.uploadId,profileId:x.profileId}));
  const inputKey = () => JSON.stringify([state.current?.revision, inputs().map(x=>[x.uploadId,x.profileId]).sort()]);
  const reportIsCurrent = () => !!state.uploads.length && state.uploads.every(x=>x.profileId) &&
    state.report?.status==='PASS' && state.report.inputGeneration===state.generation &&
    state.report.inputKey===inputKey() && state.report.baseRevision===state.current?.revision;
  function invalidate(){state.generation++;state.report=null;$('report').hidden=true;$('reportEmpty').hidden=false;$('publishConsent').checked=false;refreshButtons();}
  function refreshButtons(){
    $('preview').disabled=state.busy||!state.uploads.length||state.uploads.some(x=>!x.profileId);
    $('publish').disabled=state.busy||!reportIsCurrent()||!$('publishConsent').checked;
    $('suggestAI').disabled=state.busy||!state.selected||!$('aiConsent').checked;
    for(const id of ['approve','refresh','rollback','sampleAI'])$(id).disabled=state.busy;
  }
  async function task(fn){if(state.busy)return;state.busy=true;refreshButtons();try{await fn();}catch(error){message(error.message,true);}finally{state.busy=false;refreshButtons();}}
  async function refresh(){
    const [current,history]=await Promise.all([api('/api/current'),api('/api/history')]);
    state.current=current;$('revision').textContent=current.revision;
    $('history').replaceChildren(...history.map(h=>{const label=new Intl.DateTimeFormat('th-TH',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(h.createdAt));const option=el('option',`${label} · ${h.event.kind} · ${h.revision.slice(0,12)}`);option.value=h.revision;return option;}));
    $('login').hidden=true;$('workspace').hidden=false;invalidate();
  }
  $('loginForm').addEventListener('submit',event=>{event.preventDefault();task(async()=>{const token=$('token').value;const result=await api('/api/session',{method:'POST',headers:{Authorization:'Bearer '+token}});$('token').value='';state.csrf=result.csrf;await refresh();message('เข้าสู่ระบบแล้ว');});});
  $('logout').onclick=()=>task(async()=>{await api('/api/logout',{method:'POST'});location.reload();});
  $('refresh').onclick=()=>task(refresh);
  function renderUploads(){
    $('uploads').replaceChildren();
    for(const file of state.uploads){
      const card=el('div',null,'filecard'),info=el('div');info.append(el('strong',file.name),el('small',file.profileId?'Mapping ยืนยันแล้ว':'ต้องตรวจ Mapping ก่อน'));
      const select=el('select'),placeholder=el('option','เลือก Mapping ที่ตรงกับไฟล์');placeholder.value='';select.append(placeholder);
      for(const p of file.matchingProfiles){const o=el('option',p.name);o.value=p.id;select.append(o);}
      select.value=file.profileId||'';select.onchange=()=>{file.profileId=select.value||null;invalidate();renderUploads();};
      const edit=el('button','ตรวจ Mapping','secondary');edit.onclick=()=>openMapping(file);
      const remove=el('button','นำออกจากรอบนี้','quiet');remove.onclick=()=>{state.uploads=state.uploads.filter(x=>x!==file);if(state.selected===file){state.selected=null;$('mappingPanel').hidden=true;}invalidate();renderUploads();};
      card.append(info,select,edit,remove);$('uploads').append(card);
    }refreshButtons();
  }
  async function upload(files){
    invalidate();
    if(state.uploads.length+files.length>8)throw Error('หนึ่งรอบรองรับไม่เกิน 8 ไฟล์');
    for(const file of files){
      if(!file.name.toLowerCase().endsWith('.xlsx')||file.size>20*1024*1024)throw Error('รองรับ .xlsx ไม่เกิน 20 MiB ต่อไฟล์');
      message('กำลังตรวจโครงสร้าง '+file.name);
      const result=await api('/api/uploads',{method:'POST',body:file,headers:{'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(file.name)}});
      if(state.uploads.some(x=>x.uploadId===result.uploadId)){message('ไฟล์นี้อยู่ในรอบนำเข้าแล้ว ไม่เพิ่มซ้ำ');continue;}
      result.profileId=result.matchingProfiles.length===1?result.matchingProfiles[0].id:null;
      result.name=file.name;state.uploads.push(result);invalidate();renderUploads();
    }invalidate();renderUploads();message('อ่านโครงสร้างแล้ว ข้อมูล Dashboard ยังไม่เปลี่ยน');
  }
  $('files').onchange=event=>task(async()=>{await upload([...event.target.files]);event.target.value='';});
  const drop=$('dropzone');drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragging');});drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragging');task(()=>upload([...e.dataTransfer.files]));});
  function openMapping(file){
    if(state.busy)return;
    state.selected=file;$('mappingPanel').hidden=false;$('mappingFile').textContent=file.name;
    $('inspection').textContent=JSON.stringify(file.inspection,null,2);
    const known=file.matchingProfiles.find(x=>x.id===file.profileId);
    $('profile').value=known?JSON.stringify(known.profile,null,2):JSON.stringify({schema_version:2,name:'ตั้งชื่อ Mapping',layout_hash:file.inspection.layoutHash,semantics:'boq-budget_and_or_cumulative-ap-postings',regions:[],ignored_sheets:{}},null,2);
    $('review').value='';$('semantics').checked=false;$('aiConsent').checked=false;$('aiPreview').hidden=true;refreshButtons();$('mappingPanel').scrollIntoView({behavior:'smooth',block:'start'});
  }
  $('sampleAI').onclick=()=>task(async()=>{if(!state.selected)throw Error('เลือกไฟล์ก่อน');const payload=await api('/api/ai-payload/'+state.selected.uploadId);$('aiPayload').textContent=JSON.stringify(payload,null,2);$('aiPreview').hidden=false;$('aiPreview').open=true;});
  $('aiConsent').onchange=refreshButtons;
  $('suggestAI').onclick=()=>task(async()=>{const result=await api('/api/ai-suggest',{method:'POST',body:{uploadId:state.selected.uploadId,consentToSendSamples:$('aiConsent').checked}});if(result.profile){$('profile').value=JSON.stringify(result.profile,null,2);$('profile').dispatchEvent(new Event('input'));}message(result.profile?'AI เสนอ Mapping แล้ว ยังต้องตรวจและยืนยันก่อนใช้งาน':result.reason,true);});
  $('profile').addEventListener('input',()=>{if(state.selected)state.selected.profileId=null;$('semantics').checked=false;invalidate();});
  $('approve').onclick=()=>task(async()=>{
    if(!state.selected)throw Error('เลือกไฟล์ก่อน');const file=state.selected, generation=state.generation, profile=JSON.parse($('profile').value);
    const result=await api('/api/profiles/approve',{method:'POST',body:{uploadId:file.uploadId,profile,review:$('review').value,confirmSemantics:$('semantics').checked}});
    if(generation!==state.generation||state.selected!==file||!state.uploads.includes(file))return;
    state.selected.profileId=result.profileId;
    if(!state.selected.matchingProfiles.some(x=>x.id===result.profileId))state.selected.matchingProfiles.push({id:result.profileId,name:profile.name,profile});
    invalidate();renderUploads();message('บันทึก Mapping ที่ยืนยันแล้ว ยังต้องตรวจยอดก่อนเผยแพร่');
  });
  const row=(values)=>{const tr=el('tr');for(const value of values)tr.append(el('td',value));return tr;};
  function renderReport(report, generation, key){
    state.report={...report,inputGeneration:generation,inputKey:key};$('reportEmpty').hidden=true;$('report').hidden=false;$('publishConsent').checked=false;
    $('resultBadge').replaceChildren(el('span',report.status==='PASS'?'ผ่านการตรวจเชิงโครงสร้างและยอด':'หยุดนำเข้า — ต้องแก้รายการต่อไปนี้',report.status==='PASS'?'pass':'blocked'));
    $('counts').replaceChildren(...[[report.checks.length,'รายการตรวจ'],[report.diff.filter(x=>x.changed).length,'แปลง/ปีที่เปลี่ยน'],[report.issues.length,'ข้อผิดพลาด']].map(([n,label])=>{const box=el('div',null,'metric');box.append(el('b',fmt.format(n)),el('span',label));return box;}));
    $('checks').replaceChildren(...report.checks.map(c=>row(c.kind==='scope'?[`${c.portfolio} ปี ${c.year}`,c.expected,c.parsed,c.pass?'PASS':'FAIL']:[`${c.sheet}!${c.cell} · ${c.field}`,money(c.source),money(c.parsed),`${money(c.difference)} · ${c.pass?'PASS':'FAIL'}`])));
    $('issues').hidden=!report.issues.length;$('issues').textContent=report.issues.map(i=>i.code).join('\n');
    const changed=report.diff.filter(x=>x.changed);
    $('diff').replaceChildren(...changed.slice(0,500).map(d=>row([`${d.portfolio} / ${d.plotCode} / ปี ${d.year}${d.evidenceChanged?' · ปรับหลักฐาน/สถานะ':''}`,`${money(d.before.boq)} → ${money(d.after.boq)}`,`${money(d.before.paid)} → ${money(d.after.paid)}`])));
    if(changed.length>500)$('diff').append(row([`แสดง 500 จาก ${changed.length} รายการ — ดูทั้งหมดใน JSON`,'','']));
    $('provenance').textContent=JSON.stringify(report.provenance.slice(0,300),null,2)+(report.provenance.length>300?'\nแสดง 300 รายการแรก ดูทั้งหมดใน JSON':'');refreshButtons();
  }
  $('preview').onclick=()=>task(async()=>{
    invalidate();const generation=state.generation, key=inputKey();
    const result=await api('/api/preview',{method:'POST',body:{inputs:inputs(),expectedRevision:state.current.revision}});
    if(generation!==state.generation||key!==inputKey()){
      message('รายการไฟล์หรือ Mapping เปลี่ยนแล้ว ยกเลิกผลตรวจเก่า กรุณาตรวจใหม่',true);return;
    }
    renderReport(result,generation,key);message(result.status==='PASS'?'ตรวจสอบผ่านแล้ว โปรดตรวจความหมายและขอบเขตก่อนเผยแพร่':'ยังเผยแพร่ไม่ได้ ตรวจรายการที่ไม่ผ่าน',result.status!=='PASS');
  });
  $('publishConsent').onchange=refreshButtons;
  $('publish').onclick=()=>task(async()=>{
    if(!reportIsCurrent()||!$('publishConsent').checked)throw Error('ผลตรวจไม่ตรงกับรายการปัจจุบัน กรุณาตรวจใหม่');
    const result=await api('/api/publish',{method:'POST',body:{inputs:inputs(),previewId:state.report.previewId,expectedRevision:state.report.baseRevision,confirm:true}});
    await refresh();message('เผยแพร่ในบริการ private แล้ว: '+result.revision+'\nเว็บ GitHub Pages ไม่ถูกเปลี่ยน');
  });
  $('downloadReport').onclick=()=>{if(!state.report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(state.report,null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download='boq-import-report-'+state.report.previewId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  $('rollback').onclick=()=>task(async()=>{const result=await api('/api/rollback',{method:'POST',body:{revision:$('history').value,expectedRevision:state.current.revision,reason:$('rollbackReason').value,confirm:$('rollbackConsent').checked}});$('rollbackConsent').checked=false;await refresh();message('ย้อนกลับแล้ว โดยสร้างเวอร์ชันใหม่: '+result.revision);});
  task(async()=>{try{const session=await api('/api/session');state.csrf=session.csrf;await refresh();}catch(error){if(error.message!=='AUTH_REQUIRED')throw error;}});
})();

/* Manual-save workspace: empty -> upload/merge -> explicit Save -> restore; Reset clears both. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),DB='boq-workspace-web-v1';
  const KEY=location.protocol==='file:'?decodeURIComponent(location.pathname):'workspace';
  const FALLBACK=DB+':'+KEY;
  const originalMain=$('financeDashboard').cloneNode(true),originalModal=$('modalBackdrop').cloneNode(true);
  let current=null,busy=false,dirty=false,generation=0,lastEnvelopeTime=0;
  const fmt=v=>new Intl.NumberFormat('th-TH',{maximumFractionDigits:2}).format(v);
  const date=(v,time=false)=>{
    if(!v||!Number.isFinite(new Date(v).getTime()))return 'ไม่ระบุ';
    return new Intl.DateTimeFormat('th-TH',{day:'2-digit',month:'2-digit',year:'numeric',calendar:'buddhist',numberingSystem:'latn',timeZone:'Asia/Bangkok',...(time?{hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}:{})}).format(new Date(v))+(time?' น.':'');
  };
  function status(text,error=false){$('autoStatus').textContent=text;$('autoStatus').hidden=!text;$('autoStatus').classList.toggle('error',error);$('autoProgress').hidden=!busy||error;}
  function buttons(){
    for(const b of document.querySelectorAll('[data-choose]'))b.disabled=busy;
    $('autoFile').disabled=busy;$('saveResult').disabled=busy||!current;
    $('resetAll').disabled=busy||!current;$('downloadSnapshot').disabled=busy||!current;
    $('saveResult').textContent=current&&!dirty?'เซฟแล้ว':'เซฟผล';
    document.body.classList.toggle('is-reading',busy);
  }
  function setDirty(){if(!current||busy)return;dirty=true;$('saveState').textContent='มีการเปลี่ยนแปลง — ยังไม่ได้เซฟผล';buttons();}
  function openDb(){return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB,1);let settled=false;
    const timeout=setTimeout(()=>{settled=true;reject(Error('เปิดพื้นที่จัดเก็บไม่สำเร็จ'));},4000);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('results'))request.result.createObjectStore('results');};
    request.onsuccess=()=>{clearTimeout(timeout);if(settled){request.result.close();return;}settled=true;resolve(request.result);};
    request.onerror=()=>{clearTimeout(timeout);settled=true;reject(request.error);};
    request.onblocked=()=>{clearTimeout(timeout);settled=true;reject(Error('พื้นที่จัดเก็บกำลังถูกใช้งาน'));};
  });}
  async function readStored(){
    let fallback=null,stored=null;
    try{fallback=JSON.parse(localStorage.getItem(FALLBACK)||'null');}catch(_){}
    try{
      const db=await openDb();
      try{stored=await new Promise((resolve,reject)=>{const tx=db.transaction('results');const req=tx.objectStore('results').get(KEY);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}finally{db.close();}
    }catch(_){}
    return [stored,fallback].filter(v=>v?.version===3).sort((a,b)=>b.timestamp-a.timestamp)[0]||null;
  }
  async function writeStored(record){
    const envelope={version:3,timestamp:Math.max(Date.now(),lastEnvelopeTime+1),kind:record?'saved':'empty',record};
    lastEnvelopeTime=envelope.timestamp;
    try{
      const db=await openDb();
      try{await new Promise((resolve,reject)=>{const tx=db.transaction('results','readwrite');tx.objectStore('results').put(envelope,KEY);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
      try{localStorage.removeItem(FALLBACK);}catch(_){}
    }catch(_){
      try{localStorage.setItem(FALLBACK,JSON.stringify(envelope));}catch(error){throw Error('เบราว์เซอร์ไม่อนุญาตให้เซฟลงเครื่อง กรุณาใช้ปุ่มดาวน์โหลดสำเนาผลลัพธ์ HTML');}
    }
  }
  function valid(record){return record?.schema===3&&Array.isArray(record?.data?.plots)&&record.data.plots.length&&Array.isArray(record.overrides)&&Array.isArray(record.referenceRows)&&record.referenceRows.length===BOQERP.reference.apCount&&record?.summary?.generatedAt;}
  function show(record,isSaved=false){
    const view=record.view||window.BOQDashboard?.getState()||{};
    window.renderBOQ(record.data,view);
    current=record;dirty=!isSaved;
    $('uploadIntro').hidden=true;$('sourceBar').hidden=false;$('resultCreated').hidden=false;
    const s=record.summary;
    $('resultCreatedTime').textContent=date(s.generatedAt,true);$('resultCreatedTime').setAttribute('data-iso',s.generatedAt);
    $('saveState').textContent=isSaved?'เซฟแล้ว '+date(record.savedAt||s.generatedAt,true):'ยังไม่ได้เซฟผล';
    $('sourceName').textContent='ไฟล์ล่าสุด: '+s.fileName;
    $('sourceSummary').textContent='อัปโหลดแล้ว '+fmt(record.sources.length)+' ไฟล์ • AP ถึง '+date(s.asOf);
    $('updateSummary').textContent='รอบล่าสุด: เพิ่ม '+fmt(s.added)+' รายการ • แทนที่ข้อมูลเดิม '+fmt(s.replaced)+' รายการ • เหมือนเดิม '+fmt(s.unchanged)+' รายการ — ไม่มีการบวกซ้ำ';
    $('readDetails').textContent='รวมกับฐาน BOQ เดิมและรายการก่อนหน้า โดยจับคู่รหัสบริษัท + เลขที่เอกสาร AP + เลขลำดับรายการ\n'
      +'ยอดซ้ำใช้ข้อมูลจากไฟล์ที่อัปโหลดทีหลัง รายการอื่นยังคงเดิม\n'
      +'ฐาน BOQ เดิมถึง 05/10/2569; ไฟล์ Excel เป็นแหล่งอัปเดตรายการ AP ไม่เปลี่ยนงบ BOQ โดยไม่มีหลักฐาน\n'
      +'ยอด AP สุทธิเปลี่ยนจากฐาน '+fmt(s.deltaAmount)+' บาท • '+fmt(s.changedPlots)+' แปลง\n'
      +'วันที่สร้าง Excel ต้นฉบับ: '+(s.fileCreatedAt?date(s.fileCreatedAt,true):'ไม่มีข้อมูลในไฟล์')+'\n\n'
      +'ลำดับไฟล์ (รายการซ้ำใช้ไฟล์ที่อยู่ด้านล่าง):\n'+record.sources.map((x,i)=>(i+1)+'. '+x.fileName+' • '+date(x.uploadedAt,true)).join('\n')
      +'\n\nกดเซฟผลเพื่อเปิดต่อในเว็บหรือไฟล์เดิมและเบราว์เซอร์นี้ ไม่บันทึกการเปลี่ยนแปลงอัตโนมัติ และไม่มีการส่งข้อมูลขึ้น Server';
    buttons();status('');
  }
  function blank(){
    current=null;dirty=false;window.BOQDashboard=null;
    $('financeDashboard').replaceWith(originalMain.cloneNode(true));$('modalBackdrop').replaceWith(originalModal.cloneNode(true));
    $('financeDashboard').hidden=true;$('uploadIntro').hidden=false;$('sourceBar').hidden=true;$('resultCreated').hidden=true;
    $('resultCreatedTime').textContent='';$('autoFile').value='';document.body.style.overflow='';buttons();
  }
  async function upload(files){
    if(!files.length||busy)return;
    if(files.length>8){status('เลือกได้ไม่เกิน 8 ไฟล์ต่อรอบ',true);return;}
    const seq=++generation;busy=true;buttons();status('กำลังอ่าน Excel…');
    const view=window.BOQDashboard?.getState()||{};let next=current;
    try{
      const baseline=await window.BOQ_BASELINE_READY;
      for(let i=0;i<files.length;i++){
        const file=files[i];
        const progress=message=>status((files.length>1?'ไฟล์ '+(i+1)+'/'+files.length+' • ':'')+message);
        const book=await BOQXlsx.read(file,progress);
        next=await BOQERP.build(book,baseline,next,progress);
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      if(seq!==generation)return;
      next.view=view;next.savedAt=null;show(next,false);
    }catch(error){status((error.message||'อ่านไฟล์ไม่สำเร็จ')+' — ข้อมูลก่อนหน้าและผลที่เซฟไว้ยังไม่เปลี่ยน',true);}
    finally{busy=false;buttons();$('autoProgress').hidden=true;$('autoFile').value='';}
  }
  async function save(){
    if(!current||busy)return;
    busy=true;buttons();status('กำลังเซฟผล…');
    try{
      const record={...current,view:window.BOQDashboard.getState(),savedAt:new Date().toISOString()};
      await writeStored(record);current=record;dirty=false;
      $('saveState').textContent='เซฟแล้ว '+date(record.savedAt,true);
      status('เซฟผลแล้ว — ครั้งหน้าเปิดเว็บหรือไฟล์เดิมในเบราว์เซอร์นี้จะเห็นกราฟและตัวกรองที่เซฟไว้');
    }catch(error){status(error.message,true);}
    finally{busy=false;buttons();$('autoProgress').hidden=true;}
  }
  async function resetAll(){
    if(!current||busy)return;
    ++generation;busy=true;buttons();
    try{await writeStored(null);blank();status('Reset แล้ว — ล้างผลที่เซฟไว้และกลับสู่หน้าเริ่มต้น');}
    catch(error){status('ล้างผลที่เซฟไม่สำเร็จ: '+error.message,true);}
    finally{busy=false;buttons();$('autoProgress').hidden=true;}
  }
  async function downloadSnapshot(){
    if(!current||busy)return;
    busy=true;buttons();status('กำลังสร้างไฟล์สำเนาสำหรับเปิดออฟไลน์…');
    try{
    const record={...current,view:window.BOQDashboard.getState(),savedAt:new Date().toISOString()};
    const baseline=await window.BOQ_BASELINE_READY;
    const root=document.documentElement.cloneNode(true);
    // Inline the public assets so the user's downloaded copy works without this website.
    for(const link of root.querySelectorAll('link[rel="stylesheet"]')){
      const response=await fetch(new URL(link.getAttribute('href'),document.baseURI));
      if(!response.ok)throw Error('โหลดรูปแบบสำหรับสำเนาออฟไลน์ไม่สำเร็จ');
      const style=document.createElement('style');style.textContent=await response.text();link.replaceWith(style);
    }
    for(const script of root.querySelectorAll('script[src]')){
      const response=await fetch(new URL(script.getAttribute('src'),document.baseURI));
      if(!response.ok)throw Error('โหลดโปรแกรมสำหรับสำเนาออฟไลน์ไม่สำเร็จ');
      script.textContent=(await response.text()).replace(/<\/script/gi,'<\\/script');script.removeAttribute('src');
    }
    for(const link of root.querySelectorAll('link[rel="icon"]'))link.remove();
    const embeddedBaseline=document.createElement('script');
    embeddedBaseline.textContent='window.BOQ_BASELINE='+JSON.stringify(baseline).replace(/</g,'\\u003c')+';';
    root.querySelector('body').prepend(embeddedBaseline);
    root.querySelector('#financeDashboard').replaceWith(originalMain.cloneNode(true));
    root.querySelector('#modalBackdrop').replaceWith(originalModal.cloneNode(true));
    root.querySelector('#boq-saved-snapshot').textContent=JSON.stringify(record).replace(/</g,'\\u003c');
    root.querySelector('#uploadIntro').hidden=false;
    for(const id of ['sourceBar','resultCreated','autoStatus','autoProgress'])root.querySelector('#'+id).hidden=true;
    for(const el of root.querySelectorAll('[data-choose],#autoFile'))el.disabled=false;
    root.querySelector('body').classList.remove('is-reading');root.querySelector('body').style.overflow='';
    const url=URL.createObjectURL(new Blob(['<!doctype html>\n'+root.outerHTML],{type:'text/html;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='BOQ-ผลที่เซฟ-'+new Date().toISOString().replace(/[:.]/g,'-')+'.html';
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    status('สร้างไฟล์สำเนาผลลัพธ์แล้ว เปิดไฟล์สำเนานั้นเพื่อดูกราฟต่อได้');
    }catch(error){status(error.message||'สร้างไฟล์สำเนาไม่สำเร็จ',true);}
    finally{busy=false;buttons();$('autoProgress').hidden=true;}
  }
  for(const button of document.querySelectorAll('[data-choose]'))button.addEventListener('click',()=>$('autoFile').click());
  $('autoFile').addEventListener('change',event=>upload([...event.target.files]));
  $('saveResult').addEventListener('click',save);$('resetAll').addEventListener('click',resetAll);
  $('downloadSnapshot').addEventListener('click',downloadSnapshot);
  const drop=$('dropArea');
  for(const event of ['dragenter','dragover'])drop.addEventListener(event,e=>{e.preventDefault();if(!busy)drop.classList.add('dragging');});
  drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));
  drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragging');upload([...e.dataTransfer.files]);});
  for(const event of ['input','change'])document.addEventListener(event,e=>{if(e.target.closest('#financeDashboard'))setDirty();});
  document.addEventListener('click',e=>{if(e.target.closest('#financeDashboard [data-portfolio], #reset'))setDirty();});
  window.BOQWorkspace={getRecord:()=>current?structuredClone(current):null,isDirty:()=>dirty,ready:false};
  // Never show the embedded reference by itself. Only an explicitly saved result is restorable.
  busy=true;buttons();
  readStored().then(envelope=>{
    lastEnvelopeTime=envelope?.timestamp||0;
    if(envelope?.kind==='saved'&&valid(envelope.record))show(envelope.record,true);
    else if(!envelope){
      try{const embedded=JSON.parse($('boq-saved-snapshot').textContent);if(valid(embedded))show(embedded,true);}catch(_){}
    }
  }).catch(error=>status('อ่านผลที่เซฟไม่สำเร็จ กรุณาอัปโหลด Excel ใหม่',true))
    .finally(()=>{busy=false;buttons();$('autoProgress').hidden=true;window.BOQWorkspace.ready=true;});
})();

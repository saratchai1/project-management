(()=>{'use strict';
const params=new URLSearchParams(location.search);
const PROJECT_ID=(params.get('project')||'standalone').trim();
const DB_NAME='work-monitor-browser-cache-v1';
const DB_VERSION=1;
const STORE='excelFiles';
const input=document.getElementById('fileInput');
const dropzone=document.getElementById('dropzone');
if(!input||!('indexedDB' in window))return;
let restoring=false;

function openDb(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      const store=db.objectStoreNames.contains(STORE)?request.transaction.objectStore(STORE):db.createObjectStore(STORE,{keyPath:'key'});
      if(!store.indexNames.contains('projectId'))store.createIndex('projectId','projectId',{unique:false});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('เปิดพื้นที่เก็บ Excel ไม่สำเร็จ'));
  });
}
function keyFor(meta){return `${PROJECT_ID}|${meta.name}|${Number(meta.size)||0}|${Number(meta.lastModified)||0}`}
async function withStore(mode,fn){
  const db=await openDb();
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);
      let result;
      try{result=fn(store,tx)}catch(error){reject(error);return}
      tx.oncomplete=()=>resolve(result);
      tx.onerror=()=>reject(tx.error||new Error('บันทึก Excel ใน browser ไม่สำเร็จ'));
      tx.onabort=()=>reject(tx.error||new Error('การบันทึก Excel ถูกยกเลิก'));
    });
  }finally{db.close()}
}
async function putRecord(meta,buffer){
  if(ArrayBuffer.isView(buffer))buffer=buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength);
  if(!(buffer instanceof ArrayBuffer))return;
  const copy=buffer.slice(0);
  const rec={key:keyFor(meta),projectId:PROJECT_ID,name:meta.name||'monitor.xlsx',type:meta.type||'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',size:Number(meta.size)||copy.byteLength,lastModified:Number(meta.lastModified)||Date.now(),storedAt:Date.now(),buffer:copy};
  await withStore('readwrite',store=>store.put(rec));
}
async function putFile(file){await putRecord(file,await file.arrayBuffer())}
async function listRecords(){
  const db=await openDb();
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly'),index=tx.objectStore(STORE).index('projectId'),request=index.getAll(PROJECT_ID);
      request.onsuccess=()=>resolve((request.result||[]).sort((a,b)=>(a.storedAt||0)-(b.storedAt||0)));
      request.onerror=()=>reject(request.error||new Error('อ่าน Excel ที่บันทึกไว้ไม่สำเร็จ'));
    });
  }finally{db.close()}
}
async function deleteByName(name){
  const db=await openDb();
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),index=tx.objectStore(STORE).index('projectId'),request=index.openCursor(IDBKeyRange.only(PROJECT_ID));
      request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;if(cursor.value?.name===name)cursor.delete();cursor.continue()};
      request.onerror=()=>reject(request.error||new Error('ลบ Excel ที่บันทึกไว้ไม่สำเร็จ'));
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||new Error('ลบ Excel ที่บันทึกไว้ไม่สำเร็จ'));
    });
  }finally{db.close()}
}
function visibleNames(){return new Set([...document.querySelectorAll('#fileList .file-card .file-card-main strong')].map(x=>x.textContent.trim()))}
function persistWhenAccepted(files,delay=650){
  const list=[...(files||[])];if(!list.length||restoring)return;
  setTimeout(async()=>{
    const names=visibleNames();
    for(const file of list){
      if(!names.has(file.name))continue;
      try{await putFile(file)}catch(error){console.warn('Excel persistence failed',error)}
    }
  },delay);
}

input.addEventListener('change',e=>persistWhenAccepted(e.target.files),false);
dropzone?.addEventListener('drop',e=>persistWhenAccepted(e.dataTransfer?.files,850),true);
document.addEventListener('click',e=>{
  const button=e.target.closest?.('[data-remove-file]');if(!button)return;
  const name=button.closest('.file-card')?.querySelector('.file-card-main strong')?.textContent?.trim();
  if(name)setTimeout(()=>deleteByName(name).catch(error=>console.warn('Excel persistence delete failed',error)),0);
},true);
window.addEventListener('message',e=>{
  if(e.origin!==location.origin||e.data?.type!=='work-monitor:add-excel')return;
  for(const item of e.data.files||[]){
    putRecord(item,item.buffer).catch(error=>console.warn('Excel persistence message save failed',error));
  }
});

async function restore(){
  try{
    const records=await listRecords();if(!records.length)return;
    if(typeof DataTransfer!=='function')return;
    const transfer=new DataTransfer();
    for(const rec of records){
      if(!(rec.buffer instanceof ArrayBuffer))continue;
      transfer.items.add(new File([rec.buffer],rec.name,{type:rec.type||'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',lastModified:Number(rec.lastModified)||Date.now()}));
    }
    if(!transfer.files.length)return;
    restoring=true;
    input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    setTimeout(()=>{restoring=false;input.value=''},1200);
  }catch(error){restoring=false;console.warn('Excel persistence restore failed',error)}
}

setTimeout(restore,0);
window.__WORK_MONITOR_BROWSER_CACHE__={projectId:PROJECT_ID,restore};
})();
(()=>{'use strict';
const params=new URLSearchParams(location.search);
const projectId=params.get('project')||'';
const ORIGIN=location.origin;

function respond(type,detail={}){
  if(window.parent===window)return;
  window.parent.postMessage({type,projectId,...detail},ORIGIN);
}

async function importFiles(message){
  const input=document.getElementById('fileInput');
  if(!input||typeof input.onchange!=='function')throw new Error('Dashboard ยังไม่พร้อมรับไฟล์');
  const items=Array.isArray(message.files)?message.files:[];
  if(!items.length)return;
  if(typeof DataTransfer!=='function')throw new Error('Browser นี้ไม่รองรับการส่งไฟล์เข้าสู่ Dashboard อัตโนมัติ');

  const transfer=new DataTransfer();
  for(const item of items){
    let buffer=item.buffer;
    if(ArrayBuffer.isView(buffer))buffer=buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength);
    if(!(buffer instanceof ArrayBuffer))throw new Error(`ข้อมูลไฟล์ ${item.name||''} ไม่สมบูรณ์`);
    transfer.items.add(new File([buffer],item.name||'monitor.xlsx',{
      type:item.type||'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      lastModified:Number(item.lastModified)||Date.now()
    }));
  }

  await Promise.resolve(input.onchange({target:{files:transfer.files}}));
  const errorCard=document.getElementById('errorCard');
  const errorVisible=errorCard&&!errorCard.hidden&&errorCard.textContent.trim();
  if(errorVisible)throw new Error(errorCard.textContent.trim());
}

window.addEventListener('message',event=>{
  if(event.origin!==ORIGIN||event.data?.type!=='work-monitor:add-excel')return;
  importFiles(event.data)
    .then(()=>respond('work-monitor:excel-added',{requestId:event.data.requestId||''}))
    .catch(error=>{
      console.error(error);
      respond('work-monitor:excel-error',{requestId:event.data.requestId||'',message:error?.message||'อ่านไฟล์ไม่สำเร็จ'});
    });
});

window.__WORK_MONITOR_FILE_BRIDGE_READY__=true;
respond('work-monitor:dashboard-ready');
})();

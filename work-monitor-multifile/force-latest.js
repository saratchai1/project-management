(()=>{'use strict';
const VERSION='20260907-4';
function versionFrame(frame){
  if(!frame||frame.tagName!=='IFRAME')return;
  let url;
  try{url=new URL(frame.src,location.href)}catch{return}
  if(!/\/work-monitor-multifile\/dashboard\.html$/.test(url.pathname))return;
  if(url.searchParams.get('v')===VERSION)return;
  url.searchParams.set('v',VERSION);
  frame.src=url.toString();
}
document.querySelectorAll('iframe').forEach(versionFrame);
new MutationObserver(records=>{
  for(const record of records)for(const node of record.addedNodes){
    if(node?.nodeType!==1)continue;
    if(node.tagName==='IFRAME')versionFrame(node);
    node.querySelectorAll?.('iframe').forEach(versionFrame);
  }
}).observe(document.documentElement,{childList:true,subtree:true});
})();

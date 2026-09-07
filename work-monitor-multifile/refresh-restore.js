(()=>{'use strict';
const KEY='work-monitor-last-active-project-v1';
const select=document.getElementById('projectSelect');
const workspace=document.getElementById('projectWorkspace');
if(!select||!workspace)return;

function remember(){
  if(!workspace.hidden&&select.value){
    try{localStorage.setItem(KEY,select.value)}catch{}
  }
}
new MutationObserver(remember).observe(workspace,{attributes:true,attributeFilter:['hidden']});
document.addEventListener('click',e=>{
  if(e.target.closest?.('[data-detail-action="open-dashboard"]'))setTimeout(remember,80);
},true);

function restoreLast(){
  let id='';try{id=localStorage.getItem(KEY)||''}catch{}
  if(!id)return;
  const option=[...select.options].find(x=>x.value===id);
  if(!option){try{localStorage.removeItem(KEY)}catch{};return}
  select.value=id;
  select.dispatchEvent(new Event('change',{bubbles:true}));
  let tries=0;
  const timer=setInterval(()=>{
    tries++;
    const modal=document.getElementById('projectDetailModal');
    const button=modal?.querySelector('[data-detail-action="open-dashboard"]');
    if(button&&!modal.hidden){clearInterval(timer);button.click();return}
    if(tries>40)clearInterval(timer);
  },50);
}
setTimeout(restoreLast,0);
})();
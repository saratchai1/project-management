(()=>{'use strict';
const D=window.PROJECT_DATA;
if(!D?.plots)return;

const ORDER=['critical','high','watch','on_track','ahead'];
const LABELS={critical:'วิกฤต',high:'เสี่ยงสูง',watch:'เฝ้าระวัง',on_track:'ตามแผน',ahead:'เร็วกว่าแผน'};
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[char]));
const vendorName=plot=>D.meta?.vendors?.[plot.vendorKey]||plot.vendorKey||'';

function chartPlots(){
  const q=($('searchInput')?.value||'').trim().toLowerCase();
  const province=$('provinceFilter')?.value||'';
  const followOnly=Boolean($('followupOnly')?.checked);
  return D.plots.filter(plot=>{
    if(province&&plot.province!==province)return false;
    if(followOnly&&plot.risk==='on_track'&&plot.paymentFlag==='aligned'&&plot.payment?.confidence!=='mixed')return false;
    if(q&&!([plot.plotId,plot.contractNo,plot.province,vendorName(plot),plot.wo].join(' ').toLowerCase().includes(q)))return false;
    return true;
  });
}

function polar(cx,cy,r,angle){
  const rad=(angle-90)*Math.PI/180;
  return {x:cx+r*Math.cos(rad),y:cy+r*Math.sin(rad)};
}

function donutPath(startAngle,endAngle){
  const cx=120,cy=120,outer=104,inner=62;
  const safeEnd=Math.min(endAngle,startAngle+359.999);
  const p1=polar(cx,cy,outer,startAngle);
  const p2=polar(cx,cy,outer,safeEnd);
  const p3=polar(cx,cy,inner,safeEnd);
  const p4=polar(cx,cy,inner,startAngle);
  const large=safeEnd-startAngle>180?1:0;
  return `M ${p1.x.toFixed(3)} ${p1.y.toFixed(3)} A ${outer} ${outer} 0 ${large} 1 ${p2.x.toFixed(3)} ${p2.y.toFixed(3)} L ${p3.x.toFixed(3)} ${p3.y.toFixed(3)} A ${inner} ${inner} 0 ${large} 0 ${p4.x.toFixed(3)} ${p4.y.toFixed(3)} Z`;
}

function goToRisk(risk){
  const filter=$('riskFilter');
  const scheduleTab=document.querySelector('.tab[data-view="schedule"]');
  if(!filter||!scheduleTab)return;
  filter.value=risk;
  filter.dispatchEvent(new Event('change',{bubbles:true}));
  scheduleTab.click();
  requestAnimationFrame(()=>document.querySelector('.tabs')?.scrollIntoView({behavior:'smooth',block:'start'}));
}

function showTooltip(shell,risk,groups){
  const tooltip=shell.querySelector('.risk-pie-tooltip');
  const plots=groups[risk]||[];
  if(!tooltip)return;
  tooltip.innerHTML=`<div class="risk-tooltip-head"><span><i class="dot ${risk}"></i>${LABELS[risk]}</span><b>${plots.length} แปลง</b></div><div class="risk-tooltip-list">${plots.length?plots.map(plot=>`<span>${esc(plot.plotId)}</span>`).join(''):'<span class="risk-tooltip-empty">ไม่มีแปลงในสถานะนี้</span>'}</div><div class="risk-tooltip-action">คลิกชิ้นกราฟหรือรายการด้านบน เพื่อเปิดแท็บ “ติดตามงาน” พร้อม Filter</div>`;
  tooltip.hidden=false;
}

function moveRiskPanel(){
  const overview=$('overviewView');
  if(!overview)return null;
  const riskPanel=[...overview.querySelectorAll('.panel')].find(panel=>panel.querySelector('h2')?.textContent.trim()==='Risk Distribution');
  if(!riskPanel)return null;

  const originalGrid=riskPanel.closest('.grid-2');
  if(originalGrid){
    overview.insertBefore(riskPanel,originalGrid);
    originalGrid.classList.add('plan-full-row');
  }
  riskPanel.classList.add('risk-panel-wide');
  return riskPanel;
}

function renderPie(panel){
  if(panel.dataset.riskPieEnhanced==='1')return;
  panel.dataset.riskPieEnhanced='1';

  const plots=chartPlots();
  const groups=Object.fromEntries(ORDER.map(risk=>[
    risk,
    plots.filter(plot=>plot.risk===risk).sort((a,b)=>a.plotId.localeCompare(b.plotId,'th',{numeric:true}))
  ]));
  const total=plots.length||1;
  let angle=0;
  const slices=ORDER.map(risk=>{
    const count=groups[risk].length;
    if(!count)return '';
    const sweep=count/total*360;
    const path=donutPath(angle,angle+sweep);
    angle+=sweep;
    return `<path class="risk-pie-slice risk-${risk}" data-risk="${risk}" d="${path}" tabindex="0" role="button" aria-label="${LABELS[risk]} ${count} แปลง"></path>`;
  }).join('');

  panel.innerHTML=`
    <div class="panel-title-row risk-title-row">
      <div>
        <h2>Risk Distribution</h2>
        <div class="panel-sub">สัดส่วนสถานะแปลง · วางเมาส์เพื่อดูรายชื่อ · คลิกเพื่อไปติดตามรายการนั้นทันที</div>
      </div>
    </div>
    <div class="risk-pie-shell">
      <div class="risk-pie-stage">
        <svg class="risk-pie" viewBox="0 0 240 240" role="img" aria-label="สัดส่วนสถานะงานรายแปลง">
          <circle class="risk-pie-track" cx="120" cy="120" r="83" fill="none" stroke-width="42"></circle>
          ${slices}
        </svg>
        <div class="risk-pie-center"><strong>${plots.length}</strong><span>แปลงทั้งหมด</span></div>
      </div>
      <div class="risk-pie-info">
        <div class="risk-pie-legend">${ORDER.map(risk=>`<button type="button" class="risk-legend-item" data-risk="${risk}"><span><i class="dot ${risk}"></i>${LABELS[risk]}</span><b>${groups[risk].length}</b></button>`).join('')}</div>
        <div class="risk-pie-tooltip" hidden></div>
      </div>
    </div>
    <div class="callout risk-rule-callout">Critical: gap ≥25 จุด หรือ ≥90 วัน · High: gap ≥10 จุด หรือ ≥30 วัน</div>`;

  const shell=panel.querySelector('.risk-pie-shell');
  const slicesEls=panel.querySelectorAll('.risk-pie-slice');
  const legendEls=panel.querySelectorAll('.risk-legend-item');

  const activate=element=>{
    const selectedRisk=element.dataset.risk;
    slicesEls.forEach(slice=>slice.classList.toggle('is-active',slice.dataset.risk===selectedRisk));
    legendEls.forEach(item=>item.classList.toggle('is-active',item.dataset.risk===selectedRisk));
    showTooltip(shell,selectedRisk,groups);
  };
  const clear=()=>{
    slicesEls.forEach(slice=>slice.classList.remove('is-active'));
    legendEls.forEach(item=>item.classList.remove('is-active'));
    const tooltip=shell.querySelector('.risk-pie-tooltip');
    if(tooltip)tooltip.hidden=true;
  };

  slicesEls.forEach(slice=>{
    slice.addEventListener('pointerenter',()=>activate(slice));
    slice.addEventListener('focus',()=>activate(slice));
    slice.addEventListener('click',()=>goToRisk(slice.dataset.risk));
    slice.addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===' '){event.preventDefault();goToRisk(slice.dataset.risk)}
    });
  });
  legendEls.forEach(item=>{
    item.addEventListener('pointerenter',()=>activate(item));
    item.addEventListener('focus',()=>activate(item));
    item.addEventListener('click',()=>goToRisk(item.dataset.risk));
  });
  shell.addEventListener('mouseleave',clear);
}

function enhance(){
  const riskPanel=moveRiskPanel();
  if(riskPanel)renderPie(riskPanel);
}

const overview=$('overviewView');
if(overview)new MutationObserver(()=>queueMicrotask(enhance)).observe(overview,{childList:true,subtree:true});
['searchInput','provinceFilter','followupOnly'].forEach(id=>$(id)?.addEventListener(id==='searchInput'?'input':'change',()=>queueMicrotask(enhance)));
queueMicrotask(enhance);
})();

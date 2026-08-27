(async()=>{
'use strict';
const $=id=>document.getElementById(id);
const fmt=new Intl.NumberFormat('th-TH',{maximumFractionDigits:2});
const money=n=>n==null?'—':`${fmt.format(Number(n||0))} บาท`;
const pct=n=>`${fmt.format(Number(n||0))}%`;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let D;
try{D=await window.FINANCE_DATA_PROMISE;}catch(err){document.querySelector('main').innerHTML=`<section class="panel empty-state"><h2>โหลดข้อมูลการเงินไม่สำเร็จ</h2><p>${esc(err.message)}</p></section>`;return;}
const PLOTS=D.plots||[];
const portfolioMap=Object.fromEntries((D.portfolios||[]).map(x=>[x.id,x]));
const state={portfolio:'forest65_external',projectCode:'',year:3,company:'',province:'',token:'',search:'',sort:'balance'};
const plotPaymentYear=3;
const hasSegmentation=()=>!!(state.projectCode||state.company||state.province||state.token||state.search);
const isExternal65=()=>state.portfolio==='forest65_external';
const yearRec=(p,y=state.year)=>p.years[y-1];
function option(el,value,label){const o=document.createElement('option');o.value=value;o.textContent=label;el.appendChild(o);}
function bind(id,event,fn){$(id).addEventListener(event,fn);}
function init(){
  D.portfolios.forEach(x=>option($('portfolio'),x.id,x.label));
  for(let y=1;y<=10;y++)option($('year'),String(y),`ปีที่ ${y}${y===3?' — มี AP รายแปลง':''}`);
  [...new Set(PLOTS.map(p=>p.company).filter(Boolean))].sort().forEach(v=>option($('company'),v,v));
  [...new Set(PLOTS.map(p=>p.province).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'th')).forEach(v=>option($('province'),v,v));
  [...new Set(PLOTS.map(p=>p.tokenType).filter(Boolean))].sort().forEach(v=>option($('token'),v,v));
  $('portfolio').value=state.portfolio;$('year').value='3';
  bind('portfolio','change',e=>{state.portfolio=e.target.value;state.projectCode='';populateCodes();render();});
  bind('projectCode','change',e=>{state.projectCode=e.target.value;render();});
  bind('year','change',e=>{state.year=Number(e.target.value);render();});
  bind('company','change',e=>{state.company=e.target.value;render();});
  bind('province','change',e=>{state.province=e.target.value;render();});
  bind('token','change',e=>{state.token=e.target.value;render();});
  bind('search','input',e=>{state.search=e.target.value.trim().toLowerCase();render();});
  bind('sort','change',e=>{state.sort=e.target.value;renderPlots();});
  bind('reset','click',()=>{Object.assign(state,{portfolio:'forest65_external',projectCode:'',year:3,company:'',province:'',token:'',search:'',sort:'balance'});$('portfolio').value=state.portfolio;$('year').value='3';$('company').value='';$('province').value='';$('token').value='';$('search').value='';$('sort').value='balance';populateCodes();render();});
  bind('openAllSpend','click',openAllSpend);bind('exportCsv','click',exportCsv);bind('modalClose','click',closeModal);
  $('modalBackdrop').addEventListener('click',e=>{if(e.target===$('modalBackdrop'))closeModal();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
  populateCodes();render();
}
function populateCodes(){const s=$('projectCode');s.innerHTML='<option value="">ทั้งหมด</option>';D.projectCodes.filter(x=>x.portfolio===state.portfolio).forEach(x=>option(s,x.code,`${x.code}${x.company?` — ${x.company}`:''}`));s.value=state.projectCode;}
function filteredPlots(){
  if(!isExternal65())return[];
  let rows=PLOTS.filter(p=>(!state.projectCode||p.projectCode===state.projectCode)&&(!state.company||p.company===state.company)&&(!state.province||p.province===state.province)&&(!state.token||p.tokenType===state.token));
  if(state.search)rows=rows.filter(p=>[p.projectCode,p.plotCode,p.contractNo,p.projectName,p.tokenType,p.province,p.district,p.subdistrict,p.village,p.company].join(' ').toLowerCase().includes(state.search));
  const y=state.year-1;
  rows.sort((a,b)=>state.sort==='plot'?a.plotCode.localeCompare(b.plotCode,'th',{numeric:true}):state.sort==='paid'?(b.years[y].paid||0)-(a.years[y].paid||0):state.sort==='boq'?b.years[y].boq-a.years[y].boq:state.year===plotPaymentYear?(b.years[y].balance||0)-(a.years[y].balance||0):b.years[y].boq-a.years[y].boq);
  return rows;
}
function plotSummary(rows=filteredPlots()){
  const s={boq:0,paid:0,possiblePaid:0,balance:0,possibleBalance:0,over:0,pending:0,started:0,mapped:0};
  rows.forEach(p=>{const r=yearRec(p);s.boq+=r.boq;if(r.paymentDataAvailable){s.mapped++;s.paid+=r.paid;s.possiblePaid+=r.possiblePaid;s.balance+=r.balance;s.possibleBalance+=r.possibleBalance;s.over+=r.over;if(r.balance>1)s.pending++;if(r.paid>1)s.started++;}});
  s.rate=s.boq?s.paid/s.boq*100:0;return s;
}
function aggregateYear(){return D.yearSummary?.[state.year-1]||{year:state.year,boq:0,paid:0,balance:0};}
function render(){renderPortfolioCards();renderKpis();renderYearBars();renderWorkTypes();renderCodes();renderPlots();renderSource();}
function renderPortfolioCards(){
  const rows=filteredPlots(),ps=plotSummary(rows),agg=aggregateYear();
  $('portfolioCards').innerHTML=D.portfolios.map(p=>{
    let value=p.totalAp,detail=`ERP AP สะสม ${money(p.totalAp)}`,ring='รอ BOQ',rate=0;
    if(p.id==='forest65_external'){
      const boq=isExternal65()?ps.boq:agg.boq;
      if(state.year===plotPaymentYear&&isExternal65()){value=ps.paid;rate=boq?Math.min(100,ps.paid/boq*100):0;ring=pct(rate);detail=`ปี ${state.year}: confirmed ${money(ps.paid)} • คงเหลือ ${money(ps.balance)}`;}
      else if(!hasSegmentation()){value=agg.paid;rate=boq?Math.min(100,agg.paid/boq*100):0;ring=pct(rate);detail=`ปี ${state.year}: ERP AP รวม ${money(agg.paid)} • ไม่มี allocation รายแปลง`;}
      else{value=null;ring='—';detail=`ปี ${state.year}: BOQ ${money(boq)} • ยอด AP รายแปลงไม่มีใน public snapshot`;}
    }
    return `<article class="portfolio-card ${state.portfolio===p.id?'active':''}" data-portfolio="${p.id}"><div class="ring ${p.boqAvailable?'':'gray'}" style="--pct:${rate}%"><strong>${ring}</strong></div><div><h3>${esc(p.label)}</h3><div class="money">${value==null?'—':money(value)}</div><p>${esc(detail)}</p><p>${p.codes.map(esc).join(' · ')}</p></div></article>`;
  }).join('');
  document.querySelectorAll('[data-portfolio]').forEach(el=>el.addEventListener('click',()=>{state.portfolio=el.dataset.portfolio;state.projectCode='';$('portfolio').value=state.portfolio;populateCodes();render();}));
}
function renderKpis(){
  const p=portfolioMap[state.portfolio];
  if(!isExternal65()){
    const a=p.amounts;$('kpis').innerHTML=[['ERP AP สะสม',p.totalAp,'ทุกหมวดงาน'],['ปลูก/บำรุง',a.boq_contract,'ยอดสะสม'],['PDD',a.pdd,'ยอดสะสม'],['ลงพื้นที่ / Advance',a.field_visit,'ยอดสะสม'],['กองทุนชุมชน',a.community_fund,'ยอดสะสม'],['BOQ รายปี',null,'ยังไม่ได้รับ BOQ รายปี']].map((x,i)=>`<div class="kpi ${i===5?'warn':''}"><div class="label">${x[0]}</div><div class="value">${x[1]==null?'รอข้อมูล':money(x[1])}</div><div class="sub">${x[2]}</div></div>`).join('');return;
  }
  const rows=filteredPlots(),s=plotSummary(rows);
  if(state.year!==plotPaymentYear){
    const agg=aggregateYear(),canAggregate=!hasSegmentation();
    $('kpis').innerHTML=`<div class="kpi"><div class="label">BOQ ปี ${state.year}</div><div class="value">${money(s.boq)}</div><div class="sub">${fmt.format(rows.length)} แปลง</div></div><div class="kpi"><div class="label">ERP AP ปี ${state.year}</div><div class="value">${canAggregate?money(agg.paid):'—'}</div><div class="sub">${canAggregate?'ยอดรวม portfolio — ไม่ allocate รายแปลง':'เมื่อกรองรายแปลง ไม่สามารถแบ่งยอดรวมได้'}</div></div><div class="kpi warn"><div class="label">คงเหลือระดับแปลง</div><div class="value">—</div><div class="sub">public safe snapshot มี payment detail ระดับแปลงเฉพาะปี 3</div></div><div class="kpi"><div class="label">ยอดรวมคงเหลือ</div><div class="value">${canAggregate?money(Math.max(0,agg.balance)):'—'}</div><div class="sub">ระดับ portfolio เท่านั้น</div></div><div class="kpi"><div class="label">ปีที่มี AP รายแปลง</div><div class="value">ปี 3</div><div class="sub">เลือกปี 3 เพื่อดูงวดค้างรายแปลง</div></div><div class="kpi"><div class="label">Data policy</div><div class="value">ไม่เดา</div><div class="sub">ไม่ตีความ no-data ว่าเป็นค้างจ่าย</div></div>`;return;
  }
  const range=s.possiblePaid>s.paid+0.01?`${money(s.paid)} – ${money(s.possiblePaid)}`:money(s.paid);
  $('kpis').innerHTML=`<div class="kpi"><div class="label">BOQ ปี 3</div><div class="value">${money(s.boq)}</div><div class="sub">${fmt.format(rows.length)} แปลง</div></div><div class="kpi"><div class="label">จ่ายแล้ว / ERP</div><div class="value">${range}</div><div class="sub">confirmed${s.possiblePaid>s.paid+0.01?' ถึง possible (mixed)':''}</div></div><div class="kpi clickable warn" id="remainingKpi"><div class="label">คงเหลือจาก confirmed</div><div class="value">${money(s.balance)}</div><div class="sub">คลิกดูแปลงและงวดที่ inferred ว่าค้าง</div></div><div class="kpi clickable danger" id="pendingKpi"><div class="label">แปลงที่ยังมี BOQ เหลือ</div><div class="value">${fmt.format(s.pending)} แปลง</div><div class="sub">มี ERP mapping ${fmt.format(s.mapped)} แปลง</div></div><div class="kpi"><div class="label">เริ่มจ่าย confirmed</div><div class="value">${fmt.format(s.started)} แปลง</div><div class="sub">public safe AP snapshot</div></div><div class="kpi ${s.over>1?'danger':''}"><div class="label">confirmed เกิน BOQ</div><div class="value">${money(s.over)}</div><div class="sub">ควรตรวจสัญญาแก้ไข/credit note</div></div>`;
  $('remainingKpi').addEventListener('click',openPending);$('pendingKpi').addEventListener('click',openPending);
}
function renderYearBars(){
  if(!isExternal65()){$('yearBars').innerHTML='<div class="empty-state">ประเภทโครงการนี้ยังไม่มี BOQ รายปีในไฟล์ที่ได้รับ</div>';return;}
  const rows=filteredPlots();
  const segmented=hasSegmentation();
  $('yearBars').innerHTML=Array.from({length:10},(_,i)=>{
    const year=i+1;const boq=rows.reduce((s,p)=>s+p.years[i].boq,0);let paid=null,balance=null,note='BOQ เท่านั้น';
    if(year===3){paid=rows.reduce((s,p)=>s+(p.years[i].paymentDataAvailable?p.years[i].paid:0),0);balance=Math.max(0,boq-paid);note='confirmed รายแปลง';}
    else if(!segmented){const a=D.yearSummary[i];paid=a.paid;balance=Math.max(0,a.balance);note='ERP รวม portfolio';}
    const width=paid==null||!boq?0:Math.min(100,paid/boq*100);
    return `<div class="bar-row"><div class="bar-label">ปี ${year}</div><div class="stack-track"><div class="stack-paid" style="width:${width}%"></div><div class="stack-remain" style="width:${100-width}%"></div></div><div class="bar-value">${paid==null?'ไม่มี allocation รายแปลง':`${money(paid)} · ${note}`}</div></div>`;
  }).join('');
}
function renderWorkTypes(){const codes=D.projectCodes.filter(x=>x.portfolio===state.portfolio&&(!state.projectCode||x.code===state.projectCode));const totals={};for(const k of Object.keys(D.workTypeLabels))totals[k]=codes.reduce((s,c)=>s+Number(c.amounts[k]||0),0);const max=Math.max(...Object.values(totals).map(v=>Math.abs(v)),1);$('workTypeBars').innerHTML=Object.entries(D.workTypeLabels).map(([k,label])=>`<div class="bar-row"><div class="bar-label">${esc(label)}</div><div class="bar-track"><div class="bar-paid" style="width:${Math.abs(totals[k])/max*100}%"></div></div><div class="bar-value">${money(totals[k])}</div></div>`).join('');}
function renderCodes(){const rows=D.projectCodes.filter(x=>x.portfolio===state.portfolio&&(!state.projectCode||x.code===state.projectCode));$('codeRows').innerHTML=rows.map(x=>`<tr><td><strong>${esc(x.code)}</strong></td><td>${esc(portfolioMap[x.portfolio]?.label||x.portfolio)}</td><td>${esc(x.company||'—')}</td><td class="num">${money(x.amounts.boq_contract)}</td><td class="num">${money(x.amounts.pdd)}</td><td class="num">${money(x.amounts.vvb)}</td><td class="num">${money(x.amounts.field_visit)}</td><td class="num">${money(x.amounts.survival)}</td><td class="num">${money(x.amounts.community_fund)}</td><td class="num"><strong>${money(x.totalAp)}</strong></td></tr>`).join('');}
function confidenceLabel(r){if(!r.paymentDataAvailable)return'<span class="pill no_data">ไม่มีข้อมูล</span>';if(r.paymentConfidence==='mixed')return'<span class="pill partial">Mixed</span>';if(r.paymentConfidence==='high')return'<span class="pill paid">High</span>';return'<span class="pill not_started">No record</span>';}
function latestLabel(r){if(!r.paymentDataAvailable)return'—';return r.latestFullInstallment?`ผ่านยอดครบถึงงวด ${r.latestFullInstallment}`:'ยังไม่ครบงวด 1';}
function pendingLabel(r){if(!r.paymentDataAvailable)return'—';return r.pendingInstallments?.length?r.pendingInstallments.map(i=>`งวด ${i}`).join(', '):'—';}
function renderPlots(){
  const available=isExternal65();$('plotUnavailable').hidden=available;$('plotTableWrap').hidden=!available;$('exportCsv').disabled=!available;
  if(!available){$('plotUnavailable').textContent='ประเภทโครงการนี้มีข้อมูล AP สะสมตามรหัสโครงการ แต่ยังไม่มี BOQ รายปี/รายแปลงสำหรับคำนวณงวดคงเหลือ';$('tableSubtitle').textContent='';return;}
  const rows=filteredPlots();$('boqYearHead').textContent=`BOQ ปี ${state.year}`;$('tableSubtitle').textContent=`${fmt.format(rows.length)} แปลง • ${state.year===3?'payment รายแปลงจาก ERP safe snapshot':'แสดง BOQ; payment รายแปลงไม่มีใน snapshot'}`;
  $('plotRows').innerHTML=rows.map(p=>{const r=yearRec(p);const payment=state.year===3&&r.paymentDataAvailable;const paid=payment?money(r.paid):'—';const bal=payment?money(r.balance):'—';const possible=payment&&r.possiblePaid>r.paid+0.01?`<div class="muted">possible ${money(r.possiblePaid)}</div>`:'';return `<tr><td><strong>${esc(p.projectCode)}</strong></td><td>ป่าบุคคลภายนอก ปี 2565</td><td>${esc(p.projectName)}</td><td>${esc(p.tokenType)}</td><td><strong>${esc(p.plotCode)}</strong><div class="muted nowrap">${esc(p.contractNo)}</div></td><td>${esc(p.province)}</td><td class="num">${fmt.format(p.areaRai)}</td><td class="num">${money(r.boq)}</td><td class="nowrap">${state.year===3?latestLabel(r):'—'}<div class="muted">${state.year===3&&r.latestPaymentDate?r.latestPaymentDate:''}</div></td><td>${state.year===3?pendingLabel(r):'—'}</td><td class="num">${paid}${possible}</td><td class="num"><strong>${bal}</strong></td><td>${state.year===3?confidenceLabel(r):'<span class="pill no_data">ไม่มี AP รายแปลง</span>'}</td><td><button class="link-btn" data-plot="${esc(p.plotCode)}" data-contract="${esc(p.contractNo)}">รายละเอียด</button></td></tr>`;}).join('')||'<tr><td colspan="14" class="empty-state">ไม่พบข้อมูลตามตัวกรอง</td></tr>';
  document.querySelectorAll('[data-plot]').forEach(b=>b.addEventListener('click',()=>openPlot(b.dataset.plot,b.dataset.contract)));
}
function renderSource(){$('sourceNote').textContent=`BOQ: ${D.meta.boqSource} • ERP ถึง ${D.meta.erpAsOf} • ${D.meta.paymentScope}`;}
function openModal(html){$('modalContent').innerHTML=html;$('modalBackdrop').hidden=false;document.body.style.overflow='hidden';}
function closeModal(){$('modalBackdrop').hidden=true;document.body.style.overflow='';}
function openAllSpend(){const keys=Object.keys(D.workTypeLabels);const total=D.portfolios.reduce((s,p)=>s+p.totalAp,0);const totals=Object.fromEntries(keys.map(k=>[k,D.portfolios.reduce((s,p)=>s+Number(p.amounts[k]||0),0)]));openModal(`<h2 id="modalTitle">เงินที่จ่ายแล้วทุกหมวดหมู่</h2><p class="muted">ERP AP สะสมถึง ${esc(D.meta.erpAsOf)} — เริ่มจัดกลุ่มจากรหัสโครงการ</p><div class="modal-grid"><div class="mini-card"><div class="label">รวมทุก portfolio</div><div class="value">${money(total)}</div></div>${D.portfolios.map(p=>`<div class="mini-card"><div class="label">${esc(p.label)}</div><div class="value">${money(p.totalAp)}</div></div>`).join('')}</div><div class="table-wrap"><table class="compact"><thead><tr><th>ประเภทงาน</th><th class="num">รวม</th>${D.portfolios.map(p=>`<th class="num">${esc(p.label)}</th>`).join('')}</tr></thead><tbody>${keys.map(k=>`<tr><td>${esc(D.workTypeLabels[k])}</td><td class="num"><strong>${money(totals[k])}</strong></td>${D.portfolios.map(p=>`<td class="num">${money(p.amounts[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="muted">ยอดปลูก/บำรุงที่ map เข้า BOQ master ได้ ${money(D.meta.mappedBoqPayments)}; รายการนอก master/จับคู่ไม่ได้ ${money(D.meta.unmatchedOrOutOfMasterBoqPayment)} ไม่ถูกนำไปคำนวณคงเหลือรายแปลง</p>`);}
function openPending(){if(state.year!==3){openModal('<h2 id="modalTitle">ไม่มี payment allocation รายแปลงสำหรับปีนี้</h2><p>public safe snapshot ที่ใช้กับ dashboard มีรายละเอียด AP ระดับแปลงเฉพาะปีที่ 3 จึงไม่ตีความปีอื่นว่า “ค้างจ่าย”</p>');return;}const rows=filteredPlots().filter(p=>yearRec(p).paymentDataAvailable&&yearRec(p).balance>1).sort((a,b)=>yearRec(b).balance-yearRec(a).balance);openModal(`<h2 id="modalTitle">แปลงที่ยังมี BOQ เหลือ — ปี 3</h2><p class="muted">“งวดค้าง” เป็นการอนุมานจากยอด confirmed ตามลำดับ BOQ ไม่ใช่การอ่านข้อความ remark ดิบ</p><div class="table-wrap"><table><thead><tr><th>แปลง / สัญญา</th><th>จังหวัด</th><th>จ่ายล่าสุด</th><th>งวด inferred ว่าค้าง</th><th class="num">confirmed</th><th class="num">คงเหลือ</th><th></th></tr></thead><tbody>${rows.map(p=>{const r=yearRec(p);return`<tr><td><strong>${esc(p.plotCode)}</strong><div class="muted">${esc(p.contractNo)}</div></td><td>${esc(p.province)}</td><td>${r.latestPaymentDate||'—'}</td><td>${pendingLabel(r)}</td><td class="num">${money(r.paid)}</td><td class="num"><strong>${money(r.balance)}</strong></td><td><button class="link-btn" data-modal-plot="${esc(p.plotCode)}" data-modal-contract="${esc(p.contractNo)}">รายละเอียด</button></td></tr>`;}).join('')}</tbody></table></div><p><a class="btn" href="../work-monitor/">เปิด Work Monitor เพื่อตรวจ Progress</a></p>`);document.querySelectorAll('[data-modal-plot]').forEach(b=>b.addEventListener('click',()=>openPlot(b.dataset.modalPlot,b.dataset.modalContract)));}
function openPlot(code,contract){const p=PLOTS.find(x=>x.plotCode===code&&(!contract||x.contractNo===contract));if(!p)return;const r=yearRec(p);const payment=state.year===3&&r.paymentDataAvailable;openModal(`<h2 id="modalTitle">${esc(p.plotCode)} — ปี ${state.year}</h2><p class="muted">${esc(p.projectCode)} • ${esc(p.contractNo)} • ${esc(p.province)} • ${fmt.format(p.areaRai)} ไร่</p><div class="modal-grid"><div class="mini-card"><div class="label">BOQ ปีนี้</div><div class="value">${money(r.boq)}</div></div><div class="mini-card"><div class="label">confirmed AP</div><div class="value">${payment?money(r.paid):'—'}</div></div><div class="mini-card"><div class="label">possible AP</div><div class="value">${payment?money(r.possiblePaid):'—'}</div></div><div class="mini-card"><div class="label">คงเหลือจาก confirmed</div><div class="value">${payment?money(r.balance):'—'}</div></div></div>${payment?'<div class="warn">การกระจายยอดลงงวดด้านล่างเป็นการอนุมานตามลำดับ BOQ จากยอด confirmed เพราะ public dataset ไม่เปิด remark ดิบ ใช้เพื่อชี้งวดที่ควรตรวจสอบ ไม่ใช่หลักฐานการจ่ายรายงวด</div>':'<div class="warn">ปีนี้ไม่มี payment allocation ระดับแปลงใน public safe snapshot จึงแสดงเฉพาะ BOQ โดยไม่เดายอดจ่าย/คงเหลือ</div>'}<h3>งวดงานปี ${state.year}</h3><div class="installment-grid">${r.installments.map(i=>`<div class="inst-card ${payment?(i.fullyPaid?'done':'pending'):''}"><h4>งวด ${i.no}</h4><p>BOQ <strong>${money(i.boq)}</strong></p><p>จ่าย ${payment?money(i.paid):'—'}</p><p>คงเหลือ ${payment?money(i.remaining):'—'}</p></div>`).join('')}</div><h3>BOQ ปี 1–10</h3><div class="table-wrap"><table class="compact"><thead><tr><th>ปี</th><th class="num">BOQ</th><th class="num">AP รายแปลง</th><th class="num">คงเหลือ</th><th>หมายเหตุ</th></tr></thead><tbody>${p.years.map(y=>`<tr><td>ปี ${y.year}</td><td class="num">${money(y.boq)}</td><td class="num">${y.paymentDataAvailable?money(y.paid):'—'}</td><td class="num">${y.paymentDataAvailable?money(y.balance):'—'}</td><td>${y.paymentDataAvailable?esc(y.paymentConfidence):'ไม่มี allocation รายแปลง'}</td></tr>`).join('')}</tbody></table></div><p><a class="btn" href="../work-monitor/">ตรวจ Progress / ปัญหาหน้างาน</a></p>`);}
function exportCsv(){const rows=filteredPlots();const head=['รหัสโครงการ','หมวดหมู่/ประเภทโครงการ','ชื่อโครงการ T-VER','ประเภท TOKEN X','รหัสแปลง','จังหวัด','เนื้อที่สัญญา (ไร่)','การดำเนินงานปีที่','มูลค่าสัญญาปีที่เลือก','งวดล่าสุดที่จ่ายแล้ว/อนุมาน','งวดที่ควรตรวจ','ยอดเงิน confirmed','ยอด possible','ยอดคงเหลือ confirmed','สถานะข้อมูล'];const body=rows.map(p=>{const r=yearRec(p),pay=state.year===3&&r.paymentDataAvailable;return[p.projectCode,'ป่าบุคคลภายนอก ปี 2565',p.projectName,p.tokenType,p.plotCode,p.province,p.areaRai,state.year,r.boq,pay?latestLabel(r):'',pay?pendingLabel(r):'',pay?r.paid:'',pay?r.possiblePaid:'',pay?r.balance:'',pay?r.paymentConfidence:'ไม่มี AP รายแปลง'];});const csv=[head,...body].map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));a.download=`project-finance-year-${state.year}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
init();
})();

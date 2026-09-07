(async () => {
  'use strict';
  const D = await window.FINANCE_DATA_PROMISE;
  const PLOTS = D.plots || [];
  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });
  const money = (n) => `${fmt.format(Number(n || 0))} บาท`;
  const pct = (n) => `${fmt.format(Number(n || 0))}%`;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const portfolioMap = Object.fromEntries(D.portfolios.map(x => [x.id, x]));
  const state = { portfolio:'forest65_external', projectCode:'', year:3, company:'', province:'', token:'', search:'', sort:'balance' };

  function option(select, value, label) { const o=document.createElement('option'); o.value=value; o.textContent=label; select.appendChild(o); }
  function bind(id,event,fn){ $(id).addEventListener(event,fn); }
  function currentPortfolio(){ return portfolioMap[state.portfolio]; }
  function portfolioPlots(id=state.portfolio){ return PLOTS.filter(p=>p.portfolio===id); }
  function availableYears(){ const p=currentPortfolio(); return p?.boqYears?.length ? p.boqYears : [1]; }

  function populateYears(){
    const sel=$('year'); const years=availableYears(); sel.innerHTML='';
    years.forEach(y=>option(sel,String(y),`ปีที่ ${y}`));
    if(!years.includes(state.year)) state.year=years[0];
    sel.value=String(state.year);
  }
  function populateProjectCodes(){
    const sel=$('projectCode'); sel.innerHTML='<option value="">ทั้งหมด</option>';
    D.projectCodes.filter(x=>x.portfolio===state.portfolio).forEach(x=>option(sel,x.code,`${x.code} — ${x.company||'ทั้งหมด'}`));
    sel.value=state.projectCode;
  }
  function resetSecondaryFilters(){
    Object.assign(state,{projectCode:'',company:'',province:'',token:'',search:'',sort:'balance'});
    for(const id of ['projectCode','company','province','token','search']) $(id).value='';
    $('sort').value='balance';
  }
  function initFilters() {
    D.portfolios.forEach(x => option($('portfolio'), x.id, x.label));
    [...new Set(PLOTS.map(p=>p.company).filter(Boolean))].sort().forEach(v=>option($('company'),v,v));
    [...new Set(PLOTS.map(p=>p.province).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'th')).forEach(v=>option($('province'),v,v));
    [...new Set(PLOTS.map(p=>p.tokenType).filter(Boolean))].sort().forEach(v=>option($('token'),v,v));
    $('portfolio').value=state.portfolio; populateYears();
    bind('portfolio','change',e=>{state.portfolio=e.target.value; resetSecondaryFilters(); populateProjectCodes(); populateYears(); render();});
    bind('projectCode','change',e=>{state.projectCode=e.target.value; render();});
    bind('year','change',e=>{state.year=Number(e.target.value); render();});
    bind('company','change',e=>{state.company=e.target.value; render();});
    bind('province','change',e=>{state.province=e.target.value; render();});
    bind('token','change',e=>{state.token=e.target.value; render();});
    bind('search','input',e=>{state.search=e.target.value.trim().toLowerCase(); render();});
    bind('sort','change',e=>{state.sort=e.target.value; renderPlots();});
    bind('reset','click',()=>{
      Object.assign(state,{portfolio:'forest65_external',projectCode:'',year:3,company:'',province:'',token:'',search:'',sort:'balance'});
      $('portfolio').value=state.portfolio; resetSecondaryFilters(); populateProjectCodes(); populateYears(); render();
    });
    bind('openAllSpend','click',openAllSpend);
    bind('exportCsv','click',exportCsv);
    bind('modalClose','click',closeModal);
    $('modalBackdrop').addEventListener('click',e=>{if(e.target===$('modalBackdrop')) closeModal();});
    document.addEventListener('keydown',e=>{if(e.key==='Escape') closeModal();});
    populateProjectCodes();
  }

  function filteredPlots(){
    const p=currentPortfolio(); if(!p?.plotDataAvailable) return [];
    let rows=portfolioPlots().filter(x=>(!state.projectCode||x.projectCode===state.projectCode)&&(!state.company||x.company===state.company)&&(!state.province||x.province===state.province)&&(!state.token||x.tokenType===state.token));
    if(state.search) rows=rows.filter(x=>[x.projectCode,x.plotCode,x.contractNo,x.projectName,x.tokenType,x.province,x.district,x.subdistrict,x.village,x.company,x.communityName,x.chairman].join(' ').toLowerCase().includes(state.search));
    const y=state.year-1;
    rows.sort((a,b)=>state.sort==='plot'?a.plotCode.localeCompare(b.plotCode,'th',{numeric:true}):state.sort==='paid'?b.years[y].paid-a.years[y].paid:state.sort==='boq'?b.years[y].boq-a.years[y].boq:b.years[y].balance-a.years[y].balance);
    return rows;
  }
  function summary(rows=filteredPlots()){
    const y=state.year-1; const s={boq:0,paid:0,balance:0,over:0,pending:0,started:0,notContracted:0,contracted:0};
    rows.forEach(p=>{const r=p.years[y]; if(!r)return; s.boq+=r.boq;s.paid+=r.paid;s.balance+=r.balance;s.over+=r.over||0;if(r.paid>1)s.started++;if(r.contractStatus==='ทำสัญญาแล้ว')s.contracted++;if(r.status==='not_contracted')s.notContracted++;if(r.balance>1&&r.contractStatus==='ทำสัญญาแล้ว')s.pending++;});
    s.rate=s.boq?Math.min(s.paid/s.boq*100,999):0; return s;
  }
  function scopeSummary(portfolio){
    const rows=portfolioPlots(portfolio.id); const years=portfolio.boqYears||[];
    let boq=0,paid=0;
    rows.forEach(p=>years.forEach(y=>{const r=p.years[y-1];if(r){boq+=r.boq;paid+=r.paid;}}));
    return {boq,paid,balance:Math.max(0,boq-paid),rate:boq?Math.min(paid/boq*100,100):0};
  }

  function render(){ renderPortfolioCards(); renderKpis(); renderYearBars(); renderWorkTypes(); renderCodes(); renderPlots(); renderSource(); }
  function renderPortfolioCards(){
    $('portfolioCards').innerHTML=D.portfolios.map(p=>{
      let display=0,rate=0,detail='';
      if(p.boqAvailable&&p.plotDataAvailable){
        const active=p.id===state.portfolio&&p.boqYears.includes(state.year);
        const s=active?summary():scopeSummary(p);
        display=s.paid; rate=s.rate;
        detail=active?`ปี ${state.year}: BOQ ${money(s.boq)} • คงเหลือ ${money(s.balance)}`:`${p.boqScopeLabel||'BOQ'} ${money(s.boq)} • จ่ายตาม BOQ ${money(s.paid)}`;
      }else{
        display=p.totalAp; detail=`ERP AP สะสม ${money(p.totalAp)} • จ่ายงานปลูก/บำรุง ${money(p.amounts.boq_contract)} • รอ BOQ`;
      }
      return `<article class="portfolio-card ${state.portfolio===p.id?'active':''}" data-portfolio="${p.id}">
        <div class="ring ${p.boqAvailable?'':'gray'}" style="--pct:${rate}%"><strong>${p.boqAvailable?pct(rate):'รอ BOQ'}</strong></div>
        <div><h3>${esc(p.label)}</h3><div class="money">${money(display)}</div><p>${esc(detail)}</p><p>${p.codes.map(esc).join(' · ')}</p></div>
      </article>`;
    }).join('');
    document.querySelectorAll('[data-portfolio]').forEach(el=>el.addEventListener('click',()=>{state.portfolio=el.dataset.portfolio;resetSecondaryFilters();$('portfolio').value=state.portfolio;populateProjectCodes();populateYears();render();}));
  }
  function renderKpis(){
    const p=currentPortfolio();
    if(!p.boqAvailable||!p.plotDataAvailable){
      const vals=p.amounts;
      $('kpis').innerHTML=[['ERP AP สะสม',p.totalAp,'ทุกหมวดงาน'],['ปลูก/บำรุง',vals.boq_contract,'ยอด AP ที่จัดเป็นงาน BOQ'],['PDD',vals.pdd,'แยกจาก BOQ'],['VVB',vals.vvb,'แยกจาก BOQ'],['ลงพื้นที่ / Advance',vals.field_visit,'แยกจาก BOQ'],['ข้อมูล BOQ',null,'ยังไม่ได้รับไฟล์ BOQ']].map((x,i)=>`<div class="kpi ${i===5?'warn':''}"><div class="label">${x[0]}</div><div class="value">${x[1]===null?'รอข้อมูล':money(x[1])}</div><div class="sub">${x[2]}</div></div>`).join('');
      return;
    }
    const s=summary(), rows=filteredPlots();
    if(state.portfolio==='forest66_community'){
      $('kpis').innerHTML=`
        <div class="kpi"><div class="label">BOQ ปลูก/ดูแล ปี ${state.year}</div><div class="value">${money(s.boq)}</div><div class="sub">${fmt.format(rows.length)} ชุมชน</div></div>
        <div class="kpi"><div class="label">จ่ายค่าปลูก/ดูแล (ERP AP)</div><div class="value">${money(s.paid)}</div><div class="sub">${pct(s.rate)} ของ BOQ • ERP ถึง ${D.meta.erpAsOf}</div></div>
        <div class="kpi clickable warn" id="remainingKpi"><div class="label">BOQ คงเหลือ</div><div class="value">${money(s.balance)}</div><div class="sub">รวมชุมชนที่ยังไม่ทำสัญญาด้วย</div></div>
        <div class="kpi"><div class="label">ทำสัญญาแล้ว</div><div class="value">${fmt.format(s.contracted)} ชุมชน</div><div class="sub">ยังไม่ทำสัญญา ${fmt.format(s.notContracted)} ชุมชน</div></div>
        <div class="kpi"><div class="label">กองทุนชุมชน (นอก BOQ)</div><div class="value">${money(p.amounts.community_fund)}</div><div class="sub">แยก ไม่หักจาก BOQ ปลูก/ดูแล</div></div>
        <div class="kpi"><div class="label">ลงพื้นที่ / Clear Advance</div><div class="value">${money(p.amounts.field_visit)}</div><div class="sub">ค่าใช้จ่ายประกอบ แยกจาก BOQ</div></div>`;
      $('remainingKpi').addEventListener('click',openPending); return;
    }
    $('kpis').innerHTML=`
      <div class="kpi"><div class="label">มูลค่า BOQ ปี ${state.year}</div><div class="value">${money(s.boq)}</div><div class="sub">${fmt.format(rows.length)} ${p.unitLabel}</div></div>
      <div class="kpi"><div class="label">จ่ายแล้ว (ERP AP)</div><div class="value">${money(s.paid)}</div><div class="sub">${pct(s.rate)} ของ BOQ</div></div>
      <div class="kpi clickable warn" id="remainingKpi"><div class="label">คงเหลือยังไม่จ่าย</div><div class="value">${money(s.balance)}</div><div class="sub">คลิกดูรายการคงเหลือ</div></div>
      <div class="kpi clickable danger" id="pendingKpi"><div class="label">${p.unitLabel}ที่ยังค้าง</div><div class="value">${fmt.format(s.pending)} ${p.unitLabel}</div><div class="sub">จาก ${fmt.format(rows.length)} ${p.unitLabel}</div></div>
      <div class="kpi"><div class="label">เริ่มจ่ายแล้ว</div><div class="value">${fmt.format(s.started)} ${p.unitLabel}</div><div class="sub">ปีดำเนินงานที่เลือก</div></div>
      <div class="kpi ${s.over>1?'danger':''}"><div class="label">จ่ายเกิน BOQ ปัจจุบัน</div><div class="value">${money(s.over)}</div><div class="sub">ตรวจรายการหากยอดมากกว่า 0</div></div>`;
    $('remainingKpi').addEventListener('click',openPending); $('pendingKpi').addEventListener('click',openPending);
  }
  function renderYearBars(){
    const p=currentPortfolio(); if(!p.boqAvailable||!p.plotDataAvailable){$('yearBars').innerHTML='<div class="empty-state">ยังไม่มี BOQ สำหรับประเภทโครงการนี้</div>';return;}
    const rows=filteredPlots(), years=p.boqYears||[];
    const sums=years.map(y=>({year:y,boq:0,paid:0,balance:0}));
    rows.forEach(plot=>sums.forEach(s=>{const r=plot.years[s.year-1];if(r){s.boq+=r.boq;s.paid+=r.paid;s.balance+=r.balance;}}));
    $('yearBars').innerHTML=sums.map(r=>{const paidPct=r.boq?Math.min(r.paid/r.boq*100,100):0;const remPct=100-paidPct;return `<div class="bar-row"><div class="bar-label">ปี ${r.year}</div><div class="stack-track"><div class="stack-paid" style="width:${paidPct}%" title="จ่ายแล้ว ${money(r.paid)}"></div><div class="stack-remain" style="width:${remPct}%" title="คงเหลือ ${money(r.balance)}"></div></div><div class="bar-value">${pct(paidPct)} · คง ${money(r.balance)}</div></div>`;}).join('');
  }
  function renderWorkTypes(){
    const codes=D.projectCodes.filter(x=>x.portfolio===state.portfolio&&(!state.projectCode||x.code===state.projectCode));
    const totals={}; Object.keys(D.workTypeLabels).forEach(k=>totals[k]=codes.reduce((s,c)=>s+Number(c.amounts[k]||0),0));
    const max=Math.max(...Object.values(totals).map(Math.abs),1);
    $('workTypeBars').innerHTML=Object.entries(D.workTypeLabels).map(([k,label])=>`<div class="bar-row"><div class="bar-label">${esc(label)}</div><div class="bar-track"><div class="bar-paid" style="width:${Math.max(0,Math.abs(totals[k])/max*100)}%"></div></div><div class="bar-value">${money(totals[k])}</div></div>`).join('');
  }
  function renderCodes(){
    const rows=D.projectCodes.filter(x=>x.portfolio===state.portfolio&&(!state.projectCode||x.code===state.projectCode));
    $('codeRows').innerHTML=rows.map(x=>`<tr><td><strong>${esc(x.code)}</strong></td><td>${esc(portfolioMap[x.portfolio].label)}</td><td>${esc(x.company||'—')}</td><td class="num">${money(x.amounts.boq_contract)}</td><td class="num">${money(x.amounts.pdd)}</td><td class="num">${money(x.amounts.vvb)}</td><td class="num">${money(x.amounts.field_visit)}</td><td class="num">${money(x.amounts.survival)}</td><td class="num">${money(x.amounts.community_fund)}</td><td class="num"><strong>${money(x.totalAp)}</strong></td></tr>`).join('');
  }
  function statusLabel(y){
    if(!y)return ['no_data','ไม่มีข้อมูล']; if(y.status==='not_contracted')return ['not_contracted','ยังไม่ทำสัญญา']; if(y.status==='future')return ['future','ยังไม่ถึงปี']; if(y.status==='no_boq')return ['no_boq','ไม่มี BOQ']; if(y.status==='no_data')return ['no_data','ไม่มีข้อมูลจ่าย']; if(y.over>1)return ['over','เกิน BOQ']; if(y.status==='paid')return ['paid','ครบ']; if(y.status==='partial')return ['partial','จ่ายบางส่วน']; return ['not_started','ยังไม่พบยอดจ่าย'];
  }
  function latestLabel(y){ if(!y||['not_contracted','future','no_boq'].includes(y.status))return '—'; if(y.latestPaymentInstallments?.length)return `งวด ${y.latestPaymentInstallments.join(', ')}`; if(y.latestFullInstallment)return `ถึงงวด ${y.latestFullInstallment}`; return '—'; }
  function pendingLabel(y){ if(!y||['not_contracted','future','no_boq'].includes(y.status))return '—'; return y.pendingInstallments?.length?y.pendingInstallments.map(i=>`งวด ${i}`).join(', '):'—'; }
  function unitDisplay(p){ return p.communityName?`${esc(p.communityName)}<div class="muted nowrap">${esc(p.plotCode)}</div>`:`<strong>${esc(p.plotCode)}</strong><div class="muted nowrap">${esc(p.contractNo||'')}</div>`; }
  function renderPlots(){
    const pf=currentPortfolio(), available=!!pf.plotDataAvailable; $('plotUnavailable').hidden=available; $('plotTableWrap').hidden=!available; $('exportCsv').disabled=!available;
    if(!available){$('plotUnavailable').textContent='ประเภทโครงการนี้มีข้อมูลจ่ายสะสมตามรหัสโครงการ แต่ยังไม่มี BOQ ป่าบุคคลภายนอก ปี 2566 ในชุดข้อมูลที่ฝังไว้ จึงยังคำนวณคงเหลือรายแปลงไม่ได้';$('tableSubtitle').textContent='';return;}
    const rows=filteredPlots(), y=state.year-1; $('boqYearHead').textContent=`BOQ ปี ${state.year}`;
    $('tableSubtitle').textContent=`${fmt.format(rows.length)} ${pf.unitLabel} • ปีดำเนินงานที่ ${state.year}`;
    $('plotRows').innerHTML=rows.map(p=>{const r=p.years[y],[cls,label]=statusLabel(r);const contract=r?.contractNo||p.contractNo||'';const area=r?.areaRai??p.areaRai;return `<tr><td><strong>${p.projectCode}</strong></td><td>${esc(pf.label)}</td><td>${esc(p.projectName)}</td><td>${esc(p.tokenType||'—')}</td><td>${unitDisplay(p)}${contract?`<div class="muted nowrap">${esc(contract)}</div>`:''}</td><td>${esc(p.province)}</td><td class="num">${fmt.format(area||0)}</td><td class="num">${money(r.boq)}</td><td class="nowrap">${latestLabel(r)}<div class="muted">${r.latestPaymentDate||''}</div></td><td>${pendingLabel(r)}</td><td class="num">${money(r.paid)}</td><td class="num"><strong>${money(r.balance)}</strong></td><td><span class="pill ${cls}">${label}</span></td><td><button class="link-btn" data-plot="${esc(p.plotCode)}">ดู</button></td></tr>`;}).join('');
    document.querySelectorAll('[data-plot]').forEach(btn=>btn.addEventListener('click',()=>openPlot(btn.dataset.plot)));
  }
  function renderSource(){ $('sourceNote').textContent=`ERP AP ถึง ${D.meta.erpAsOf} • BOQ ป่าบุคคลภายนอก ปี 2565: 160 แปลง • BOQ ป่าชุมชน ปี 2566: 93 ชุมชน ปี 1–2 (ไฟล์ 25.08.2569)`; }
  function openModal(html){$('modalContent').innerHTML=html;$('modalBackdrop').hidden=false;document.body.style.overflow='hidden';}
  function closeModal(){$('modalBackdrop').hidden=true;document.body.style.overflow='';}
  function openAllSpend(){
    const total=D.portfolios.reduce((s,p)=>s+p.totalAp,0), keys=Object.keys(D.workTypeLabels);
    const totals=Object.fromEntries(keys.map(k=>[k,D.portfolios.reduce((s,p)=>s+Number(p.amounts[k]||0),0)]));
    openModal(`<h2 id="modalTitle">เงินที่จ่าย/ตั้ง AP ทุกหมวดหมู่</h2><p class="muted">แยกหมวดจาก ERP AP ถึง ${D.meta.erpAsOf}; “ปลูก/บำรุงตาม BOQ” เท่านั้นที่นำไปหัก BOQ ส่วนกองทุนชุมชน, PDD, VVB และ Clear Advance แยกออก</p><div class="modal-grid"><div class="mini-card"><div class="label">รวมทุกโครงการ</div><div class="value">${money(total)}</div></div>${D.portfolios.map(p=>`<div class="mini-card"><div class="label">${esc(p.label)}</div><div class="value">${money(p.totalAp)}</div></div>`).join('')}</div><div class="table-wrap"><table class="compact"><thead><tr><th>หมวดงาน</th><th class="num">ยอดสะสม</th>${D.portfolios.map(p=>`<th class="num">${esc(p.label)}</th>`).join('')}</tr></thead><tbody>${keys.map(k=>`<tr><td>${esc(D.workTypeLabels[k])}</td><td class="num"><strong>${money(totals[k])}</strong></td>${D.portfolios.map(p=>`<td class="num">${money(p.amounts[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
  }
  function openPending(){
    const rows=filteredPlots().filter(p=>p.years[state.year-1].balance>1).sort((a,b)=>b.years[state.year-1].balance-a.years[state.year-1].balance), y=state.year-1, pf=currentPortfolio();
    openModal(`<h2 id="modalTitle">รายการที่ยังมี BOQ คงเหลือ — ปี ${state.year}</h2><p class="muted">สำหรับป่าชุมชน รายการที่ “ยังไม่ทำสัญญา” จะแสดงแยกสถานะและไม่ถือว่าเป็นงวดค้างของสัญญา</p><div class="table-wrap"><table><thead><tr><th>${pf.unitLabel}</th><th>จังหวัด</th><th>สถานะ</th><th>งวดล่าสุด</th><th>งวดค้าง</th><th class="num">จ่ายแล้ว</th><th class="num">คงเหลือ</th><th></th></tr></thead><tbody>${rows.map(p=>{const r=p.years[y],[cls,label]=statusLabel(r);return `<tr><td><strong>${esc(p.communityName||p.plotCode)}</strong><div class="muted">${esc(p.communityName?p.plotCode:(r.contractNo||p.contractNo||''))}</div></td><td>${esc(p.province)}</td><td><span class="pill ${cls}">${label}</span></td><td>${latestLabel(r)}</td><td>${pendingLabel(r)}</td><td class="num">${money(r.paid)}</td><td class="num"><strong>${money(r.balance)}</strong></td><td><button class="link-btn" data-modal-plot="${esc(p.plotCode)}">รายละเอียด</button></td></tr>`;}).join('')}</tbody></table></div>`);
    document.querySelectorAll('[data-modal-plot]').forEach(b=>b.addEventListener('click',()=>openPlot(b.dataset.modalPlot)));
  }
  function openPlot(code){
    const p=PLOTS.find(x=>x.plotCode===code); if(!p)return; const r=p.years[state.year-1], pf=portfolioMap[p.portfolio], area=r?.areaRai??p.areaRai, contract=r?.contractNo||p.contractNo||'—';
    const years=(pf.boqYears||[]).map(y=>p.years[y-1]).filter(Boolean);
    openModal(`<h2 id="modalTitle">${esc(p.communityName||p.plotCode)} — ปีดำเนินงาน ${state.year}</h2><p class="muted">${esc(p.projectCode)} • ${esc(p.plotCode)} • ${esc(contract)} • ${esc(p.province)} • ${fmt.format(area||0)} ไร่</p><div class="modal-grid"><div class="mini-card"><div class="label">BOQ ปีนี้</div><div class="value">${money(r.boq)}</div></div><div class="mini-card"><div class="label">จ่ายแล้ว (ERP AP)</div><div class="value">${money(r.paid)}</div></div><div class="mini-card"><div class="label">คงเหลือ</div><div class="value">${money(r.balance)}</div></div><div class="mini-card"><div class="label">สถานะสัญญา</div><div class="value">${esc(r.contractStatus||'—')}</div></div></div>${r.installments?.length?`<h3>งวดงานปี ${state.year}</h3><div class="installment-grid">${r.installments.map(i=>`<div class="inst-card ${i.fullyPaid?'done':'pending'}"><h4>งวด ${i.no}</h4><p>BOQ <strong>${money(i.boq)}</strong></p><p>จ่าย ${money(i.paid)}</p><p>คงเหลือ ${money(i.remaining)}</p></div>`).join('')}</div>`:''}<h3>ภาพรวมปีที่มี BOQ</h3><div class="table-wrap"><table class="compact"><thead><tr><th>ปี</th><th>สัญญา</th><th class="num">BOQ</th><th class="num">จ่ายแล้ว</th><th class="num">คงเหลือ</th><th>สถานะ</th></tr></thead><tbody>${years.map(y=>{const [cls,label]=statusLabel(y);return `<tr><td>ปี ${y.year}</td><td>${esc(y.contractNo||'—')}</td><td class="num">${money(y.boq)}</td><td class="num">${money(y.paid)}</td><td class="num">${money(y.balance)}</td><td><span class="pill ${cls}">${label}</span></td></tr>`;}).join('')}</tbody></table></div>`);
  }
  function exportCsv(){
    const pf=currentPortfolio(), rows=filteredPlots(), y=state.year-1;
    const head=['รหัสโครงการ','หมวดหมู่/ประเภทโครงการ','ชื่อโครงการ T-VER','ประเภท TOKEN X','รหัสแปลง/ชุมชน','จังหวัด','เนื้อที่สัญญา (ไร่)','การดำเนินงานปีที่','มูลค่า BOQ ปีที่เลือก','งวดล่าสุดที่จ่ายแล้ว','งวดที่ยังไม่จ่าย','ยอดเงินที่จ่ายแล้ว','ยอดคงเหลือ','สถานะสัญญา'];
    const body=rows.map(p=>{const r=p.years[y];return [p.projectCode,pf.label,p.projectName,p.tokenType,p.communityName||p.plotCode,p.province,r.areaRai??p.areaRai,state.year,r.boq,latestLabel(r),pendingLabel(r),r.paid,r.balance,r.contractStatus||''];});
    const csv=[head,...body].map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));a.download=`project-finance-${state.portfolio}-year-${state.year}.csv`;a.click();URL.revokeObjectURL(a.href);
  }
  initFilters(); render();
})();

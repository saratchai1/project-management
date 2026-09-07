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
  function initFilters() {
    D.portfolios.forEach(x => option($('portfolio'), x.id, x.label));
    for (let y=1;y<=10;y++) option($('year'), String(y), `ปีที่ ${y}`);
    [...new Set(PLOTS.map(p=>p.company))].sort().forEach(v=>option($('company'),v,v));
    [...new Set(PLOTS.map(p=>p.province))].sort((a,b)=>a.localeCompare(b,'th')).forEach(v=>option($('province'),v,v));
    [...new Set(PLOTS.map(p=>p.tokenType))].sort().forEach(v=>option($('token'),v,v));
    $('portfolio').value=state.portfolio; $('year').value=String(state.year);
    bind('portfolio','change',e=>{state.portfolio=e.target.value; state.projectCode=''; populateProjectCodes(); render();});
    bind('projectCode','change',e=>{state.projectCode=e.target.value; render();});
    bind('year','change',e=>{state.year=Number(e.target.value); render();});
    bind('company','change',e=>{state.company=e.target.value; render();});
    bind('province','change',e=>{state.province=e.target.value; render();});
    bind('token','change',e=>{state.token=e.target.value; render();});
    bind('search','input',e=>{state.search=e.target.value.trim().toLowerCase(); render();});
    bind('sort','change',e=>{state.sort=e.target.value; renderPlots();});
    bind('reset','click',()=>{Object.assign(state,{portfolio:'forest65_external',projectCode:'',year:3,company:'',province:'',token:'',search:'',sort:'balance'}); for(const id of ['portfolio','projectCode','year','company','province','token','search','sort']) $(id).value=id==='year'?'3':id==='portfolio'?'forest65_external':id==='sort'?'balance':''; populateProjectCodes(); render();});
    bind('openAllSpend','click',openAllSpend);
    bind('exportCsv','click',exportCsv);
    bind('modalClose','click',closeModal);
    $('modalBackdrop').addEventListener('click',e=>{if(e.target===$('modalBackdrop')) closeModal();});
    document.addEventListener('keydown',e=>{if(e.key==='Escape') closeModal();});
    populateProjectCodes();
  }
  function bind(id,event,fn){ $(id).addEventListener(event,fn); }
  function populateProjectCodes(){
    const sel=$('projectCode'); sel.innerHTML='<option value="">ทั้งหมด</option>';
    D.projectCodes.filter(x=>x.portfolio===state.portfolio).forEach(x=>option(sel,x.code,`${x.code} — ${x.company||'ทั้งหมด'}`));
    sel.value=state.projectCode;
  }
  function filteredPlots(){
    if(state.portfolio!=='forest65_external') return [];
    let rows=PLOTS.filter(p=>(!state.projectCode||p.projectCode===state.projectCode)&&(!state.company||p.company===state.company)&&(!state.province||p.province===state.province)&&(!state.token||p.tokenType===state.token));
    if(state.search) rows=rows.filter(p=>[p.projectCode,p.plotCode,p.contractNo,p.projectName,p.tokenType,p.province,p.district,p.subdistrict,p.village,p.company].join(' ').toLowerCase().includes(state.search));
    const y=state.year-1;
    rows.sort((a,b)=>state.sort==='plot'?a.plotCode.localeCompare(b.plotCode,'th',{numeric:true}):state.sort==='paid'?b.years[y].paid-a.years[y].paid:state.sort==='boq'?b.years[y].boq-a.years[y].boq:b.years[y].balance-a.years[y].balance);
    return rows;
  }
  function summary(rows=filteredPlots()){
    const y=state.year-1; const s={boq:0,paid:0,balance:0,over:0,pending:0,started:0};
    rows.forEach(p=>{const r=p.years[y];s.boq+=r.boq;s.paid+=r.paid;s.balance+=r.balance;s.over+=r.over;if(r.balance>1)s.pending++;if(r.paid>1)s.started++;});
    s.rate=s.boq?Math.min(s.paid/s.boq*100,999):0; return s;
  }
  function render(){ renderPortfolioCards(); renderKpis(); renderYearBars(); renderWorkTypes(); renderCodes(); renderPlots(); renderSource(); }
  function renderPortfolioCards(){
    const selectedSummary=summary();
    $('portfolioCards').innerHTML=D.portfolios.map(p=>{
      let boq=0,paid=0,balance=0,rate=0,detail='';
      if(p.id==='forest65_external'){
        if(state.portfolio==='forest65_external'){boq=selectedSummary.boq;paid=selectedSummary.paid;balance=selectedSummary.balance;} else {const y=D.yearSummary[state.year-1];boq=y.boq;paid=y.paid;balance=y.balance;}
        rate=boq?Math.min(paid/boq*100,100):0;
        detail=`ปี ${state.year}: จ่าย ${money(paid)} • คงเหลือ ${money(balance)}`;
      } else { paid=p.totalAp; detail=`ERP AP สะสม ${money(paid)} • ยังไม่มี BOQ รายปีในไฟล์ที่ได้รับ`; }
      return `<article class="portfolio-card ${state.portfolio===p.id?'active':''}" data-portfolio="${p.id}">
        <div class="ring ${p.boqAvailable?'':'gray'}" style="--pct:${rate}%"><strong>${p.boqAvailable?pct(rate):'รอ BOQ'}</strong></div>
        <div><h3>${esc(p.label)}</h3><div class="money">${money(paid)}</div><p>${esc(detail)}</p><p>${p.codes.map(esc).join(' · ')}</p></div>
      </article>`;
    }).join('');
    document.querySelectorAll('[data-portfolio]').forEach(el=>el.addEventListener('click',()=>{state.portfolio=el.dataset.portfolio;state.projectCode='';$('portfolio').value=state.portfolio;populateProjectCodes();render();}));
  }
  function renderKpis(){
    const s=summary(); const isBoq=state.portfolio==='forest65_external';
    const p=portfolioMap[state.portfolio];
    if(!isBoq){
      const vals=p.amounts;
      $('kpis').innerHTML=[['ERP AP สะสม',p.totalAp,'ทุกหมวดงาน'],['ปลูก/บำรุง',vals.boq_contract,'ยอดสะสม'],['PDD',vals.pdd,'ยอดสะสม'],['ลงพื้นที่ / Advance',vals.field_visit,'ยอดสะสม'],['กองทุนชุมชน',vals.community_fund,'ยอดสะสม'],['ข้อมูล BOQ',null,'ยังไม่ได้รับไฟล์ BOQ รายปี']].map((x,i)=>`<div class="kpi ${i===5?'warn':''}"><div class="label">${x[0]}</div><div class="value">${x[1]===null?'รอข้อมูล':money(x[1])}</div><div class="sub">${x[2]}</div></div>`).join('');
      return;
    }
    $('kpis').innerHTML=`
      <div class="kpi"><div class="label">มูลค่าสัญญาปี ${state.year}</div><div class="value">${money(s.boq)}</div><div class="sub">${fmt.format(filteredPlots().length)} แปลง</div></div>
      <div class="kpi"><div class="label">จ่ายแล้ว</div><div class="value">${money(s.paid)}</div><div class="sub">${pct(s.rate)} ของ BOQ</div></div>
      <div class="kpi clickable warn" id="remainingKpi"><div class="label">คงเหลือยังไม่จ่าย</div><div class="value">${money(s.balance)}</div><div class="sub">คลิกดูแปลงและงวดค้าง</div></div>
      <div class="kpi clickable danger" id="pendingKpi"><div class="label">แปลงที่ยังค้าง</div><div class="value">${fmt.format(s.pending)} แปลง</div><div class="sub">จาก ${fmt.format(filteredPlots().length)} แปลง</div></div>
      <div class="kpi"><div class="label">เริ่มจ่ายแล้ว</div><div class="value">${fmt.format(s.started)} แปลง</div><div class="sub">ปีดำเนินงานที่เลือก</div></div>
      <div class="kpi ${s.over>1?'danger':''}"><div class="label">จ่ายเกิน BOQ ปัจจุบัน</div><div class="value">${money(s.over)}</div><div class="sub">ควรตรวจสัญญาแก้ไข/ใบลดหนี้</div></div>`;
    $('remainingKpi').addEventListener('click',openPending); $('pendingKpi').addEventListener('click',openPending);
  }
  function renderYearBars(){
    if(state.portfolio!=='forest65_external'){$('yearBars').innerHTML='<div class="empty-state">ยังไม่มี BOQ รายปีสำหรับประเภทโครงการนี้ จึงแสดงสัดส่วนจ่าย/คงเหลือไม่ได้</div>';return;}
    const rows=filteredPlots();
    const sums=Array.from({length:10},(_,i)=>({year:i+1,boq:0,paid:0,balance:0}));
    rows.forEach(p=>p.years.forEach((r,i)=>{sums[i].boq+=r.boq;sums[i].paid+=r.paid;sums[i].balance+=r.balance;}));
    $('yearBars').innerHTML=sums.map(r=>{const paidPct=r.boq?Math.min(r.paid/r.boq*100,100):0;const remPct=100-paidPct;return `<div class="bar-row"><div class="bar-label">ปี ${r.year}</div><div class="stack-track"><div class="stack-paid" style="width:${paidPct}%" title="จ่ายแล้ว ${money(r.paid)}"></div><div class="stack-remain" style="width:${remPct}%" title="คงเหลือ ${money(r.balance)}"></div></div><div class="bar-value">${pct(paidPct)} · คง ${money(r.balance)}</div></div>`;}).join('');
  }
  function renderWorkTypes(){
    const codes=D.projectCodes.filter(x=>x.portfolio===state.portfolio&&(!state.projectCode||x.code===state.projectCode));
    const totals={}; Object.keys(D.workTypeLabels).forEach(k=>totals[k]=codes.reduce((s,c)=>s+c.amounts[k],0));
    const max=Math.max(...Object.values(totals).map(Math.abs),1);
    $('workTypeBars').innerHTML=Object.entries(D.workTypeLabels).map(([k,label])=>`<div class="bar-row"><div class="bar-label">${esc(label)}</div><div class="bar-track"><div class="bar-paid" style="width:${Math.max(0,Math.abs(totals[k])/max*100)}%"></div></div><div class="bar-value">${money(totals[k])}</div></div>`).join('');
  }
  function renderCodes(){
    const rows=D.projectCodes.filter(x=>x.portfolio===state.portfolio&&(!state.projectCode||x.code===state.projectCode));
    $('codeRows').innerHTML=rows.map(x=>`<tr><td><strong>${esc(x.code)}</strong></td><td>${esc(portfolioMap[x.portfolio].label)}</td><td>${esc(x.company||'—')}</td><td class="num">${money(x.amounts.boq_contract)}</td><td class="num">${money(x.amounts.pdd)}</td><td class="num">${money(x.amounts.vvb)}</td><td class="num">${money(x.amounts.field_visit)}</td><td class="num">${money(x.amounts.survival)}</td><td class="num">${money(x.amounts.community_fund)}</td><td class="num"><strong>${money(x.totalAp)}</strong></td></tr>`).join('');
  }
  function statusLabel(y){ if(y.over>1)return ['over','เกิน BOQ']; if(y.status==='paid')return ['paid','ครบ']; if(y.status==='partial')return ['partial','จ่ายบางส่วน']; return ['not_started','ยังไม่จ่าย']; }
  function latestLabel(y){ if(y.latestPaymentInstallments?.length)return `งวด ${y.latestPaymentInstallments.join(', ')}`; if(y.latestFullInstallment)return `ถึงงวด ${y.latestFullInstallment}`; return '—'; }
  function pendingLabel(y){ return y.pendingInstallments.length?y.pendingInstallments.map(i=>`งวด ${i}`).join(', '):'—'; }
  function renderPlots(){
    const available=state.portfolio==='forest65_external'; $('plotUnavailable').hidden=available; $('plotTableWrap').hidden=!available; $('exportCsv').disabled=!available;
    if(!available){$('plotUnavailable').textContent='ประเภทโครงการนี้มีข้อมูลจ่ายสะสมตามรหัสโครงการ แต่ยังไม่มี BOQ รายปี/รายแปลงในไฟล์ที่ได้รับ จึงยังคำนวณคงเหลือรายงวดไม่ได้';$('tableSubtitle').textContent='';return;}
    const rows=filteredPlots(), y=state.year-1; $('boqYearHead').textContent=`BOQ ปี ${state.year}`;
    $('tableSubtitle').textContent=`${fmt.format(rows.length)} แปลง • ปีดำเนินงานที่ ${state.year}`;
    $('plotRows').innerHTML=rows.map(p=>{const r=p.years[y],[cls,label]=statusLabel(r);return `<tr><td><strong>${p.projectCode}</strong></td><td>ป่าบุคคลภายนอก ปี 2565</td><td>${esc(p.projectName)}</td><td>${esc(p.tokenType)}</td><td><strong>${esc(p.plotCode)}</strong><div class="muted nowrap">${esc(p.contractNo)}</div></td><td>${esc(p.province)}</td><td class="num">${fmt.format(p.areaRai)}</td><td class="num">${money(r.boq)}</td><td class="nowrap">${latestLabel(r)}<div class="muted">${r.latestPaymentDate||''}</div></td><td>${pendingLabel(r)}</td><td class="num">${money(r.paid)}</td><td class="num"><strong>${money(r.balance)}</strong></td><td><span class="pill ${cls}">${label}</span></td><td><button class="link-btn" data-plot="${esc(p.plotCode)}">ดู</button></td></tr>`;}).join('');
    document.querySelectorAll('[data-plot]').forEach(btn=>btn.addEventListener('click',()=>openPlot(btn.dataset.plot)));
  }
  function renderSource(){ $('sourceNote').textContent=`ERP ถึง ${D.meta.erpAsOf} • BOQ 160 แปลง • จับคู่ยอดปลูก/บำรุงได้ ${money(D.meta.mappedBoqPayments)}`; }
  function openModal(html){$('modalContent').innerHTML=html;$('modalBackdrop').hidden=false;document.body.style.overflow='hidden';}
  function closeModal(){$('modalBackdrop').hidden=true;document.body.style.overflow='';}
  function openAllSpend(){
    const total=D.portfolios.reduce((s,p)=>s+p.totalAp,0); const keys=Object.keys(D.workTypeLabels);
    const totals=Object.fromEntries(keys.map(k=>[k,D.portfolios.reduce((s,p)=>s+p.amounts[k],0)]));
    openModal(`<h2 id="modalTitle">เงินที่จ่ายแล้วทุกหมวดหมู่</h2><p class="muted">ยอดสุทธิจากโมดูล AP ถึง ${D.meta.erpAsOf} เริ่มรวมจากรหัสโครงการ ไม่ใช่เฉพาะรายการที่ผูก BOQ ได้</p><div class="modal-grid"><div class="mini-card"><div class="label">รวมทุกโครงการ</div><div class="value">${money(total)}</div></div>${D.portfolios.map(p=>`<div class="mini-card"><div class="label">${esc(p.label)}</div><div class="value">${money(p.totalAp)}</div></div>`).join('')}</div><div class="table-wrap"><table class="compact"><thead><tr><th>หมวดงาน</th><th class="num">ยอดสะสม</th>${D.portfolios.map(p=>`<th class="num">${esc(p.label)}</th>`).join('')}</tr></thead><tbody>${keys.map(k=>`<tr><td>${esc(D.workTypeLabels[k])}</td><td class="num"><strong>${money(totals[k])}</strong></td>${D.portfolios.map(p=>`<td class="num">${money(p.amounts[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="muted">ยอด “ปลูก/บำรุงตาม BOQ” ของป่าปี 65 ที่ผูกกับ master 160 แปลงได้ = ${money(D.meta.mappedBoqPayments)}; ส่วน ${money(D.meta.unmatchedOrOutOfMasterBoqPayment)} เป็นสัญญา/รายการนอก master ชุดนี้หรือจับคู่ไม่ได้ จึงไม่เอาไปคำนวณคงเหลือรายแปลง</p>`);
  }
  function openPending(){
    const rows=filteredPlots().filter(p=>p.years[state.year-1].balance>1).sort((a,b)=>b.years[state.year-1].balance-a.years[state.year-1].balance); const y=state.year-1;
    openModal(`<h2 id="modalTitle">แปลงที่ยังมีเงินคงเหลือ — ปี ${state.year}</h2><p class="muted">ใช้ติดตามว่างานติดที่งวดใด จ่ายล่าสุดเมื่อใด และควรไปตรวจ Progress/การตรวจรับต่อ</p><div class="table-wrap"><table><thead><tr><th>แปลง / สัญญา</th><th>จังหวัด</th><th>งวดล่าสุด</th><th>จ่ายล่าสุด</th><th>งวดค้าง</th><th class="num">จ่ายแล้ว</th><th class="num">คงเหลือ</th><th></th></tr></thead><tbody>${rows.map(p=>{const r=p.years[y];return `<tr><td><strong>${esc(p.plotCode)}</strong><div class="muted">${esc(p.contractNo)}</div></td><td>${esc(p.province)}</td><td>${latestLabel(r)}</td><td>${r.latestPaymentDate||'—'}<div class="muted">${r.latestPaymentAmount?money(r.latestPaymentAmount):''}</div></td><td>${pendingLabel(r)}</td><td class="num">${money(r.paid)}</td><td class="num"><strong>${money(r.balance)}</strong></td><td><button class="link-btn" data-modal-plot="${esc(p.plotCode)}">รายละเอียด</button></td></tr>`;}).join('')}</tbody></table></div><p><a class="btn" href="../work-monitor/">เปิด Work Monitor เพื่อตรวจสาเหตุหน้างาน</a></p>`);
    document.querySelectorAll('[data-modal-plot]').forEach(b=>b.addEventListener('click',()=>openPlot(b.dataset.modalPlot)));
  }
  function openPlot(code){
    const p=PLOTS.find(x=>x.plotCode===code); if(!p)return; const r=p.years[state.year-1];
    openModal(`<h2 id="modalTitle">${esc(p.plotCode)} — ปีดำเนินงาน ${state.year}</h2><p class="muted">${esc(p.projectCode)} • ${esc(p.contractNo)} • ${esc(p.province)} • ${fmt.format(p.areaRai)} ไร่</p><div class="modal-grid"><div class="mini-card"><div class="label">BOQ ปีนี้</div><div class="value">${money(r.boq)}</div></div><div class="mini-card"><div class="label">จ่ายแล้ว</div><div class="value">${money(r.paid)}</div></div><div class="mini-card"><div class="label">คงเหลือ</div><div class="value">${money(r.balance)}</div></div><div class="mini-card"><div class="label">จ่ายล่าสุด</div><div class="value">${r.latestPaymentDate||'—'}</div><div class="muted">${r.latestPaymentAmount?money(r.latestPaymentAmount):''}</div></div></div><h3>งวดงานปี ${state.year}</h3><div class="installment-grid">${r.installments.map(i=>`<div class="inst-card ${i.fullyPaid?'done':'pending'}"><h4>งวด ${i.no}</h4><p>BOQ <strong>${money(i.boq)}</strong></p><p>จ่าย ${money(i.paid)}</p><p>คงเหลือ ${money(i.remaining)}</p></div>`).join('')}</div><h3>ภาพรวมปี 1–10</h3><div class="table-wrap"><table class="compact"><thead><tr><th>ปี</th><th class="num">BOQ</th><th class="num">จ่ายแล้ว</th><th class="num">คงเหลือ</th><th>งวดค้าง</th><th>จ่ายล่าสุด</th></tr></thead><tbody>${p.years.map(y=>`<tr><td>ปี ${y.year}</td><td class="num">${money(y.boq)}</td><td class="num">${money(y.paid)}</td><td class="num">${money(y.balance)}</td><td>${pendingLabel(y)}</td><td>${y.latestPaymentDate||'—'}</td></tr>`).join('')}</tbody></table></div><p><a class="btn" href="../work-monitor/">ตรวจ Progress / ปัญหาหน้างาน</a></p>`);
  }
  function exportCsv(){
    const rows=filteredPlots(), y=state.year-1;
    const head=['รหัสโครงการ','หมวดหมู่/ประเภทโครงการ','ชื่อโครงการ T-VER','ประเภท TOKEN X','รหัสแปลง','จังหวัด','เนื้อที่สัญญา (ไร่)','การดำเนินงานปีที่','มูลค่าสัญญาปีที่เลือก','งวดล่าสุดที่จ่ายแล้ว','งวดที่ยังไม่จ่าย','ยอดเงินที่จ่ายแล้ว','ยอดคงเหลือ'];
    const body=rows.map(p=>{const r=p.years[y];return [p.projectCode,'ป่าบุคคลภายนอก ปี 2565',p.projectName,p.tokenType,p.plotCode,p.province,p.areaRai,state.year,r.boq,latestLabel(r),pendingLabel(r),r.paid,r.balance];});
    const csv=[head,...body].map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));a.download=`project-finance-year-${state.year}.csv`;a.click();URL.revokeObjectURL(a.href);
  }
  initFilters(); render();
})();

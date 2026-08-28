(()=>{'use strict';
const D=window.SUBMISSION_MONITOR_DATA;
if(!D){document.body.innerHTML='<div style="padding:40px;font-family:sans-serif">ไม่พบ data.js</div>';return}
const STATUS_CODE={s:'submitted',p:'pending',a:'paused',t:'terminated',n:'na',o:'note'};
D.datasets.forEach(d=>{d.plots=d.plots.map(r=>({id:r[0],order:r[1],companyCode:r[2],province:r[3],contractArea:r[4],ownerMainContractNo:r[5],contractGroup:r[6],sourceRow:r[7],expectedInstallments:r[8],sourceFile:d.sourceFile,installments:r[9].map((x,i)=>({no:i+1,status:STATUS_CODE[x[0]]||x[0],date:x[1]||null,expected:!!x[2],warning:x[3]==='f'?'future_date':null,note:x[4]||null}))}));d.plots.forEach(p=>{p.futureWarning=p.installments.some(x=>x.warning==='future_date');p.submissionCount=p.installments.filter(x=>x.status==='submitted').length;p.pendingCount=p.installments.filter(x=>x.status==='pending'&&x.expected).length;const stopped=/ยุติ/.test(p.contractGroup)||p.installments.some(x=>['paused','terminated'].includes(x.status));p.overallStatus=stopped?'stopped':p.futureWarning?'future_warning':p.pendingCount?'pending':'complete'})});
const $=id=>document.getElementById(id);
const S={dataset:'2565-y3',q:'',province:'',company:'',overall:'',installment:'',instStatus:''};
const STATUS={pending:'มีงวดที่ยังไม่ส่ง',complete:'ส่งครบตามงวดที่คาดหวัง',stopped:'ชะลอ / ยุติ',future_warning:'มีวันที่อนาคต'};
const INST={submitted:'ส่งแล้ว',pending:'ยังไม่ส่ง',paused:'ชะลอ',terminated:'ยุติ',na:'N/A',note:'หมายเหตุ'};
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const ds=()=>D.datasets.find(x=>x.key===S.dataset)||D.datasets[0];
function thaiDate(iso){if(!iso)return '—';const [y,m,d]=iso.split('-').map(Number);return `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y+543}`}
function num(n,d=0){return new Intl.NumberFormat('th-TH',{maximumFractionDigits:d}).format(n||0)}
function currentRows(){
  const q=S.q.trim().toLowerCase();
  return ds().plots.filter(p=>{
    if(S.province&&p.province!==S.province)return false;
    if(S.company&&p.companyCode!==S.company)return false;
    if(S.overall&&p.overallStatus!==S.overall)return false;
    if(q&&!([p.id,p.province,p.ownerMainContractNo,p.contractGroup,p.companyCode].join(' ').toLowerCase().includes(q)))return false;
    if(S.instStatus){
      const cells=S.installment?[p.installments[Number(S.installment)-1]].filter(Boolean):p.installments;
      const ok=c=>S.instStatus==='stopped'?['paused','terminated'].includes(c.status):S.instStatus==='future'?c.warning==='future_date':c.status===S.instStatus;
      if(!cells.some(ok))return false;
    }
    return true;
  })
}
function renderTabs(){
  $('datasetTabs').innerHTML=D.datasets.map(x=>`<button class="dataset-tab ${x.key===S.dataset?'active':''}" data-key="${x.key}"><b>${esc(x.label)}</b><small>${x.summary.plots} แปลง · ${x.installmentCount} งวด</small></button>`).join('');
  document.querySelectorAll('.dataset-tab').forEach(b=>b.onclick=()=>{S.dataset=b.dataset.key;resetFilters(false);render()})
}
function populateFilters(){
  const rows=ds().plots;
  const provinces=[...new Set(rows.map(x=>x.province).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'th'));
  const companies=[...new Set(rows.map(x=>x.companyCode).filter(Boolean))].sort();
  $('province').innerHTML='<option value="">ทั้งหมด</option>'+provinces.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
  $('company').innerHTML='<option value="">ทั้งหมด</option>'+companies.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
  $('installment').innerHTML='<option value="">ทุกงวด</option>'+Array.from({length:ds().installmentCount},(_,i)=>`<option value="${i+1}">งวดที่ ${i+1}</option>`).join('');
  $('province').value=S.province;$('company').value=S.company;$('overall').value=S.overall;$('installment').value=S.installment;$('instStatus').value=S.instStatus;$('search').value=S.q;
}
function kpi(label,value,sub,cls=''){return `<article class="card kpi ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></article>`}
function filteredMetrics(rows){
  const active=rows.filter(p=>p.overallStatus!=='stopped').length, stopped=rows.length-active;
  const submitted=rows.reduce((s,p)=>s+p.installments.filter(x=>x.status==='submitted').length,0);
  const pending=rows.reduce((s,p)=>s+p.installments.filter(x=>x.status==='pending'&&x.expected).length,0);
  const future=rows.filter(p=>p.futureWarning).length;
  const complete=rows.filter(p=>p.overallStatus==='complete').length;
  return {active,stopped,submitted,pending,future,complete};
}
function renderKpis(){const r=currentRows(),m=filteredMetrics(r);$('kpiGrid').innerHTML=
  kpi('แปลงในผลกรอง',num(r.length),`จาก ${num(ds().plots.length)} แปลง`)+
  kpi('แปลง Active',num(m.active),'ไม่รวมชะลอ/ยุติ','good')+
  kpi('วันที่ส่งงาน',num(m.submitted),'จำนวน cell ที่เป็นวันที่จริง','good')+
  kpi('งวดที่ยังไม่ส่ง',num(m.pending),'เฉพาะงวดที่คาดหวัง','warn')+
  kpi('ชะลอ / ยุติ',num(m.stopped),'นับระดับแปลง','danger')+
  kpi('วันที่อนาคต',num(m.future),'แปลงที่ควรตรวจ data','danger')}
function renderInstallments(){
  const rows=currentRows();
  $('installmentMeta').textContent=`คำนวณจาก ${rows.length} แปลงในผลกรอง · วันที่ = ส่งแล้ว · ข้อความชะลอ/ยุติไม่ถูกนับเป็นวันที่`;
  const cards=[];
  for(let no=1;no<=ds().installmentCount;no++){
    const c={submitted:0,pending:0,stopped:0,na:0,note:0};
    rows.forEach(p=>{const x=p.installments[no-1];if(!x)return;if(x.status==='submitted')c.submitted++;else if(x.status==='pending')c.pending++;else if(['paused','terminated'].includes(x.status))c.stopped++;else if(x.status==='na')c.na++;else c.note++});
    const denom=c.submitted+c.pending,rate=denom?c.submitted/denom*100:0,total=Math.max(rows.length,1);
    cards.push(`<article class="inst-card" data-inst="${no}"><div class="inst-top"><div><span class="section-kicker">งวดที่ ${no}</span><strong>${c.submitted} ส่งแล้ว</strong></div><div class="inst-rate">${rate.toFixed(0)}%</div></div><div class="bar"><span class="submitted" style="width:${c.submitted/total*100}%"></span><span class="pending" style="width:${c.pending/total*100}%"></span><span class="stopped" style="width:${c.stopped/total*100}%"></span><span class="na" style="width:${(c.na+c.note)/total*100}%"></span></div><div class="inst-stats"><span><b>${c.submitted}</b> ส่งแล้ว</span><span><b>${c.pending}</b> ยังไม่ส่ง</span><span><b>${c.stopped}</b> ชะลอ/ยุติ</span><span><b>${c.na}</b> N/A${c.note?` · ${c.note} note`:''}</span></div></article>`)
  }
  $('installmentGrid').style.gridTemplateColumns=`repeat(${Math.min(ds().installmentCount,4)},1fr)`;
  $('installmentGrid').innerHTML=cards.join('');
  document.querySelectorAll('[data-inst]').forEach(e=>e.onclick=()=>{S.installment=e.dataset.inst;S.instStatus='';$('installment').value=S.installment;$('instStatus').value='';renderPartial()})
}
function overallChip(p){return `<span class="status-chip ${p.overallStatus}">${STATUS[p.overallStatus]||p.overallStatus}</span>`}
function instChip(x){if(!x)return '—';let cls=x.status,label=INST[x.status]||x.status;if(x.warning==='future_date'){cls='future';label='ส่งแล้ว · วันที่อนาคต'}const d=x.date?`<span class="inst-date ${x.warning?'future-date':''}">${thaiDate(x.date)}</span>`:'';const note=x.note?`<span class="inst-date">${esc(x.note)}</span>`:'';return `<span class="inst-chip ${cls}">${label}</span>${d}${note}`}
function priority(p){const rank={future_warning:0,pending:1,stopped:2,complete:3};return rank[p.overallStatus]??9}
function renderTable(){
  const rows=currentRows().slice().sort((a,b)=>priority(a)-priority(b)||b.pendingCount-a.pendingCount||String(a.id).localeCompare(String(b.id),'th',{numeric:true}));
  $('tableMeta').textContent=`${rows.length} แปลง · ${ds().label} · คลิกแถวเพื่อดู contract hierarchy และรายละเอียดทุกงวด`;
  const instHeads=Array.from({length:ds().installmentCount},(_,i)=>`<th>งวด ${i+1}</th>`).join('');
  $('tableHeadRow').innerHTML=`<th>แปลง</th><th>จังหวัด</th><th>สถานะ</th><th>กลุ่มสัญญา</th><th>สัญญา TC–ROK</th>${instHeads}<th class="num">พื้นที่สัญญา</th>`;
  $('plotRows').innerHTML=rows.length?rows.map(p=>`<tr data-plot="${esc(p.id)}"><td><div class="plot-id">${esc(p.id)}</div><div class="small">${esc(p.companyCode||'—')}</div></td><td>${esc(p.province||'—')}</td><td>${overallChip(p)}</td><td><div class="nowrap">${esc(p.contractGroup||'—')}</div></td><td><span class="nowrap">${esc(p.ownerMainContractNo||'—')}</span></td>${p.installments.slice(0,ds().installmentCount).map(instChip).map(x=>`<td>${x}</td>`).join('')}<td class="num">${p.contractArea!=null?num(p.contractArea,2):'—'}</td></tr>`).join(''):`<tr><td colspan="${6+ds().installmentCount}"><div class="empty">ไม่พบรายการตามตัวกรอง</div></td></tr>`;
  document.querySelectorAll('[data-plot]').forEach(tr=>tr.onclick=()=>openDetail(tr.dataset.plot))
}
function openDetail(id){const p=ds().plots.find(x=>x.id===id);if(!p)return;
  const timelines=p.installments.slice(0,ds().installmentCount).map(x=>`<article class="timeline-item"><h3>งวดที่ ${x.no}</h3>${instChip(x)}<div class="date">${x.date?thaiDate(x.date):'—'}</div><div class="small">${x.expected?'งวดที่คาดหวังตาม source':'นอกจำนวนงวดที่ระบุในกลุ่มสัญญา'}${x.warning?' · ควรตรวจสอบวันที่':''}</div></article>`).join('');
  $('detailContent').innerHTML=`<div class="section-kicker">PLOT DETAIL · ${esc(ds().label)}</div><h2 id="detailTitle">${esc(p.id)} · ${esc(p.province||'—')}</h2><div class="small">Source row ${p.sourceRow} · ${esc(p.sourceFile)}</div><div class="detail-path"><span>Owner · TC</span><b>→</b><span>Main contractor · ROK</span><b>→</b><span>Subcontractor · ผรม.</span></div><div class="detail-grid"><div class="detail-box"><div class="label">สถานะแปลง</div><div class="value">${overallChip(p)}</div></div><div class="detail-box"><div class="label">สัญญา TC–ROK</div><div class="value">${esc(p.ownerMainContractNo||'ไม่พบใน source นี้')}</div></div><div class="detail-box"><div class="label">กลุ่มสัญญา ROK–ผรม.</div><div class="value">${esc(p.contractGroup||'—')}</div></div><div class="detail-box"><div class="label">พื้นที่สัญญา</div><div class="value">${p.contractArea!=null?num(p.contractArea,2)+' ไร่':'—'}</div></div></div><div class="section-kicker">SUBMISSION TIMELINE</div><div class="timeline" style="grid-template-columns:repeat(${Math.min(ds().installmentCount,4)},1fr)">${timelines}</div><div class="modal-note">ชื่อผู้รับเหมาช่วงรายบริษัทไม่ได้อยู่ใน 3 ไฟล์ที่ใช้สร้าง snapshot นี้ จึงไม่เดาชื่อบริษัทจากคอลัมน์ “บริษัท” ในต้นทาง</div>`;
  $('detailBackdrop').hidden=false;document.body.style.overflow='hidden'
}
function openQuality(){const q=D.quality;const future=q.futureDates.map(x=>`<div class="future-item"><b>${esc(x.plotId)} · งวด ${x.installment}</b>${thaiDate(x.date)} · ${esc(D.datasets.find(d=>d.key===x.dataset)?.label||x.dataset)}</div>`).join('');$('qualityContent').innerHTML=`<div class="section-kicker">DATA QUALITY</div><h2 id="qualityTitle">สิ่งที่ Dashboard จัดการไว้</h2><div class="quality-list">${q.notes.map((x,i)=>`<div class="quality-item"><b>${i+1}. ${esc(x)}</b></div>`).join('')}</div><div class="quality-item" style="margin-top:12px"><b>Continuation rows ที่ไม่นับเป็นแปลงใหม่</b>${Object.entries(q.continuationRowsIgnored).map(([k,v])=>`${esc(k)}: ${v}`).join(' · ')}</div><div class="quality-item" style="margin-top:12px"><b>วันที่อนาคตที่พบ: ${q.futureDateCount} จุด</b><div class="future-list">${future||'<div class="small">ไม่พบ</div>'}</div></div>`;$('qualityBackdrop').hidden=false;document.body.style.overflow='hidden'}
function exportCsv(){const rows=currentRows();const header=['project_year','operation_year','plot_id','province','company_code','overall_status','contract_group','tc_rok_contract','contract_area',...Array.from({length:ds().installmentCount},(_,i)=>`installment_${i+1}_status`),...Array.from({length:ds().installmentCount},(_,i)=>`installment_${i+1}_date`)];const lines=[header];rows.forEach(p=>lines.push([ds().projectYear,ds().operationYear,p.id,p.province,p.companyCode,p.overallStatus,p.contractGroup,p.ownerMainContractNo,p.contractArea??'',...p.installments.slice(0,ds().installmentCount).map(x=>x.status),...p.installments.slice(0,ds().installmentCount).map(x=>x.date||'')]));const csv='\ufeff'+lines.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`submission-monitor-${S.dataset}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function resetFilters(doRender=true){S.q=S.province=S.company=S.overall=S.installment=S.instStatus='';if(doRender)render()}
function renderPartial(){renderKpis();renderInstallments();renderTable()}
function render(){renderTabs();populateFilters();renderPartial()}
$('snapshotDate').textContent=thaiDate(D.asOf);
$('search').oninput=e=>{S.q=e.target.value;renderPartial()};
$('province').onchange=e=>{S.province=e.target.value;renderPartial()};$('company').onchange=e=>{S.company=e.target.value;renderPartial()};$('overall').onchange=e=>{S.overall=e.target.value;renderPartial()};$('installment').onchange=e=>{S.installment=e.target.value;renderPartial()};$('instStatus').onchange=e=>{S.instStatus=e.target.value;renderPartial()};
$('resetBtn').onclick=()=>resetFilters();$('qualityBtn').onclick=openQuality;$('exportBtn').onclick=exportCsv;
function closeModal(id){$(id).hidden=true;document.body.style.overflow=''}
$('detailClose').onclick=()=>closeModal('detailBackdrop');$('qualityClose').onclick=()=>closeModal('qualityBackdrop');$('detailBackdrop').onclick=e=>{if(e.target===$('detailBackdrop'))closeModal('detailBackdrop')};$('qualityBackdrop').onclick=e=>{if(e.target===$('qualityBackdrop'))closeModal('qualityBackdrop')};document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal('detailBackdrop');closeModal('qualityBackdrop')}});
render();
})();

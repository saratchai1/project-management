(() => {
  "use strict";

  const DATA = window.BOQ_DATA;
  const $ = (s) => document.querySelector(s);
  const state = { year: DATA.meta.defaultYear || 3, company: "", province: "", token: "", search: "", sort: "total10y" };
  const money = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
  const areaFmt = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });
  const pctFmt = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 1 });

  function esc(v) { return String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }
  function baht(v) { return money.format(Math.round(Number(v || 0))); }
  function shortMoney(v) { v=Number(v||0); if(Math.abs(v)>=1e9)return `${(v/1e9).toFixed(2)} พันลบ.`; if(Math.abs(v)>=1e6)return `${(v/1e6).toFixed(2)} ลบ.`; if(Math.abs(v)>=1e3)return `${(v/1e3).toFixed(0)}k`; return baht(v); }
  function yearRow(plot,y=state.year){ return plot.years.find(d=>d.y===Number(y)); }
  function sum(arr,fn){ return arr.reduce((a,x)=>a+Number(fn(x)||0),0); }
  function filtered(){
    const q=state.search.trim().toLowerCase();
    return DATA.plots.filter(p=>{
      if(state.company&&p.company!==state.company)return false;
      if(state.province&&p.province!==state.province)return false;
      if(state.token&&p.token!==state.token)return false;
      if(!q)return true;
      return [p.id,p.contract,p.company,p.project,p.token,p.moo,p.village,p.subdistrict,p.district,p.province,p.areaType].join(" ").toLowerCase().includes(q);
    });
  }

  function populateFilters(){
    for(let y=1;y<=10;y++)$("#year").insertAdjacentHTML("beforeend",`<option value="${y}" ${y===state.year?"selected":""}>ปี ${y}</option>`);
    [["#company",[...new Set(DATA.plots.map(p=>p.company))].sort()],["#province",[...new Set(DATA.plots.map(p=>p.province))].sort((a,b)=>a.localeCompare(b,"th"))],["#token",[...new Set(DATA.plots.map(p=>p.token))].sort()]].forEach(([sel,values])=>values.forEach(v=>$(sel).insertAdjacentHTML("beforeend",`<option value="${esc(v)}">${esc(v)}</option>`)));
  }

  function renderKpis(rows){
    const total10y=sum(rows,p=>p.total10y),yearTotal=sum(rows,p=>yearRow(p)?.value),area=sum(rows,p=>p.area),exceptions=rows.filter(p=>yearRow(p)?.exception).length;
    $("#kpis").innerHTML=`
      <article class="kpi"><div class="label">แปลง</div><div class="value">${rows.length}</div><div class="sub">จากทั้งหมด ${DATA.meta.plotCount} แปลง</div></article>
      <article class="kpi"><div class="label">พื้นที่</div><div class="value">${areaFmt.format(area)}</div><div class="sub">ไร่</div></article>
      <article class="kpi"><div class="label">BOQ รวม 10 ปี</div><div class="value">${shortMoney(total10y)}</div><div class="sub">${baht(total10y)} บาท</div></article>
      <article class="kpi"><div class="label">BOQ ปี ${state.year}</div><div class="value">${shortMoney(yearTotal)}</div><div class="sub">${total10y?pctFmt.format(yearTotal/total10y*100):"0"}% ของมูลค่า 10 ปี</div></article>
      <article class="kpi ${exceptions?"attn":""}"><div class="label">งวดต่างจาก Template</div><div class="value">${exceptions}</div><div class="sub">แปลงในปี ${state.year} — ใช้ค่าจริงจากเซลล์</div></article>`;
  }

  function renderYearChart(rows){
    const totals=Array.from({length:10},(_,i)=>({y:i+1,value:sum(rows,p=>yearRow(p,i+1)?.value)})),max=Math.max(...totals.map(d=>d.value),1);
    $("#yearChart").innerHTML=totals.map(d=>`<div class="year-bar-wrap ${d.y===state.year?"active":""}" data-year="${d.y}" title="ปี ${d.y}: ${baht(d.value)} บาท"><div class="year-value">${shortMoney(d.value)}</div><div class="year-bar" style="height:${Math.max(2,d.value/max*155)}px"></div><div class="year-label">ปี ${d.y}</div></div>`).join("");
    document.querySelectorAll("[data-year]").forEach(el=>el.addEventListener("click",()=>{state.year=Number(el.dataset.year);$("#year").value=state.year;render();}));
  }

  function renderInstallments(rows){
    const totals=[0,0,0,0]; rows.forEach(p=>{const y=yearRow(p);if(y)y.ins.forEach((v,i)=>totals[i]+=Number(v||0));});
    const all=totals.reduce((a,b)=>a+b,0); $("#installmentTitle").textContent=`สัดส่วนงวด — ปี ${state.year}`;
    if(!all){$("#installmentChart").innerHTML='<div class="empty">ไม่มีข้อมูล</div>';return;}
    const widths=totals.map(v=>v/all*100);
    $("#installmentChart").innerHTML=`<div class="installment-total">รวม ${baht(all)} บาท</div><div class="stack">${totals.map((v,i)=>`<span style="width:${widths[i]}%" title="งวด ${i+1}: ${baht(v)} บาท">${widths[i]>=10?`${widths[i].toFixed(0)}%`:""}</span>`).join("")}</div><div class="legend">${totals.map((v,i)=>`<div class="legend-item"><div class="l1">งวด ${i+1}</div><div class="l2">${shortMoney(v)} · ${widths[i].toFixed(1)}%</div></div>`).join("")}</div>`;
  }

  function renderHBars(sel,rows,maxRows=7){const list=rows.slice(0,maxRows),max=Math.max(...list.map(d=>d.value),1);$(sel).innerHTML=list.length?`<div class="hbar-list">${list.map(d=>`<div class="hbar-row" title="${esc(d.label)}: ${baht(d.value)} บาท"><div class="hbar-label">${esc(d.label)}</div><div class="hbar-track"><div class="hbar-fill" style="width:${d.value/max*100}%"></div></div><div class="hbar-value">${shortMoney(d.value)}</div></div>`).join("")}</div>`:'<div class="empty">ไม่มีข้อมูล</div>';}
  function renderCompany(rows){const groups=[...new Set(rows.map(p=>p.company))].map(company=>({label:company,value:sum(rows.filter(p=>p.company===company),p=>p.total10y)})).sort((a,b)=>b.value-a.value);renderHBars("#companyChart",groups,6);}
  function renderProvince(rows){const m=new Map();rows.forEach(p=>m.set(p.province,(m.get(p.province)||0)+Number(p.total10y||0)));renderHBars("#provinceChart",[...m].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value),7);}
  function sortedRows(rows){return [...rows].sort((a,b)=>{if(state.sort==="id")return a.id.localeCompare(b.id,undefined,{numeric:true});if(state.sort==="area")return b.area-a.area;if(state.sort==="yearValue")return(yearRow(b)?.value||0)-(yearRow(a)?.value||0);return b.total10y-a.total10y;});}

  function renderTable(rows){
    const body=$("#plotRows"),sorted=sortedRows(rows);$("#tableSubtitle").textContent=`แสดง ${sorted.length} แปลง · คลิก “ดู” เพื่อเปิดมูลค่าทุกปีและทุกงวด`;$("#yearCol").textContent=`ปี ${state.year}`;
    if(!sorted.length){body.innerHTML='<tr><td colspan="8" class="empty">ไม่พบข้อมูลตามตัวกรอง</td></tr>';return;}
    body.innerHTML=sorted.map(p=>{const y=yearRow(p);return `<tr><td><span class="plot-id">${esc(p.id)}</span>${y?.exception?'<br><span class="exception">งวดพิเศษ</span>':""}</td><td><span class="badge ${p.company.toLowerCase()}">${esc(p.company)}</span></td><td>${esc(p.province)}</td><td class="num">${areaFmt.format(p.area)}</td><td>${esc(p.contract)}</td><td class="num">${baht(y?.value||0)}</td><td class="num"><strong>${baht(p.total10y)}</strong></td><td><button class="detail-btn" data-plot="${esc(p.id)}">ดู</button></td></tr>`;}).join("");
    document.querySelectorAll("[data-plot]").forEach(btn=>btn.addEventListener("click",()=>openPlot(btn.dataset.plot)));
  }

  function openPlot(id){
    const p=DATA.plots.find(x=>x.id===id);if(!p)return;const selected=yearRow(p),hasException=p.years.some(y=>y.exception);
    $("#modalContent").innerHTML=`<h2 id="modalTitle">${esc(p.id)} · ${esc(p.company)}</h2><div class="muted">${esc(p.contract)} · ${esc(p.project)}</div><div class="detail-grid"><div class="detail-card"><div class="d1">BOQ 10 ปี</div><div class="d2">${baht(p.total10y)} บาท</div></div><div class="detail-card"><div class="d1">พื้นที่</div><div class="d2">${areaFmt.format(p.area)} ไร่</div></div><div class="detail-card"><div class="d1">จังหวัด</div><div class="d2">${esc(p.province)}</div></div><div class="detail-card"><div class="d1">ประเภท</div><div class="d2">${esc(p.token)}</div></div><div class="detail-card"><div class="d1">ตำบล / อำเภอ</div><div class="d2">${esc(p.subdistrict)} / ${esc(p.district)}</div></div><div class="detail-card"><div class="d1">หมู่บ้าน / หมู่</div><div class="d2">${esc(p.village||"-")} / ${esc(p.moo||"-")}</div></div><div class="detail-card"><div class="d1">ประเภทพื้นที่</div><div class="d2">${esc(p.areaType)}</div></div><div class="detail-card"><div class="d1">ปี ${state.year}</div><div class="d2">${baht(selected?.value||0)} บาท</div></div></div>${hasException?'<div class="warn">แปลงนี้มีอย่างน้อยหนึ่งปีที่สัดส่วนงวดจริงต่างจาก template ในหัวตาราง ระบบแสดง “ค่าจริงจากเซลล์” ไม่ได้บังคับตาม template.</div>':""}<div class="table-wrap"><table class="modal-table"><thead><tr><th>ปี</th><th class="num">มูลค่าปี</th><th class="num">งวด 1</th><th class="num">งวด 2</th><th class="num">งวด 3</th><th class="num">งวด 4</th><th>Template</th></tr></thead><tbody>${p.years.map(y=>`<tr class="${y.y===state.year?"selected":""}"><td><strong>ปี ${y.y}</strong>${y.exception?' <span class="exception">พิเศษ</span>':""}</td><td class="num">${baht(y.value)}</td>${y.ins.map(v=>`<td class="num">${v?baht(v):"-"}</td>`).join("")}<td>${esc(y.template)}</td></tr>`).join("")}</tbody></table></div>`;
    $("#modalBackdrop").hidden=false;document.body.style.overflow="hidden";
  }
  function closeModal(){$("#modalBackdrop").hidden=true;document.body.style.overflow="";}
  function exportCsv(rows){const header=["plot_code","company","province","district","subdistrict","area_rai","contract_no",`year_${state.year}_baht`,"ten_year_total_baht","year_exception"],vals=sortedRows(rows).map(p=>{const y=yearRow(p);return[p.id,p.company,p.province,p.district,p.subdistrict,p.area,p.contract,y?.value||0,p.total10y,y?.exception?"true":"false"];}),quote=v=>`"${String(v??"").replaceAll('"','""')}"`,csv="\ufeff"+[header,...vals].map(r=>r.map(quote).join(",")).join("\n"),blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`boq_filtered_year_${state.year}.csv`;a.click();URL.revokeObjectURL(a.href);}

  function render(){const rows=filtered();renderKpis(rows);renderYearChart(rows);renderInstallments(rows);renderCompany(rows);renderProvince(rows);renderTable(rows);$("#sourceNote").textContent=`Snapshot ${DATA.meta.asOf} · ${DATA.meta.source}`;}
  function wire(){
    $("#search").addEventListener("input",e=>{state.search=e.target.value;render();});$("#year").addEventListener("change",e=>{state.year=Number(e.target.value);render();});$("#company").addEventListener("change",e=>{state.company=e.target.value;render();});$("#province").addEventListener("change",e=>{state.province=e.target.value;render();});$("#token").addEventListener("change",e=>{state.token=e.target.value;render();});$("#sort").addEventListener("change",e=>{state.sort=e.target.value;renderTable(filtered());});
    $("#reset").addEventListener("click",()=>{Object.assign(state,{year:DATA.meta.defaultYear||3,company:"",province:"",token:"",search:"",sort:"total10y"});["#search","#company","#province","#token"].forEach(s=>$(s).value="");$("#year").value=state.year;$("#sort").value=state.sort;render();});
    $("#exportCsv").addEventListener("click",()=>exportCsv(filtered()));$("#modalClose").addEventListener("click",closeModal);$("#modalBackdrop").addEventListener("click",e=>{if(e.target.id==="modalBackdrop")closeModal();});document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal();});
  }
  populateFilters();wire();render();
})();

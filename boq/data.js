window.FINANCE_DATA_PROMISE=(async()=>{
  'use strict';
  const r=await fetch('finance-data.json',{cache:'no-cache'});
  if(!r.ok) throw new Error(`โหลด finance-data.json ไม่สำเร็จ (${r.status})`);
  const data=await r.json();
  if(!data||!Array.isArray(data.portfolios)||!Array.isArray(data.projectCodes)||!Array.isArray(data.plots)) throw new Error('รูปแบบข้อมูลการเงินไม่ถูกต้อง');
  return data;
})().catch(err=>{console.error('FINANCE DATA LOAD ERROR',err);throw err;});

window.FINANCE_DATA_PROMISE.then(data=>setTimeout(()=>{
  const portfolio=document.getElementById('portfolio');
  const year=document.getElementById('year');
  const defaults={forest65_external:'3',forest66_community:'1',forest66_external:'1'};
  const setDefaultYear=id=>{
    const target=defaults[id];
    if(!target||!year||!year.querySelector(`option[value="${target}"]`)) return;
    if(year.value!==target){
      year.value=target;
      year.dispatchEvent(new Event('change',{bubbles:true}));
    }
  };
  if(portfolio){
    portfolio.addEventListener('change',()=>setTimeout(()=>setDefaultYear(portfolio.value),0));
  }
  document.addEventListener('click',event=>{
    const card=event.target.closest?.('[data-portfolio]');
    if(card) setTimeout(()=>setDefaultYear(card.dataset.portfolio),0);
  });

  const notice=document.querySelector('.notice span');
  if(notice) notice.textContent='ป่าบุคคลภายนอก ปี 2565 (160 แปลง) + ป่าชุมชน ปี 2566 ปีที่ 1–2 (93 ชุมชน) + ป่าบุคคลภายนอก ปี 2566 (10 รายการ BOQ / 6 สัญญา) โดยแยกกองทุนชุมชน / PDD / VVB / Clear Advance ออกจาก BOQ ปลูกและดูแล';

  const source=document.getElementById('sourceNote');
  const sourceText=`ERP AP ถึง ${data.meta.erpAsOf} • BOQ ป่าบุคคลภายนอก ปี 2565: 160 แปลง • BOQ ป่าชุมชน ปี 2566: 93 ชุมชน ปี 1–2 • BOQ ป่าบุคคลภายนอก ปี 2566: 10 รายการ BOQ / 6 สัญญา`;
  if(source){
    const keepSource=()=>{if(source.textContent!==sourceText)source.textContent=sourceText;};
    new MutationObserver(keepSource).observe(source,{childList:true,characterData:true,subtree:true});
    keepSource();
  }

  const cards=document.getElementById('portfolioCards');
  const addExt66Note=()=>{
    const card=document.querySelector('[data-portfolio="forest66_external"]');
    if(!card||card.querySelector('.ext66-master-note')) return;
    const body=card.lastElementChild;
    if(!body) return;
    const note=document.createElement('p');
    note.className='ext66-master-note';
    note.textContent='AP งาน BOQ ทั้งหมด 3,673,921 บาท • จับคู่ BOQ ที่ได้รับ 3,582,517 บาท • 99-STC 91,404 บาทไม่อยู่ใน BOQ master นี้';
    body.appendChild(note);
  };
  if(cards){
    new MutationObserver(addExt66Note).observe(cards,{childList:true,subtree:true});
    addExt66Note();
  }
},0)).catch(()=>{});

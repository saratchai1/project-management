window.FINANCE_DATA_PROMISE=(async()=>{
  'use strict';
  const r=await fetch('finance-data.json',{cache:'no-cache'});
  if(!r.ok) throw new Error(`โหลด finance-data.json ไม่สำเร็จ (${r.status})`);
  const data=await r.json();
  if(!data||!Array.isArray(data.portfolios)||!Array.isArray(data.projectCodes)||!Array.isArray(data.plots)) throw new Error('รูปแบบข้อมูลการเงินไม่ถูกต้อง');
  return data;
})().catch(err=>{console.error('FINANCE DATA LOAD ERROR',err);throw err;});

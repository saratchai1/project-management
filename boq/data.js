window.FINANCE_DATA_PROMISE=(async()=>{
  'use strict';
  const b64=window.__FINANCE_B64||'';
  if(!b64) throw new Error('ไม่พบชุดข้อมูลการเงิน data-01/data-02');
  const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
  let text;
  if('DecompressionStream' in window){
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    text=await new Response(stream).text();
  }else{
    throw new Error('เบราว์เซอร์นี้ไม่รองรับการแตก gzip กรุณาใช้ Chrome, Edge, Safari หรือ Firefox รุ่นปัจจุบัน');
  }
  const data=JSON.parse(text);
  if(!data||!Array.isArray(data.portfolios)||!Array.isArray(data.projectCodes)||!Array.isArray(data.plots)) throw new Error('รูปแบบข้อมูลการเงินไม่ถูกต้อง');
  if(data.plots.length!==160) console.warn(`Finance dataset contains ${data.plots.length} plots; expected 160 BOQ master plots.`);
  delete window.__FINANCE_B64;
  return data;
})().catch(err=>{console.error('FINANCE DATA LOAD ERROR',err);throw err;});

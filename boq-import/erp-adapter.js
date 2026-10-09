/* Automatic adapter for the TC-ROK ERP export. Immutable BOQ + verified historical AP + new postings. */
(() => {
  'use strict';
  const REFERENCE=Object.freeze({
    sourceHash:'ced4f7d980257bff748873a71bf78f62d7a6a56fda52c3cd9662fadaaabe812a',
    asOf:'2026-10-05', apCount:3265, historyHash:'daec78086181d0b24918e1b7b2509f101f18321a166ef63c4f450eaff066ff71'
  });
  const REQUIRED=['maincode','glitemno','refcode','proj_dpt','vchdate','vchno','remark','amtdr','amtcr','module','costcode'];
  const ID=['maincode','vchno','glitemno'];
  const SIGNATURE=['module','ac_code','recitemno','refcode','docno','docno_powo','costcode','refcode_proj','remark','proj_dpt'];
  const clean=v=>v==null?'':String(v).normalize('NFC').trim().replace(/\s+/g,' ');
  const compact=v=>clean(v).toUpperCase().replace(/\s+/g,'');
  const fail=message=>{throw new Error(message);};
  const cents=value=>{
    if(value==null||value==='')return 0;
    if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e12)fail('ยอด AP ในไฟล์ต้องเป็นตัวเลข ไม่ใช่ข้อความ');
    const n=Math.round(value*100);
    if(Math.abs(n/100-value)>0.000001)fail('ยอด AP มีทศนิยมเกินสองตำแหน่ง ต้องตรวจต้นฉบับก่อน');
    return n;
  };
  function isoDate(value,date1904=false){
    if(typeof value==='number'&&Number.isFinite(value)){
      if(value<1||value>200000)fail('วันที่รายการ AP ใน Excel ไม่ถูกต้อง');
      return new Date(Date.UTC(1899,11,30)+(Math.floor(value)+(date1904?1462:0))*86400000).toISOString().slice(0,10);
    }
    const v=clean(value),m=/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(v)||/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
    if(!m)fail('อ่านวันที่ AP ไม่ได้ กรุณาใช้ไฟล์ส่งออกจาก ERP โดยตรง');
    let y,month,d;
    if(v.includes('/')){d=+m[1];month=+m[2];y=+m[3];}else{y=+m[1];month=+m[2];d=+m[3];}
    if(y>2400)y-=543;
    const out=new Date(Date.UTC(y,month-1,d));
    if(out.getUTCFullYear()!==y||out.getUTCMonth()!==month-1||out.getUTCDate()!==d)fail('วันที่ AP ไม่ถูกต้อง');
    return out.toISOString().slice(0,10);
  }
  const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const signature=r=>JSON.stringify([recordKey(r),...SIGNATURE.map(k=>clean(r[k])),r.date,String(r.debit),String(r.credit)]);
  function extract(book){
    const records=[],seen=new Map();let matchedSheets=0,rowsRead=0,duplicateSheets=0;
    for(const sheet of book.sheets){
      const indexes=[...sheet.rows.keys()].sort((a,b)=>a-b);
      let header=null,headerRow=-1;
      for(const row of indexes.slice(0,30)){
        const names=new Map();
        for(const [col,cell] of sheet.rows.get(row)){
          const name=clean(cell.value).toLowerCase();
          if(names.has(name)&&REQUIRED.includes(name))fail('หัวคอลัมน์ซ้ำในชีต '+sheet.name);
          names.set(name,col);
        }
        if(REQUIRED.every(k=>names.has(k))){header=names;headerRow=row;break;}
      }
      if(!header)continue;
      matchedSheets++;
      for(const index of indexes){
        if(index<=headerRow)continue;
        const source=sheet.rows.get(index),record={sheet:sheet.name,row:index+1};
        for(const [name,col] of header){const cell=source.get(col);if(cell){record[name]=cell.value;if(cell.formula)record.hasFormula=true;}}
        rowsRead++;
        if(clean(record.module).toUpperCase()!=='AP')continue;
        if(record.hasFormula)fail('พบสูตรในแถว AP '+record.row+' กรุณาใช้ไฟล์ส่งออก ERP ที่เป็นค่าจริง');
        record.date=isoDate(record.vchdate,book.date1904);
        record.debit=cents(record.amtdr);record.credit=cents(record.amtcr);record.amount=record.debit-record.credit;
        record.project=clean(record.refcode).split('-')[0];
        if(!clean(record.maincode)||!clean(record.glitemno)||!clean(record.vchno)||!record.project)fail('แถว AP '+record.row+' ไม่มีเลขที่รายการหรือรหัสโครงการ');
        const key=recordKey(record),previous=seen.get(key);
        if(previous){
          if(signature(previous)===signature(record)){duplicateSheets++;continue;}
          fail('มีรายการ AP ซ้ำหรือขัดกันที่แถว '+record.row+' จึงยังไม่บวกยอดซ้ำ');
        }
        seen.set(key,record);records.push(record);
      }
    }
    if(!matchedSheets)fail('ไฟล์นี้ไม่ใช่รายงานบริหารเงิน TC–ROK ที่รองรับ กรุณาเลือกไฟล์ Export ERP แบบเดียวกับไฟล์เดิม ระบบจะอ่านให้เองโดยไม่ต้องตั้งค่า');
    if(!records.length)fail('ไฟล์นี้ไม่มีรายการ AP สำหรับสร้าง Dashboard');
    return {records,rowsRead,matchedSheets,duplicateSheets};
  }
  async function history(extracted){
    const rows=extracted.records.filter(r=>r.date<=REFERENCE.asOf).map(signature).sort();
    return {count:rows.length,hash:await sha(rows.join('\n'))};
  }
  function classify(r){
    const remark=clean(r.remark),cost=clean(r.costcode);
    if(/กองทุน|community\s*fund/i.test(remark))return 'community_fund';
    if(/\bPDD\b/i.test(remark))return 'pdd';
    if(/\bVVB\b/i.test(remark))return 'vvb';
    if(/รอดตาย|survival/i.test(remark))return 'survival';
    if(/clear\s*advance|เคลียร์.{0,12}(?:เงินทดรอง|เงินยืม)|ลงพื้นที่/i.test(remark))return 'field_visit';
    if(/management\s*fee/i.test(remark))return 'other';
    if(cost==='S090002')return 'boq_contract';
    fail('รายการ AP แถว '+r.row+' เป็นงานรูปแบบใหม่ที่ยังแยกหมวดไม่ได้ จึงไม่เปลี่ยนยอดเดิม');
  }
  function matchPlot(r,data){
    const remark=clean(r.remark).replace(/ครั้ง\s*\/\s*ปี\s*\d+/g,''),years=[...remark.matchAll(/ปี\s*ที่\s*(\d{1,2})(?!\d)/g)].map(m=>+m[1]);
    if(new Set(years).size!==1||/ปี\s*ที่\s*\d+\s*(?:[-/,]|และ)\s*\d/.test(remark))fail('รายการ AP แถว '+r.row+' ระบุปีงานไม่ชัดเจน จึงไม่เดาแบ่งยอด');
    const year=years[0],source=compact(remark);
    let matches=[];
    for(const p of data.plots){
      if(p.projectCode!==r.project)continue;
      const y=p.years.find(x=>x.year===year),contract=compact(y?.contractNo??p.contractNo);
      if(!y||!contract)continue;
      // Exact contract token, not a prefix such as 65-01 matching 65-010.
      const at=source.indexOf(contract),next=source[at+contract.length];
      if(at>=0&&(!next||!/[0-9A-Z/-]/.test(next)))matches.push({p,y,year});
    }
    if(matches.length>1){
      const codes=[...clean(r.proj_dpt+' '+r.remark).toUpperCase().matchAll(/\b\d+(?:\(\d+\))?-(?:STC|VSD)\b/g)].map(m=>m[0]);
      matches=matches.filter(m=>codes.includes(m.p.plotCode));
    }
    if(matches.length!==1)fail('จับคู่สัญญากับ BOQ ไม่ได้อย่างชัดเจนที่แถว '+r.row+' จึงยังไม่เปลี่ยนยอดเดิม');
    if(['future','not_contracted'].includes(matches[0].y.status))fail('รายการแถว '+r.row+' อ้างถึงปีที่ยังไม่เริ่มหรือยังไม่ทำสัญญา');
    return matches[0];
  }

  function recordKey(r){
    const line=Number(r.glitemno);
    if(!Number.isInteger(line)||line<0||!clean(r.maincode)||!clean(r.vchno))fail('รายการ AP ไม่มีรหัสบริษัท เลขที่เอกสาร หรือเลขลำดับแถวที่ใช้ตรวจข้อมูลซ้ำ');
    return JSON.stringify([compact(r.maincode),compact(r.vchno),String(line)]);
  }
  // The public app contains only the aggregate BOQ and this historical digest.
  // Private reference rows come from the user's first full ERP upload, never from GitHub.
  async function resolveReference(parsed,previous){
    const rows=previous?.referenceRows || parsed.records.filter(r=>r.date<=REFERENCE.asOf);
    const digest=await history({records:rows});
    if(digest.count!==REFERENCE.apCount || digest.hash!==REFERENCE.historyHash)
      fail('ครั้งแรกกรุณาใช้ไฟล์บริหารเงิน TC–ROK ฉบับเต็มที่มีข้อมูลถึง 05/10/2569 ตรงกับฐาน BOQ จากนั้นจึงอัปโหลดไฟล์เพิ่มเติมหรือไฟล์แก้ไขได้ โดยไม่ต้องตั้งค่า');
    const map=new Map(rows.map(r=>[recordKey(r),r]));
    if(map.size!==rows.length)fail('รายการอ้างอิงซ้ำ จึงยังไม่เปลี่ยนข้อมูล');
    return {rows,map};
  }
  async function build(book,baseline,previous=null,onProgress=()=>{}){
    if(!baseline?.plots?.length||!baseline?.projectCodes?.length)fail('ไม่พบฐาน BOQ ในไฟล์โปรแกรม');
    if(baseline.meta.erpSourceSha256!==REFERENCE.sourceHash||baseline.meta.erpAsOf!==REFERENCE.asOf)fail('ฐาน BOQ เปลี่ยนรุ่น กรุณาให้ผู้ดูแลตรวจรุ่นตัวอ่านก่อน เพื่อไม่บวกยอดซ้ำ');
    onProgress('กำลังรวมรายการ — ส่วนที่ซ้ำใช้ข้อมูลจากไฟล์หลัง…');
    const parsed=extract(book),reference=await resolveReference(parsed,previous),referenceMap=reference.map;
    const overrides=new Map((previous?.overrides||[]).map(r=>[recordKey(r),r]));
    let replaced=0,added=0,unchanged=0;
    for(const r of parsed.records){
      const key=recordKey(r),prior=overrides.get(key)||referenceMap.get(key),original=referenceMap.get(key);
      if(!prior)added++;else if(signature(prior)!==signature(r))replaced++;else unchanged++;
      // Upload order wins, including restoring a corrected row back to its original value.
      if(original&&signature(original)===signature(r))overrides.delete(key);else overrides.set(key,r);
    }
    if(overrides.size>100000)fail('ข้อมูลรวมเกิน 100,000 รายการ กรุณาแยกรอบข้อมูล');
    const data=structuredClone(baseline),projectChanges=new Map(),plotChanges=new Map();
    function effect(r,sign){
      const project=data.projectCodes.find(p=>p.code===r.project);
      if(!project)fail('รายการ '+r.vchno+' อยู่ในโครงการที่ไม่มีใน BOQ เดิม จึงยังไม่เปลี่ยนยอด');
      const category=classify(r),portfolio=data.portfolios.find(p=>p.id===project.portfolio);
      if(!portfolio||!Object.hasOwn(project.amounts,category)||!Object.hasOwn(portfolio.amounts,category))fail('หมวดงานไม่ตรงกับฐาน BOQ');
      const key=project.code+'|'+category;
      if(!projectChanges.has(key))projectChanges.set(key,{project,portfolio,category,amount:0});
      projectChanges.get(key).amount+=sign*r.amount;
      if(category==='boq_contract'){
        const match=matchPlot(r,data),pk=match.p.projectCode+'|'+match.p.plotCode+'|'+match.year;
        if(!plotChanges.has(pk))plotChanges.set(pk,{...match,amount:0,latest:'',latestAmount:0});
        const item=plotChanges.get(pk);item.amount+=sign*r.amount;
        if(sign>0&&r.date>=item.latest){
          if(r.date>item.latest){item.latest=r.date;item.latestAmount=0;}
          item.latestAmount+=r.amount;
        }
      }
    }
    for(const [key,r] of overrides){
      const old=referenceMap.get(key);
      if(old)effect(old,-1);
      effect(r,1);
    }
    let deltaAmount=0;
    for(const {project,portfolio,category,amount} of projectChanges.values()){
      project.amounts[category]=(cents(project.amounts[category])+amount)/100;
      portfolio.amounts[category]=(cents(portfolio.amounts[category])+amount)/100;
      project.totalAp=(cents(project.totalAp)+amount)/100;portfolio.totalAp=(cents(portfolio.totalAp)+amount)/100;
      deltaAmount+=amount;
    }
    // Scan final transactions once, rather than once per changed plot.
    const effective=new Map(referenceMap);for(const [key,r] of overrides)effective.set(key,r);
    const latestByPlot=new Map();
    if(plotChanges.size){
      const projectsToCheck=new Set([...plotChanges.values()].map(x=>x.p.projectCode));
      for(const r of effective.values()){
        if(!projectsToCheck.has(r.project))continue;
        try{
          if(classify(r)!=='boq_contract')continue;
          const m=matchPlot(r,data),pk=m.p.projectCode+'|'+m.p.plotCode+'|'+m.year;
          if(!plotChanges.has(pk))continue;
          let entry=latestByPlot.get(pk);
          if(!entry||r.date>entry.date){entry={date:r.date,amount:0};latestByPlot.set(pk,entry);}
          if(r.date===entry.date)entry.amount+=r.amount;
        }catch(_){} // Unrelated, ambiguous historical entries retain their original aggregate authority.
      }
    }
    for(const item of plotChanges.values()){
      const y=item.y,paid=cents(y.paid)+item.amount,boq=cents(y.boq);
      if(paid<0)fail('ยอดรวม AP ของแปลง '+item.p.plotCode+' ติดลบ จึงยังไม่เปลี่ยนข้อมูล');
      Object.assign(y,{paid:paid/100,possiblePaid:paid/100,balance:Math.max(0,boq-paid)/100,
        possibleBalance:Math.max(0,boq-paid)/100,over:Math.max(0,paid-boq)/100,
        status:paid>=boq?'paid':paid>0?'partial':'not_started',paymentDataAvailable:true,
        paymentConfidence:'latest_upload_wins',installments:[],pendingInstallments:[],latestFullInstallment:0,
        latestPaymentInstallments:[],installmentDataAvailable:false,
        installmentDataReason:'ยอด AP รวมยืนยันจากรายการที่รวมแล้ว ไม่เดาแบ่งยอดเงินรายงวด'});
      const latest=latestByPlot.get(item.p.projectCode+'|'+item.p.plotCode+'|'+item.year);
      y.latestPaymentDate=latest?.date||null;y.latestPaymentAmount=latest?latest.amount/100:null;
    }
    for(const pf of data.portfolios){
      const delta=[...plotChanges.values()].filter(x=>x.p.portfolio===pf.id).reduce((sum,x)=>sum+x.amount,0);
      if(typeof pf.boqPaid==='number')pf.boqPaid=(cents(pf.boqPaid)+delta)/100;
    }
    for(const t of [...data.projectCodes,...data.portfolios]){
      if(Math.abs(Object.values(t.amounts).reduce((s,v)=>s+cents(v),0)-cents(t.totalAp))>10)fail('ยอดรวมหมวดงานไม่ตรงกับโครงการ จึงยังไม่เปลี่ยนข้อมูล');
    }
    const generatedAt=new Date().toISOString(),asOf=[...effective.values()].reduce((s,r)=>r.date>s?r.date:s,'');
    const sources=[...(previous?.sources||[]),{fileName:book.name,sourceHash:book.sourceHash,uploadedAt:generatedAt,rows:parsed.rowsRead,apRows:parsed.records.length,replaced,added}];
    Object.assign(data.meta,{generatedAt,erpAsOf:asOf,erpSource:book.name,erpSourceSha256:book.sourceHash,
      erpLatestUpdate:'รวมรายการจาก Excel ตามลำดับอัปโหลด — รายการซ้ำใช้ไฟล์หลัง'});
    return {schema:3,data,referenceRows:reference.rows,overrides:[...overrides.values()],sources,summary:{fileName:book.name,
      fileCreatedAt:book.createdAt,generatedAt,asOf,rowsRead:parsed.rowsRead,apRows:parsed.records.length,
      totalApRows:effective.size,replaced,added,unchanged,deltaAmount:deltaAmount/100,
      changedPlots:new Set([...plotChanges.values()].filter(x=>x.amount).map(x=>x.p.plotCode)).size,
      sheets:parsed.matchedSheets,duplicateSheets:parsed.duplicateSheets,sourceHash:book.sourceHash}};
  }
  window.BOQERP={extract,build,recordKey,reference:REFERENCE};
})();

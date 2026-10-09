/* BOQ public preview: local-only workbook inspection; NEVER publishes financial data. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const MAX_BYTES = 20 * 1024 * 1024;
  const MAX_FILES = 8;
  // Limits apply to actual content, never to the rectangular !ref (which includes blanks/styles).
  const MAX_DATA_ROWS = 100000;
  const MAX_DATA_COLS = 1024;
  const MAX_DATA_CELLS = 1000000;
  const MAX_SESSION_CELLS = 2000000;
  const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));
  const FIELDS = ['plotCode', 'contractNo', 'projectCode', 'boq', 'paid'];
  const LABELS = {plotCode:'รหัสแปลง/ชุมชน',contractNo:'เลขที่สัญญา',projectCode:'รหัสโครงการ',boq:'ยอด BOQ',paid:'ยอด AP สะสม'};
  const PATTERNS = {
    plotCode:/^(รหัสแปลง|รหัสชุมชน|เลขที่แปลง|plotcode|plotid|plotno)$/,
    contractNo:/^(เลขที่สัญญา|เลขสัญญา|contractno|contractnumber)$/,
    projectCode:/^(รหัสโครงการ|projectcode|projectid)$/,
    boq:/^(boq|ยอดboq|งบประมาณboq|มูลค่าboq|budget|budgetboq)$/,
    paid:/^(apสะสม|ยอดapสะสม|ยอดจ่ายสะสม|จ่ายสะสม|cumulativeap|cumulativepaid|paidcumulative)$/
  };
  const portfolios = [
    ['forest65_external','ป่าบุคคลภายนอก ปี 2565'],
    ['forest66_community','ป่าชุมชน ปี 2566'],
    ['forest66_external','ป่าบุคคลภายนอก ปี 2566']
  ];
  const state = {files:[],active:-1,baseline:null,baselineMessage:'ยังไม่โหลดข้อมูลฐาน',report:null};
  const txt = value => value == null ? '' : String(value).trim();
  const norm = value => txt(value).toLowerCase().replace(/[\s()[\]._\-:\/]/g,'').replace(/[\u200b-\u200d]/g,'');
  const node = (tag,text,cls) => {const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const money = value => value == null ? 'ไม่ทราบ' : new Intl.NumberFormat('th-TH',{maximumFractionDigits:2}).format(value);
  const show = (text,error=false) => {for(const id of ['localStatus','message']){const e=$(id);if(e){e.textContent=text;e.classList.toggle('error',error);}}};
  const empty = e => e.replaceChildren();
  const filename = name => txt(name).slice(0,240);
  const cell = (sheet,row,col) => sheet.worksheet[XLSX.utils.encode_cell({r:row,c:col})];
  const val = (sheet,row,col) => col < 0 ? null : (sheet.rows[row]||[])[col];
  const nonempty = row => Object.values(row).some(v => txt(v) !== '');
  const colName = col => XLSX.utils.encode_col(col);
  // Excel's core document properties describe creation time; never substitute upload or modification time.
  function parseCreationDate(value){
    if(value == null || value === '')return null;
    if(!(value instanceof Date) && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(value.trim())))return null;
    const date=value instanceof Date ? value : new Date(value.trim());
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const formatCreated = value => new Intl.DateTimeFormat('th-TH',{
    day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',
    hourCycle:'h23',timeZone:'Asia/Bangkok',calendar:'buddhist',numberingSystem:'latn'
  }).format(new Date(value))+' น.';
  function renderCreationDate(){
    const file=chosenFile(),info=$('excelCreatedInfo');
    if(!info)return;
    info.hidden=!file;
    if(!file)return;
    $('excelCreatedDate').textContent=file.createdDate?formatCreated(file.createdDate):'ไม่พบข้อมูลใน Excel';
    $('excelCreatedFile').textContent=file.name;
    info.title='วันที่สร้างจากคุณสมบัติภายในไฟล์ Excel ไม่ใช่วันที่อัปโหลดหรือวันที่แก้ไขล่าสุด';
  }

  async function readWorkbook(file) {
    if (!window.XLSX || typeof XLSX.read !== 'function') throw Error('โหลดตัวอ่าน Excel ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตและรีเฟรชหน้านี้');
    if (!/\.xlsx$/i.test(file.name) || file.size > MAX_BYTES || !file.size) throw Error('รองรับ .xlsx ที่มีข้อมูล ขนาดไม่เกิน 20 MiB ต่อไฟล์');
    // Give the upload/progress message a chance to paint before parsing.
    await yieldToBrowser();
    const buffer = await file.arrayBuffer();
    const magic = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
    if(magic.length < 4 || magic[0] !== 0x50 || magic[1] !== 0x4b || magic[2] !== 3 || magic[3] !== 4){
      throw Error('ไฟล์นี้ไม่ใช่ .xlsx ที่อ่านได้ หรือถูกเข้ารหัสด้วยรหัสผ่าน');
    }
    const workbook = XLSX.read(buffer,{type:'array',cellFormula:true,cellHTML:false,bookVBA:false,bookDeps:false,cellDates:false});
    if (!workbook.SheetNames.length || workbook.SheetNames.length > 40) throw Error('จำนวน Worksheet ไม่ถูกต้องหรือมากกว่า 40 ชีต');
    const sheets = [];
    let totalCells=0,totalRows=0;
    for (const name of workbook.SheetNames) {
      const source=workbook.Sheets[name];
      if(!source || typeof source !== 'object')throw Error('ไม่พบข้อมูล Worksheet: '+name);
      // Sparse row/column maps preserve real Excel addresses, including large empty gaps.
      // Never iterate or allocate A1..lastRow/lastCol from !ref.
      const worksheet=Object.create(null),rows=Object.create(null),columns=new Set();
      let formulas=0,populatedCells=0,visited=0;
      for(const key of Object.keys(source)){
        if(key[0]==='!')continue;
        if(++visited % 10000 === 0)await yieldToBrowser();
        const entry=source[key];
        const hasFormula=entry && typeof entry.f === 'string';
        const hasValue=entry && entry.v != null && !(typeof entry.v === 'string' && entry.v.trim()==='');
        if(!hasFormula && !hasValue)continue; // Do not count style-only cells or empty strings.
        if(!/^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(key))throw Error('ตำแหน่งเซลล์ไม่ถูกต้องใน Worksheet: '+name);
        const {r,c}=XLSX.utils.decode_cell(key);
        if(r>=1048576 || c>=16384)throw Error('ตำแหน่งเซลล์เกินขอบเขต Excel: '+name+'!'+key);
        if(++totalCells>MAX_DATA_CELLS)throw Error('ไฟล์มีข้อมูลจริงเกิน 1,000,000 เซลล์ (ไม่นับช่องว่าง) กรุณาแบ่งไฟล์ก่อนตรวจ');
        if(!rows[r]){
          rows[r]=Object.create(null);
          if(++totalRows>MAX_DATA_ROWS)throw Error('ไฟล์มีแถวข้อมูลจริงเกิน 100,000 แถว กรุณาแบ่งไฟล์ก่อนตรวจ');
        }
        columns.add(c);
        if(columns.size>MAX_DATA_COLS)throw Error('Worksheet "'+name+'" มีคอลัมน์ข้อมูลจริงเกิน 1,024 คอลัมน์');
        worksheet[key]=entry;
        if(hasValue)rows[r][c]=entry.v;
        if(hasFormula)formulas++;
        populatedCells++;
      }
      const rowIndices=Object.keys(rows).map(Number).sort((a,b)=>a-b);
      const columnIndices=[...columns].sort((a,b)=>a-b);
      const lastRow=rowIndices.at(-1)??0,lastCol=columnIndices.at(-1)??0;
      sheets.push({name,worksheet,rows,rowIndices,columnIndices,lastRow,lastCol,
        nonemptyRows:rowIndices.length,formulaCount:formulas,populatedCells});
    }
    return {name:filename(file.name),size:file.size,sheets,totalCells,createdDate:parseCreationDate(workbook.Props?.CreatedDate)};
  }

  function guessHeader(sheet) {
    let best=0,score=-1;
    for (const r of sheet.rowIndices.slice(0,35)) {
      const row=sheet.rows[r]||[];
      const n=FIELDS.filter(f=>Object.values(row).some(v=>PATTERNS[f].test(norm(v)))).length;
      if (n>score && nonempty(row)) {score=n;best=r;}
    }
    return best;
  }
  function guessColumns(sheet,header) {
    const cols={};
    const row=sheet.rows[header]||[];
    for (const f of FIELDS) cols[f]=sheet.columnIndices.find(c=>PATTERNS[f].test(norm(row[c])))??-1;
    return cols;
  }
  function chosenFile(){return state.files[state.active];}
  function chosenSheet(){const f=chosenFile();return f&&f.sheets.find(s=>s.name===f.selectedSheet);}
  function invalidate(){state.report=null;$('localResult').hidden=true;$('downloadLocal').disabled=true;}
  function makeSelect(options,selected,onChange){
    const e=node('select');
    for (const [value,label] of options){const opt=node('option',label);opt.value=String(value);e.append(opt);}
    e.value=String(selected);
    e.addEventListener('change',()=>onChange(e.value));
    return e;
  }
  function makeField(label,child){
    const wrap=node('label');wrap.className='local-field';
    wrap.append(node('span',label),child);
    return wrap;
  }
  function renderFiles() {
    const area=$('uploads');empty(area);
    for(let i=0;i<state.files.length;i++){
      const f=state.files[i],card=node('div',undefined,'filecard'),meta=node('div');
      meta.append(node('strong',f.name),node('small',f.sheets.length+' ชีต · '+money(f.size/1024/1024)+' MiB · เก็บเฉพาะในหน้านี้'));
      const actions=node('div',undefined,'inline');
      const inspect=node('button','ตรวจไฟล์','secondary');
      inspect.type='button';
      inspect.onclick=()=>{state.active=i;invalidate();renderInspection();};
      const remove=node('button','นำออก','quiet');
      remove.type='button';
      remove.onclick=()=>{state.files.splice(i,1);state.active=state.files.length?Math.min(i,state.files.length-1):-1;invalidate();renderFiles();renderInspection();};
      actions.append(inspect,remove);card.append(meta,actions);area.append(card);
    }
  }
  function renderInspection(){
    const panel=$('localReview'),file=chosenFile();
    renderCreationDate();
    panel.hidden=!file;
    if(!file)return;
    $('localName').textContent=file.name;
    const overview=$('localSheets');empty(overview);
    for (const s of file.sheets) {
      const chip=node('span',s.name+' · '+s.nonemptyRows.toLocaleString('th-TH')+' แถว · '+s.columnIndices.length+' คอลัมน์ · '+s.populatedCells.toLocaleString('th-TH')+' เซลล์ข้อมูล'+(s.formulaCount?' · สูตร '+s.formulaCount:''));
      chip.className='local-chip';overview.append(chip);
    }
    const s=chosenSheet(),controls=$('localControls');empty(controls);
    const sheetOptions=file.sheets.map(x=>[x.name,x.name]);
    const sheetSelect=makeSelect(sheetOptions,file.selectedSheet,v=>{file.selectedSheet=v;file.header=guessHeader(chosenSheet());file.cols=guessColumns(chosenSheet(),file.header);invalidate();renderInspection();});
    controls.append(makeField('Worksheet',sheetSelect));
    const header=node('input');header.type='number';header.min='1';header.max=String(Math.max(s.lastRow+1,1));header.value=String(file.header+1);
    header.onchange=()=>{file.header=Math.max(0,Math.min(s.lastRow,Math.floor(Number(header.value)||1)-1));file.cols=guessColumns(s,file.header);invalidate();renderInspection();};
    controls.append(makeField('แถวหัวตาราง',header));
    controls.append(makeField('ประเภทโครงการ',makeSelect(portfolios,file.portfolio,v=>{file.portfolio=v;invalidate();})));
    const years=Array.from({length:10},(_,i)=>[String(i+1),'ปีดำเนินงาน '+(i+1)]);
    controls.append(makeField('ปีดำเนินงาน (เลือกเอง)',makeSelect(years,file.year,v=>{file.year=Number(v);invalidate();})));
    const mapping=$('localMapping');empty(mapping);
    const headerValues=s.rows[file.header]||[];
    const available=s.columnIndices.map(c=>[String(c),colName(c)+' · '+(txt(headerValues[c])||'(ไม่มีหัวคอลัมน์)')]);
    for (const f of FIELDS) {
      const sel=makeSelect([['-1','— ไม่ใช้ —'],...available],file.cols[f],v=>{file.cols[f]=Number(v);invalidate();});
      mapping.append(makeField(LABELS[f],sel));
    }
    const preview=$('localSample');empty(preview);
    let count=0;
    for(const i of s.rowIndices){
      if(count>=8)break;
      const row=s.rows[i]||[];if(!nonempty(row))continue;
      const item=node('div',undefined,'local-sample-row');
      item.append(node('strong','แถว '+(i+1)));
      item.append(node('span',s.columnIndices.slice(0,12).map(c=>colName(c)+': '+txt(row[c]).slice(0,70)).join(' | ')));
      preview.append(item);count++;
    }
    if(!count) preview.textContent='ชีตนี้ไม่มีข้อมูล';
    show('อ่านไฟล์ใน Browser แล้ว ยังไม่ได้เปลี่ยน BOQ Dashboard');
  }

  function baseIndex(){
    const map=new Map();
    if(!state.baseline||!Array.isArray(state.baseline.plots))return map;
    for (const p of state.baseline.plots) {
      if(!p.plotCode||!p.portfolio)continue;
      for(const y of (p.years||[])) {
        if(!y||!y.year)continue;
        map.set(p.portfolio+'|'+p.plotCode+'|'+y.year,{plot:p,year:y});
      }
    }
    return map;
  }
  function numeric(sheet,row,col) {
    const c=cell(sheet,row,col),v=val(sheet,row,col);
    if (c && c.f !== undefined) throw Error('พบสูตร Excel ที่ '+sheet.name+'!'+colName(col)+(row+1)+' — ไม่ใช้ Cached Value เพื่อสรุปยอด');
    if (typeof v !== 'number' || !Number.isFinite(v) || v<0 || v>1e12) throw Error('ยอดเงินต้องเป็นตัวเลขจริงที่ '+sheet.name+'!'+colName(col)+(row+1));
    return Math.round(v*100)/100;
  }
  function inspectMapping(){
    const f=chosenFile(),s=chosenSheet();
    if(!f||!s)throw Error('กรุณาเลือกไฟล์และชีตก่อน');
    if(f.cols.plotCode<0 || (f.cols.boq<0&&f.cols.paid<0))throw Error('ต้องกำหนดคอลัมน์รหัสแปลงและยอด BOQ หรือ AP อย่างน้อยหนึ่งรายการ');
    const mapped=FIELDS.filter(x=>f.cols[x]>=0);
    if(new Set(mapped.map(x=>f.cols[x])).size!==mapped.length)throw Error('ห้ามกำหนดคอลัมน์เดียวกันให้หลายความหมาย');
    const issues=[],records=[],seen=new Set();
    const baseline=baseIndex(),covered=new Set();
    let boqTotal=0,paidTotal=0;
    for(const r of s.rowIndices){
      if(r<=f.header)continue;
      const code=txt(val(s,r,f.cols.plotCode));
      const hasMoney=['boq','paid'].some(x=>f.cols[x]>=0&&txt(val(s,r,f.cols[x]))!=='');
      if(!code){if(hasMoney&&issues.length<25)issues.push('แถว '+(r+1)+' มียอดเงินแต่ไม่มีรหัสแปลง (อาจเป็นแถวรวม)');continue;}
      if(/^(รวม|ยอดรวม|รวมทั้งสิ้น|total|subtotal|grandtotal)$/.test(norm(code))){issues.push('ข้ามแถวรวมที่ '+(r+1)+' — ต้องตรวจ Control Total จากต้นฉบับ');continue;}
      if(!hasMoney)continue;
      if(!/^[A-Za-z0-9ก-๙][A-Za-z0-9ก-๙()._\/\- ]{0,90}$/.test(code)){
        if(issues.length<25)issues.push('รหัสแปลงที่แถว '+(r+1)+' มีอักขระที่ไม่รองรับ');continue;
      }
      if(seen.has(code)){issues.push('รหัสแปลงซ้ำในชีต: '+code);continue;}
      seen.add(code);
      let boq=null,paid=null;
      try{
        if(f.cols.boq>=0)boq=numeric(s,r,f.cols.boq);
        if(f.cols.paid>=0)paid=numeric(s,r,f.cols.paid);
      }catch(err){issues.push(err.message);continue;}
      if(boq!==null)boqTotal+=boq;
      if(paid!==null)paidTotal+=paid;
      const key=f.portfolio+'|'+code+'|'+f.year;
      covered.add(key);
      const prior=baseline.get(key);
      const project=txt(val(s,r,f.cols.projectCode));
      const contract=txt(val(s,r,f.cols.contractNo));
      if(baseline.size && !prior){issues.push('ไม่พบรหัสแปลงในฐานข้อมูลเดิม: '+code);continue;}
      if(prior && f.cols.projectCode>=0 && project!==txt(prior.plot.projectCode))issues.push('รหัสโครงการไม่ตรง: '+code);
      const existingContract=prior&&(prior.year.contractNo!==undefined?prior.year.contractNo:prior.plot.contractNo);
      if(prior && f.cols.contractNo>=0 && contract!==txt(existingContract))issues.push('เลขที่สัญญาไม่ตรง: '+code);
      const previous=prior?{boq:Number(prior.year.boq),paid:Number(prior.year.paid)}:null;
      records.push({plotCode:code,portfolio:f.portfolio,year:f.year,row:r+1,projectCode:project,contractNo:contract,before:previous,after:{boq:boq===null?previous?.boq??null:boq,paid:paid===null?previous?.paid??null:paid},changed:previous?((boq!==null&&Math.abs(boq-previous.boq)>.005)||(paid!==null&&Math.abs(paid-previous.paid)>.005)):null});
    }
    if(records.length===0)issues.push('ไม่พบข้อมูลแปลงที่อ่านยอดได้');
    if(baseline.size) {
      const expected=[...baseline.keys()].filter(k=>k.startsWith(f.portfolio+'|')&&k.endsWith('|'+f.year));
      const missing=expected.filter(k=>!covered.has(k));
      if(missing.length)issues.push('ขอบเขตไม่ครบ: มี '+covered.size+' จาก '+expected.length+' รายการในฐานข้อมูลเดิม (ขาด '+missing.length+')');
    } else issues.push('ไม่มีฐานข้อมูล BOQ เดิมให้เทียบ — ผลรวมเป็นเพียงตัวเลขเบื้องต้น');
    if(f.cols.projectCode<0||f.cols.contractNo<0)issues.push('ยังไม่ได้ตรวจตัวตนรหัสโครงการและเลขที่สัญญาครบ');
    issues.push('ต้องตรวจปีดำเนินงาน แหล่งข้อมูล และ Control Total กับผู้รับผิดชอบก่อนเผยแพร่');
    return {mode:'LOCAL_REVIEW_ONLY',status:'REVIEW_REQUIRED',file:f.name,sheet:s.name,headerRow:f.header+1,portfolio:f.portfolio,year:f.year,
      mapping:Object.fromEntries(mapped.map(x=>[x,colName(f.cols[x])])),
      summary:{records:records.length,changed:records.filter(x=>x.changed).length,boqTotal:Math.round(boqTotal*100)/100,paidTotal:Math.round(paidTotal*100)/100,baselineAvailable:!!baseline.size},
      issues,records,generatedAt:new Date().toISOString()};
  }

  function renderReport(report){
    const root=$('localResult');root.hidden=false;
    $('localSummary').textContent='ตรวจพบ '+report.summary.records+' รายการ · BOQ '+money(report.summary.boqTotal)+' บาท · AP '+money(report.summary.paidTotal)+' บาท'
      +(report.summary.baselineAvailable?' · เปลี่ยน '+report.summary.changed+' รายการ':' · ยังเปรียบเทียบฐานเดิมไม่ได้');
    const problems=$('localIssues');empty(problems);
    for(const issue of report.issues.slice(0,35)) problems.append(node('div','• '+issue));
    if(report.issues.length>35)problems.append(node('div','แสดง '+35+' จาก '+report.issues.length+' ประเด็น'));
    const table=$('localDiff');empty(table);
    for (const r of report.records.filter(x=>x.changed).slice(0,150)){
      const tr=node('tr');
      for (const v of [r.plotCode,money(r.before?.boq)+' → '+money(r.after.boq),money(r.before?.paid)+' → '+money(r.after.paid)])tr.append(node('td',v));
      table.append(tr);
    }
    $('downloadLocal').disabled=false;
  }
  function downloadJSON(report){
    const obj=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(obj),a=node('a');
    a.href=url;a.download='boq-review-'+new Date().toISOString().slice(0,10)+'.json';
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  async function init(){
    $('localReview').hidden=true;
    const panel=$('localReview');
    panel.querySelector('#runLocal').addEventListener('click',()=>{
      try{const report=inspectMapping();state.report=report;renderReport(report);show('ตรวจสอบเบื้องต้นแล้ว — ยังไม่เผยแพร่หรือแก้ข้อมูล Dashboard');}
      catch(err){invalidate();show(err.message,true);}
    });
    $('downloadLocal').onclick=()=>{if(state.report)downloadJSON(state.report);};
    try {
      const response=await fetch('../boq/finance-data.json',{cache:'no-store'});
      if(!response.ok)throw Error('HTTP '+response.status);
      const data=await response.json();
      if(!Array.isArray(data.plots))throw Error('รูปแบบข้อมูลฐานไม่ถูกต้อง');
      state.baseline=data;state.baselineMessage='โหลดฐาน BOQ เดิมสำหรับเปรียบเทียบได้';
    }catch(_){state.baselineMessage='ไม่พบไฟล์ฐาน BOQ สำหรับเปรียบเทียบบน GitHub Pages (ยังตรวจโครงสร้าง Excel ได้)';}
    $('localBaseline').textContent=state.baselineMessage;
  }
  async function upload(files) {
    if(state.files.length+files.length>MAX_FILES)throw Error('หนึ่งรอบรองรับไม่เกิน 8 ไฟล์');
    for(const file of files){
      if(!/\.xlsx$/i.test(file.name)||!file.size||file.size>MAX_BYTES)throw Error('รองรับไฟล์ .xlsx ขนาดไม่เกิน 20 MiB ต่อไฟล์: '+filename(file.name));
      if(state.files.some(x=>x.name===file.name&&x.size===file.size))continue;
      show('กำลังอ่าน '+filename(file.name)+' ใน Browser...');
      const item=await readWorkbook(file);
      if(state.files.reduce((sum,f)=>sum+f.totalCells,0)+item.totalCells>MAX_SESSION_CELLS){
        throw Error('รอบนี้มีข้อมูลรวมเกิน 2,000,000 เซลล์ กรุณานำไฟล์เก่าออกก่อนเพิ่มไฟล์ใหม่');
      }
      const sheet=item.sheets.find(s=>s.nonemptyRows>0)||item.sheets[0];
      item.selectedSheet=sheet.name;item.header=guessHeader(sheet);item.cols=guessColumns(sheet,item.header);
      item.portfolio=portfolios[0][0];item.year=3;
      state.files.push(item);state.active=state.files.length-1;
      invalidate();renderFiles();renderInspection();
    }
    show('เลือกไฟล์สำเร็จ อ่าน Excel ในเครื่องแล้ว — ยังไม่บันทึกไฟล์ขึ้น Server');
  }
  window.BOQPublicPreview={init,upload,readWorkbook,inspectMapping};
})();

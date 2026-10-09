/* Read-only XLSX decoder using browser ZIP decompression and XML parsing. No CDN, macros or formula execution. */
(() => {
  'use strict';
  const MAX_FILE = 20 * 1024 * 1024, MAX_UNPACKED = 160 * 1024 * 1024;
  const MAX_CELLS = 1000000, MAX_ROWS = 100000;
  const enc = new TextDecoder('utf-8', {fatal:true});
  const fail = message => { throw new Error(message); };
  const pause = () => new Promise(resolve => setTimeout(resolve, 0));
  const list = (node, name) => [...node.getElementsByTagNameNS('*', name)];
  const text = (node, name) => list(node, name)[0]?.textContent ?? '';
  function xml(bytes) {
    const source = enc.decode(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) fail('ไฟล์ Excel มี XML ที่ไม่รองรับ');
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) fail('ข้อมูลภายใน Excel ไม่สมบูรณ์ กรุณาบันทึกไฟล์ใหม่จาก Excel');
    return doc;
  }
  function colIndex(ref) {
    const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(ref);
    if (!match) fail('ตำแหน่งเซลล์ใน Excel ไม่ถูกต้อง');
    let col=0;
    for (const c of match[1]) col=col*26+c.charCodeAt(0)-64;
    if (col>16384 || +match[2]>1048576) fail('ตำแหน่งเซลล์เกินขอบเขต Excel');
    return {r:+match[2]-1,c:col-1};
  }
  function crc32(bytes) {
    let crc=0xffffffff;
    for (let i=0;i<bytes.length;i++) {
      crc ^= bytes[i];
      for(let j=0;j<8;j++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);
    }
    return (crc^0xffffffff)>>>0;
  }
  function archive(buffer) {
    const v=new DataView(buffer), bytes=new Uint8Array(buffer), entries=new Map();
    if(bytes.length<22 || v.getUint32(0,true)!==0x04034b50) fail('กรุณาใช้ไฟล์ .xlsx ที่ไม่ได้ตั้งรหัสผ่าน');
    let end=-1;
    for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){
      if(v.getUint32(i,true)===0x06054b50 && i+22+v.getUint16(i+20,true)===bytes.length){end=i;break;}
    }
    if(end<0) fail('ไฟล์ Excel ไม่สมบูรณ์หรือเสียหาย');
    if(v.getUint16(end+4,true)||v.getUint16(end+6,true)) fail('ไม่รองรับไฟล์ Excel แบบแยกชุด');
    const count=v.getUint16(end+10,true), cdSize=v.getUint32(end+12,true), offset=v.getUint32(end+16,true);
    if(count>3000 || count!==v.getUint16(end+8,true) || offset+cdSize>end) fail('โครงสร้างไฟล์ Excel ไม่ถูกต้อง');
    let p=offset, unpacked=0;
    for(let i=0;i<count;i++) {
      if(p+46>end || v.getUint32(p,true)!==0x02014b50) fail('รายการไฟล์ภายใน Excel ไม่สมบูรณ์');
      const flags=v.getUint16(p+8,true), method=v.getUint16(p+10,true), crc=v.getUint32(p+16,true);
      const size=v.getUint32(p+20,true), output=v.getUint32(p+24,true), n=v.getUint16(p+28,true), extra=v.getUint16(p+30,true), comment=v.getUint16(p+32,true), start=v.getUint32(p+42,true);
      if(p+46+n+extra+comment>end) fail('ข้อมูล ZIP ภายใน Excel ไม่สมบูรณ์');
      const name=enc.decode(bytes.subarray(p+46,p+46+n));
      if(name.startsWith('/')||name.split('/').includes('..')||name.includes('\\')||entries.has(name)) fail('เส้นทางไฟล์ภายใน Excel ไม่ถูกต้อง');
      if(flags&1) fail('กรุณาใช้ Excel ที่ไม่ได้ตั้งรหัสผ่าน');
      if(![0,8].includes(method)) fail('วิธีบีบอัด Excel นี้ยังไม่รองรับ');
      if(/vbaproject|activex\/|embeddings\//i.test(name)) fail('กรุณาส่งออกเป็น .xlsx ที่ไม่มีแมโครหรือไฟล์ฝัง');
      unpacked+=output;
      if(unpacked>MAX_UNPACKED || output>80*1024*1024) fail('ข้อมูลภายใน Excel ใหญ่เกินขอบเขตที่อ่านในเครื่องได้');
      entries.set(name,{name,flags,method,crc,size,output,start});
      p+=46+n+extra+comment;
    }
    if(p!==offset+cdSize) fail('รายการ ZIP ภายใน Excel ไม่ตรงกัน');
    async function get(name) {
      const e=entries.get(name);
      if(!e) fail('ไม่พบส่วนข้อมูลที่จำเป็นใน Excel: '+name);
      const s=e.start;
      if(s+30>offset || v.getUint32(s,true)!==0x04034b50) fail('ข้อมูลภายใน Excel ไม่สมบูรณ์');
      const n=v.getUint16(s+26,true), extra=v.getUint16(s+28,true), from=s+30+n+extra;
      if(from+e.size>offset || enc.decode(bytes.subarray(s+30,s+30+n))!==name) fail('ตำแหน่งข้อมูล Excel ไม่ตรงกัน');
      let result;
      if(e.method===0)result=bytes.slice(from,from+e.size);
      else {
        let stream;
        try{stream=new Blob([bytes.subarray(from,from+e.size)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));}
        catch(_){fail('กรุณาเปิดด้วย Chrome, Edge หรือ Safari รุ่นที่รองรับการอ่านไฟล์ Excel นี้');}
        const reader=stream.getReader(),chunks=[];
        let len=0;
        try {
          while(true){const {done,value}=await reader.read();if(done)break;len+=value.length;
            if(len>e.output || len>MAX_UNPACKED){await reader.cancel();fail('ขนาดข้อมูลใน Excel ไม่ถูกต้อง');}chunks.push(value);}
        } finally {reader.releaseLock();}
        result=new Uint8Array(len);let at=0;for(const b of chunks){result.set(b,at);at+=b.length;}
      }
      if(result.length!==e.output || crc32(result)!==e.crc) fail('ตรวจพบข้อมูล Excel เสียหาย กรุณาส่งออกไฟล์ใหม่');
      return result;
    }
    return {entries,get};
  }
  function targetPath(target) {
    const parts=(target.startsWith('/')?target.slice(1):'xl/'+target).split('/'),out=[];
    for(const part of parts){if(part==='..'){if(!out.length)fail('เส้นทางชีตไม่ถูกต้อง');out.pop();}else if(part&&part!=='.')out.push(part);}
    const path=out.join('/');
    if(!path.startsWith('xl/')||path.includes('\\'))fail('เส้นทางชีตไม่ถูกต้อง');
    return path;
  }
  async function read(file, onProgress=()=>{}) {
    if(!/\.xlsx$/i.test(file.name)||!file.size||file.size>MAX_FILE) fail('กรุณาเลือกไฟล์ .xlsx ขนาดไม่เกิน 20 MB');
    onProgress('กำลังอ่าน Excel…');await pause();
    const buffer=await file.arrayBuffer(),zip=archive(buffer);
    const sourceHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');
    const main=xml(await zip.get('xl/workbook.xml'));
    const rels=xml(await zip.get('xl/_rels/workbook.xml.rels'));
    const paths=new Map(list(rels,'Relationship').filter(x=>x.getAttribute('TargetMode')!=='External').map(x=>[x.getAttribute('Id'),targetPath(x.getAttribute('Target')||'')]));
    const specs=list(main,'sheet');
    if(!specs.length||specs.length>40) fail('ไฟล์นี้ไม่มีชีตข้อมูล หรือมีจำนวนชีตเกิน 40 ชีต');
    const shared=[];
    if(zip.entries.has('xl/sharedStrings.xml')) {
      const strings=xml(await zip.get('xl/sharedStrings.xml'));
      for(const item of list(strings,'si'))shared.push(list(item,'t').map(x=>x.textContent).join(''));
    }
    let createdAt=null;
    if(zip.entries.has('docProps/core.xml')) {
      const created=text(xml(await zip.get('docProps/core.xml')),'created'),date=new Date(created);
      if(created&&Number.isFinite(date.getTime()))createdAt=date.toISOString();
    }
    const date1904=['1','true'].includes(list(main,'workbookPr')[0]?.getAttribute('date1904'));
    const sheets=[];let populated=0,rowCount=0;
    for(const spec of specs) {
      const name=spec.getAttribute('name')||'Sheet',id=[...spec.attributes].find(a=>a.localName==='id')?.value;
      if(!paths.has(id))fail('ไม่พบชีต '+name);
      onProgress('กำลังอ่านข้อมูล '+name+'…');await pause();
      const sheet=xml(await zip.get(paths.get(id))),rows=new Map();
      let visited=0;
      for(const c of list(sheet,'c')) {
        if(++visited%12000===0){onProgress('กำลังอ่าน '+name+'… '+populated.toLocaleString('th-TH')+' เซลล์');await pause();}
        const type=c.getAttribute('t')||'n',formula=list(c,'f').length>0;
        let value=text(c,'v');
        if(type==='s'){
          const i=Number(value);if(!Number.isInteger(i)||i<0||i>=shared.length)fail('ข้อความใน Excel ไม่สมบูรณ์');value=shared[i];
        }else if(type==='inlineStr')value=list(c,'t').map(x=>x.textContent).join('');
        else if(type==='b')value=value==='1';
        else if(type==='n'&&value!==''){value=Number(value);if(!Number.isFinite(value))fail('ตัวเลขใน Excel ไม่ถูกต้อง');}
        if((value==null||(typeof value==='string'&&value.trim()===''))&&!formula)continue;
        if(++populated>MAX_CELLS)fail('ไฟล์มีข้อมูลจริงเกิน 1,000,000 เซลล์');
        const {r,c:col}=colIndex(c.getAttribute('r')||'');
        if(!rows.has(r)){rows.set(r,new Map());if(++rowCount>MAX_ROWS)fail('ไฟล์มีแถวข้อมูลจริงเกิน 100,000 แถว');}
        if(rows.get(r).has(col))fail('มีเซลล์ซ้ำใน '+name);
        rows.get(r).set(col,{value,formula,type});
      }
      sheets.push({name,rows});
    }
    return {name:file.name,size:file.size,sourceHash,createdAt,date1904,sheets,populatedCells:populated};
  }
  window.BOQXlsx={read};
})();

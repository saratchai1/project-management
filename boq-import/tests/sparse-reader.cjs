// Manual regression tests: node boq-import/tests/sparse-reader.cjs
// SheetJS decoding is stubbed here; this tests the app's post-decode guard/normalizer and UI state.
// An optional independently extracted OOXML fixture can be passed with --fixture /private/path.json.
// Never commit company workbook bytes or the extracted fixture.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'../public-preview.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function encode_col(n){let s='';do{s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)-1;}while(n>=0);return s;}
function decode_cell(address){const [,s,row]=/^([A-Z]+)(\d+)$/.exec(address);return{c:[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1,r:Number(row)-1};}
const utils={encode_col,decode_cell,encode_cell:({r,c})=>encode_col(c)+(r+1),decode_range:ref=>({s:decode_cell(ref.split(':')[0]),e:decode_cell(ref.split(':').at(-1))})};
function fixture(sheet,props){return{SheetNames:['Year 3'],Sheets:{'Year 3':sheet},Props:props};}
function harness(wb,code=script){
 const elements={};
 class Element{constructor(){this.children=[];this.hidden=false;this.disabled=false;this.value='';this.textContent='';this.handlers={};this.classList={toggle(){}};}append(...x){this.children.push(...x);}replaceChildren(...x){this.children=x;}addEventListener(k,f){this.handlers[k]=f;}querySelector(s){return elements[s.slice(1)];}}
 for(const m of html.matchAll(/id="([^"]+)"/g))elements[m[1]]=new Element();
 const ctx={window:{},document:{getElementById:id=>elements[id],createElement:()=>new Element()},XLSX:{utils,read:()=>wb},fetch:async()=>({ok:false,status:404}),setTimeout,Uint8Array,Intl,Date,console};
 ctx.window.XLSX=ctx.XLSX;vm.runInNewContext(code,ctx);
 const file={name:'synthetic.xlsx',size:100,arrayBuffer:async()=>new Uint8Array([0x50,0x4b,3,4]).buffer};
 return{api:ctx.window.BOQPublicPreview,file,elements};
}
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
 await test('large used rectangle with few real cells and style-only tail',async()=>{
  const {api,file}=harness(fixture({'!ref':'A1:XFD1048576',A1:{v:'plotCode'},B1:{v:'BOQ'},A2:{v:'TEST-1'},B2:{v:0},XFD1048576:{s:1}}));
  const r=await api.readWorkbook(file),s=r.sheets[0];assert.equal(r.totalCells,4);assert.equal(s.nonemptyRows,2);assert.equal(s.lastRow,1);assert.equal(s.lastCol,1);assert.equal(s.rows[1][1],0);
 });
 await test('real cells beyond old row/column caps preserve absolute addresses',async()=>{
  const {api,file}=harness(fixture({'!ref':'B40001:XFD1000000',B40001:{v:'plotCode'},XFD40001:{v:'BOQ'},B1000000:{v:'TEST-1'},XFD1000000:{v:123}}));
  const s=(await api.readWorkbook(file)).sheets[0];assert.deepEqual(Array.from(s.rowIndices),[40000,999999]);assert.deepEqual(Array.from(s.columnIndices),[1,16383]);assert.equal(s.rows[999999][16383],123);
  await api.upload([file]);const report=api.inspectMapping();assert.equal(report.summary.records,1);assert.equal(report.summary.boqTotal,123);assert.equal(report.records[0].row,1000000);
 });
 await test('zero, false and formulas count; blanks and styles do not',async()=>{
  const {api,file}=harness(fixture({'!ref':'A1:H1',A1:{v:0},B1:{v:false},C1:{f:'SUM(A1)',v:0},D1:{f:'1+1'},E1:{v:''},F1:{v:' '},G1:{v:null},H1:{s:1}}));
  const r=await api.readWorkbook(file);assert.equal(r.totalCells,4);assert.equal(r.sheets[0].formulaCount,2);
 });
 await test('normal mapping summary, formula rejection, metadata and remove state',async()=>{
  const wb=fixture({'!ref':'A1:C3',A1:{v:'plotCode'},B1:{v:'BOQ'},C1:{v:'cumulativeAP'},A2:{v:'TEST-1'},B2:{v:100},C2:{v:20},A3:{v:'TEST-2'},B3:{v:200},C3:{v:30}},{CreatedDate:'2026-10-08T10:15:00Z'});
  const {api,file,elements}=harness(wb);await api.init();await api.upload([file]);let r=api.inspectMapping();assert.equal(r.summary.boqTotal,300);assert.equal(r.summary.paidTotal,50);assert.equal(elements.excelCreatedDate.textContent,'08/10/2569 17:15 น.');assert.equal(elements.localReview.hidden,false);
  wb.Sheets['Year 3'].B2.f='99+1';r=api.inspectMapping();assert.ok(r.issues.some(i=>i.includes('สูตร Excel')));
  elements.uploads.children[0].children[1].children[1].onclick();assert.equal(elements.excelCreatedInfo.hidden,true);
 });
 await test('invalid file rejected then retry works without stale error banner',async()=>{
  const {api,file,elements}=harness(fixture({'!ref':'A1',A1:{v:'data'}}));
  await assert.rejects(()=>api.readWorkbook({...file,arrayBuffer:async()=>new Uint8Array([1,2,3,4]).buffer}),/ไม่ใช่ .xlsx/);
  await api.upload([file]);assert.ok(elements.message.textContent.includes('เลือกไฟล์สำเร็จ'));
 });
 await test('actual data cell limit is bounded, never silently truncated',async()=>{
  const sheet={'!ref':'A1:ALL1001'};let n=0;
  outer:for(let r=0;r<1001;r++)for(let c=0;c<1000;c++){sheet[utils.encode_cell({r,c})]={v:1};if(++n===1000001)break outer;}
  const {api,file}=harness(fixture(sheet));await assert.rejects(()=>api.readWorkbook(file),/1,000,000/);
 });
 const fi=process.argv.indexOf('--fixture');
 if(fi>=0){
  const wb=JSON.parse(fs.readFileSync(process.argv[fi+1],'utf8'));
  const oi=process.argv.indexOf('--old-source');
  if(oi>=0)await test('reproduce original failure on real OOXML cell fixture',async()=>{const {api,file}=harness(wb,fs.readFileSync(process.argv[oi+1],'utf8'));await assert.rejects(()=>api.readWorkbook(file),/250,000/);});
  await test('real OOXML cells read completely, no data truncation',async()=>{
   const {api,file,elements}=harness(wb);const r=await api.readWorkbook(file);
   let expected=0;for(const s of Object.values(wb.Sheets))for(const [key,c] of Object.entries(s))if(!key.startsWith('!')&&(typeof c.f==='string'||(c.v!=null&&!(typeof c.v==='string'&&c.v.trim()===''))))expected++;
   assert.equal(r.totalCells,expected);assert.equal(r.sheets[0].nonemptyRows,5477);assert.equal(r.sheets[0].columnIndices.length,52);
   await api.upload([file]);assert.equal(elements.localReview.hidden,false);assert.equal(elements.localControls.children.length,4);assert.equal(elements.localMapping.children.length,5);assert.ok(elements.message.textContent.includes('สำเร็จ'));
   console.log(JSON.stringify({real_fixture:{totalCells:r.totalCells,rows:r.sheets[0].nonemptyRows,columns:r.sheets[0].columnIndices.length,createdDate:r.createdDate}}));
  });
 }
 console.log(`${passed} tests passed`);
})().catch(e=>{console.error(e);process.exit(1);});

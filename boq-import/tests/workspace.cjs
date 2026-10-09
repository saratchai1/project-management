/* Synthetic records only. Never commit company Excel or voucher fixtures. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{webcrypto,createHash}=require('node:crypto');
const sourcePath=path.join(__dirname,'../erp-adapter.js');
let source=fs.readFileSync(sourcePath,'utf8');
const original={maincode:'DEMO',glitemno:1,refcode:'TEST-A',proj_dpt:'1-STC',vchdate:'2026-10-05',vchno:'SYNTHETIC-001',remark:'สัญญา CONTRACT-1 ปีที่ 3',amtdr:100,amtcr:0,module:'AP',costcode:'S090002'};
const keys=['module','ac_code','recitemno','refcode','docno','docno_powo','costcode','refcode_proj','remark','proj_dpt'];
const key=JSON.stringify(['DEMO','SYNTHETIC-001','1']);
const sig=JSON.stringify([key,...keys.map(k=>String(original[k]??'')),original.vchdate,'10000','0']);
const digest=createHash('sha256').update(sig).digest('hex');
source=source.replace('apCount:3265','apCount:1').replace(/historyHash:'[a-f0-9]+'/,'historyHash:'+JSON.stringify(digest));
const context={window:{},crypto:webcrypto,TextEncoder,structuredClone};vm.createContext(context);vm.runInContext(source,context);
const api=context.window.BOQERP;
const amounts=()=>({boq_contract:100,pdd:0,vvb:0,survival:0,field_visit:0,community_fund:0,other:0});
const baseline={meta:{erpAsOf:api.reference.asOf,erpSourceSha256:api.reference.sourceHash},plots:[{plotCode:'1-STC',projectCode:'TEST',portfolio:'demo',contractNo:'CONTRACT-1',years:[{year:3,boq:500,paid:100,status:'partial'}]}],projectCodes:[{code:'TEST',portfolio:'demo',amounts:amounts(),totalAp:100}],portfolios:[{id:'demo',amounts:amounts(),totalAp:100,boqPaid:100}]};
const book=(values,name='synthetic.xlsx')=>{
  const headers=[...new Set(values.flatMap(Object.keys))],rows=new Map();
  rows.set(0,new Map(headers.map((k,i)=>[i,{value:k}])));
  values.forEach((r,i)=>rows.set(i+1,new Map(headers.map((k,j)=>[j,{value:r[k]}]))));
  return {name,sourceHash:name,date1904:false,createdAt:null,sheets:[{name:'Export',rows}]};
};
const paid=r=>r.data.plots[0].years[0].paid;
(async()=>{
  const first=await api.build(book([original]),baseline);assert.equal(paid(first),100);
  const corrected={...original,amtdr:120};
  const second=await api.build(book([corrected]),baseline,first);assert.equal(paid(second),120);assert.equal(second.summary.replaced,1);
  const repeat=await api.build(book([corrected]),baseline,second);assert.equal(paid(repeat),120);assert.equal(repeat.summary.unchanged,1);
  const addition={...original,glitemno:2,vchno:'SYNTHETIC-002',amtdr:30,vchdate:'2026-10-06'};
  const third=await api.build(book([addition]),baseline,repeat);assert.equal(paid(third),150);assert.equal(third.summary.added,1);
  const reverted=await api.build(book([original]),baseline,third);assert.equal(paid(reverted),130);
  const zero=await api.build(book([{...original,amtdr:0}]),baseline,first);assert.equal(paid(zero),0);
  await assert.rejects(()=>api.build(book([corrected]),baseline));
  await assert.rejects(()=>api.build(book([original,corrected]),baseline,first));
  await assert.rejects(()=>api.build(book([{...addition,refcode:'UNKNOWN-A'}]),baseline,first));
  assert.equal(paid(first),100);assert.equal(baseline.plots[0].years[0].paid,100);
  console.log('PASS: first upload, last-write-wins, duplicate, append, revert, zero, invalid seed, conflict, unknown project, atomicity');
})().catch(error=>{console.error(error);process.exitCode=1;});

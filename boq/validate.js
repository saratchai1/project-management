const fs=require('fs');
const vm=require('vm');
const zlib=require('zlib');
const cp=require('child_process');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};

for(const f of ['boq/data.js','boq/app.js']) cp.execFileSync(process.execPath,['--check',f],{stdio:'inherit'});

const html=fs.readFileSync('boq/index.html','utf8');
for(const f of ['data-01.js','data-02.js','data.js','app.js']) assert(html.includes(`src="${f}"`),`index.html does not load ${f}`);

const sandbox={window:{}};
vm.createContext(sandbox);
for(const f of ['boq/data-01.js','boq/data-02.js']) vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f});
const b64=sandbox.window.__FINANCE_B64||'';
assert(b64.length>1000,'compressed finance payload is missing/too small');
const data=JSON.parse(zlib.gunzipSync(Buffer.from(b64,'base64')).toString('utf8'));

assert(Array.isArray(data.portfolios)&&data.portfolios.length>=3,'portfolios missing');
assert(Array.isArray(data.projectCodes)&&data.projectCodes.length>0,'projectCodes missing');
assert(Array.isArray(data.plots)&&data.plots.length===160,`expected 160 BOQ master plots, got ${data.plots?.length}`);
assert(data.plots.every(p=>Array.isArray(p.years)&&p.years.length===10),'each plot must contain years 1-10');
assert(data.plots.every(p=>p.projectCode&&p.plotCode&&p.contractNo),'plot key fields missing');
assert(data.projectCodes.every(p=>p.code&&p.portfolio&&p.amounts),'project-code classification incomplete');

const boqTotal=data.plots.reduce((s,p)=>s+p.years.reduce((a,y)=>a+Number(y.boq||0),0),0);
assert(Math.abs(boqTotal-616601357.59025)<1,'10-year BOQ total does not reconcile');
for(const p of data.plots){
  for(const y of p.years){
    assert(Number.isFinite(Number(y.boq))&&Number.isFinite(Number(y.paid))&&Number.isFinite(Number(y.balance)),'non-numeric finance value');
    assert(Array.isArray(y.installments),'installment detail missing');
  }
}
console.log(JSON.stringify({ok:true,plots:data.plots.length,portfolios:data.portfolios.length,projectCodes:data.projectCodes.length,boqTotal:Number(boqTotal.toFixed(2)),erpAsOf:data.meta?.erpAsOf||null}));

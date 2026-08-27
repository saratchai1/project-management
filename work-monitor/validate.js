const fs=require('fs');const vm=require('vm');const path=require('path');
const root=__dirname,ctx={window:{}};vm.createContext(ctx);
['data/raw-base.js','data/raw-2-01.js','data/raw-2-02.js','data/raw-2-03.js','data/raw-3-01.js','data/raw-3-02.js','data/raw-3-03.js'].forEach(f=>vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx,{filename:f}));
const d=ctx.window.WORK_MONITOR_RAW;if(!d)throw new Error('WORK_MONITOR_RAW missing');
const expected={'2':{plots:151,installments:460,risks:{C:151}},'3':{plots:151,installments:449,risks:{X:44,H:37,T:34,F:36}}};
for(const y of ['2','3']){const a=d.p[y],e=expected[y];if(a.length!==e.plots)throw new Error(`Year ${y}: expected ${e.plots} plots, got ${a.length}`);const ids=a.map(p=>p[0]);if(new Set(ids).size!==ids.length)throw new Error(`Year ${y}: duplicate Plot ID`);const inst=a.reduce((s,p)=>s+p[8].length,0);if(inst!==e.installments)throw new Error(`Year ${y}: expected ${e.installments} installments, got ${inst}`);const risks={};a.forEach(p=>risks[p[7]]=(risks[p[7]]||0)+1);for(const [k,v] of Object.entries(e.risks))if((risks[k]||0)!==v)throw new Error(`Year ${y}: risk ${k} expected ${v}, got ${risks[k]||0}`);console.log(`Year ${y}: ${a.length} plots / ${inst} installments / unique IDs OK`)}
console.log('Work monitor validation passed.');

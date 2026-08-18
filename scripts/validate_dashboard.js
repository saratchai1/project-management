#!/usr/bin/env node
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..'),ctx={window:{}};vm.createContext(ctx);
const files=['data/project-data.js',...fs.readdirSync(path.join(root,'data')).filter(f=>/^plots-\d+\.js$/.test(f)).sort().map(f=>'data/'+f)];
for(const f of files)vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx,{filename:f});
const d=ctx.window.PROJECT_DATA,fail=m=>{throw new Error(m)},near=(a,b)=>Math.abs(a-b)<=0.05;
if(!d||!Array.isArray(d.plots))fail('PROJECT_DATA missing');
if(d.plots.length!==d.summary.totalPlots)fail(`plot count ${d.plots.length} != summary ${d.summary.totalPlots}`);
const ids=d.plots.map(p=>p.plotId);if(new Set(ids).size!==ids.length)fail('duplicate plotId detected');
for(const p of d.plots){if(!p.plotId||!p.contractNo||!p.payment)fail(`required field missing: ${p.plotId||'unknown'}`)}
const sum=k=>d.plots.reduce((a,p)=>a+(Number(p[k])||0),0);
if(!near(sum('contractValue'),d.summary.totalContract))fail('contract total mismatch');
if(!near(sum('planValue'),d.summary.plannedValue))fail('planned value mismatch');
if(!near(sum('progressValue'),d.summary.earnedValue))fail('earned value mismatch');
console.log(`OK: ${d.plots.length} plots | contract ${d.summary.totalContract.toFixed(2)} | plan ${d.summary.plannedValue.toFixed(2)} | progress ${d.summary.earnedValue.toFixed(2)}`);

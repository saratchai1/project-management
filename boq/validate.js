const fs=require('fs');
const vm=require('vm');
const zlib=require('zlib');
const https=require('https');
const cp=require('child_process');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
const clean=v=>v==null?'':String(v).trim();
const getJson=url=>new Promise((resolve,reject)=>https.get(url,{headers:{'User-Agent':'project-finance-validator'}},res=>{
  if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){res.resume();return getJson(res.headers.location).then(resolve,reject);}
  if(res.statusCode!==200){res.resume();return reject(new Error(`${url} -> HTTP ${res.statusCode}`));}
  let s='';res.setEncoding('utf8');res.on('data',d=>s+=d);res.on('end',()=>{try{resolve(JSON.parse(s));}catch(e){reject(new Error(`Invalid JSON ${url}: ${e.message}`));}});
}).on('error',reject));

function recoverClassification(){
  const sandbox={window:{}};vm.createContext(sandbox);
  for(const f of ['boq/data-01.js','boq/data-02.js']) vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f});
  const b64=sandbox.window.__FINANCE_B64||'';assert(b64.length>1000,'classification payload missing');
  const text=zlib.gunzipSync(Buffer.from(b64,'base64'),{finishFlush:zlib.constants.Z_SYNC_FLUSH}).toString('utf8');
  const marker=',"plots":[';const i=text.indexOf(marker);assert(i>0,'recoverable classification header missing');
  return JSON.parse(text.slice(0,i)+',"plots":[]}');
}
function loadSafeProjectData(){
  const sandbox={window:{}};vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('data/project-data.js','utf8'),sandbox,{filename:'data/project-data.js'});
  for(let i=1;i<=8;i++){const f=`data/plots-${String(i).padStart(2,'0')}.js`;vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f});}
  return sandbox.window.PROJECT_DATA;
}
function allocateSequential(boqIns,paid){
  let left=Math.max(0,Number(paid||0));
  return boqIns.map((boq,idx)=>{const b=Number(boq||0);const p=Math.min(b,left);left=Math.max(0,left-p);const remaining=Math.max(0,b-p);return{no:idx+1,boq:b,paid:p,remaining,fullyPaid:remaining<=0.01};});
}

(async()=>{
  for(const f of ['boq/data.js','boq/app.js']) cp.execFileSync(process.execPath,['--check',f],{stdio:'inherit'});
  const base=recoverClassification();
  const safe=loadSafeProjectData();
  assert(safe.plots.length===151,`safe ERP/Progress snapshot expected 151 plots, got ${safe.plots.length}`);
  const safeByKey=new Map(safe.plots.map(p=>[`${clean(p.plotId)}|${clean(p.contractNo)}`,p]));
  const safeByPlot=new Map(safe.plots.map(p=>[clean(p.plotId),p]));

  const ROOT='https://raw.githubusercontent.com/saratchai1/project-management/a397f7713be0292d3e14cc3f495ff13ed77a4717/data/boq-2565-tc-rok-20260827/';
  const manifest=await getJson(ROOT+'manifest.json');
  const parts=await Promise.all(manifest.parts.map(f=>getJson(ROOT+f)));
  const d=manifest.dictionaries;
  const template=y=>(manifest.year_templates[String(y)]||[]).map(x=>`${Math.round(x*100)}%`).join('/');
  const plots=parts.flatMap(x=>x.plots).map(r=>{
    const company=clean(d.company[r[4]]);const plotCode=clean(r[1]);const contractNo=clean(r[12]);
    const projectCode=company==='STC'?'TCGMCR6508':'TCGMCR6607';
    const safePlot=safeByKey.get(`${plotCode}|${contractNo}`)||safeByPlot.get(plotCode)||null;
    const years=r[14].map(y=>{
      const year=Number(y[0]);const boq=Number(y[1]||0);const boqIns=y.slice(2,6).map(v=>Number(v||0)).filter((v,idx)=>idx<3||v!==0||year!==1);
      if(year!==3){return{year,boq,paid:0,possiblePaid:0,balance:boq,possibleBalance:boq,over:0,status:'no_data',paymentDataAvailable:false,paymentConfidence:'no_data',latestPaymentInstallments:[],latestFullInstallment:0,latestPaymentDate:null,latestPaymentAmount:null,pendingInstallments:[],installments:boqIns.map((b,i)=>({no:i+1,boq:b,paid:0,remaining:b,fullyPaid:false})),template:template(year),exception:!!y[6]};}
      const pay=safePlot?.payment||null;const confirmed=Number(pay?.confirmedAmount||0);const ambiguous=Number(pay?.ambiguousAmount||0);const possible=confirmed+ambiguous;
      const installments=allocateSequential(boqIns,confirmed);const latestFull=Math.max(0,...installments.filter(x=>x.fullyPaid).map(x=>x.no));
      const pending=installments.filter(x=>x.remaining>0.01).map(x=>x.no);const over=Math.max(0,confirmed-boq);const balance=Math.max(0,boq-confirmed);
      return{year,boq,paid:confirmed,possiblePaid:possible,balance,possibleBalance:Math.max(0,boq-possible),over,status:confirmed>=boq-0.01?'paid':confirmed>0?'partial':safePlot?'not_started':'no_data',paymentDataAvailable:!!safePlot,paymentConfidence:pay?.confidence||'no_data',latestPaymentInstallments:[],latestFullInstallment:latestFull,latestPaymentDate:pay?.lastDate||null,latestPaymentAmount:null,pendingInstallments:pending,installments,template:template(year),exception:!!y[6],installmentInference:true};
    });
    return{projectCode,plotCode,contractNo,projectName:clean(d.project_name[r[2]]),tokenType:clean(d.token_type[r[3]]),company,moo:clean(d.moo[r[5]]),village:clean(d.village[r[6]]),subdistrict:clean(d.subdistrict[r[7]]),district:clean(d.district[r[8]]),province:clean(d.province[r[9]]),areaType:clean(d.area_type[r[10]]),areaRai:Number(r[11]||0),total10y:Number(r[13]||0),years};
  });
  plots.sort((a,b)=>a.plotCode.localeCompare(b.plotCode,'th',{numeric:true}));
  const boqTotal=plots.reduce((s,p)=>s+p.years.reduce((a,y)=>a+y.boq,0),0);
  assert(plots.length===160,`expected 160 BOQ master plots, got ${plots.length}`);
  assert(Math.abs(boqTotal-Number(manifest.ten_year_total_baht))<0.02,'BOQ master does not reconcile');
  assert(plots.every(p=>p.projectCode&&p.plotCode&&p.contractNo&&p.years.length===10),'plot key/year structure incomplete');
  const mappedYear3=plots.filter(p=>p.years[2].paymentDataAvailable).length;
  const year3Confirmed=plots.reduce((s,p)=>s+p.years[2].paid,0);
  const totalExternalBoqAp=Number(base.portfolios.find(p=>p.id==='forest65_external')?.amounts?.boq_contract||0);
  const mappedBoqPayments=Number(base.meta.mappedBoqPayments||0);
  const data={
    meta:{...base.meta,boq10y:Number(manifest.ten_year_total_baht),areaRai:Number(manifest.total_area_rai),plotCount:plots.length,mappedYear3Plots:mappedYear3,year3ConfirmedPublicSnapshot:year3Confirmed,unmatchedOrOutOfMasterBoqPayment:Math.max(0,totalExternalBoqAp-mappedBoqPayments),paymentScope:'ระดับแปลงใช้ public safe ERP snapshot เฉพาะปีที่ 3; ปีอื่นแสดงยอด BOQ รายแปลงและยอดจ่ายรวมระดับ portfolio เท่านั้น'},
    portfolios:base.portfolios,projectCodes:base.projectCodes,workTypeLabels:base.workTypeLabels,yearSummary:base.yearSummary,plots
  };
  fs.writeFileSync('boq/finance-data.json',JSON.stringify(data));
  const check=JSON.parse(fs.readFileSync('boq/finance-data.json','utf8'));
  assert(check.plots.length===160&&check.projectCodes.length===5,'generated finance-data.json invalid');
  console.log(JSON.stringify({ok:true,plots:plots.length,mappedYear3,year3Confirmed:Number(year3Confirmed.toFixed(2)),boqTotal:Number(boqTotal.toFixed(2)),projectCodes:base.projectCodes.length,output:'boq/finance-data.json'}));
})().catch(err=>{console.error(err);process.exit(1);});

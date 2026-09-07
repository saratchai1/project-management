const fs=require('fs');
const https=require('https');
const cp=require('child_process');
const zlib=require('zlib');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
const clean=v=>v==null?'':String(v).trim();
const near=(a,b,t=0.05)=>Math.abs(Number(a)-Number(b))<=t;
const getJson=url=>new Promise((resolve,reject)=>https.get(url,{headers:{'User-Agent':'project-finance-embedded-builder'}},res=>{
  if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){res.resume();return getJson(res.headers.location).then(resolve,reject);}
  if(res.statusCode!==200){res.resume();return reject(new Error(`${url} -> HTTP ${res.statusCode}`));}
  let s='';res.setEncoding('utf8');res.on('data',d=>s+=d);res.on('end',()=>{try{resolve(JSON.parse(s));}catch(e){reject(new Error(`Invalid JSON ${url}: ${e.message}`));}});
}).on('error',reject));
function allocateSequential(boqIns,paid){
  let left=Math.max(0,Number(paid||0));
  return boqIns.map((boq,idx)=>{const b=Number(boq||0);const p=Math.min(b,left);left=Math.max(0,left-p);const remaining=Math.max(0,b-p);return{no:idx+1,boq:b,paid:p,remaining,fullyPaid:remaining<=0.01};});
}
function makeYear({year,boq,paid=0,boqIns=[],statusOverride=null,contractNo=null,areaRai=0,contractStatus='ทำสัญญาแล้ว',template='',paymentDataAvailable=true}){
  const paidCapped=Math.min(Math.max(0,Number(paid||0)),Number(boq||0));
  const balance=Math.max(0,Number(boq||0)-paidCapped);
  const installments=allocateSequential(boqIns,paidCapped);
  const latestFull=Math.max(0,...installments.filter(x=>x.fullyPaid).map(x=>x.no));
  const pending=statusOverride==='not_contracted'||statusOverride==='future'?[]:installments.filter(x=>x.remaining>0.01).map(x=>x.no);
  let status=statusOverride;
  if(!status) status=balance<=0.01?'paid':paidCapped>0?'partial':'not_started';
  return {year,boq:Number(boq||0),paid:paidCapped,possiblePaid:paidCapped,balance,possibleBalance:balance,over:0,status,paymentDataAvailable,paymentConfidence:paymentDataAvailable?'embedded_erp_ap':'no_data',latestPaymentInstallments:[],latestFullInstallment:latestFull,latestPaymentDate:null,latestPaymentAmount:null,pendingInstallments:pending,installments,template,exception:false,contractNo,areaRai,contractStatus};
}
(async()=>{
  for(const f of ['boq/data.js','boq/app.js']) cp.execFileSync(process.execPath,['--check',f],{stdio:'inherit'});
  const snap=JSON.parse(zlib.gunzipSync(Buffer.from(fs.readFileSync('boq/embedded-snapshot.b64','utf8').trim(),'base64')).toString('utf8'));
  const external65Master=JSON.parse(zlib.gunzipSync(Buffer.from(fs.readFileSync('boq/external65-master-20260907.b64','utf8').trim(),'base64')).toString('utf8'));
  assert(external65Master.source_sha256==='68c30653b81c1cc2c98e14a47dd008ca47535e8361097a4f179c887eda292b62','external65 source snapshot hash mismatch');
  assert(external65Master.plot_count===160,'external65 latest master plot count mismatch');
  const y2Unpaid=new Set(snap.external65.y2Unpaid);
  const external=external65Master.plots.map(r=>{
    const company=clean(r.company),plotCode=clean(r.plotCode),contractNo=clean(r.contractNo);
    const projectCode=company==='STC'?'TCGMCR6508':'TCGMCR6607';
    const years=r.years.map(y=>{
      const year=Number(y.year),boq=Number(y.boq||0);
      const boqIns=(y.installments||[]).map(v=>Number(v||0));
      let paid=0,statusOverride=null,paymentDataAvailable=true;
      if(year===1) paid=Object.prototype.hasOwnProperty.call(snap.external65.y1Partial,plotCode)?Number(snap.external65.y1Partial[plotCode]):boq;
      else if(year===2) paid=y2Unpaid.has(plotCode)?0:boq;
      else if(year===3) paid=Number(snap.external65.y3Paid[plotCode]||0);
      else {statusOverride='future';paymentDataAvailable=false;}
      return makeYear({year,boq,paid,boqIns,statusOverride,contractNo,areaRai:Number(r.areaRai||0),template:clean(y.template),paymentDataAvailable});
    });
    return {portfolio:'forest65_external',projectCode,plotCode,contractNo,projectName:clean(r.projectName),tokenType:clean(r.tokenType),company,moo:clean(r.moo),village:clean(r.village),subdistrict:clean(r.subdistrict),district:clean(r.district),province:clean(r.province),areaType:clean(r.areaType),areaRai:Number(r.areaRai||0),total10y:Number(r.total10y||0),years};
  });
  external.sort((a,b)=>a.plotCode.localeCompare(b.plotCode,'th',{numeric:true}));
  assert(external.length===160,`expected 160 external plots, got ${external.length}`);
  const latestVillageNames={
    '72-STC':'ท่าควน,บ้านท่าใหญ่','78-STC':'บ้านหมากปรก','79-STC':'บ้านผักฉีด','88-STC':'บ้านเกาะนก (คลองน้ำเวียน)',
    '56(1)-STC':'บ้านคลองย่าหนัด','57(1)-STC':'บ้านคลองย่าหนัด','58(1)-STC':'บ้านคลองย่าหนัด',
    '9-VSD':'ท่าขาหย่าง','10-VSD':'ท่าขาหย่าง','37-VSD':'คลองหิน','69-VSD':'บ้านเกาะนก (คลองน้ำเวียน)'
  };
  const externalByCode=new Map(external.map(p=>[p.plotCode,p]));
  for(const [code,village] of Object.entries(latestVillageNames)) assert(externalByCode.get(code)?.village===village,`external65 latest village mismatch ${code}`);
  const community=snap.community66.map(row=>{
    const [plotCode,communityName,chairman,province,area1,contract1,status1,boq1,area2,contract2,status2,boq2,paid1]=row;
    const ins1=[.3,.2,.3,.2].map(x=>Number((boq1*x).toFixed(2))),ins2=[.3,.2,.3,.2].map(x=>Number((boq2*x).toFixed(2)));
    ins1[3]=Number((boq1-ins1[0]-ins1[1]-ins1[2]).toFixed(2));ins2[3]=Number((boq2-ins2[0]-ins2[1]-ins2[2]).toFixed(2));
    const contracted1=status1==='ทำสัญญาแล้ว',contracted2=status2==='ทำสัญญาแล้ว';
    const y1=makeYear({year:1,boq:boq1,paid:paid1,boqIns:ins1,statusOverride:contracted1?null:'not_contracted',contractNo:contract1,areaRai:area1,contractStatus:status1,template:'30%/20%/30%/20%',paymentDataAvailable:contracted1});
    const y2=makeYear({year:2,boq:boq2,paid:0,boqIns:ins2,statusOverride:contracted2?null:'not_contracted',contractNo:contract2,areaRai:area2,contractStatus:status2,template:'30%/20%/30%/20%',paymentDataAvailable:contracted2});
    return {portfolio:'forest66_community',projectCode:'TCGMCR6609',plotCode,contractNo:contract1||contract2||'',projectName:'โครงการปลูกป่าชายเลน เพื่อประโยชน์จากคาร์บอนเครดิต สำหรับชุมชน ประจำปี พ.ศ. 2566',tokenType:'',company:'ชุมชน',moo:'',village:communityName,subdistrict:'',district:'',province,areaType:'ป่าชุมชน',areaRai:Number(area1||area2||0),total10y:Number(boq1||0)+Number(boq2||0),communityName,chairman,years:[y1,y2]};
  });
  assert(community.length===93,`expected 93 community units, got ${community.length}`);
  const plots=[...external,...community];
  const portfolios=snap.portfolios.map(p=>({...p}));
  const meta={...snap.meta,external65Source:external65Master.source_filename,external65SourceSha256:external65Master.source_sha256,external65SnapshotDate:external65Master.snapshot_date,classificationPolicy:'ยอดจ่าย BOQ ใช้ ERP module AP เฉพาะงานปลูก/บำรุง; กองทุนชุมชน/PDD/VVB/Clear Advance แยกหมวดและไม่หักจาก BOQ',external65PlotCount:160,community66UnitCount:93,totalPlotLikeUnits:253,publicDataPolicy:'Aggregated project/plot/community/payment status; raw voucher IDs and remarks excluded.'};
  const data={meta,portfolios,projectCodes:snap.projectCodes,workTypeLabels:snap.workTypeLabels,plots};
  fs.writeFileSync('boq/finance-data.json',JSON.stringify(data));
  const sum=(rows,y,k)=>rows.reduce((s,p)=>s+Number(p.years[y-1]?.[k]||0),0);
  const e1={boq:sum(external,1,'boq'),paid:sum(external,1,'paid'),balance:sum(external,1,'balance')};
  const e2={boq:sum(external,2,'boq'),paid:sum(external,2,'paid'),balance:sum(external,2,'balance')};
  const e3={boq:sum(external,3,'boq'),paid:sum(external,3,'paid'),balance:sum(external,3,'balance')};
  const c1={boq:sum(community,1,'boq'),paid:sum(community,1,'paid')},c2={boq:sum(community,2,'boq'),paid:sum(community,2,'paid')};
  assert(near(e1.boq,169802286.35)&&near(e1.paid,167675542.17)&&near(e1.balance,2126744.18),'external65 year1 mismatch');
  assert(near(e2.boq,56786944.69)&&near(e2.paid,54508982.24)&&near(e2.balance,2277962.45),'external65 year2 mismatch');
  assert(external.filter(p=>p.years[1].paid<=0.01).length===9,'external65 year2 unpaid count mismatch');
  assert(near(e3.paid,7013632.96),'external65 year3 paid mismatch');
  assert(near(c1.boq,69677122.05)&&near(c1.paid,4116627),'community year1 mismatch');
  assert(near(c2.boq,30967343.80)&&near(c2.paid,0),'community year2 mismatch');
  assert(near(c1.boq+c2.boq,100644465.85),'community combined BOQ mismatch');
  const pm=Object.fromEntries(portfolios.map(p=>[p.id,p]));
  assert(near(pm.forest66_community.amounts.boq_contract,4116627)&&near(pm.forest66_community.amounts.community_fund,18600000),'community AP categories mismatch');
  assert(near(pm.forest66_community.amounts.field_visit,365773.65),'community advance/field visit mismatch');
  assert(near(pm.forest66_external.amounts.boq_contract,3673921)&&near(pm.forest66_external.totalAp,3992126.10),'external66 AP mismatch');
  for(const p of portfolios){const cat=Object.values(p.amounts).reduce((a,b)=>a+Number(b||0),0);assert(near(cat,p.totalAp,0.1),`${p.id} AP categories do not reconcile`);}
  console.log(JSON.stringify({ok:true,units:plots.length,external65:{source:external65Master.source_filename,sourceSha256:external65Master.source_sha256,year1:e1,year2:{...e2,unpaidPlots:9},year3:e3},community66:{year1:c1,year2:c2,combinedBoq:c1.boq+c2.boq,fund:pm.forest66_community.amounts.community_fund,advance:pm.forest66_community.amounts.field_visit},external66:{boqTypeAp:pm.forest66_external.amounts.boq_contract,totalAp:pm.forest66_external.totalAp},output:'boq/finance-data.json'}));
})().catch(err=>{console.error(err);process.exit(1);});

#!/usr/bin/env python3
"""Build public-safe dashboard data from Progress + ERP XLSX exports.

Uses Python standard library only. Raw XLSX files, voucher IDs and remarks are
not written to the repository output.
"""
from __future__ import annotations
import argparse, json, re, zipfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

MAIN_NS="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PLOT_RE=re.compile(r"(?<!\d)(\d{1,3}(?:\(\d+\))?)\s*-\s*(STC|VSD)\b",re.I)
CONTRACT_RE=re.compile(r"ROK/CB(?:/)?(?:\d{2}/)?\d{2}-\d{3}(?:\(\d+\))?",re.I)
PROVINCE_FIX={"จันทุบุรี":"จันทบุรี"}

def col_idx(ref:str)->int:
    letters=re.match(r"([A-Z]+)",ref).group(1); n=0
    for c in letters:n=n*26+ord(c)-64
    return n-1

def load_xlsx(path:Path):
    z=zipfile.ZipFile(path); ss=[]; ns=f"{{{MAIN_NS}}}"
    if "xl/sharedStrings.xml" in z.namelist():
        root=ET.fromstring(z.read("xl/sharedStrings.xml"))
        ss=["".join((t.text or "") for t in si.iter(ns+"t")) for si in root.findall(ns+"si")]
    wb=ET.fromstring(z.read("xl/workbook.xml")); rel=ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rels={x.attrib["Id"]:x.attrib["Target"] for x in rel}; rns=f"{{{REL_NS}}}"; sheets=[]
    for x in wb.find(ns+"sheets"):
        target=rels[x.attrib[rns+"id"]]
        if not target.startswith("xl/"):target="xl/"+target.lstrip("/")
        sheets.append((x.attrib["name"],target))
    return z,ss,sheets

def parse_sheet(z,ss,path):
    ns=f"{{{MAIN_NS}}}"; out=[]
    with z.open(path) as fh:
        for _,row in ET.iterparse(fh,events=("end",)):
            if row.tag!=ns+"row":continue
            vals={}
            for c in row.findall(ns+"c"):
                i=col_idx(c.attrib.get("r","A1")); kind=c.attrib.get("t"); v=c.find(ns+"v"); val=None
                if kind=="inlineStr":
                    inline=c.find(ns+"is"); val="".join((t.text or "") for t in inline.iter(ns+"t")) if inline is not None else None
                elif v is not None:
                    raw=v.text
                    if kind=="s": val=ss[int(raw)] if raw is not None else None
                    elif kind=="b": val=raw=="1"
                    elif kind in ("str","e"): val=raw
                    else:
                        try:
                            n=float(raw); val=int(n) if n.is_integer() else n
                        except (TypeError,ValueError): val=raw
                vals[i]=val
            if vals:
                arr=[None]*(max(vals)+1)
                for i,v in vals.items():arr[i]=v
                out.append((int(row.attrib.get("r",len(out)+1)),arr))
            row.clear()
    return out

def dict_rows(rows):
    headers=rows[0][1]; out=[]
    for rn,row in rows[1:]:
        d={"_row":rn}
        for i,h in enumerate(headers):
            if h is not None and str(h).strip():d[str(h).strip()]=row[i] if i<len(row) else None
        out.append(d)
    return out

def f(v):
    try:return float(v or 0)
    except (TypeError,ValueError):return 0.0

def plot_id(v):
    m=PLOT_RE.search(str(v or "")); return f"{m.group(1)}-{m.group(2).upper()}" if m else None

def contracts(v):return [m.upper() for m in CONTRACT_RE.findall(str(v or "").replace(" ",""))]

def xdate(v):
    if isinstance(v,(int,float)):return (datetime(1899,12,30)+timedelta(days=float(v))).date().isoformat()
    return str(v) if v else None

def file_date(name):
    m=re.search(r"(\d{2})\.(\d{2})\.(\d{4})",name)
    if not m:return None
    d,mo,y=map(int,m.groups()); y=y-543 if y>2400 else y
    try:return datetime(y,mo,d).date().isoformat()
    except ValueError:return None

def risk(p):
    gap=p["planPct"]-p["progressPct"]; days=p["delayDays"]
    if p["progressPct"]>p["planPct"]+0.02:return "ahead"
    if gap>=0.25 or days<=-90:return "critical"
    if gap>=0.10 or days<=-30:return "high"
    if gap>0.02 or days<-7:return "watch"
    return "on_track"

def build(progress_path:Path,erp_path:Path):
    z,ss,sheets=load_xlsx(progress_path); progress=dict_rows(parse_sheet(z,ss,sheets[0][1])); z.close()
    plots={}
    for r in progress:
        desc=str(r.get("Description") or ""); pid=plot_id(desc); wbs=str(r.get("WBS No") or "").strip()
        if not(pid and not wbs and f(r.get("Contract(฿)"))>0):continue
        pm=re.search(r"จ\.\s*([^\s(]+)",desc); province=PROVINCE_FIX.get(pm.group(1).strip(),pm.group(1).strip()) if pm else "ไม่ระบุ"
        plots[pid]={"plotId":pid,"province":province,"contractValue":f(r.get("Contract(฿)")),"planValue":f(r.get("Plan (฿)")),"planPct":f(r.get("Plan (%)")),"progressValue":f(r.get("Progress (฿)")),"progressPct":f(r.get("Progress(%)")),"delayDays":f(r.get("+เร็ว/-ช้า (D)"))}

    z,ss,sheets=load_xlsx(erp_path); a=parse_sheet(z,ss,sheets[0][1]); second_name=None; duplicate=False
    if len(sheets)>1:
        b=parse_sheet(z,ss,sheets[1][1]); second_name=sheets[1][0]; duplicate=a==b
    z.close(); erp=dict_rows(a)
    ap=defaultdict(list); y3=defaultdict(list); max_date=None
    for r in erp:
        pid=plot_id(r.get("proj_dpt")) or plot_id(r.get("refcode_proj")) or plot_id(r.get("remark")) or plot_id(r.get("description")); dt=xdate(r.get("vchdate"))
        if dt and (max_date is None or dt>max_date):max_date=dt
        if r.get("module")=="AP" and pid:
            ap[pid].append(r)
            if "ปีที่3" in str(r.get("remark") or ""):y3[pid].append(r)

    vendor_names=[]
    for pid,p in plots.items():
        latest_contract=latest_vendor=latest_wo=None
        for r in ap.get(pid,[]):
            serial=f(r.get("vchdate"))
            for c in contracts(r.get("remark")):
                if latest_contract is None or serial>=latest_contract[0]:latest_contract=(serial,c)
            vn=r.get("vend_name") or r.get("vend_cust")
            if vn and (latest_vendor is None or serial>=latest_vendor[0]):latest_vendor=(serial,str(vn))
            wo=r.get("docno_powo")
            if wo and (latest_wo is None or serial>=latest_wo[0]):latest_wo=(serial,str(wo))
        p["contractNo"]=latest_contract[1] if latest_contract else None; p["_vendor"]=latest_vendor[1] if latest_vendor else None; p["wo"]=latest_wo[1] if latest_wo else None
        if p["_vendor"] and p["_vendor"] not in vendor_names:vendor_names.append(p["_vendor"])
        confirmed=ambig=0.0; dates=[]; count=0
        for r in y3.get(pid,[]):
            text=" ".join(str(r.get(k) or "") for k in ("remark","description","remark2")); amount=f(r.get("Dr-Cr")); mixed="ปีที่2" in text or "ปีที่ 2" in text
            ambig+=amount if mixed else 0; confirmed+=0 if mixed else amount; count+=1
            dt=xdate(r.get("vchdate")); dates.append(dt) if dt else None
        has=count>0; confidence="none" if not has else ("mixed" if ambig else "high"); cp=confirmed/p["contractValue"] if p["contractValue"] else 0; pp=(confirmed+ambig)/p["contractValue"] if has and p["contractValue"] else 0
        p["payment"]={"confidence":confidence,"confirmedAmount":round(confirmed,2),"ambiguousAmount":round(ambig,2),"confirmedPct":cp,"possiblePct":pp,"lastDate":max(dates,default=None),"txnCount":count}
        p["scheduleGapPp"]=round((p["planPct"]-p["progressPct"])*100,2); p["delayValue"]=round(max(p["planValue"]-p["progressValue"],0),2); p["risk"]=risk(p)
        p["paymentFlag"]="no_data" if not has else ("paid_ahead" if cp>p["progressPct"]+0.05 else ("paid_behind" if pp<p["progressPct"]-0.05 else ("review" if confidence=="mixed" else "aligned")))

    vendor_map={f"vendor_{i+1:02d}":name for i,name in enumerate(sorted(vendor_names))}; reverse={v:k for k,v in vendor_map.items()}
    for p in plots.values():p["vendorKey"]=reverse.get(p.pop("_vendor"),None)
    ps=list(plots.values()); total=sum(p["contractValue"] for p in ps); plan=sum(p["planValue"] for p in ps); prog=sum(p["progressValue"] for p in ps); conf=sum(p["payment"]["confirmedAmount"] for p in ps); amb=sum(p["payment"]["ambiguousAmount"] for p in ps)
    rc=Counter(p["risk"] for p in ps); cc=Counter(p["payment"]["confidence"] for p in ps); fc=Counter(p["paymentFlag"] for p in ps)
    return {"meta":{"generatedAt":datetime.now().isoformat(timespec="seconds"),"progressAsOf":file_date(progress_path.name),"erpExportDate":file_date(erp_path.name),"erpMaxTransactionDate":max_date,"sourceFiles":[progress_path.name,erp_path.name],"erpSheetUsed":sheets[0][0],"erpSecondSheet":second_name,"erpSecondSheetDuplicate":duplicate,"rawFilesCommitted":False,"vendors":vendor_map,"publicDataPolicy":"Aggregated plot/contract/AP summary only; raw voucher IDs and remarks excluded"},"summary":{"totalPlots":len(ps),"totalContract":round(total,2),"plannedValue":round(plan,2),"plannedPct":plan/total if total else 0,"earnedValue":round(prog,2),"progressPct":prog/total if total else 0,"scheduleGapValue":round(max(plan-prog,0),2),"scheduleGapPp":((plan-prog)/total*100 if total else 0),"delayedPlots":sum(p["progressPct"]<p["planPct"] for p in ps),"riskCounts":dict(rc),"paymentCoveragePlots":sum(p["payment"]["confidence"]!="none" for p in ps),"paymentHighConfidencePlots":cc.get("high",0),"paymentMixedPlots":cc.get("mixed",0),"paymentNoRecordPlots":cc.get("none",0),"confirmedErpAmount":round(conf,2),"ambiguousErpAmount":round(amb,2),"confirmedErpPctOfPortfolio":conf/total if total else 0,"possibleErpPctOfPortfolio":((conf+amb)/total if total else 0),"paymentFlagCounts":dict(fc)},"plots":ps}

def main():
    pa=argparse.ArgumentParser(); pa.add_argument("progress",type=Path); pa.add_argument("erp",type=Path); pa.add_argument("--output",type=Path,default=Path("data/project-data.js")); a=pa.parse_args(); data=build(a.progress,a.erp); a.output.parent.mkdir(parents=True,exist_ok=True); plots=data.pop("plots")
    a.output.write_text("window.PROJECT_DATA = "+json.dumps(data,ensure_ascii=False,separators=(",",":"))[:-1]+',"plots":[]};\n',encoding="utf-8")
    for old in a.output.parent.glob("plots-*.js"):old.unlink()
    for i in range(0,len(plots),20):(a.output.parent/f"plots-{i//20+1:02d}.js").write_text("window.PROJECT_DATA.plots.push(..."+json.dumps(plots[i:i+20],ensure_ascii=False,separators=(",",":"))+");\n",encoding="utf-8")
    print(f"Wrote {len(plots)} plots"); print(json.dumps(data["summary"],ensure_ascii=False,indent=2))
if __name__=="__main__":main()

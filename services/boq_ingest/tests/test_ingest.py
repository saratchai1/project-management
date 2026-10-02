"""Synthetic fixtures only: no company workbooks or credentials are committed."""
import copy
import io
import json
import os
import tempfile
import unittest
import zipfile
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
from xml.sax.saxutils import escape
from fastapi.testclient import TestClient
from pydantic import ValidationError
from services.boq_ingest.workbook import Workbook, ImportBlocked, decimal, MAX_UPLOAD
from services.boq_ingest.core import Profile, make_preview, validate_profile
from services.boq_ingest.store import Store
from services.boq_ingest.api import create_app
from services.boq_ingest.ai import mapping_payload, suggest_mapping


def baseline():
    def year(no, boq, paid):
        return {"year": no, "boq": boq, "paid": paid, "balance": boq-paid, "over": 0,
            "possiblePaid": paid, "possibleBalance": boq-paid, "status": "partial" if paid else "not_started",
            "contractStatus": "ทำสัญญาแล้ว", "paymentDataAvailable": True,
            "installments": [{"no": 1, "boq": boq, "paid": paid, "remaining": boq-paid, "fullyPaid": False}],
            "pendingInstallments": [1], "latestPaymentInstallments": [], "latestFullInstallment": 0}
    rows = []
    for code, budget, paid in [("14-STC",100,10),("14(1)-STC",200,20)]:
        rows.append({"portfolio":"forest65_external","projectCode":"TEST-PROJECT","plotCode":code,
            "total10y":budget,"province":"ข้อมูลจำลอง","company":"TEST","contractNo":"TEST-CONTRACT-"+code,
            "areaRai":1,"projectName":"ข้อมูลจำลอง ไม่ใช่ข้อมูลบริษัท","tokenType":"STANDARD",
            "years":[year(1,0,0),year(2,0,0),year(3,budget,paid)]})
    amounts={"boq_contract":41,"pdd":5}  # 11 of previously-unmatched AP must not disappear.
    return {"meta":{"erpAsOf":"2026-01-01"},"workTypeLabels":{"boq_contract":"BOQ","pdd":"PDD"},
        "plots":rows,"projectCodes":[{"code":"TEST-PROJECT","portfolio":"forest65_external","company":"TEST","amounts":copy.deepcopy(amounts),"totalAp":46}],
        "portfolios":[{"id":"forest65_external","label":"ข้อมูลจำลอง","codes":["TEST-PROJECT"],"boqYears":[1,2,3],
            "defaultYear":3,"boqAvailable":True,"plotDataAvailable":True,"unitLabel":"แปลง","boqTotal":300,"boqPaid":30,
            "amounts":copy.deepcopy(amounts),"totalAp":46}]}


def xlsx(changes=None, extra_sheet=False, extra_entry=None, hidden=False):
    cells={"A1":"รหัสแปลง","B1":"BOQ","C1":"AP สะสม","A2":"14-STC","B2":100,"C2":60,
        "A3":"14(1)-STC","B3":200,"C3":80,"A4":"รวม","B4":("SUM(B2:B3)",1),"C4":("SUM(C2:C3)",1)}
    cells.update(changes or {})
    rows={}
    for ref,value in cells.items():
        if value is None:
            continue
        r=int(''.join(c for c in ref if c.isdigit()))
        if isinstance(value,tuple):
            node=f'<c r="{ref}"><f>{escape(value[0])}</f><v>{value[1]}</v></c>'
        elif isinstance(value,str):
            node=f'<c r="{ref}" t="inlineStr"><is><t>{escape(value)}</t></is></c>'
        else:
            node=f'<c r="{ref}"><v>{value}</v></c>'
        rows.setdefault(r,[]).append(node)
    sheet='<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    for r,items in sorted(rows.items()):
        hide=' hidden="1"' if hidden and r==3 else ''
        sheet+=f'<row r="{r}"{hide}>'+''.join(items)+'</row>'
    sheet+='</sheetData><mergeCells><mergeCell ref="E1:F1"/></mergeCells></worksheet>'
    root='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    book=f'<workbook xmlns="{root}" xmlns:r="{rel}"><sheets><sheet name="ปี3" sheetId="1" r:id="rId1"/>'
    if extra_sheet:book+='<sheet name="หมายเหตุ" state="hidden" sheetId="2" r:id="rId2"/>'
    book+='</sheets></workbook>'
    relationships=f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{rel}/worksheet" Target="worksheets/sheet1.xml"/>'
    if extra_sheet:relationships+=f'<Relationship Id="rId2" Type="{rel}/worksheet" Target="worksheets/sheet2.xml"/>'
    relationships+='</Relationships>'
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('xl/workbook.xml',book);z.writestr('xl/_rels/workbook.xml.rels',relationships)
        z.writestr('xl/worksheets/sheet1.xml',sheet)
        if extra_sheet:z.writestr('xl/worksheets/sheet2.xml',f'<worksheet xmlns="{root}"><sheetData/></worksheet>')
        if extra_entry:z.writestr(*extra_entry)
    return out.getvalue()


def profile(workbook, fields=("boq","paid")):
    columns={"plotCode":"A",**{f:{"boq":"B","paid":"C"}[f] for f in fields}}
    headers={"A1":"รหัสแปลง",**{{"boq":"B1","paid":"C1"}[f]:{"boq":"BOQ","paid":"AP สะสม"}[f] for f in fields}}
    return Profile.model_validate({"name":"Synthetic annual balances","layout_hash":workbook.layout_hash,
        "semantics":"boq-budget_and_or_cumulative-ap-postings","regions":[{"sheet":"ปี3","portfolio":"forest65_external","year":3,
            "start_row":2,"end_row":3,"columns":columns,"header_cells":headers,"totals":{f:{"boq":"B4","paid":"C4"}[f] for f in fields}}]})


class WorkbookTests(unittest.TestCase):
    def test_invalid_numbers_never_become_zero(self):
        for value in (None,True,False,'',' ','-','NaN','Infinity','1,2','1%','#VALUE!'):
            with self.subTest(value=value),self.assertRaises(ImportBlocked):decimal(value)
    def test_decimal_precision(self):
        self.assertEqual(decimal('1,234.50'),Decimal('1234.50'))
        self.assertEqual(decimal('(๑๒.๕๐)'),Decimal('-12.50'))
        self.assertEqual(decimal(0),Decimal(0))
    def test_formula_cache_is_not_trusted(self):
        w=Workbook(xlsx());self.assertEqual(w.number('ปี3','C4'),Decimal(140))
    def test_arithmetic_recalculation(self):
        w=Workbook(xlsx({'C4':('C2 + C3 * 2 - (20/2)',-999)}));self.assertEqual(w.number('ปี3','C4'),Decimal(210))
    def test_unsupported_formula_blocks_even_with_cached_result(self):
        for formula in ('XLOOKUP(A2,A2:A3,C2:C3)','RAND()','Sheet2!A1','[external.xlsx]Sheet1!A1','2**1000'):
            with self.subTest(formula=formula),self.assertRaises(ImportBlocked):Workbook(xlsx({'C4':(formula,140)})).number('ปี3','C4')
    def test_formula_cycle_blocks(self):
        with self.assertRaises(ImportBlocked):Workbook(xlsx({'C2':('C3',1),'C3':('C2',1)})).number('ปี3','C4')
    def test_missing_formula_input_blocks(self):
        with self.assertRaises(ImportBlocked):Workbook(xlsx({'C4':('C2+C9',140)})).number('ปี3','C4')
    def test_hidden_rows_not_silently_dropped(self):
        w=Workbook(xlsx(hidden=True));self.assertEqual(w.inspect()['sheets'][0]['hiddenRows'],[3]);self.assertEqual(w.number('ปี3','C4'),140)
        self.assertEqual(w.sheets['ปี3']['merges'],['E1:F1'])
    def test_macro_external_and_path_traversal_block(self):
        for name in ('xl/vbaProject.bin','xl/externalLinks/externalLink1.xml','../secret','xl/activeX/a.xml'):
            with self.subTest(name=name),self.assertRaises(ImportBlocked):Workbook(xlsx(extra_entry=(name,'x')))
    def test_external_relationship_blocks(self):
        with self.assertRaises(ImportBlocked):Workbook(xlsx(extra_entry=('xl/worksheets/_rels/sheet1.xml.rels','<Relationships><Relationship TargetMode="External" Target="https://example.com"/></Relationships>')))
    def test_dtd_blocks(self):
        with self.assertRaises(ImportBlocked):Workbook(xlsx(extra_entry=('xl/evil.rels','<!DOCTYPE foo [<!ENTITY a "x">]><r/>')))
    def test_invalid_zip_and_size(self):
        with self.assertRaises(ImportBlocked):Workbook(b'not Excel')
        with self.assertRaises(ImportBlocked):Workbook(b'x'*(MAX_UPLOAD+1))


class CoreTests(unittest.TestCase):
    def run_import(self,changes=None):
        w=Workbook(xlsx(changes));return make_preview(baseline(),[(w,profile(w))])
    def test_correct_preview_and_aggregate_updates(self):
        base=baseline();original=copy.deepcopy(base);w=Workbook(xlsx());r=make_preview(base,[(w,profile(w))])
        self.assertEqual(r['status'],'PASS');self.assertEqual(base,original)
        self.assertEqual(r['candidate']['projectCodes'][0]['totalAp'],156)
        self.assertEqual(r['candidate']['projectCodes'][0]['amounts']['boq_contract'],151)
        self.assertEqual(r['candidate']['portfolios'][0]['amounts']['pdd'],5)
        self.assertEqual(r['candidate']['plots'][0]['years'][2]['balance'],40)
        self.assertEqual(len(r['provenance']),4)
    def test_suffix_identity_is_preserved(self):
        r=self.run_import();self.assertEqual([x['plotCode'] for x in r['diff']],['14(1)-STC','14-STC'])
    def test_missing_not_zero(self):
        r=self.run_import({'C2':None});self.assertEqual(r['status'],'BLOCKED');self.assertIsNone(r['candidate'])
    def test_duplicate_plot_blocks(self):
        r=self.run_import({'A3':'14-STC'});self.assertIn('DUPLICATE_PLOT',r['issues'][0]['code'])
    def test_unmapped_plot_blocks(self):
        r=self.run_import({'A3':'99-UNKNOWN'});self.assertIn('UNMAPPED_PLOT',r['issues'][0]['code'])
    def test_control_total_mismatch_blocks(self):
        r=self.run_import({'C4':139});self.assertIn('TOTAL_MISMATCH',r['issues'][0]['code'])
    def test_incomplete_scope_blocks(self):
        w=Workbook(xlsx());p=profile(w);p.regions[0].end_row=2
        r=make_preview(baseline(),[(w,p)]);self.assertIn('INCOMPLETE_SCOPE',r['issues'][0]['code'])
    def test_duplicate_scope_across_files_blocks(self):
        w=Workbook(xlsx());r=make_preview(baseline(),[(w,profile(w)),(w,profile(w))]);self.assertEqual(r['status'],'BLOCKED')
    def test_two_sources_can_supply_distinct_fields(self):
        w=Workbook(xlsx());r=make_preview(baseline(),[(w,profile(w,('boq',))),(w,profile(w,('paid',)))]);self.assertEqual(r['status'],'PASS')
    def test_overpayment_never_clamped(self):
        r=self.run_import({'C2':500});self.assertEqual(r['status'],'BLOCKED');self.assertIn('PAYMENT_EXCEEDS',r['issues'][0]['code'])
    def test_no_invented_installment_allocation(self):
        r=self.run_import();y=r['candidate']['plots'][0]['years'][2];self.assertEqual(y['installments'],[]);self.assertIs(y['installmentDataAvailable'],False)
    def test_header_drift_requires_review(self):
        original=Workbook(xlsx());changed=Workbook(xlsx({'C1':'ความก้าวหน้า %'}))
        self.assertEqual(original.layout_hash,changed.layout_hash)
        with self.assertRaises(ImportBlocked):validate_profile(changed,profile(original))
    def test_new_shape_requires_review(self):
        original=Workbook(xlsx());changed=Workbook(xlsx({'D1':'New'}))
        with self.assertRaises(ImportBlocked):validate_profile(changed,profile(original))
    def test_changed_amounts_match_existing_profile(self):
        original=Workbook(xlsx());changed=Workbook(xlsx({'C2':70}));validate_profile(changed,profile(original))
    def test_hidden_sheet_requires_acknowledgement(self):
        w=Workbook(xlsx(extra_sheet=True));p=profile(w)
        with self.assertRaises(ImportBlocked):validate_profile(w,p)
        p.ignored_sheets={'หมายเหตุ':'Reviewed notes sheet, no financial rows'};validate_profile(w,p)
    def test_profile_rejects_executable_and_unknown_fields(self):
        p=profile(Workbook(xlsx())).model_dump();p['execute']='import os'
        with self.assertRaises(ValidationError):Profile.model_validate(p)
    def test_zero_is_supported(self):
        r=self.run_import({'C2':0,'C3':0});self.assertEqual(r['status'],'PASS');self.assertEqual(r['candidate']['plots'][0]['years'][2]['paid'],0)
    def test_ignored_row_cannot_hide_missing_plot(self):
        w=Workbook(xlsx());p=profile(w);p.regions[0].ignored_rows={'3':'Ignored intentionally'}
        self.assertEqual(make_preview(baseline(),[(w,p)])['status'],'BLOCKED')


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.store=Store(Path(self.tmp.name),baseline())
        raw=xlsx();w=Workbook(raw);u=self.store.upload(raw,'fake.xlsx');p=self.store.approve(u['uploadId'],profile(w),'Reviewed synthetic annual AP meaning')
        self.inputs=[{'uploadId':u['uploadId'],'profileId':p['profileId']}];self.revision=self.store.current()['revision']
    def test_publish_and_idempotent_replay(self):
        report=self.store.preview(self.inputs,self.revision);pub=self.store.publish(report['previewId'],self.revision)
        again=self.store.publish(report['previewId'],self.revision);self.assertEqual(pub['revision'],again['revision']);self.assertTrue(again['alreadyPublished'])
        self.assertEqual(len(self.store.history()),2)
    def test_stale_preview_cannot_overwrite(self):
        a=self.store.preview(self.inputs,self.revision);b=self.store.preview(self.inputs,self.revision)
        self.store.publish(a['previewId'],self.revision)
        with self.assertRaisesRegex(ImportBlocked,'STALE'):self.store.publish(b['previewId'],self.revision)
    def test_rollback_is_new_revision(self):
        report=self.store.preview(self.inputs,self.revision);pub=self.store.publish(report['previewId'],self.revision)
        restored=self.store.rollback(self.revision,pub['revision'],'Restore baseline for test')
        self.assertNotEqual(restored['revision'],self.revision);self.assertEqual(len(self.store.history()),3)
        self.assertEqual(self.store.current()['data'],baseline())
        self.store.publish(report['previewId'],self.revision)  # replay cannot undo rollback
        self.assertEqual(self.store.current()['revision'],restored['revision'])
    def test_reupload_is_deduplicated_and_profile_reused(self):
        item=self.store.upload(xlsx(),'another-name.xlsx');self.assertEqual(len(item['matchingProfiles']),1)
        with self.store.connection() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM uploads').fetchone()[0],1)
    def test_unapproved_profile_rejected(self):
        bad=[{**self.inputs[0],'profileId':'unapproved'}]
        with self.assertRaises(ImportBlocked):self.store.preview(bad,self.revision)
    def test_blocked_preview_cannot_publish(self):
        raw=xlsx({'C4':1});w=Workbook(raw);u=self.store.upload(raw,'bad.xlsx');p=self.store.approve(u['uploadId'],profile(w),'Header reviewed but amounts differ')
        r=self.store.preview([{'uploadId':u['uploadId'],'profileId':p['profileId']}],self.revision)
        self.assertEqual(r['status'],'BLOCKED')
        with self.assertRaises(ImportBlocked):self.store.publish(r['previewId'],self.revision)
        self.assertEqual(self.store.current()['revision'],self.revision)
    def test_state_survives_process_restart(self):
        report=self.store.preview(self.inputs,self.revision);self.store.publish(report['previewId'],self.revision)
        restarted=Store(Path(self.tmp.name),baseline());self.assertEqual(restarted.current(),self.store.current())


class APITests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.store=Store(Path(self.tmp.name),baseline())
        root=Path(__file__).resolve().parents[3];self.client=TestClient(create_app(self.store,root/'boq',root/'boq-import','t'*40));self.addCleanup(self.client.close)
        self.auth={'Authorization':'Bearer '+'t'*40}
    def test_requires_authentication(self):
        self.assertEqual(self.client.get('/api/current').status_code,401)
        self.assertEqual(self.client.get('/boq/').status_code,401)
    def test_cookie_session_csrf(self):
        login=self.client.post('/api/session',headers=self.auth);self.assertEqual(login.status_code,200)
        self.assertEqual(self.client.get('/api/current').status_code,200)
        self.assertEqual(self.client.post('/api/uploads',content=xlsx()).status_code,403)
        ok=self.client.post('/api/uploads',content=xlsx(),headers={'X-CSRF-Token':login.json()['csrf'],'X-Filename':'test.xlsx'})
        self.assertEqual(ok.status_code,200)
    def test_cross_origin_rejected_even_with_auth(self):
        self.assertEqual(self.client.get('/api/current',headers={**self.auth,'Origin':'https://evil.example'}).status_code,403)
    def test_raw_database_not_served(self):
        for path in ('/ingestion.sqlite3','/boq/finance-data.json','/boq/../ingestion.sqlite3','/ui/../../ingestion.sqlite3'):
            with self.subTest(path=path):self.assertEqual(self.client.get(path,headers=self.auth).status_code,404)
    def test_client_cannot_supply_candidate_to_publish(self):
        r=self.client.post('/api/publish',headers=self.auth,json={'previewId':'bad','expectedRevision':'bad','confirm':True,'candidate':{'fake':1}})
        self.assertEqual(r.status_code,422)
    def test_rejects_xlsm_and_invalid_xlsx(self):
        self.assertEqual(self.client.post('/api/uploads',headers={**self.auth,'X-Filename':'x.xlsm'},content=b'bad').status_code,415)
        self.assertEqual(self.client.post('/api/uploads',headers=self.auth,content=b'bad').status_code,422)
    def test_ai_requires_consent(self):
        r=self.client.post('/api/ai-suggest',headers=self.auth,json={'uploadId':'x','consentToSendSamples':False});self.assertEqual(r.status_code,422)
    def test_security_headers(self):
        r=self.client.get('/api/current',headers=self.auth);self.assertEqual(r.headers['cache-control'],'no-store');self.assertIn("object-src 'none'",r.headers['content-security-policy'])
    def test_ui_is_served_without_private_data(self):
        r=self.client.get('/');self.assertEqual(r.status_code,200);self.assertNotIn('TEST-PROJECT',r.text)


class AITests(unittest.TestCase):
    def test_amounts_masked_in_ai_payload(self):
        payload=mapping_payload(Workbook(xlsx()),[])
        cells={c['cell']:c['value'] for c in payload['sheets'][0]['sample']}
        self.assertEqual(cells['C2'],'[number]');self.assertEqual(cells['C4'],'[formula]')
    def test_missing_provider_does_not_fabricate_mapping(self):
        with patch.dict(os.environ,{},clear=True),self.assertRaisesRegex(ImportBlocked,'AI_NOT_CONFIGURED'):suggest_mapping({})


if __name__=='__main__':unittest.main()

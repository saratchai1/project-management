"""Regression coverage for review R1-R6; all workbooks/identities are synthetic.

SUM expectations are independent constants from Microsoft's reference semantics:
https://support.microsoft.com/en-us/excel/use-the-sum-function-to-sum-numbers-in-a-range
No Excel desktop or external calculation service is claimed as a test oracle.
"""
import copy
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from decimal import Decimal
from fastapi.testclient import TestClient
from pydantic import ValidationError
from services.boq_ingest.tests.test_ingest import baseline, xlsx, profile
from services.boq_ingest.workbook import Workbook, ImportBlocked
from services.boq_ingest.core import Profile, YearAnchor, make_preview, validate_profile
from services.boq_ingest.store import Store, dump
from services.boq_ingest.api import create_app


def rewrite(raw, path, replace):
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(raw)) as src, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as dst:
        for name in src.namelist():
            content = src.read(name)
            if name == path:
                content = replace(content.decode()).encode()
            dst.writestr(name, content)
    return output.getvalue()


def formula_text(cached_type='str', expression='E2'):
    raw = xlsx({'E2': '60', 'C2': (expression, 999), 'C4': ('SUM(C2:C3)', 999)})
    return rewrite(raw, 'xl/worksheets/sheet1.xml', lambda s: s.replace('<c r="C2">', f'<c r="C2" t="{cached_type}">'))


def preview(raw, base=None, fields=('boq', 'paid')):
    w = Workbook(raw)
    return make_preview(base or baseline(), [(w, profile(w, fields))])


def annual(title):
    return rewrite(xlsx({'H1': title}), 'xl/workbook.xml', lambda s: s.replace('name="ปี3"', 'name="Annual Report"'))


def annual_profile(w):
    p = profile(w)
    p.regions[0].sheet = 'Annual Report'
    p.regions[0].year_anchor = YearAnchor(kind='cell', cell='H1')
    return p


class FormulaTypeRegressions(unittest.TestCase):
    def test_r1_sum_ignores_formula_text_independent_of_cache_type(self):
        for typ in ('str', 'n'):
            with self.subTest(cached_type=typ):
                w = Workbook(formula_text(typ))
                self.assertEqual(w.value('ปี3', 'C2'), '60')
                self.assertEqual(w.number('ปี3', 'C4'), Decimal(80))
                r = make_preview(baseline(), [(w, profile(w))])
                self.assertEqual(r['status'], 'BLOCKED')
                self.assertIn('NON_NUMERIC_FINANCIAL_CELL', r['issues'][0]['code'])

    def test_sum_ignores_literal_empty_and_chained_text_results(self):
        for expression, extra in [('"60"', {}), ('""', {}), ('F2', {'F2': ('E2', 60)}), ('(E2)', {})]:
            with self.subTest(expression=expression):
                w = Workbook(xlsx({'E2': '60', 'C2': (expression, 60), **extra}))
                self.assertEqual(w.number('ปี3', 'C4'), 80)

    def test_numeric_formula_with_stale_string_cache_is_still_numeric(self):
        w = Workbook(formula_text('str', '20+40'))
        self.assertEqual(w.number('ปี3', 'C2'), 60)
        self.assertEqual(w.number('ปี3', 'C4'), 140)
        self.assertEqual(make_preview(baseline(), [(w, profile(w))])['status'], 'PASS')

    def test_sum_ignores_boolean_and_blank_but_financial_field_does_not(self):
        raw = rewrite(xlsx({'C2': 1}), 'xl/worksheets/sheet1.xml', lambda s: s.replace('<c r="C2">', '<c r="C2" t="b">'))
        for fixture in (raw, xlsx({'C2': None}), xlsx({'C2': '60'})):
            with self.subTest(fixture=fixture[:12]):
                w = Workbook(fixture)
                self.assertEqual(w.number('ปี3', 'C4'), 80)
                self.assertEqual(make_preview(baseline(), [(w, profile(w))])['status'], 'BLOCKED')

    def test_sum_does_not_hide_unsupported_formula_or_error_behind_string_cache(self):
        for expression in ('IF(1,"60",0)', '1/0', 'E2+0', 'XLOOKUP(A2,A2:A3,C2:C3)'):
            with self.subTest(expression=expression), self.assertRaises(ImportBlocked):
                Workbook(formula_text('str', expression)).number('ปี3', 'C4')
        raw = rewrite(xlsx({'C2': 1}), 'xl/worksheets/sheet1.xml', lambda s: s.replace('<c r="C2">', '<c r="C2" t="e">'))
        with self.assertRaises(ImportBlocked):
            Workbook(raw).number('ปี3', 'C4')

    def test_arithmetic_and_sum_remain_decimal(self):
        w = Workbook(xlsx({'B2': ('0.1+0.2', 999), 'B3': ('B2*10', 999)}))
        self.assertEqual(w.number('ปี3', 'B4'), Decimal('3.3'))


class ScopeEvidenceRegressions(unittest.TestCase):
    def test_r2_boq_only_preserves_ap_range_and_authority(self):
        b = baseline()
        y = b['plots'][0]['years'][2]
        y.update(possiblePaid=20, possibleBalance=80, paymentConfidence='mixed_year_ap')
        r = preview(xlsx({'B2': 110}), b, ('boq',))
        self.assertEqual(r['status'], 'PASS')
        y = r['candidate']['plots'][0]['years'][2]
        self.assertEqual((y['boq'], y['paid'], y['possiblePaid'], y['balance'], y['possibleBalance']), (110, 10, 20, 100, 90))
        self.assertEqual(y['paymentConfidence'], 'mixed_year_ap')
        self.assertEqual(r['candidate']['projectCodes'], b['projectCodes'])
        self.assertEqual(r['candidate']['meta']['erpAsOf'], b['meta']['erpAsOf'])
        self.assertNotIn('paid', y['fieldProvenance'])

    def test_boq_only_preserves_unknown_upper_bound(self):
        b = baseline()
        b['plots'][0]['years'][2].update(possiblePaid=None, possibleBalance=None)
        y = preview(xlsx({'B2': 110}), b, ('boq',))['candidate']['plots'][0]['years'][2]
        self.assertIsNone(y['possiblePaid'])
        self.assertIsNone(y['possibleBalance'])

    def test_boq_only_does_not_claim_missing_payment_evidence(self):
        b = baseline()
        b['plots'][0]['years'][2].update(paid=0, possiblePaid=0, balance=100, possibleBalance=100,
            status='no_data', paymentDataAvailable=False, paymentConfidence='no_data')
        y = preview(xlsx({'B2': 110}), b, ('boq',))['candidate']['plots'][0]['years'][2]
        self.assertEqual((y['status'], y['paymentDataAvailable'], y['paymentConfidence']), ('no_data', False, 'no_data'))

    def test_r5_confirmed_zero_updates_authority_without_numeric_delta(self):
        b = baseline()
        b['plots'][0]['years'][2].update(paid=0, possiblePaid=0, balance=100, possibleBalance=100,
            status='no_data', paymentDataAvailable=False, paymentConfidence='no_data')
        r = preview(xlsx({'C2': 0, 'C3': 20}), b, ('paid',))
        self.assertEqual(r['status'], 'PASS')
        y = r['candidate']['plots'][0]['years'][2]
        self.assertEqual((y['paid'], y['status'], y['paymentDataAvailable']), (0, 'not_started', True))
        self.assertEqual(y['paymentConfidence'], 'reviewed_cumulative_ap_snapshot')
        d = next(d for d in r['diff'] if d['plotCode'] == '14-STC')
        self.assertFalse(d['numericChanged'])
        self.assertTrue(d['evidenceChanged'])
        self.assertTrue(d['changed'])
        self.assertEqual(y['fieldProvenance']['paid']['cell'], 'C2')
        self.assertEqual(r['candidate']['projectCodes'], b['projectCodes'])

    def test_paid_source_can_resolve_range_even_without_numeric_change(self):
        b = baseline()
        b['plots'][0]['years'][2].update(possiblePaid=20, possibleBalance=80, paymentConfidence='mixed_year_ap')
        raw = xlsx({'C2': 10, 'C3': 20})
        r = preview(raw, b, ('paid',))
        y = r['candidate']['plots'][0]['years'][2]
        self.assertEqual((y['possiblePaid'], y['possibleBalance']), (10, 90))
        self.assertEqual(y['paymentConfidence'], 'reviewed_cumulative_ap_snapshot')
        again = preview(raw, r['candidate'], ('paid',))
        self.assertFalse(any(d['changed'] for d in again['diff']))

    def test_unmapped_years_and_fields_are_unchanged(self):
        b = baseline()
        r = preview(xlsx({'B2': 110}), b, ('boq',))
        for old, new in zip(b['plots'], r['candidate']['plots']):
            self.assertEqual(old['years'][:2], new['years'][:2])
            self.assertEqual(old['years'][2]['paid'], new['years'][2]['paid'])
        self.assertEqual(r['candidate']['portfolios'][0]['amounts'], b['portfolios'][0]['amounts'])


class IdentityPeriodRegressions(unittest.TestCase):
    def test_r3_same_layout_new_year_is_not_reused(self):
        old, new = Workbook(annual('ปีที่ 3')), Workbook(annual('ปีที่ 4'))
        self.assertEqual(old.layout_hash, new.layout_hash)
        p = annual_profile(old)
        validate_profile(old, p)
        r = make_preview(baseline(), [(new, p)])
        self.assertEqual(r['status'], 'BLOCKED')
        self.assertIn('OPERATING_YEAR_MISMATCH', r['issues'][0]['code'])
        with tempfile.TemporaryDirectory() as d:
            st = Store(Path(d), baseline())
            u = st.upload(annual('ปีที่ 3'), 'old.xlsx')
            st.approve(u['uploadId'], p, 'Reviewed operating year and source identities')
            self.assertEqual(st.upload(annual('ปีที่ 4'), 'new.xlsx')['matchingProfiles'], [])

    def test_year_anchor_is_required_and_cannot_point_at_data(self):
        p = profile(Workbook(xlsx())).model_dump()
        del p['regions'][0]['year_anchor']
        with self.assertRaises(ValidationError):
            Profile.model_validate(p)
        p['regions'][0]['year_anchor'] = {'kind': 'cell', 'cell': 'B2'}
        with self.assertRaises(ValidationError):
            Profile.model_validate(p)

    def test_year_anchor_cannot_silently_accept_calendar_or_unrecognised_context(self):
        for text in ('2565', '2026', 'รายงานล่าสุด', 'ปีที่ 4'):
            with self.subTest(text=text), self.assertRaises(ImportBlocked):
                w = Workbook(annual(text))
                validate_profile(w, annual_profile(w))

    def test_explicit_operating_year_formats(self):
        for text in ('ปีที่ 3', 'ปี3', 'Year 3', 'care year 3', '๓', '3'):
            with self.subTest(text=text):
                w = Workbook(annual(text))
                validate_profile(w, annual_profile(w))

    def test_r4_contract_and_project_mismatch_block(self):
        for changes, field in [({'D2': 'WRONG-CONTRACT-A'}, 'contractNo'), ({'G2': 'WRONG-PROJECT'}, 'projectCode')]:
            with self.subTest(field=field):
                r = preview(xlsx(changes))
                self.assertEqual(r['status'], 'BLOCKED')
                self.assertIn('SOURCE_IDENTITY_MISMATCH:' + field, r['issues'][0]['code'])

    def test_source_identity_columns_are_mandatory(self):
        for identity in ('contractNo', 'projectCode'):
            p = profile(Workbook(xlsx())).model_dump()
            del p['regions'][0]['columns'][identity]
            with self.subTest(identity=identity), self.assertRaises(ValidationError):
                Profile.model_validate(p)

    def test_year_specific_contract_takes_precedence_and_empty_is_not_filled(self):
        b = baseline()
        b['plots'][0]['years'][2]['contractNo'] = 'YEAR3-CONTRACT'
        self.assertEqual(preview(xlsx(), b)['status'], 'BLOCKED')
        self.assertEqual(preview(xlsx({'D2': 'YEAR3-CONTRACT'}), b)['status'], 'PASS')
        b['plots'][0]['years'][2]['contractNo'] = ''
        r = preview(xlsx(), b)
        self.assertEqual(r['status'], 'BLOCKED')
        self.assertIn('BASELINE_IDENTITY_REQUIRED', r['issues'][0]['code'])

    def test_legacy_profile_requires_new_approval_instead_of_crashing_upload(self):
        with tempfile.TemporaryDirectory() as d:
            st = Store(Path(d), baseline())
            legacy = profile(Workbook(xlsx())).model_dump()
            del legacy['schema_version']
            del legacy['regions'][0]['year_anchor']
            with st.connection(write=True) as db:
                db.execute('INSERT INTO profiles VALUES(?,?,?,?)', ('legacy', dump(legacy), 'Old approval', '2026-01-01'))
            u = st.upload(xlsx(), 'review-again.xlsx')
            self.assertEqual(u['matchingProfiles'], [])
            with self.assertRaisesRegex(ImportBlocked, 'PROFILE_UPGRADE_REVIEW_REQUIRED'):
                st.preview([{'uploadId': u['uploadId'], 'profileId': 'legacy'}], st.current()['revision'])


class PublicationRegressions(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = Store(Path(self.tmp.name), baseline())
        root = Path(__file__).resolve().parents[3]
        self.client = TestClient(create_app(self.store, root / 'boq', root / 'boq-import', 'r' * 40))
        self.addCleanup(self.client.close)
        self.auth = {'Authorization': 'Bearer ' + 'r' * 40}
        self.revision = self.store.current()['revision']

    def prepare(self, raw, make_profile=profile):
        w = Workbook(raw)
        u = self.client.post('/api/uploads', headers=self.auth, content=raw)
        self.assertEqual(u.status_code, 200)
        a = self.client.post('/api/profiles/approve', headers=self.auth, json={
            'uploadId': u.json()['uploadId'], 'profile': make_profile(w).model_dump(),
            'review': 'Independently reviewed synthetic scope and identity', 'confirmSemantics': True})
        self.assertEqual(a.status_code, 200, a.text)
        inputs = [{'uploadId': u.json()['uploadId'], 'profileId': a.json()['profileId']}]
        r = self.client.post('/api/preview', headers=self.auth, json={'inputs': inputs, 'expectedRevision': self.revision})
        self.assertEqual(r.status_code, 200)
        return inputs, r.json()

    def publish(self, inputs, report):
        return self.client.post('/api/publish', headers=self.auth, json={
            'inputs': inputs, 'previewId': report['previewId'], 'expectedRevision': self.revision, 'confirm': True})

    def test_r1_api_cannot_publish_formula_text_as_money(self):
        inputs, report = self.prepare(formula_text())
        self.assertEqual(report['status'], 'BLOCKED')
        result = self.publish(inputs, report)
        self.assertEqual(result.status_code, 422)
        self.assertEqual(result.json()['error'], 'PUBLICATION_BLOCKED')
        self.assertEqual(self.store.current()['revision'], self.revision)
        self.assertEqual(len(self.store.history()), 1)

    def test_r4_api_cannot_publish_mismatched_contract(self):
        inputs, report = self.prepare(xlsx({'D2': 'WRONG-CONTRACT'}))
        self.assertEqual(report['status'], 'BLOCKED')
        self.assertEqual(self.publish(inputs, report).status_code, 422)
        self.assertEqual(self.store.current()['revision'], self.revision)

    def test_r3_api_rechecks_year_after_reusing_an_old_approved_profile(self):
        inputs, _ = self.prepare(annual('ปีที่ 3'), annual_profile)
        u = self.client.post('/api/uploads', headers=self.auth, content=annual('ปีที่ 4'))
        self.assertEqual(u.json()['matchingProfiles'], [])
        new_inputs = [{**inputs[0], 'uploadId': u.json()['uploadId']}]
        r = self.store.preview(new_inputs, self.revision)
        self.assertEqual(r['status'], 'BLOCKED')
        self.assertEqual(self.publish(new_inputs, r).status_code, 422)
        self.assertEqual(self.store.current()['revision'], self.revision)

    def test_r6_api_rejects_removed_or_replaced_inputs(self):
        inputs, r = self.prepare(xlsx())
        self.assertEqual(self.publish([], r).status_code, 422)
        for changed in ([{**inputs[0], 'uploadId': 'removed-and-replaced'}], [{**inputs[0], 'profileId': 'different-profile'}]):
            result = self.publish(changed, r)
            self.assertEqual(result.status_code, 409)
            self.assertEqual(result.json()['error'], 'STALE_PREVIEW_INPUTS')
        self.assertEqual(self.store.current()['revision'], self.revision)
        self.assertEqual(self.publish(inputs, r).status_code, 200)

    def test_replay_is_idempotent_only_for_the_same_input_batch(self):
        inputs, r = self.prepare(xlsx())
        first = self.publish(inputs, r)
        again = self.publish(inputs, r)
        self.assertEqual(first.json()['revision'], again.json()['revision'])
        self.assertTrue(again.json()['alreadyPublished'])
        result = self.publish([{**inputs[0], 'profileId': 'different'}], r)
        self.assertEqual(result.status_code, 409)
        self.assertEqual(len(self.store.history()), 2)

    def test_current_inputs_are_required_in_publish_request(self):
        inputs, r = self.prepare(xlsx())
        response = self.client.post('/api/publish', headers=self.auth, json={
            'previewId': r['previewId'], 'expectedRevision': self.revision, 'confirm': True})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.store.current()['revision'], self.revision)


if __name__ == '__main__':
    unittest.main()

"""Real Chromium DOM + explicitly mocked HTTP. Not network/deployment E2E.

Run from the repo root after installing Python Playwright and Chromium:
  python services/boq_ingest/tests/ui_review_regressions.py --output ui-results.json
"""
import argparse
import asyncio
import json
import re
import shutil
from pathlib import Path
from playwright.async_api import async_playwright


async def run(repo, executable=None, screenshot=None):
    html = (repo / 'boq-import/index.html').read_text()
    html = re.sub(r'<script\b[^>]*>.*?</script>', '', html, flags=re.S)
    html = re.sub(r'<link\b[^>]*>', '', html)
    results = []
    async with async_playwright() as pw:
        options = {'args': ['--no-sandbox']}
        binary = executable or shutil.which('chromium') or shutil.which('google-chrome')
        if binary:
            options['executable_path'] = str(binary)
        browser = await pw.chromium.launch(**options)

        async def setup(delayed=False):
            page = await browser.new_page()
            page.set_default_timeout(4000)
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            await page.set_content(html)
            await page.add_style_tag(content=(repo / 'boq-import/styles.css').read_text())
            await page.evaluate('''delayed => {
              window.__published=[];
              const current={revision:'base-1',data:{meta:{},plots:[],portfolios:[],projectCodes:[]}};
              const report={status:'PASS',previewId:'preview-a',baseRevision:'base-1',checks:[],issues:[],provenance:[],diff:[
                {portfolio:'forest65_external',plotCode:'14-STC',year:3,changed:true,numericChanged:false,evidenceChanged:true,
                 before:{boq:'100',paid:'0'},after:{boq:'100',paid:'0'}}]};
              const response=(data,status=200)=>({ok:status<400,status,json:async()=>data});
              window.fetch=async(path,opts={})=>{
                if(path==='/api/session')return response({csrf:'test-csrf'});
                if(path==='/api/current')return response(current);
                if(path==='/api/history')return response([]);
                if(path==='/api/uploads')return response({uploadId:opts.body.name,inspection:{layoutHash:'a'.repeat(64)},
                  matchingProfiles:[{id:'profile-a',name:'Mapping A',profile:{schema_version:2}},
                                    {id:'profile-b',name:'Mapping B',profile:{schema_version:2}}]});
                if(path==='/api/preview')return delayed?await new Promise(resolve=>{
                  window.__finishPreview=()=>resolve(response(report));}):response(report);
                if(path==='/api/publish'){
                  window.__published.push(JSON.parse(opts.body));current.revision='new-revision';return response({revision:current.revision});
                }
                if(path.startsWith('/api/ai-payload/'))return response({samples:'Masked synthetic sample'});
                if(path==='/api/ai-suggest')return response({profile:{schema_version:2,name:'Unapproved AI suggestion'}});
                throw new Error('Unexpected mocked route '+path);
              };
            }''', delayed)
            await page.add_script_tag(content=(repo / 'boq-import/app.js').read_text())
            await page.wait_for_function("!document.getElementById('workspace').hidden")
            return page, errors

        async def upload(page, name='source-a.xlsx'):
            await page.locator('#files').set_input_files({'name': name, 'mimeType': 'application/octet-stream', 'buffer': b'Synthetic UI fixture; XLSX parsing is tested separately'})
            await page.wait_for_function("document.querySelectorAll('#uploads .filecard').length===1")
            await page.locator('#uploads select').select_option('profile-a')
            await page.wait_for_function("!document.getElementById('preview').disabled")

        async def ready(page):
            await upload(page)
            await page.locator('#preview').click()
            await page.wait_for_function("!document.getElementById('report').hidden")

        async def assert_no_publish(page):
            assert await page.locator('#publish').is_disabled()
            # Even a programmatic click cannot bypass the handler's current-batch guard.
            await page.locator('#publish').dispatch_event('click')
            assert await page.evaluate('window.__published.length') == 0

        for scenario in ('remove_pending', 'change_and_restore_mapping_pending', 'valid_publish',
                         'invalid_upload_clears_preview', 'partial_upload_clears_preview',
                         'edit_mapping_clears_preview', 'ai_suggestion_revokes_approval', 'mobile_layout'):
            print('RUN', scenario, flush=True)
            page, errors = await setup(scenario.endswith('pending'))
            try:
                if scenario.endswith('pending'):
                    await upload(page)
                    await page.locator('#preview').click()
                    await page.wait_for_function("typeof window.__finishPreview==='function'")
                    if scenario == 'remove_pending':
                        await page.get_by_role('button', name='นำออกจากรอบนี้').click()
                        assert await page.locator('#uploads .filecard').count() == 0
                    else:
                        await page.locator('#uploads select').select_option('profile-b')
                        await page.locator('#uploads select').select_option('profile-a')
                    await page.evaluate('window.__finishPreview()')
                    await page.wait_for_function("document.getElementById('message').textContent.includes('ยกเลิกผลตรวจเก่า')")
                    assert await page.locator('#report').is_hidden()
                    await assert_no_publish(page)
                elif scenario == 'valid_publish':
                    await ready(page)
                    assert 'ปรับหลักฐาน/สถานะ' in await page.locator('#diff').inner_text()
                    await page.locator('#publishConsent').check()
                    await page.locator('#publish').click()
                    await page.wait_for_function('window.__published.length===1')
                    request = await page.evaluate('window.__published[0]')
                    assert request['inputs'] == [{'uploadId': 'source-a.xlsx', 'profileId': 'profile-a'}]
                    assert request['previewId'] == 'preview-a' and request['expectedRevision'] == 'base-1'
                elif scenario in ('invalid_upload_clears_preview', 'partial_upload_clears_preview'):
                    await ready(page)
                    await page.locator('#publishConsent').check()
                    batch = [{'name': 'wrong.txt', 'mimeType': 'text/plain', 'buffer': b'invalid'}]
                    if scenario == 'partial_upload_clears_preview':
                        batch.insert(0, {'name': 'source-b.xlsx', 'mimeType': 'application/octet-stream', 'buffer': b'UI fixture'})
                    await page.locator('#files').set_input_files(batch)
                    await page.wait_for_function("document.getElementById('message').textContent.includes('รองรับ .xlsx')")
                    assert await page.locator('#report').is_hidden()
                    assert await page.locator('#uploads .filecard').count() == (2 if len(batch) == 2 else 1)
                    await assert_no_publish(page)
                elif scenario in ('edit_mapping_clears_preview', 'ai_suggestion_revokes_approval'):
                    await ready(page)
                    await page.get_by_role('button', name='ตรวจ Mapping', exact=True).click()
                    if scenario == 'edit_mapping_clears_preview':
                        await page.locator('#profile').fill('{"schema_version":2,"name":"Changed mapping"}')
                    else:
                        await page.locator('#sampleAI').click()
                        await page.locator('#aiConsent').check()
                        await page.locator('#suggestAI').click()
                        await page.wait_for_function("document.getElementById('profile').value.includes('Unapproved AI suggestion')")
                    assert await page.locator('#preview').is_disabled()
                    assert await page.locator('#report').is_hidden()
                    await assert_no_publish(page)
                else:
                    await ready(page)
                    await page.set_viewport_size({'width': 390, 'height': 844})
                    overflow = await page.evaluate('document.documentElement.scrollWidth>innerWidth')
                    assert not overflow
                    if screenshot:
                        await page.screenshot(path=str(screenshot), full_page=True)
                assert errors == [], errors
                results.append({'case': scenario, 'pass': True, 'javascriptErrors': errors})
            except Exception as exc:
                results.append({'case': scenario, 'pass': False, 'error': str(exc), 'javascriptErrors': errors})
            finally:
                await page.close()
        await browser.close()
    return {'transport': 'Chromium DOM with mocked HTTP; NOT network or deployment E2E', 'results': results}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[3])
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--chromium', type=Path)
    parser.add_argument('--screenshot', type=Path)
    args = parser.parse_args()
    result = asyncio.run(run(args.repo, args.chromium, args.screenshot))
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if all(x['pass'] for x in result['results']) else 1)

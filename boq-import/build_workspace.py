"""Build the repeatable renderer from the existing, validated BOQ dashboard.

Run after `node boq/validate-embedded.js`. --publish-entry is only for the
GitHub Pages build copy; the private service's source index.html is unchanged.
"""
from pathlib import Path
import argparse
import re

ROOT = Path(__file__).resolve().parents[1]

def build(publish_entry: bool = False) -> None:
    source = (ROOT / "boq/app.js").read_text(encoding="utf-8")
    def replace_once(old: str, new: str) -> None:
        nonlocal source
        if source.count(old) != 1:
            raise RuntimeError("BOQ renderer changed; review workspace adapter: " + old[:80])
        source = source.replace(old, new, 1)
    replace_once("(async () => {", """(() => {
  const mainTemplate=document.getElementById('financeDashboard').cloneNode(true);
  const modalTemplate=document.getElementById('modalBackdrop').cloneNode(true);
  let controller;
  window.renderBOQ=function(data,savedView={}){
  if(controller)controller.abort();controller=new AbortController();
  document.getElementById('financeDashboard').replaceWith(mainTemplate.cloneNode(true));
  document.getElementById('modalBackdrop').replaceWith(modalTemplate.cloneNode(true));
""")
    replace_once("const D = await window.FINANCE_DATA_PROMISE;", "const D = data;")
    replace_once("search:'', sort:'balance' };", "search:'', sort:'balance',...savedView };\n  if(!portfolioMap[state.portfolio])state.portfolio='forest65_external';")
    replace_once("document.addEventListener('keydown',e=>{if(e.key==='Escape') closeModal();});", "document.addEventListener('keydown',e=>{if(e.key==='Escape') closeModal();},{signal:controller.signal});")
    source, count = re.subn(r"  function renderSource\(\)\{[^\n]+\}", "  function renderSource(){ $('sourceNote').textContent='ERP AP ถึง '+D.meta.erpAsOf+' • '+(D.meta.erpSource||'Excel')+' • BOQ เดิม + ข้อมูล AP ที่รวมแล้ว'; }", source)
    if count != 1:
        raise RuntimeError("BOQ source footer changed; review adapter")
    replace_once("  initFilters(); render();\n})();", """  initFilters();
  for(const id of ['company','province','token','search','sort']){if($(id))$(id).value=state[id]??'';}
  populateProjectCodes();populateYears();render();
  $('financeDashboard').hidden=false;
  window.BOQDashboard={getState:()=>({...state})};
  };
})();""")
    (ROOT / "boq-import/dashboard.js").write_text(source, encoding="utf-8")
    if publish_entry:
        (ROOT / "boq-import/index.html").write_bytes((ROOT / "boq-import/workspace.html").read_bytes())

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--publish-entry", action="store_true")
    build(parser.parse_args().publish_entry)

"""Build the existing legacy snapshot in a disposable copy, never patch the checkout."""
import argparse
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from .core import baseline_keys


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--state',type=Path,required=True)
    parser.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[2])
    args=parser.parse_args();repo=args.repo.resolve();state=args.state.resolve()
    if repo==state or repo in state.parents:
        raise SystemExit('Private state must be outside the repository')
    if (state/'baseline.json').exists() or (state/'ingestion.sqlite3').exists():
        raise SystemExit('State already exists; refusing to replace baseline or history')
    state.mkdir(parents=True,exist_ok=True,mode=0o700);os.chmod(state,0o700)
    with tempfile.TemporaryDirectory(prefix='boq-bootstrap-') as tmp:
        build=Path(tmp)
        shutil.copytree(repo/'boq',build/'boq',ignore=shutil.ignore_patterns('*.xlsx','*.xlsm','*.xls','*.sqlite3*','.env'))
        subprocess.run(['node','boq/validate-embedded.js'],cwd=build,check=True,timeout=120)
        data=json.loads((build/'boq/finance-data.json').read_text(encoding='utf-8'))
        baseline_keys(data)
        assets=state/'assets';assets.mkdir(mode=0o700)
        for name in ('index.html','app.js','styles.css'):
            shutil.copyfile(build/'boq'/name,assets/name)
        target=state/'baseline.json';target.write_text(json.dumps(data,ensure_ascii=False,allow_nan=False),encoding='utf-8');os.chmod(target,0o600)
    print('Private baseline created. Checkout and GitHub Pages were not changed.')


if __name__=='__main__':main()

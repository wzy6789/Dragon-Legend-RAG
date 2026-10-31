"""Offline representative-code/index compatibility check. Never loads a model."""
import gc
import hashlib
import json
import sys
from pathlib import Path

from experiment_catalog import ROOT, visible_systems
from flash_runtime import modules, read


def main():
    rows=[]
    for system in visible_systems():
        if system['config'].get('adapter')!='modern_flash': continue
        settings=system['config']; number=settings['number']
        run=ROOT/system['results'][0]
        manifest=read(run/'run_manifest.json')
        expected={p:h for p,h in manifest['fingerprints'].items()
                  if p.startswith('src/flash'+number+'/') and p.endswith('.py')}
        source=ROOT/settings['source']
        for name,digest in expected.items():
            relative=Path(name).relative_to('src/flash'+number)
            assert hashlib.sha256((source/relative).read_bytes()).hexdigest()==digest, name
        m=modules(ROOT,settings)
        backend=m['resources'].load_backend(ROOT)
        rows.append({'id':system['id'],'code_matches_recorded_manifest':True,
                     'checked_files':len(expected),'model_loaded':backend.encoder is not None or backend.ranker is not None,
                     'source_rows':{s.source:len(s.rows) for s in backend.sources},
                     'data_version':backend.version})
        assert not rows[-1]['model_loaded']
        print(json.dumps(rows[-1],ensure_ascii=False),flush=True)
        del backend
        gc.collect()
    report={'checks':rows,'generation_calls':0,'judge_calls':0,'test_set_used':False,
            'scope':'historical code + current private resources; no quality or latency claim'}
    out=ROOT/'data/web-flash-integration'
    out.mkdir(parents=True,exist_ok=True)
    (out/'resource-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')


if __name__=='__main__': main()

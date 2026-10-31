"""Launch from this directory: python server.py --port 8011. Private corpus stays outside Git."""
import argparse
import os
import sqlite3
import sys
from pathlib import Path

ROOT=Path(os.environ.get('RAG_PROJECT_ROOT','F:/龙王传说智能体'))
sys.path.insert(0,str(ROOT/'src'))
sys.path.insert(0,str(Path(__file__).parent))
os.environ.setdefault('RAG_EXPERIMENT_DB',str(ROOT/'data/experiment_web_runs.sqlite3'))
private_config=Path(os.environ.get('RAG_EXPERIMENT_ENV','D:/RAG实验网站/experiment-admin.env'))
if private_config.is_file():
    for line in private_config.read_text(encoding='utf-8-sig').splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key,value=line.split('=',1)
            if key.strip().startswith('RAG_EXPERIMENT_'):os.environ.setdefault(key.strip(),value.strip())
# Use the complete existing project cache, before importing transformers. The desktop
# may carry an unrelated HF_HOME whose snapshots are incomplete; do not download silently.
cache=Path(os.environ.get('RAG_EXPERIMENT_HF_HOME',str(ROOT/'data/flash20/cache/huggingface')))
if cache.is_dir():
    for name in ('HF_HOME',):os.environ[name]=str(cache)
    for name in ('HF_HUB_CACHE','HUGGINGFACE_HUB_CACHE'):os.environ[name]=str(cache/'hub')
    os.environ['HF_HUB_OFFLINE']='1'
    os.environ['TRANSFORMERS_OFFLINE']='1'
    import config
    for attr, model in [('EMBED_MODEL_NAME','bge-m3'),('RERANKER_MODEL_NAME','bge-reranker-v2-m3')]:
        snapshots=cache/'hub'/('models--BAAI--'+model)/'snapshots'
        candidates=[p for p in snapshots.glob('*') if (p/'config.json').is_file() and
                    ((p/'model.safetensors').is_file() or (p/'pytorch_model.bin').is_file())]
        if len(candidates)!=1:
            raise RuntimeError('Expected one complete local snapshot for '+model+'; configure RAG_EXPERIMENT_HF_HOME')
        # Imported snapshots have complete weights but no hub refs/main; load the exact directory.
        setattr(config,attr,str(candidates[0]))

def copy_history_once():
    target=Path(os.environ['RAG_EXPERIMENT_DB']); source=ROOT/'data/web_runs.sqlite3'
    if not target.exists() and source.is_file():
        target.parent.mkdir(parents=True,exist_ok=True)
        with sqlite3.connect(f'file:{source.as_posix()}?mode=ro',uri=True) as original, sqlite3.connect(target) as dest:
            original.backup(dest)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8011)
    parser.add_argument('--host',default='127.0.0.1');args=parser.parse_args()
    copy_history_once()
    import uvicorn
    uvicorn.run('web_bridge:app',host=args.host,port=args.port)

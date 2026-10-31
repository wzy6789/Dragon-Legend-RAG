"""Research-line-qualified catalogue. Discovery is not runtime certification."""
from __future__ import annotations
import ast
import hashlib
import json
import os
from functools import lru_cache
from pathlib import Path

ROOT=Path(os.environ.get('RAG_PROJECT_ROOT','F:/龙王传说智能体'))
PAPER=Path(os.environ.get('RAG_PAPER_ROOT','F:/rag系统论文'))
DEFAULTS={'flash':'flash-v19-sem_select','pro':'pro-v25','max':'max-v31'}

def fingerprint(paths):
    return hashlib.sha256(''.join(str(p.relative_to(ROOT))+':'+hashlib.sha256(p.read_bytes()).hexdigest()
        for p in paths if p.is_file() and p.is_relative_to(ROOT)).encode()).hexdigest()

@lru_cache(maxsize=1)
def systems():
    out=[]
    def add(sid,family,version,variant,source,tiers,status='pending',config=None,notes=''):
        path=ROOT/source
        results=[]
        for folder in [ROOT/'results/flashbench',ROOT/'results/legacy50',ROOT/'results/pro32']:
            if folder.is_dir():
                results.extend(str(p.relative_to(ROOT)) for p in folder.iterdir()
                               if sid.replace('flash-','').replace('pro-','').replace('max-','').replace('-','_') in p.name)
        out.append(dict(id=sid,family=family,version=version,variant=variant,
            label=f'{family} {version}'+(f' · {variant}' if variant else ''),tiers=tiers,
            source=str(path.relative_to(ROOT)),status=status if path.exists() else 'archive',
            config=config or {},notes=notes or ('已接线；结果以实际运行记录为准' if status=='runnable' else '尚未完成此入口验证，不替换为其他版本'),
            results=results,code_fingerprint=fingerprint([path]) if path.is_file() else None))
    for n in (16,17,18,19):
        add(f'flash-v{n}','Flash',f'v1.{n-10}','base',f'src/flash_v{n}.py',['flash'])
    for variant in ['patch1','patch2']:
        add('flash-v17-'+variant,'Flash','v1.7',variant,'src/flash_v17.py',['flash'])
    add('flash-v18-slot2c','Flash','v1.8','slot2c','src/flash_v18.py',['flash'])
    for variant in ['ev2','plan2','sem','sem_select']:
        add('flash-v19-'+variant,'Flash','v1.9',variant,'src/flash_v19.py',['flash'],'runnable',
            {'profile':'RAG1','kg':True,'flash_version':'v1.9','flash_profile':variant})
    for n in (20,21,22):
        add(f'flash-v{n}','Flash',f'v2.{n-20}','base',f'src/flash{n}',['flash'])
    historic=[('10','v1.0','基础检索'),('11','v1.1','历史'),('12','v1.2','历史'),
        ('13','v1.3','历史'),('14','v1.4','历史'),('15','v1.5','CRAG'),
        ('20','v2.0','Agentic'),('21','v2.1','EWE'),('22','v2.2','章节对齐'),('23','v2.3','扩展支线')]
    for sid,version,variant in historic:
        add('pro-v'+sid,'Pro/Max',version,variant,'src/agents.py',['pro','max'],'archive',
            notes='历史能力组合；展示归档，恢复运行需对应冻结配置')
    for variant in ['kg-on','kg-off']:
        add('pro-v22-'+variant,'Pro/Max','v2.2',variant,'src/kg',['pro','max'])
    for sid,version,source,flags,tiers in [
        ('pro-v25','v2.5','src/pro_v25.py',{'v25':True},['pro']),
        ('max-v30','v3.0','src/pro_v30.py',{'v30':True},['max']),
        ('max-v31','v3.1','src/pro_v31.py',{'v31':True},['max']),
        ('pro-v32','v3.2','src/pro32',{},['pro','max'])]:
        add(sid,'Pro/Max',version,'base',source,tiers,'runnable' if sid in DEFAULTS.values() else 'pending',
            {'profile':'RAG4','kg':True,**flags})
    add('baseline-v00','基线与消融','v0.0','裸模型','src/agents.py',[],'archive')
    for variant in ['crag','agentic','ewe','chapter-align','kg-off','kg-on']:
        add('ablation-'+variant,'基线与消融','controlled',variant,'src/agents.py',[],'archive')
    # Preserve every additional locally recorded identity and subvariant as an archive entry.
    for vault in [PAPER/'rag研究',PAPER/'Obsidian知识库']:
        file=vault/'08_原始资料索引/批次合并配置.json'
        if not file.is_file(): continue
        data=json.loads(file.read_text(encoding='utf-8'))
        for batch in data.get('batches',[]):
            version=batch['version'];family='Flash' if batch['bank']=='FlashBench' else '历史实验'
            if any(x['version']==version and x['family']==family for x in out): continue
            if family=='Flash' and any(version.replace('-',' ').endswith(x['variant']) and version.startswith(x['version'])
                                        for x in out if x['family']==family): continue
            sid='archive-'+hashlib.sha256((family+version).encode()).hexdigest()[:12]
            if any(x['id']==sid for x in out):continue
            out.append(dict(id=sid,family=family,version=version,variant='记录中的版本身份',label=family+' '+version,
                tiers=[],source='本地实验清单',status='archive',config={},notes='归档身份；不推断运行配置',
                results=[batch.get('run','')],code_fingerprint=None))
        break
    return out

def resolve_system(system_id,tier):
    selected=next((x for x in systems() if x['id']==system_id),None)
    if selected is None: raise ValueError('未知系统版本')
    if selected['status']!='runnable': raise ValueError('此版本尚未通过运行入口验证')
    if tier not in selected['tiers']: raise ValueError('档位与版本不匹配')
    return json.loads(json.dumps(selected))

def install(app):
    @app.get('/api/systems')
    def catalogue():
        return {'systems':systems(),'defaults':DEFAULTS}

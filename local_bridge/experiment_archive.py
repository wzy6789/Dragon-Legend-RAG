"""Authenticated read-only local batch records; originals are never uploaded."""
import hashlib
import json
from fastapi import Header, HTTPException
from experiment_catalog import PAPER

def inventory():
    for vault in (PAPER/'rag研究',PAPER/'Obsidian知识库'):
        manifest=vault/'08_原始资料索引/批次合并配置.json'
        if manifest.is_file():
            rows=[]
            for r in json.loads(manifest.read_text(encoding='utf-8')).get('batches',[]):
                p=(vault/r['note']).resolve()
                if not p.is_relative_to(vault.resolve()) or not p.is_file():continue
                rows.append({**{k:r.get(k) for k in ('version','bank','label','question_count','scored_questions')},
                    'id':hashlib.sha256(r['note'].encode()).hexdigest()[:24], '_path':p})
            return rows
    return []

def install(app,service,bridge):
    def authorize(token,key):
        if not token or not service.authorize_admin(token):raise HTTPException(403,'仅管理员可以读取历史实验档案')
        service.require_admin_owner(token,bridge._owner_id(key or ''))

    @app.get('/api/archives')
    def batches(admin: str|None=Header(None,alias='X-Experiment-Admin'),key: str|None=Header(None,alias='X-RAG-Access-Key')):
        authorize(admin,key)
        return {'batches':[{k:v for k,v in r.items() if k!='_path'} for r in inventory()]}

    @app.get('/api/archives/{batch_id}')
    def batch(batch_id:str,admin: str|None=Header(None,alias='X-Experiment-Admin'),key: str|None=Header(None,alias='X-RAG-Access-Key')):
        authorize(admin,key)
        r=next((r for r in inventory() if r['id']==batch_id),None)
        if r is None:raise HTTPException(404,'历史批次不存在')
        return {**{k:v for k,v in r.items() if k!='_path'},'markdown':r['_path'].read_text(encoding='utf-8')}

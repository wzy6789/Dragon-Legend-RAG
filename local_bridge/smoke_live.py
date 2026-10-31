"""Exactly three generation tasks, auto-judged as admin. Reuse saved task IDs on resume."""
import json
import os
import sys
import time
from pathlib import Path
import requests
from experiment_catalog import ROOT
sys.path.insert(0,str(ROOT/'src'))
import config

BASE='http://127.0.0.1:8011'
TAG=os.environ.get('RAG_SMOKE_ID','experiment-smoke-20261031')
OUT=Path('D:/RAG实验网站/验收/'+TAG+'.json');OUT.parent.mkdir(parents=True,exist_ok=True)
headers={'X-RAG-Access-Key':config.DEEPSEEK_API_KEY,'X-LLM-API-Key':config.DEEPSEEK_API_KEY}
private=Path('D:/RAG实验网站/experiment-admin.env').read_text(encoding='utf-8')
password=next(x.split('=',1)[1] for x in private.splitlines() if x.startswith('RAG_EXPERIMENT_ADMIN_PASSWORD='))
login=requests.post(BASE+'/api/admin/login',headers=headers,json={'password':password},timeout=15)
login.raise_for_status();headers['X-Experiment-Admin']=login.json()['token']
saved=json.loads(OUT.read_text(encoding='utf-8')) if OUT.is_file() else {'tasks':[]}
question=next(q for q in requests.get(BASE+'/api/benchmarks').json()['benchmarks'] if q['id']=='new49')['questions'][0]
for tier,system in [('flash','flash-v19-sem_select'),('pro','pro-v25'),('max','max-v31')]:
    if any(t['tier']==tier for t in saved['tasks']):continue
    req={'message':question['question'],'tier':tier,'system_id':system,'conversation_id':TAG+'-'+tier,
         'client_request_id':TAG+'-'+tier,
         'benchmark_id':'free' if tier=='flash' else 'new49',
         'question_id':None if tier=='flash' else question['id']}
    r=requests.post(BASE+'/api/runs',headers=headers,json=req,timeout=20)
    if r.status_code!=200:raise RuntimeError(f'{tier} create failed HTTP {r.status_code}')
    saved['tasks'].append({'tier':tier,'run_id':r.json()['run_id']})
    OUT.write_text(json.dumps(saved,ensure_ascii=False,indent=2),encoding='utf-8')
terminal={'done','error','failed','blocked','not_authorized','unavailable','interrupted'}
last={};deadline=time.monotonic()+1200
while time.monotonic()<deadline:
    complete=True
    for task in saved['tasks']:
        r=requests.get(BASE+'/api/runs/'+task['run_id'],headers=headers,timeout=15)
        if r.status_code==429:
            complete=False
            continue
        r.raise_for_status();s=r.json()
        task['snapshot']=s
        evaluations=(s.get('experiment') or {}).get('evaluations',[])
        state=(s['status'],','.join(e['status'] for e in evaluations))
        if last.get(task['tier'])!=state:
            print(json.dumps({'tier':task['tier'],'generation':state[0],'evaluation':state[1]},ensure_ascii=False),flush=True)
            last[task['tier']]=state
        complete &= s['status'] in terminal and bool(evaluations) and all(e['status'] in terminal for e in evaluations)
    OUT.write_text(json.dumps(saved,ensure_ascii=False,indent=2),encoding='utf-8')
    if complete:break
    time.sleep(5)
else:raise RuntimeError('Smoke deadline reached; tasks preserved for resume, not regenerated.')
summary=[{'tier':t['tier'],'generation':t['snapshot']['status'],'answer_chars':len(t['snapshot']['answer']),
          'metrics':t['snapshot']['experiment']['metrics'],
          'evaluations':[{k:e.get(k) for k in ('status','score','judge_model','protocol_id','usage','error')} for e in t['snapshot']['experiment']['evaluations']]}
         for t in saved['tasks']]
print(json.dumps(summary,ensure_ascii=False),flush=True)
if any(t['snapshot']['status']!='done' or any(e['status']!='done' for e in t['snapshot']['experiment']['evaluations']) for t in saved['tasks']):sys.exit(1)

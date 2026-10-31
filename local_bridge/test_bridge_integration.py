"""Route/storage/owner tests with fake generation. No real model or GPU."""
import importlib.util
import os
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient

class FakeAgent:
    def __init__(self):self.messages=[]
    def _trim_history(self):pass
    def answer(self,q):return '测试回答', [{'chunk_id':'ch0001_001','text_full':'直接证据全文','chapter_index':1}]

class BridgeIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cfg=types.ModuleType('config')
        for name in ['CRAG_FILTER_ENABLED','RELEVANCE_ENABLED','AGENTIC_ENABLED','AGENTIC2_ENABLED','ITERATIVE_ENABLED',
            'POLISH_ENABLED','DECOMPOSE_ENABLED','HYDE_ENABLED','CHAPTER_ALIGNMENT_ENABLED','KG_ENABLED',
            'PRO_V25_ENABLED','PRO_V25_KG_ENABLED','PRO_V30_ENABLED','PRO_V30_KG_ENABLED','PRO_V31_ENABLED',
            'PRO_V31_KG_ENABLED','PRO_V32_ENABLED']:
            setattr(cls.cfg,name,False)
        cls.cfg.DEEPSEEK_API_KEY='';cls.cfg.LLM_MODEL='fake-generation';cls.cfg.apply_cap_profile=lambda x:None
        cls.cfg.QWEN_API_KEY='';cls.cfg.QWEN_BASE_URL='https://invalid.test'
        fake=types.ModuleType('agents');fake.QAAgent=FakeAgent;fake._client=None;fake.WebRunCancelled=type('WebRunCancelled',(Exception,),{})
        fake.gen_model=lambda:cls.cfg.LLM_MODEL
        cls.modules=patch.dict(sys.modules,{'agents':fake,'config':cls.cfg});cls.modules.start()
        sys.path.append(str(Path('F:/龙王传说智能体/src')))
        import v19_profiles
        for k,v in v19_profiles.profile_config('sem_select').items():setattr(cls.cfg,k,False if isinstance(v,bool) else 0)
        spec=importlib.util.spec_from_file_location('experiment_test_bridge',Path(__file__).with_name('web_bridge.py'))
        cls.bridge=importlib.util.module_from_spec(spec);sys.modules[spec.name]=cls.bridge;spec.loader.exec_module(cls.bridge)
    @classmethod
    def tearDownClass(cls):cls.modules.stop()
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();b=self.bridge;b._RUN_DB=Path(self.tmp.name)/'runs.sqlite3'
        b._init_run_store();b.experiment_service.initialize(b);b._WARMUP['done']=True;b._request_windows.clear();b._sessions.clear()
        self.client=TestClient(b.app);self.headers={'X-RAG-Access-Key':'test-owner','X-LLM-API-Key':'test-owner'}
    def tearDown(self):
        for f in list(self.bridge._RUN_FUTURES.values()):f.result(timeout=5)
        self.bridge.experiment_service._service.close()
        self.tmp.cleanup()
    def create(self,**kw):
        body={'message':'一个自由问题','tier':'pro','system_id':'pro-v25','conversation_id':'same-chat','client_request_id':'request-1',**kw}
        return self.client.post('/api/runs',json=body,headers=self.headers)
    def wait(self,rid):
        for _ in range(100):
            r=self.client.get('/api/runs/'+rid,headers=self.headers).json()
            if r['status'] in ('done','error','stopped'):return r
            time.sleep(.02)
        self.fail('mock run did not finish')
    def test_complete_snapshot_and_idempotency(self):
        created=self.create();self.assertEqual(created.status_code,200,created.text)
        rid=created.json()['run_id'];r=self.wait(rid)
        self.assertEqual(r['status'],'done');self.assertEqual(r['answer'],'测试回答')
        self.assertEqual(r['experiment']['system_id'],'pro-v25')
        self.assertIsNotNone(r['experiment']['metrics']['execution_ms'])
        self.assertEqual(self.create().json()['run_id'],rid)
    def test_cross_owner_cannot_read_or_reuse_history(self):
        rid=self.create().json()['run_id'];self.wait(rid)
        res=self.client.get('/api/runs/'+rid,headers={'X-RAG-Access-Key':'other-owner'})
        self.assertEqual(res.status_code,404)
        agent=self.bridge._get_agent('same-chat',self.bridge._owner_id('other-owner'))
        self.assertEqual(agent.messages,[])
    def test_unvalidated_or_wrong_tier_never_starts(self):
        self.assertEqual(self.create(system_id='flash-v22').status_code,422)
        self.assertEqual(self.create(system_id='max-v31').status_code,422)
    def test_flash_profile_executes_selected_variant_and_restores_flags(self):
        b=self.bridge;observed=[]
        def fake_flash(agent,question,version):
            import v19_profiles
            observed.append(v19_profiles.active_profile())
            yield b._event('sources',{'sources':[{'chunk_id':'ch1','snippet':'source'}]})
            yield b._event('token',{'text':'flash answer'})
        with patch.object(b,'_flash',fake_flash):
            rid=self.create(tier='flash',system_id='flash-v19-ev2').json()['run_id'];r=self.wait(rid)
        self.assertEqual(r['status'],'done');self.assertEqual(observed,['ev2'])
        self.assertEqual(r['sources'][0]['chunk_id'],'ch1')
        self.assertFalse(self.cfg.FLASH_V19_COMPLETE_GUARD)

    def test_selected_legacy_generation_is_not_forced_to_v19(self):
        b=self.bridge;observed=[]
        def fake_flash(agent, question, version):
            observed.append(version)
            yield b._event('token', {'text':'legacy answer'})
        with patch.object(b, '_flash', fake_flash):
            for i,sid in enumerate(('flash-v16','flash-v17-patch2','flash-v18-slot2c')):
                rid=self.create(tier='flash', system_id=sid, client_request_id='old-'+str(i)).json()['run_id']
                self.assertEqual(self.wait(rid)['status'],'done')
        self.assertEqual(observed,['v1.6','v1.7','v1.8'])

    def test_promax_executes_each_selected_architecture_and_restores_it(self):
        b=self.bridge;seen=[];profiles=[]
        def fake_answer(agent,question):
            names=('PRO_V25_ENABLED','PRO_V30_ENABLED','PRO_V31_ENABLED','PRO_V32_ENABLED')
            options=getattr(agent,'_pro32_config',None)
            seen.append((profiles[-1],tuple(getattr(self.cfg,k) for k in names),
                         self.cfg.KG_ENABLED,self.cfg.CHAPTER_ALIGNMENT_ENABLED,
                         options.snapshot() if options else None))
            agent._last_answer_confidence={'completion':'partial'} if options else {}
            agent._llm_call_metadata=[{'model':'fake-generation','label':'test'}]
            return '按所选架构生成的模拟回答',[]
        choices=[('pro-v20','pro','RAG3',(False,False,False,False),False,False),
                 ('pro-v21','pro','RAG4',(False,False,False,False),False,False),
                 ('pro-v22','pro','RAG5',(False,False,False,False),True,True),
                 ('pro-v25','pro','RAG4',(True,False,False,False),False,False),
                 ('max-v30','max','RAG4',(False,True,False,False),True,False),
                 ('max-v31','max','RAG4',(False,False,True,False),True,False),
                 ('max-v32','max','RAG4',(False,False,False,True),True,False),
                 ('max-v30','max','RAG4',(False,True,False,False),True,False)]
        before={k:getattr(self.cfg,k) for k in b._PROFILE_FLAGS}
        with patch.object(FakeAgent,'answer',fake_answer),patch.object(self.cfg,'apply_cap_profile',profiles.append):
            for i,(sid,tier,profile,flags,kg,align) in enumerate(choices):
                response=self.create(tier=tier,system_id=sid,client_request_id='route-'+str(i))
                self.assertEqual(response.status_code,200,response.text)
                result=self.wait(response.json()['run_id'])
                self.assertEqual(result['status'],'done',sid)
                self.assertEqual(seen[-1][:4],(profile,flags,kg,align))
                self.assertEqual({k:getattr(self.cfg,k) for k in before},before)
                if sid=='max-v32':
                    self.assertEqual(seen[-1][4]['max_calls'],32)
                    self.assertEqual(result['completion_status'],'partial')
                    self.assertEqual(result['experiment']['runtime_config']['max_calls'],32)
                    self.assertEqual(result['experiment']['metrics']['call_count'],1)
                else:self.assertIsNone(seen[-1][4])
        agent=b._get_agent('same-chat',b._owner_id('test-owner'))
        self.assertIsNone(getattr(agent,'_pro32_config',None))

    def test_max32_options_and_callbacks_are_cleared_on_failure(self):
        b=self.bridge
        def fail(agent,question):
            self.assertEqual(agent._pro32_config.max_calls,32)
            raise RuntimeError('simulated generation failure')
        with patch.object(FakeAgent,'answer',fail):
            rid=self.create(tier='max',system_id='max-v32').json()['run_id']
            self.assertEqual(self.wait(rid)['status'],'error')
        agent=b._get_agent('same-chat',b._owner_id('test-owner'))
        self.assertIsNone(getattr(agent,'_pro32_config',None))
        self.assertFalse(hasattr(agent,'_web_cancel_check'))
        self.assertFalse(self.cfg.PRO_V32_ENABLED)

    def test_max32_cancellation_stops_before_model_request(self):
        b=self.bridge
        def cancel(agent,question):
            from pro32.llm import ModelGateway
            from pro32.contracts import Budget
            for flag in b._RUN_CANCEL.values(): flag.set()
            gateway=ModelGateway(object(),'fake','deepseek',Budget(32,32),agent._web_cancel_check)
            gateway.check_cancel()
            self.fail('cancelled gateway must not continue')
        with patch.object(FakeAgent,'answer',cancel):
            rid=self.create(tier='max',system_id='max-v32').json()['run_id']
            self.assertEqual(self.wait(rid)['status'],'stopped')
        agent=b._get_agent('same-chat',b._owner_id('test-owner'))
        self.assertIsNone(getattr(agent,'_pro32_config',None))
        self.assertFalse(self.cfg.PRO_V32_ENABLED)

    def test_modern_flash_records_actual_model_sources_history_and_selected_revision(self):
        b=self.bridge;seen=[]
        def stream(system,question,**kw):
            seen.append((system['id'],kw))
            yield 'runtime', {'generation_model':'deepseek-flash','runtime_config':{'model':'deepseek-flash','temperature':.1}}
            yield 'sources', {'sources':[{'chunk_id':'actual-source','text_full':'完整原文','citation_id':'E1'}], 'retrieval_ms':44}
            yield 'token', {'text':'现代 Flash 回答'}
            yield 'diagnostics', {'calls':[{'model':'deepseek-flash'}],'call_count':1}
            yield 'final', {'use_streamed_answer':True,'text':'','sources':[],'completion_status':'complete'}
        with patch.object(b._FLASH_RUNTIME,'stream',stream):
            for i,sid in enumerate(('flash-v20-original','flash-v20','flash-v21-r3','flash-v21','flash-v22-frozen-r1','flash-v22-frozen-r2')):
                rid=self.create(tier='flash',system_id=sid,client_request_id='modern-'+str(i)).json()['run_id']
                result=self.wait(rid)
                self.assertEqual(result['status'],'done')
                self.assertEqual(result['experiment']['generation_model'],'deepseek-flash')
                self.assertEqual(result['experiment']['metrics']['call_count'],1)
                self.assertEqual(result['sources'][0]['text_full'],'完整原文')
                self.assertEqual(result['experiment']['system_id'],sid)
                self.assertNotIn('test-owner', str(result))
        self.assertEqual(seen[0][1]['history'],[])
        self.assertEqual(seen[1][1]['history'],['一个自由问题'])
        self.assertEqual(seen[0][1]['api_key'],'test-owner')

    def test_modern_failure_keeps_partial_text_and_is_not_success(self):
        b=self.bridge
        def stream(*a,**kw):
            yield 'token', {'text':'部分回答'}
            yield 'error', {'message':'output_truncated'}
        with patch.object(b._FLASH_RUNTIME,'stream',stream):
            rid=self.create(tier='flash',system_id='flash-v21').json()['run_id']
            result=self.wait(rid)
        self.assertEqual(result['status'],'error')
        self.assertEqual(result['answer'],'部分回答')
    def test_compare_requires_owned_matching_parent_and_freezes_context(self):
        first=self.create().json()['run_id'];self.wait(first)
        res=self.create(client_request_id='second',system_id='max-v31',tier='max',comparison_parent_run_id=first)
        second=self.wait(res.json()['run_id'])
        original=self.client.get('/api/runs/'+first,headers=self.headers).json()
        self.assertEqual(original['experiment']['context_snapshot'],second['experiment']['context_snapshot'])
        self.assertEqual(self.create(client_request_id='bad',message='different',comparison_parent_run_id=first).status_code,422)
    def test_sources_survive_streamed_final_and_have_chunk_id(self):
        b=self.bridge
        with patch.object(b,'_run_worker',lambda _:None):rid=self.create().json()['run_id']
        b._publish_run_event(rid,'sources',{'sources':[{'chunk_id':'ch1','snippet':'evidence'}]})
        b._publish_run_event(rid,'token',{'text':'answer'})
        b._publish_run_event(rid,'final',{'use_streamed_answer':True,'sources':[]})
        r=self.client.get('/api/runs/'+rid,headers=self.headers).json()
        self.assertEqual(r['sources'][0]['chunk_id'],'ch1')
    def test_visitor_cannot_trigger_paid_evaluation_or_read_archives(self):
        rid=self.create().json()['run_id'];self.wait(rid)
        self.assertIn(self.client.post('/api/runs/'+rid+'/evaluate',json={},headers=self.headers).status_code,(401,403))
        self.assertIn(self.client.get('/api/archives',headers=self.headers).status_code,(401,403))
    def test_complete_source_input_not_reduced_to_display_previews(self):
        rows=[{'id':str(i),'text_full':'full evidence '+str(i),'text_preview':'short'} for i in range(13)]
        sources=self.bridge._sources(rows)
        self.assertEqual(len(sources),13)
        self.assertEqual(sources[0]['text_full'],'full evidence 0')
    def test_flash_transport_error_never_becomes_an_answer(self):
        with self.assertRaises(RuntimeError):
            list(self.bridge._adapt_pieces(iter(['[ERROR] 生成失败：model request failed'])))

if __name__=='__main__':unittest.main()

"""No network/GPU: snapshot imports and request lifecycle through a fake engine."""
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
import threading
import importlib
import asyncio
import sys
import tempfile
import unittest
from unittest.mock import patch

from experiment_catalog import ROOT, visible_systems
from flash_runtime import FlashRuntime, RequestTransport, modules, public_source
sys.path.insert(0,str(ROOT))
from src.flash21.generation import Generator as RealGenerator


@dataclass
class Config:
    model: str = 'deepseek-flash'
    queue_capacity: int = 16


class Transport:
    def __init__(self, base='https://invalid.test'): self.key, self.base = '', base
    async def prepare(self): pass
    async def bind(self, key, base): self.key,self.base=key,base
    async def release(self): self.key=''
    async def aclose(self): await self.release()


class Generator:
    instances = []
    def __init__(self, transport, cfg):
        self.transport, self.closed = transport, False
        self.instances.append(self)
    def close(self): self.closed = True


class Engine:
    def __init__(self, status='ok'):
        self.status, self.generator, self._sessions, self.tasks = status, None, {}, []
    def stream(self, task, cancel):
        self.tasks.append(task)
        events = [
            ('retrieval_end', {}),
            ('sources', {'sources':[{'id':'unit','source_id':'original','text':'完整证据','chapter_index':12}]}),
            ('llm_request', {'model':'deepseek-flash','attempt':1}),
            ('token', {'text':'回答'}),
            ('generation_end', {'status':self.status,'usage':{'total_tokens':17}}),
            ('done', {'status':self.status,'reason':'completed' if self.status=='ok' else 'output_truncated'}),
        ]
        for kind, data in events:
            yield SimpleNamespace(kind=kind, data=data, t_ms=33)


class FlashRuntimeTests(unittest.TestCase):
    def test_shared_weights_do_not_change_legacy_reranker_settings(self):
        class Ranker:
            max_seq_length=8192
            def predict(self,pairs,**kw): self.received=kw;return [1.0]
        original=Ranker();runtime=FlashRuntime(ROOT)
        runtime.share_models(object(),original)
        self.assertEqual(runtime._models[1].predict([('q','text')]),[1.0])
        self.assertEqual(original.max_seq_length,8192)
        self.assertEqual(original.received['processing_kwargs']['text']['max_length'],512)

    def test_each_representative_loads_its_own_snapshot_and_config(self):
        modules_seen = set()
        for system in visible_systems():
            if system['config'].get('adapter') != 'modern_flash': continue
            m = modules(ROOT, system['config'])
            name=m['engine'].__module__
            self.assertNotIn(name, modules_seen)
            modules_seen.add(name)
            self.assertEqual(m['config'].model,'deepseek-flash')
            self.assertIn(system['config']['source'].replace('\\','/'),
                          str(Path(__import__(name, fromlist=['']).__file__).as_posix()))
        self.assertEqual(len(modules_seen),6)

    def test_real_snapshot_engines_and_generators_stream_with_fake_transport(self):
        class LocalTransport:
            async def prepare(self): pass
            async def aclose(self): pass
            async def stream(self,payload,timeout):
                yield {'model':payload['model'],'choices':[{'delta':{'content':'接口验证通过。'},'finish_reason':None}]}
                yield {'choices':[{'delta':{},'finish_reason':'stop'}],'usage':{'total_tokens':12}}
        for system in visible_systems():
            if system['config'].get('adapter')!='modern_flash': continue
            m=modules(ROOT,system['config'])
            tag=m['engine'].__module__.split('.')[0]
            evidence=importlib.import_module(tag+('.flash20' if system['config']['number']=='20' else '.flash21')+'.evidence')
            class Retriever:
                def retrieve(self, task, plan, ctx):
                    text='本地接口测试材料，描述一个虚构测试人物。'
                    c=evidence.Candidate('synthetic',text,chapter=1)
                    unit=evidence.EvidenceUnit('synthetic-unit','synthetic',text,0,len(text),c)
                    return evidence.AnswerPacket(plan,(unit,))
            generator=m['generation'].Generator(LocalTransport(),m['config'])
            try:
                engine=m['engine'](Retriever(),generator,('测试人物',),m['config'])
                task=m['task']('介绍测试人物。',session_id=system['id'])
                events=list(engine.stream(task,threading.Event()))
                self.assertEqual(events[-1].data['status'],'ok',system['id']+str(events[-1].data))
                self.assertEqual(''.join(e.data['text'] for e in events if e.kind=='token'),'接口验证通过。')
                self.assertEqual(sum(e.kind=='llm_request' for e in events),1)
            finally: generator.close()

    def make_runtime(self,status='ok'):
        engine=Engine(status)
        transport=Transport();generator=RealGenerator(transport,Config())
        self.addCleanup(generator.close);engine.generator=generator
        row={'engine':engine,'histories':OrderedDict(),'turn':0,'generator':generator,'transport':transport,
             'modules':{'config':Config(), 'task':lambda q,**kw:SimpleNamespace(question=q,**kw),
                        'generation':SimpleNamespace(OpenAITransport=Transport,Generator=Generator)}}
        runtime=FlashRuntime(ROOT)
        runtime._runtime=lambda _:row
        return runtime,row

    def call(self,runtime,**kw):
        return list(runtime.stream({'id':'flash-test'},'问题',api_key='private-key',base_url='https://invalid.test',
                                   session_id='owner:chat',history=kw.pop('history',[]),cancel_event=kw.pop('cancel',threading.Event())))

    def test_success_retains_sources_counters_and_clears_byok_key(self):
        runtime,row=self.make_runtime()
        events=self.call(runtime)
        data=dict(events)
        self.assertEqual(data['sources']['sources'][0]['text_full'],'完整证据')
        self.assertEqual(data['sources']['sources'][0]['citation_id'],'E1')
        self.assertEqual(data['diagnostics']['call_count'],1)
        self.assertEqual(data['diagnostics']['calls'][0]['usage']['total_tokens'],17)
        self.assertIn('final',data)
        self.assertFalse(row['generator']._closed)
        self.assertEqual(row['transport'].key,'')
        self.assertIs(row['engine'].generator,row['generator'])
        self.assertEqual(data['latency']['engine_first_token_ms'],33)
        self.assertNotIn('private-key',str(events))

    def test_failure_or_cancel_never_yields_success(self):
        for status in ('partial','generation_error','cancelled','no_evidence'):
            runtime,row=self.make_runtime(status)
            events=dict(self.call(runtime))
            self.assertNotIn('final',events)
            self.assertIn('cancelled' if status=='cancelled' else 'error',events)
            self.assertEqual(row['transport'].key,'')
        runtime,_=self.make_runtime()
        cancel=threading.Event();cancel.set()
        self.assertEqual(self.call(runtime,cancel=cancel),[('cancelled',{})])

    def test_early_stream_close_releases_client_without_yielding_in_finally(self):
        runtime,row=self.make_runtime()
        stream=runtime.stream({'id':'flash-test'},'问题',api_key='secret',base_url='https://invalid.test',
                              session_id='o:c',history=[],cancel_event=threading.Event())
        next(stream)
        stream.close()
        self.assertEqual(row['transport'].key,'')
        self.assertFalse(row['generator']._closed)

    def test_history_change_invalidates_stale_event_memory(self):
        runtime,row=self.make_runtime()
        self.call(runtime)
        row['engine']._sessions[('web','owner:chat')]='old event memory'
        self.call(runtime,history=['问题'])
        self.assertIn(('web','owner:chat'),row['engine']._sessions)
        self.call(runtime,history=['改过的前文'])
        self.assertNotIn(('web','owner:chat'),row['engine']._sessions)
        self.assertEqual(row['engine'].tasks[-1].user_history,('改过的前文',))

    def test_prewarm_retains_all_six_and_shares_only_identical_resource_packages(self):
        systems=[s for s in visible_systems() if s['config'].get('adapter')=='modern_flash']
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)/'resources.py';source.write_text('synthetic resource package',encoding='utf8')
            loads=[]
            class Backend:
                names=();encoder=object();ranker=object()
                def warmup(self): pass
                def prime_kernels(self,gpu): pass
            def load(root): loads.append(root);return Backend()
            m={'resources':SimpleNamespace(__file__=str(source),load_backend=load),'config':Config(),
               'scheduler':SimpleNamespace(GpuScheduler=lambda n:SimpleNamespace(close=lambda:None)),
               'generation':SimpleNamespace(Generator=RealGenerator),
               'retriever':lambda b,g,c:b,'engine':lambda r,g,n,c:SimpleNamespace(generator=g)}
            runtime=FlashRuntime(ROOT)
            try:
                with patch('flash_runtime.modules',return_value=m),patch('flash_runtime.RequestTransport',Transport):
                    report=runtime.prewarm(systems,'https://invalid.test')
                    originals={s['id']:runtime._runtime(s) for s in systems}
                    self.assertEqual(len(runtime._runtimes),6)
                    self.assertEqual(len(loads),2) # two independent data families
                    self.assertEqual(report['remote_calls'],0)
                    for s in reversed(systems):self.assertIs(runtime._runtime(s),originals[s['id']])
                    self.assertTrue(all(not r['transport'].key for r in runtime._runtimes.values()))
            finally: runtime.close()


class RequestTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_preparation_is_free_and_authorization_does_not_cross_requests(self):
        import httpx
        seen=[]
        def handler(request):
            seen.append(request.headers.get('authorization'))
            return httpx.Response(200,headers={'content-type':'text/event-stream'},content=
                b'data: {"id":"fixture","object":"chat.completion.chunk","created":0,"model":"fake","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: [DONE]\n\n')
        transport=RequestTransport('https://invalid.test',httpx.AsyncClient(transport=httpx.MockTransport(handler)))
        try:
            await transport.prepare();client=transport.client
            self.assertEqual(seen,[]);self.assertEqual(client.api_key,'')
            for key in ('owner-a','owner-b'):
                await transport.bind(key,'https://invalid.test')
                chunks=[c async for c in transport.stream({'model':'fake','messages':[],'stream':True},2)]
                self.assertEqual(chunks[0]['choices'][0]['delta']['content'],'ok')
                await transport.release()
                self.assertIs(client,transport.client)
                self.assertEqual(client.api_key,'');self.assertEqual(transport._key,'')
            self.assertEqual(seen,['Bearer owner-a','Bearer owner-b'])
            with self.assertRaises(RuntimeError):
                await anext(transport.stream({'model':'fake','messages':[],'stream':True},2))
            self.assertEqual(len(seen),2)
        finally: await transport.aclose()

    async def test_cancel_drains_old_request_before_new_credentials_can_bind(self):
        import httpx
        started=asyncio.Event();seen=[]
        async def handler(request):
            seen.append(request.headers.get('authorization'))
            if len(seen)==1:
                started.set();await asyncio.Event().wait()
            return httpx.Response(200,headers={'content-type':'text/event-stream'},content=b'data: [DONE]\n\n')
        transport=RequestTransport('https://invalid.test',httpx.AsyncClient(transport=httpx.MockTransport(handler)))
        async def consume():return [x async for x in transport.stream({'model':'fake','messages':[],'stream':True},10)]
        try:
            await transport.bind('owner-a','https://invalid.test')
            task=asyncio.create_task(consume());await asyncio.wait_for(started.wait(),2)
            await transport.release()
            self.assertTrue(task.cancelled());self.assertFalse(transport._active)
            self.assertEqual(transport.client.api_key,'')
            await transport.bind('owner-b','https://invalid.test');await consume();await transport.release()
            self.assertEqual(seen,['Bearer owner-a','Bearer owner-b'])
        finally:await transport.aclose()


if __name__=='__main__': unittest.main()

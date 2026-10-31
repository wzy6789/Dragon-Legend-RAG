"""No network/GPU: snapshot imports and request lifecycle through a fake engine."""
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
import threading
import importlib
import unittest
from unittest.mock import patch

from experiment_catalog import ROOT, visible_systems
from flash_runtime import FlashRuntime, modules, public_source


@dataclass
class Config:
    model: str = 'deepseek-flash'


class Transport:
    def __init__(self, key, base): self.key, self.base = key, base


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
        row={'engine':engine,'histories':OrderedDict(),'turn':0,
             'modules':{'config':Config(), 'task':lambda q,**kw:SimpleNamespace(question=q,**kw),
                        'generation':SimpleNamespace(OpenAITransport=Transport,Generator=Generator)}}
        runtime=FlashRuntime(ROOT)
        runtime._runtime=lambda _:row
        return runtime,row

    def call(self,runtime,**kw):
        return list(runtime.stream({'id':'flash-test'},'问题',api_key='private-key',base_url='https://invalid.test',
                                   session_id='owner:chat',history=kw.pop('history',[]),cancel_event=kw.pop('cancel',threading.Event())))

    def test_success_retains_sources_counters_and_closes_byok_client(self):
        runtime,row=self.make_runtime()
        events=self.call(runtime)
        data=dict(events)
        self.assertEqual(data['sources']['sources'][0]['text_full'],'完整证据')
        self.assertEqual(data['sources']['sources'][0]['citation_id'],'E1')
        self.assertEqual(data['diagnostics']['call_count'],1)
        self.assertEqual(data['diagnostics']['calls'][0]['usage']['total_tokens'],17)
        self.assertIn('final',data)
        self.assertTrue(Generator.instances[-1].closed)
        self.assertIsNone(row['engine'].generator)
        self.assertNotIn('private-key',str(events))

    def test_failure_or_cancel_never_yields_success(self):
        for status in ('partial','generation_error','cancelled','no_evidence'):
            runtime,row=self.make_runtime(status)
            events=dict(self.call(runtime))
            self.assertNotIn('final',events)
            self.assertIn('cancelled' if status=='cancelled' else 'error',events)
            self.assertTrue(Generator.instances[-1].closed)
        runtime,_=self.make_runtime()
        cancel=threading.Event();cancel.set()
        self.assertEqual(self.call(runtime,cancel=cancel),[('cancelled',{})])

    def test_early_stream_close_releases_client_without_yielding_in_finally(self):
        runtime,row=self.make_runtime()
        stream=runtime.stream({'id':'flash-test'},'问题',api_key='secret',base_url='https://invalid.test',
                              session_id='o:c',history=[],cancel_event=threading.Event())
        next(stream)
        stream.close()
        self.assertTrue(Generator.instances[-1].closed)
        self.assertIsNone(row['engine'].generator)

    def test_history_change_invalidates_stale_event_memory(self):
        runtime,row=self.make_runtime()
        self.call(runtime)
        row['engine']._sessions[('web','owner:chat')]='old event memory'
        self.call(runtime,history=['问题'])
        self.assertIn(('web','owner:chat'),row['engine']._sessions)
        self.call(runtime,history=['改过的前文'])
        self.assertNotIn(('web','owner:chat'),row['engine']._sessions)
        self.assertEqual(row['engine'].tasks[-1].user_history,('改过的前文',))


if __name__=='__main__': unittest.main()

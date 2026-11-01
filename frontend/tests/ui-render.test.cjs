const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
const original=Module._resolveFilename;
Module._resolveFilename=function(name,...args){return original.call(this,name.startsWith('@/')?path.join(__dirname,'..',name.slice(2)):name,...args)};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,file);
const React=require('react');
const {renderToStaticMarkup:render}=require('react-dom/server');
const ComparisonGroup=require('../components/ComparisonGroup.tsx').default;
const ScoreVisual=require('../components/ScoreVisual.tsx').default;
const RunJourney=require('../components/RunJourney.tsx').default;
const ScoreComparison=require('../components/ScoreComparison.tsx').default;
const {compareResults}=require('../lib/workbench.ts');
const evaluate=(score)=>({id:'evaluation',status:'done',score,score_scale:100,protocol_id:'SCORING_STANDARD_7D49_R2',judge_model:'fixture-judge',type:'L3',scorer_fingerprint:'same',dimensions:{rel:8,fact:9,reas:7,comp:8,lang:8,tone:9,cite:8}});
const answer=(id,score,time)=>({id,role:'assistant',content:'模拟答案正文',createdAt:1,status:'done',research:{comparisonId:'pair',question:'同一个问题'},experiment:{system_id:id,benchmark_id:'new49',question_id:'q1',protocol_id:'SCORING_STANDARD_7D49_R2',context_hash:'same',evaluations:[evaluate(score)],metrics:{execution_ms:time},timeline:[{event:'stage',stage:'检索原文',at_ms:15},{event:'sources',at_ms:70},{event:'final',at_ms:time}]}});
test('comparison renders stable identities, visible quality/speed difference and no decorative arrows',()=>{
 const html=render(React.createElement(ComparisonGroup,{messages:[answer('version-a',78,8000),answer('version-b',89,11000)],comparisonId:'pair',busy:false,onInspect(){},onRegenerate(){},onDelete(){}}));
 for(const text of ['B 高 11 分','A 少用','评分维度','执行过程','series-0','series-1','version-a','version-b'])assert.ok(html.includes(text),text);
 assert.equal(/[→←↗↓↑⇒↔]/u.test(html),false);
 assert.match(html,/comparison-group side-by-side/);
 assert.doesNotMatch(html,/上下阅读|答案阅读布局/);
});
test('zero is rendered as a valid meter; missing and unknown scales do not fabricate bars',()=>{
 const html=render(React.createElement(ScoreVisual,{evaluation:{...evaluate(0),dimensions:{rel:0}}}));
 assert.match(html,/aria-valuenow="0"/);assert.match(html,/未记录/);
 const unknown=render(React.createElement(ScoreVisual,{evaluation:{id:'x',status:'done',score:4,dimensions:{fact:4}}}));
 assert.doesNotMatch(unknown,/role="meter"/);
});
test('execution display uses observed records and never copies reasoning payloads',()=>{
 const message=answer('a',80,1000);message.experiment.timeline[0].reasoning='PRIVATE_CONTENT';
 const html=render(React.createElement(RunJourney,{message}));
 assert.match(html,/检索原文/);assert.match(html,/15 ms/);assert.doesNotMatch(html,/PRIVATE_CONTENT/);
});

test('aligned dimension comparison keeps raw scales, side labels and signed winners',()=>{
 const a=answer('version-a',78,8000), b=answer('version-b',89,11000);
 b.experiment.evaluations[0].dimensions.fact=6;
 b.experiment.evaluations[0].dimensions.reas=9;
 const html=render(React.createElement(ScoreComparison,{result:compareResults([a,b],'pair'),onInspect(){}}));
 for(const text of ['A 高 3','B 高 2','version-a','version-b','仅看差异','评分依据'])assert.ok(html.includes(text),text);
 assert.match(html,/aria-valuemax="10"/);assert.doesNotMatch(html,/aria-valuemax="100"/);
 assert.equal(/[→←↗↓↑⇒↔]/u.test(html),false);
});
test('journey records default to closed disclosures and degraded completion is not shown as success',()=>{
 const m=answer('a',80,1000);m.completionStatus='degraded';
 const html=render(React.createElement(RunJourney,{message:m}));
 assert.match(html,/部分完成/);assert.match(html,/journey-stage-card/);
 assert.doesNotMatch(html,/<details[^>]* open(?:=|>)/);
 assert.match(html,/15 ms/);assert.match(html,/retrieval|stage/);
});
test('unavailable scoring with no dimensions retains both details links and its terminal state',()=>{
 const messages=[answer('a',80,1000),answer('b',90,2000)];
 for(const m of messages){m.experiment.protocol_id='FLASHBENCH_UNVERIFIED';m.experiment.evaluations=[{id:m.id,status:'unverified_gold',protocol_id:'FLASHBENCH_UNVERIFIED'}];}
 const html=render(React.createElement(ScoreComparison,{result:compareResults(messages,'pair'),onInspect(){}}));
 assert.match(html,/查看 A 评分依据/);assert.match(html,/查看 B 评分依据/);assert.match(html,/评测暂不可用/);
 assert.doesNotMatch(html,/等待独立评分完成/);
});

const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {filterSystems,filterQuestions}=require('../lib/catalog-navigation.ts');
const entry=(id,tiers,status,notes)=>({id,tiers,status,notes,label:id,family:'research',version:id,variant:'base'});
test('version filters compose identity search, exact tier and execution availability',()=>{
 const rows=[entry('flash-v19-sem_select',['flash'],'runnable','语义 精选'),entry('pro-v22-kg-on',['pro','max'],'pending','KG 图谱'),entry('archive-19',[],'archive','语义 历史')];
 assert.deepEqual(filterSystems(rows,'语义 精选','flash','runnable').map(x=>x.id),['flash-v19-sem_select']);
 assert.equal(filterSystems(rows,'KG','max','pending').length,1);assert.equal(filterSystems(rows,'','flash','pending').length,0);assert.equal(filterSystems(rows,'missing').length,0);
 assert.equal(rows[1].status,'pending');
});
test('question-number lookup is exact and keeps unavailable questions inspectable',()=>{
 const rows=[{id:'31',question:'星罗 比赛',type:'L3',runnable:true},{id:'Q031',question:'诊断',type:'L4',runnable:false},{id:'131',question:'第31题提到人物',type:'L3',runnable:true},{id:'F1-01',question:'其他',type:'F1'}];
 assert.equal(filterQuestions(rows,'Q31').length,2);assert.equal(filterQuestions(rows,'第31题','L3',true).length,1);assert.equal(filterQuestions(rows,'','L4',true).length,0);assert.equal(filterQuestions(rows,'f1-01').length,1);assert.equal(filterQuestions(rows,'星罗 比赛').length,1);
});

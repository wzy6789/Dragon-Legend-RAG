const {test}=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs');const ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const r=require('../lib/reading.ts');
test('reading settings recover from old or malformed stored values',()=>{
 assert.deepEqual(r.normalizeReading({font:'arbitrary',size:500,spacing:'bad'}),r.READING_DEFAULTS);
 global.localStorage={getItem:()=>'{broken'};assert.deepEqual(r.loadReading(),r.READING_DEFAULTS);
});
test('valid reading choices survive reopening without touching credentials',()=>{
 const entries=new Map([['dragon-legend-rag.login.v1','private']]);
 global.localStorage={getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v)};
 const prefs={font:'serif',size:20,spacing:'relaxed'};r.saveReading(prefs);assert.deepEqual(r.loadReading(),prefs);assert.equal(entries.get('dragon-legend-rag.login.v1'),'private');
 global.localStorage={setItem(){throw new Error('disabled')},getItem(){throw new Error('disabled')}};
 assert.doesNotThrow(()=>r.saveReading(prefs));assert.deepEqual(r.loadReading(),r.READING_DEFAULTS);
});

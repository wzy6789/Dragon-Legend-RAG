// Inspect an isolated Edge CDP session. No installation and no model calls.
import fs from 'node:fs/promises';
const qaUrl=process.env.WORKBENCH_QA_URL || 'http://localhost:3011';
const page=await (await fetch('http://127.0.0.1:9223/json/new?'+encodeURIComponent(qaUrl),{method:'PUT'})).json();
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let id=0;const pending=new Map();const errors=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(m.error):p?.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);});
function call(method,params={}){return new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});}
async function evaluate(expression){return (await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;}
await call('Runtime.enable');await call('Page.enable');
await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
await call('Page.navigate',{url:qaUrl});
for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,500));if((await evaluate('document.body.innerText')).includes('实验'))break;}
// The static login HTML can precede React hydration; wait for its event handlers.
for(let i=0;i<40;i++){if(await evaluate(`(()=>{const x=document.querySelector('input[type=password]');return !x||Object.keys(x).some(k=>k.startsWith('__reactProps'));})()`))break;await new Promise(r=>setTimeout(r,100));}
await new Promise(r=>setTimeout(r,500));
// Exercise normal BYOK entry with a non-secret fixture. No question is submitted.
await evaluate(`(()=>{const input=document.querySelector('input[type=password]');if(input){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'qa-browser-fixture');input.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
await new Promise(r=>setTimeout(r,250));
await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.includes('进入研究工作台'));if(b&&!b.disabled)b.click();})()`);
for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,500));if((await evaluate('document.body.innerText')).includes('新建实验会话'))break;}
for(let i=0;i<40;i++){if(await evaluate(`document.body.innerText.includes('知识库已连接')&&document.body.innerText.includes('ONLINE_DIAGNOSTIC_7D_V1')`))break;await new Promise(r=>setTimeout(r,150));}
const result=await evaluate(`({title:document.title,text:document.body.innerText.slice(0,2200),width:innerWidth,bodyWidth:document.body.scrollWidth,buttons:[...document.querySelectorAll('button')].map(x=>x.innerText).filter(Boolean)})`);
const screenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
await fs.mkdir('D:/RAG实验网站/验收',{recursive:true});
await fs.writeFile('D:/RAG实验网站/验收/workbench-preview.png',Buffer.from(screenshot.data,'base64'));
await fs.writeFile('D:/RAG实验网站/验收/browser-check.json',JSON.stringify({...result,errors},null,2));
const click=async text=>evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.includes(${JSON.stringify(text)}));if(b)b.click();return !!b;})()`);
await click('管理员登录');
const privateEnv=await fs.readFile('D:/RAG实验网站/experiment-admin.env','utf8');
const adminPassword=privateEnv.split('\n').find(x=>x.startsWith('RAG_EXPERIMENT_ADMIN_PASSWORD=')).split('=').slice(1).join('=');
await evaluate(`(()=>{const input=document.querySelector('#admin-password');if(input){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(adminPassword)});input.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
await new Promise(r=>setTimeout(r,200));await click('登录管理员');await new Promise(r=>setTimeout(r,600));
await click('系统版本');await new Promise(r=>setTimeout(r,500));
const versions=await evaluate(`({cards:document.querySelectorAll('.registry-card').length,overflow:document.body.scrollWidth>innerWidth})`);
await click('收起详情');await new Promise(r=>setTimeout(r,100));
const inspectorCollapses=await evaluate(`getComputedStyle(document.querySelector('.research-inspector')).display==='none'`);
await click('展开详情');
await click('报告与归档');await click('历史研究归档');await new Promise(r=>setTimeout(r,1800));
const archives=await evaluate(`({batches:document.querySelectorAll('.archive-batch').length,text:document.body.innerText.slice(-500)})`);
console.log(JSON.stringify({...result,errors,versions,archives,inspectorCollapses}));ws.close();
if(errors.length||result.bodyWidth>result.width||versions.cards<40||archives.batches<1||!inspectorCollapses)process.exitCode=1;

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const root=process.cwd(), source=await fs.readFile('tools/verify/e9-session-store-browser.mjs','utf8');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const a=source.indexOf("  if (remote) page.on('response'"),b=source.indexOf("\n  page.on('console'",a),c=source.indexOf("\n  page.on('pageerror'",b);
assert.ok(a>=0&&b>a&&c>b);
const responseSource=source.slice(a,b),consoleSource=source.slice(b,c),remote=new URL('https://wasm-vm.pages.dev/');
const report={source_sha256:digest(source),cases:[]};
function environment(){
 const handlers=new Map(),report={url:'https://wasm-vm.pages.dev/app.html?noAutoBoot&testHooks=1',errors:[]};
 const env={URL,assert,fs,path,digest,root,web:path.join(root,'web/dist'),remote,report,served:new Map(),remoteReads:[],page:{on:(type,fn)=>handlers.set(type,fn)}};
 vm.runInNewContext(responseSource+'\n'+consoleSource,env);return {env,handlers,report};
}
const url='https://wasm-vm.pages.dev/session-store.js',bytes=await fs.readFile('web/dist/session-store.js');
async function respond(state,status,body=bytes){state.handlers.get('response')({url:()=>url,status:()=>status,body:async()=>body});await Promise.all(state.env.remoteReads);}
{
 const state=environment();await respond(state,304);assert.equal(state.report.errors.length,1);assert.match(state.report.errors[0],/304 without a verified cached body/);assert.equal(state.env.served.size,0);
 report.cases.push({name:'fresh 304 refused',errors:state.report.errors});
}
{
 const state=environment();await respond(state,200,Buffer.from('wrong source'));assert.equal(state.report.errors.length,1);assert.equal(state.env.served.size,0);await respond(state,304);assert.equal(state.report.errors.length,2);
 report.cases.push({name:'bad 200 cannot authorize later 304',errors:state.report.errors});
}
{
 const state=environment();await respond(state,200);assert.equal(state.report.errors.length,0);assert.equal(state.env.served.get('/session-store.js').sha256,digest(bytes));await respond(state,304);assert.equal(state.report.errors.length,0);assert.equal(state.report.cacheRevalidations.length,1);assert.equal(state.report.cacheRevalidations[0].sha256,digest(bytes));await respond(state,404);assert.equal(state.report.errors.length,1);
 report.cases.push({name:'verified 200 authorizes 304 but not 404',revalidation:state.report.cacheRevalidations[0],otherStatusRejected:true});
}
for(const [name,location,text,ignored]of [
 ['exact favicon404','https://wasm-vm.pages.dev/favicon.ico','Failed to load resource: server responded with status 404 ()',true],
 ['script mentions favicon404','https://wasm-vm.pages.dev/main.js','favicon 404',false],
 ['foreign origin favicon404','https://other.example/favicon.ico','status 404',false],
 ['query favicon404','https://wasm-vm.pages.dev/favicon.ico?other=1','status 404',false],
 ['favicon500','https://wasm-vm.pages.dev/favicon.ico','status 500',false],
 ['unattributed favicon404','','favicon 404',false],
]){
 const state=environment();state.handlers.get('console')({type:()=> 'error',location:()=>({url:location}),text:()=>text});assert.equal(state.report.errors.length,ignored?0:1);assert.equal(state.report.ignoredFaviconErrors?.length??0,ignored?1:0);
 report.cases.push({name,ignored,recorded:ignored?state.report.ignoredFaviconErrors:state.report.errors});
}
report.status='passed';await fs.writeFile('target/evidence/e9-t03-verifier/public-harness-guards.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:report.cases.length,source_sha256:report.source_sha256}));

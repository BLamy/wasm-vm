import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=path.resolve(process.argv[2]), output=path.resolve(process.argv[3]);
const base=new URL('https://wasm-vm.pages.dev/');
const sha=body=>createHash('sha256').update(body).digest('hex');
const manifest=JSON.parse(await fs.readFile(path.join(root,'web/dist/gpu-runtime/manifest.json'),'utf8'));
const files=[...manifest.files.map(f=>manifest.directory+'/'+f.path),'gpu-runtime/manifest.json','gpu-runtime-worker.js',
 'session-store.js','session-pkg/wasm_vm_session.js','session-pkg/wasm_vm_session_bg.wasm',
 'linux-worker-host.js','main.js','roadmap.js','pkg/wasm_vm_wasm.js','pkg/wasm_vm_wasm_bg.wasm','tasks.json','sw.js'];
const report={task:'E9-T03',head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 base:base.href,started:new Date().toISOString(),files:[],status:'running'};
for(let at=0;at<files.length;at+=4){
 const results=await Promise.allSettled(files.slice(at,at+4).map(async name=>{
  const local=await fs.readFile(path.join(root,'web/dist',name));
  const response=await fetch(new URL(name,base),{headers:{'Cache-Control':'no-cache'}});
  assert.equal(response.status,200,name);
  const body=Buffer.from(await response.arrayBuffer());
  assert.equal(sha(body),sha(local),name);
  return {path:name,bytes:body.length,sha256:sha(body),url:response.url};
 }));
 for(const r of results){if(r.status==='fulfilled')report.files.push(r.value);else {report.status='failed';report.failures??=[];report.failures.push(String(r.reason));}}
}
if(report.status!=='failed')report.status='passed';report.finished=new Date().toISOString();
await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(report.status,report.files.length,'published runtime/status files checked');
if(report.status!=='passed')process.exitCode=1;

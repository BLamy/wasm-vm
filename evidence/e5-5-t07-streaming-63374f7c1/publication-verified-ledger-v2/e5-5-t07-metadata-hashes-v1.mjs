import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from '/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905/web/node_modules/playwright/index.mjs';
const root='/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905';
const out='/private/tmp/e5-5-t07-metadata-hashes-v1';await fs.mkdir(out);
const paths=['pkg/wasm_vm_wasm_bg.wasm','pkg/wasm_vm_wasm.js','loader.js','snapshot-stream.js','gpu-checkpoint-build.js','artifacts-omarchy.json','tasks.json','roadmap.js','sw.js'];
const expected=await Promise.all(paths.map(async rel=>({path:rel,sha256:createHash('sha256').update(await fs.readFile(rel==='artifacts-omarchy.json'?'/private/tmp/e5-5-t07-deploy-v2/staged-manifests/artifacts-omarchy.json':path.join(root,'web/dist',rel))).digest('hex')})));
const report={status:'running',url:'https://wasm-vm.pages.dev/',started:new Date().toISOString(),expected};let browser;
try{
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});report.browser=browser.version();
 const page=await browser.newPage({serviceWorkers:'block'});await page.goto('https://wasm-vm.pages.dev/artifacts-omarchy.json');
 report.files=await page.evaluate(async rows=>{const result=[];for(const row of rows){const r=await fetch('/'+row.path,{cache:'no-store'});const bytes=new Uint8Array(await r.arrayBuffer());const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');result.push({path:row.path,url:r.url,status:r.status,bytes:bytes.length,sha256:sha,expectedSha256:row.sha256,headers:Object.fromEntries(['content-type','content-length','etag','cache-control','cross-origin-opener-policy','cross-origin-embedder-policy','cf-cache-status'].map(k=>[k,r.headers.get(k)]))});}return result;},expected);
 if(report.files.some(row=>row.status!==200||row.sha256!==row.expectedSha256))throw Error('live reviewed bytes differ');report.status='passed';
}catch(e){report.status='failed';report.failure=String(e);process.exitCode=1;}finally{await browser?.close();report.finished=new Date().toISOString();await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}

#!/usr/bin/env node
// Actual built Wasm: bounded corruption attacks, then the unchanged full software warm artifact.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(process.argv[2] || 'target/evidence/software-snapshot-stream');
await fs.mkdir(out, {recursive: false});
const manifest = JSON.parse(await fs.readFile(path.join(repo, 'web/dist/artifacts-omarchy.json')));
const snapshot = path.join(repo, manifest.artifacts.bootSnapshot.url);
const oracle = JSON.parse(execFileSync('python3', [path.join(repo, 'tools/verify/software-snapshot-oracle.py'), snapshot], {maxBuffer: 1000000}));
const report = {head: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim(),
  started: new Date().toISOString(), passed: false, oracle, manifest, errors: [], logs: []};
const server = createServer(async (req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cache-Control', 'no-store');
  if (name === '/probe.html') {res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Software snapshot streaming proof</title>'); return;}
  if (name === '/favicon.ico') {res.writeHead(204).end(); return;}
  const root = (name.startsWith('/releases/') || name === '/image-manifest') ? repo : path.join(repo, 'web/dist');
  const file = name === '/image-manifest' ? path.join(repo, 'releases/chunked-omarchy/manifest.json') : path.resolve(root, '.' + name);
  if (!file.startsWith(root + path.sep)) {res.writeHead(404).end(); return;}
  try {const stat = await fs.stat(file); if (!stat.isFile()) throw Error('not file');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Type', ({'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.html':'text/html','.json':'application/json','.css':'text/css'})[path.extname(file)] || 'application/octet-stream');
    createReadStream(file).pipe(res);
  } catch {res.writeHead(404).end();}
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  report.browser = browser.version();
  const page = await browser.newPage({serviceWorkers:'block'});
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', msg => {if (msg.type() === 'error') report.errors.push(msg.text()); if (msg.text().startsWith('STREAM_PHASE ')) {report.logs.push(msg.text()); console.log(msg.text());}});
  await page.goto(`http://127.0.0.1:${server.address().port}/probe.html`);
  report.result = await page.evaluate(async ({manifest, oracle}) => {
    const check = (ok, message) => {if (!ok) throw Error(message);};
    const mod = await import('/pkg/wasm_vm_wasm.js'); const wasm = await mod.default();
    const {stageGzipSnapshot} = await import('/snapshot-stream.js');
    const sha = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2,'0')).join('');
    const phase = (name, values={}) => console.log('STREAM_PHASE ' + JSON.stringify({name, memory:wasm.memory.buffer.byteLength,...values}));
    const vm = new mod.WasmLinux(16, new Uint8Array([0x13,0x05,0x10,0,0x6f,0,0,0]), new Uint8Array(), '', () => {}, false);
    vm.stampBootSnapshotIdentity(new Uint8Array(32));
    const original = vm.saveSnapshot(); const before = await sha(original);
    const staged = bytes => {const b = new mod.SnapshotBuffer(bytes.length); for(let at=0;at<bytes.length;at+=4097)b.append(bytes.subarray(at,at+4097)); return b;};
    const refused = [];
    const variants = [];
    for (const [name, at] of [['foreign_build',12], ['foreign_image',44], ['stale',76]]) {const b=original.slice(); b[at]^=1; variants.push([name,b]);}
    variants.push(['corrupt', original.subarray(0,original.length-1)]);
    const framing=original.slice(); new DataView(framing.buffer).setUint32(84,0xffffffff,true); variants.push(['corrupt',framing]);
    const sparse=original.slice(); const view=new DataView(sparse.buffer); let last;
    for(let at=84;at<sparse.length;) {const tag=view.getUint32(at,true),len=view.getUint32(at+4,true); if(tag===2)view.setUint32(at+9,0x7fffffff,true); last={at,tag,len}; at+=8+len;}
    variants.push(['corrupt',sparse]);
    const device=original.slice(0,-1); new DataView(device.buffer).setUint32(last.at+4,last.len-1,true); variants.push(['corrupt',device]);
    for (const [want, bytes] of variants) {
      let observed; try {observed=vm.restoreSnapshotBuffer(staged(bytes));} catch(e) {observed=String(e).includes('corrupt')?'corrupt':String(e);}
      check(observed===want,`expected ${want}, got ${observed}`);
      check(await sha(vm.saveSnapshot())===before,'refusal changed complete machine'); refused.push({want,observed});
    }
    const incomplete=new mod.SnapshotBuffer(original.length); incomplete.append(original.subarray(0,17));
    let incompleteRefused=false; try {vm.restoreSnapshotBuffer(incomplete);} catch {incompleteRefused=true;}
    check(incompleteRefused && await sha(vm.saveSnapshot())===before,'incomplete buffer atomic refusal');
    const small=new mod.SnapshotBuffer(84); let overflow=false;
    try {small.append(new Uint8Array(85));} catch {overflow=true;}
    check(overflow && small.byteLength()===0,'overflow refusal before copy'); small.free();
    const expectedRam=vm.stateDigest(); check(vm.restoreSnapshotBuffer(staged(original))==='resume','valid small restore');
    check(vm.stateDigest()===expectedRam,'small RAM restore'); vm.free(); phase('bounded-attacks',{refused});
    const fetchBytes=async entry => {const r=await fetch('/'+entry.url);check(r.ok,'input HTTP');const bytes=new Uint8Array(await r.arrayBuffer());check(bytes.length===entry.size && await sha(bytes)===entry.sha256,'compressed input integrity');return bytes;};
    const kernel=await fetchBytes(manifest.artifacts.kernel);
    const deltaGz=await fetchBytes(manifest.artifacts.overlayDelta);
    const delta=new Uint8Array(await new Response(new Blob([deltaGz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    const image=await (await fetch('/image-manifest')).text();check(await sha(new TextEncoder().encode(image))===manifest.chunkedImage.sha256,'manifest identity');
    const machine=mod.WasmLinux.newChunkedDiskSeeded(1024,kernel,image,location.origin+'/unused/',256,new Uint32Array(),'root=/dev/vda rw console=ttyS0 earlycon=sbi plymouth.enable=0',()=>{},false,delta);
    phase('constructed');
    const gz=await fetchBytes(manifest.artifacts.bootSnapshot);
    const blobCtor=globalThis.Blob, responseCtor=globalThis.Response;
    let full;
    try {
      globalThis.Blob=class {constructor(){throw Error('expanded/duplicate Blob is forbidden in snapshot staging');}};
      globalThis.Response=class {constructor(){throw Error('expanded JS Response is forbidden in snapshot staging');}};
      full=await stageGzipSnapshot(gz,manifest.artifacts.bootSnapshot,size=>new mod.SnapshotBuffer(size));
    } finally {globalThis.Blob=blobCtor;globalThis.Response=responseCtor;}
    check(full.stats.expandedBytes===oracle.expandedBytes && full.buffer.sha256()===oracle.sha256,'independent complete byte oracle');
    const stagedMemory=wasm.memory.buffer.byteLength; phase('staged',{...full.stats,sha256:full.buffer.sha256()});
    check(machine.restoreSnapshotBuffer(full.buffer)==='resume','actual full restore');
    const afterMemory=wasm.memory.buffer.byteLength;
    check(afterMemory-stagedMemory<32*1024*1024,'restore unexpectedly grew by another snapshot-sized allocation');
    const ram=machine.stateDigest();check(ram===oracle.ramSha256,'independent complete 1 GiB RAM byte oracle');
    phase('restored',{ram,stagedMemory,afterMemory});
    machine.free();
    return {refused,incompleteRefused,overflow,stats:full.stats,ramSha256:ram,stagedMemory,afterMemory,guestInstructionsExecuted:0};
  }, {manifest,oracle});
  assert.deepEqual(report.errors,[]); report.passed=true;
} catch(error) {report.failure=String(error);report.stack=error.stack;process.exitCode=1;}
finally {
  await browser?.close();await new Promise(resolve=>server.close(resolve));report.finished=new Date().toISOString();
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,failure:report.failure,result:report.result}));
}

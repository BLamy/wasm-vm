import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const clean='/private/tmp/e5-5-t07-pristine-pinned-0144c662b';
const custody='/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905';
const pkg=`${clean}/crates/wasm-web/pkg`;
const mod=await import(`${pathToFileURL(`${pkg}/wasm_vm_wasm.js`).href}?daybreak=1`);
const wasmBytes=await readFile(`${pkg}/wasm_vm_wasm_bg.wasm`);
const wasm=await mod.default({module_or_path:wasmBytes});
const stage=(await import(`${pathToFileURL(`${clean}/web/snapshot-stream.js`).href}?daybreak=1`)).stageGzipSnapshot;
const sha=b=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(await readFile(`${clean}/web/artifacts-omarchy.json`,'utf8'));
const kernel=await readFile(`${custody}/${manifest.artifacts.kernel.url}`);
const deltaGz=await readFile(`${custody}/${manifest.artifacts.overlayDelta.url}`);
const image=await readFile(`${custody}/releases/chunked-omarchy/manifest.json`,'utf8');
const gz=new Uint8Array(await readFile(`${custody}/${manifest.artifacts.bootSnapshot.url}`));
assert.equal(gz.length,manifest.artifacts.bootSnapshot.size);
assert.equal(sha(gz),manifest.artifacts.bootSnapshot.sha256);
const machine=mod.WasmLinux.newChunkedDiskSeeded(1024,new Uint8Array(kernel),image,'http://127.0.0.1/unused/',256,
  new Uint32Array(),'root=/dev/vda rw console=ttyS0 earlycon=sbi plymouth.enable=0',()=>{},false,new Uint8Array(gunzipSync(deltaGz)));
const beforeStage=wasm.memory.buffer.byteLength;
const full=await stage(gz,manifest.artifacts.bootSnapshot,n=>new mod.SnapshotBuffer(n));
assert.equal(full.stats.expandedBytes,634769246);
assert.ok(full.stats.maxCopyBytes>0&&full.stats.maxCopyBytes<=256*1024);
assert.equal(full.buffer.sha256(),'a356cd7455a7b5c7dddb67523e14bcfb07029b8846955ff5245d4a35ac23f762');
const stagedMemory=wasm.memory.buffer.byteLength;
assert.equal(machine.restoreSnapshotBuffer(full.buffer),'resume');
assert.equal(full.buffer.__wbg_ptr,0);
const afterMemory=wasm.memory.buffer.byteLength;
const ramSha256=machine.stateDigest();
assert.equal(ramSha256,'310a8f157b044cef3b7fc0f3dbc972e8658ec403d03c33aa5d46389e2b1414c0');
assert.ok(afterMemory-stagedMemory<32*1024*1024);
machine.free();
console.log(JSON.stringify({passed:true,cleanHead:'0144c662b0ffc53e0aec1efdbabc4edcac73b27d',compiler:'1.96.0',wasmBytes:wasmBytes.length,
  wasmSha256:sha(wasmBytes),glueSha256:sha(await readFile(`${pkg}/wasm_vm_wasm.js`)),compressedBytes:gz.length,
  expandedBytes:full.stats.expandedBytes,maxCopyBytes:full.stats.maxCopyBytes,copies:full.stats.copies,
  beforeStage,stagedMemory,afterMemory,ramSha256},null,2));

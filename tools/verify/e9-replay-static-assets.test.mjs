import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {sealReplayStaticAssets} from './e9-replay-static-assets.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(run){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'e9-static-package-'));
  const web=path.join(root,'web'),diagnostic=path.join(root,'diagnostic');
  const put=async(base,name,bytes)=>{const file=path.join(base,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);};
  try{
    await put(web,'session-gpu-replay-worker.js',"import {run} from './pkg/wasm_vm_wasm.js';\nimport './gpu-checkpoint-build.js';\n");
    await put(web,'gpu-checkpoint-build.js','export const build = "normal";\n');
    await put(diagnostic,'gpu-checkpoint-build.js','export const build = "diagnostic";\n');
    await put(web,'pkg/wasm_vm_wasm.js',"export {run} from './snippets/inline1.js';\nnew URL('wasm_vm_wasm_bg.wasm',import.meta.url);\n");
    await put(web,'pkg/snippets/inline1.js','export const run = 0;\n');
    await put(web,'pkg/wasm_vm_wasm_bg.wasm',new Uint8Array([0,97,115,109,0]));
    await put(diagnostic,'wasm_vm_wasm.js',"export {invokeJitBlock as run} from './snippets/inline1.js';\nimport './snippets/inline7.js';\nnew URL('wasm_vm_wasm_bg.wasm',import.meta.url);\n");
    await put(diagnostic,'snippets/inline1.js','export function invokeJitBlock() { return 1; }\n');
    await put(diagnostic,'snippets/inline7.js','export const diagnosticOnly = true;\n');
    await put(diagnostic,'wasm_vm_wasm_bg.wasm',new Uint8Array([0,97,115,109,1]));
    await run({root,web,diagnostic,put});
  }finally{await fs.rm(root,{recursive:true,force:true});}
}
test('default static graph keeps the normal complete package',()=>fixture(async({web})=>{
  const graph=await sealReplayStaticAssets(web),byName=new Map(graph.map(row=>[row.name,row]));
  assert.equal(byName.get('/pkg/snippets/inline1.js').sha256,hash('export const run = 0;\n'));
  assert.equal(byName.get('/gpu-checkpoint-build.js').sha256,hash('export const build = "normal";\n'));
  assert.equal(byName.has('/pkg/snippets/inline7.js'),false);
}));
test('diagnostic graph discovers and seals its own snippets, not normal names or bytes',()=>fixture(async({web,diagnostic})=>{
  const graph=await sealReplayStaticAssets(web,{wasmPackageRoot:diagnostic,gpuBuildFile:path.join(diagnostic,'gpu-checkpoint-build.js')}),byName=new Map(graph.map(row=>[row.name,row]));
  assert.equal(byName.get('/pkg/snippets/inline1.js').sha256,hash('export function invokeJitBlock() { return 1; }\n'));
  assert.equal(byName.get('/pkg/snippets/inline7.js').sha256,hash('export const diagnosticOnly = true;\n'));
  assert.equal(byName.get('/pkg/wasm_vm_wasm_bg.wasm').sha256,hash(new Uint8Array([0,97,115,109,1])));
  assert.equal(byName.get('/gpu-checkpoint-build.js').sha256,hash('export const build = "diagnostic";\n'));
}));
test('a missing diagnostic stamp cannot fall back to the normal identity',()=>fixture(async({web,diagnostic})=>{
  const stamp=path.join(diagnostic,'gpu-checkpoint-build.js');await fs.unlink(stamp);
  await assert.rejects(sealReplayStaticAssets(web,{wasmPackageRoot:diagnostic,gpuBuildFile:stamp}),{code:'ENOENT'});
}));
test('a missing diagnostic dependency cannot fall back to the normal package',()=>fixture(async({web,diagnostic})=>{
  await fs.unlink(path.join(diagnostic,'snippets/inline1.js'));
  await assert.rejects(sealReplayStaticAssets(web,{wasmPackageRoot:diagnostic}),{code:'ENOENT'});
}));
test('diagnostic overrides do not permit unsealed remote imports',()=>fixture(async({web,diagnostic,put})=>{
  await put(diagnostic,'snippets/inline7.js',"import 'https://unsealed.invalid/escape.js';\n");
  await assert.rejects(sealReplayStaticAssets(web,{wasmPackageRoot:diagnostic}),/unsealed bare replay import/);
}));

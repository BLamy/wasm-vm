#!/usr/bin/env node
// Bounded mutations against the shipped Wasm metadata and JS keyframe codecs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const argument=name=>{const at=process.argv.indexOf(name);return at<0?null:process.argv[at+1];};
assert(argument('--output'),'--output required');
const out=path.resolve(argument('--output'));await fs.mkdir(out,{recursive:false});
const seeds=(argument('--seeds')??'17,47,71').split(',').map(Number);
assert(seeds.length>=3&&seeds.every(seed=>Number.isSafeInteger(seed)&&seed>0&&seed<=0xffffffff));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),encoder=new TextEncoder();
const web=path.join(root,'web/dist'),module=await import(pathToFileURL(path.join(web,'session-pkg/wasm_vm_session.js')));
const wasmBytes=await fs.readFile(path.join(web,'session-pkg/wasm_vm_session_bg.wasm'));
const native=await module.default({module_or_path:wasmBytes});
const {encodeKeyframeDescriptor,decodeKeyframeDescriptor,inspectRamDeltaChunk}=await import(pathToFileURL(path.join(web,'session-keyframes.js')));
const fixture=path.join(root,'crates/storage/tests/session_manifest/fixtures');
const manifest=new Uint8Array(await fs.readFile(path.join(fixture,'manifest-v1.json')));
const events=new Uint8Array(await fs.readFile(path.join(fixture,'chunk-v1.json')));
const ram=new Uint8Array(24+6+4096),view=new DataView(ram.buffer);
ram.set(encoder.encode('WVRAMD01'));view.setUint32(8,1,true);view.setBigUint64(12,8192n,true);
view.setUint32(20,1,true);view.setUint32(24,1,true);view.setUint16(28,4096,true);ram.fill(0x51,30);
const descriptor=encodeKeyframeDescriptor({version:1,depth:1,parent:{sha256:'a'.repeat(64),length:'212'},
 frame:{sha256:'b'.repeat(64),length:'212'},chunks:[{sha256:sha(ram),length:String(ram.length)}],
 ramBytes:'8192',ramSha256:'c'.repeat(64),dirtyPages:1});
const corpus=[
 {name:'manifest',bytes:manifest,parse:module.sessionValidateManifest},
 {name:'events',bytes:events,parse:module.sessionIndexEventChunk},
 {name:'keyframe',bytes:descriptor,parse:decodeKeyframeDescriptor},
 {name:'ram-delta',bytes:ram,parse:bytes=>inspectRamDeltaChunk(bytes,8192)},
];
const report={task:'E9-T23',status:'running',started:new Date().toISOString(),
 head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 seeds,cases:0,mutations:0,controls:0,accepted:0,rejected:0,rows:[],errors:[],scope:'bounded codec robustness, not VM execution or full-workload qualification',
 sources:{wasm:sha(wasmBytes)},inputs:corpus.map(row=>({kind:row.name,bytes:row.bytes.length,sha256:sha(row.bytes)}))};
for(const name of ['session-keyframes.js','session-pkg/wasm_vm_session.js'])report.sources[name]=sha(await fs.readFile(path.join(web,name)));
const baseMemory=native.memory.buffer.byteLength;let active=null,peakMemory=baseMemory;
try{
 for(const row of corpus)row.parse(row.bytes);
 // Literal invalid boundaries must fail, making a disabled validator detectable.
 for(const row of corpus){const over=new Uint8Array((row.name==='events'||row.name==='ram-delta'?4:1)*1048576+1);
  assert.throws(()=>row.parse(over),undefined,row.name+' oversized input admitted');}
 for(const seed of seeds){let state=seed>>>0;const random=()=>state=(Math.imul(state,1664525)+1013904223)>>>0;
  for(const row of corpus){const counts={seed,kind:row.name,cases:0,accepted:0,rejected:0,forcedRejects:0};
   for(let index=0;index<1000;index++){
    const mode=index%8;let bytes=row.bytes.slice();
    if(mode===1)bytes=bytes.subarray(0,random()%bytes.length);
    if(mode===2||mode===3){for(let n=0;n<1+random()%8;n++)bytes[random()%bytes.length]^=1<<(random()%8);}
    if(mode===4){bytes.fill(random()&255,0,Math.min(bytes.length,8+random()%32));}
    if(mode===5)bytes=new Uint8Array(random()%Math.min(row.bytes.length,256));
    if(mode===6){const extra=new Uint8Array(bytes.length+1);extra.set(bytes);extra[bytes.length]=0;bytes=extra;}
    if(mode===7)bytes.fill(0,0,Math.min(bytes.length,24));
    active={seed,kind:row.name,index,mode,bytes:bytes.length,sha256:sha(bytes)};
    report[active.sha256===sha(row.bytes)?'controls':'mutations']++;
    let accepted=false;
    try{const result=row.parse(bytes);accepted=true;
     if(row.name==='manifest')assert.deepEqual(module.sessionValidateManifest(result),result,'non-stable manifest canonicalization');
    }catch(error){
     if(error instanceof WebAssembly.RuntimeError||error instanceof RangeError||/out of memory|unreachable|memory access out of bounds/i.test(error.message))throw error;
     if(error?.code==='ERR_ASSERTION')throw error;
    }
    if(mode===0)assert(accepted,'valid control refused');
    if(mode===6){assert(!accepted,'literal trailing NUL was admitted');counts.forcedRejects++;}
    counts.cases++;counts[accepted?'accepted':'rejected']++;report.cases++;report[accepted?'accepted':'rejected']++;
    peakMemory=Math.max(peakMemory,native.memory.buffer.byteLength);
    assert(peakMemory-baseMemory<=64*1048576,'bounded inputs caused excessive retained Wasm growth');
   }
   report.rows.push(counts);
  }
 }
 assert(report.mutations>=10000);report.memory={baseBytes:baseMemory,peakBytes:peakMemory,maxAdditionalBytes:64*1048576};
 report.status='passed';
}catch(error){report.status='failed';report.failure={...active,message:String(error.stack??error)};process.exitCode=1;}
finally{report.finished=new Date().toISOString();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({status:report.status,cases:report.cases,accepted:report.accepted,rejected:report.rejected,out,failure:report.failure}));

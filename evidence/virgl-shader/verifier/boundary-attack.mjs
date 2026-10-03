import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root=process.argv[2], output=process.argv[3];
const {createVirglShaderBridge}=await import(pathToFileURL(path.join(root,'renderer/virgl-shader/index.mjs')));
const configuration={};
const bridge=await createVirglShaderBridge(configuration);
const other=await createVirglShaderBridge();
const base='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[0]\nEND\n';
const header='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n';
const body='MOV OUT[0], IN[0]';
const make=(n,labels=false)=>header+Array.from({length:n},(_,i)=>(labels?`${i}: `:'')+body).join('\n')+'\n'+(labels?`${n}: `:'')+'END\n';
const cases=[
 ['baseline',base,true],
 ['exact-text-bound',base+'\n'.repeat(16384-base.length),true],
 ['text-over-bound',base+'\n'.repeat(16385-base.length),false,'input-too-large'],
 ['max-instructions',make(128),true],
 ['max-labeled-instructions',make(128,true),true],
 ['excess-instructions',make(129),false,'parse-error'],
 ['skipped-label',make(2,true).replace('1: MOV','2: MOV'),false,'parse-error'],
 ['exact-line-bound',header+body+' '.repeat(512-body.length)+'\nEND\n',true],
 ['line-over-bound',header+body+' '.repeat(513-body.length)+'\nEND\n',false,'parse-error'],
 ['unknown-property',base.replace('DCL IN[0]','PROPERTY UNKNOWN 1\nDCL IN[0]'),false,'unsupported-feature'],
 ['unknown-property-after-end',base+'PROPERTY UNKNOWN 1\n',false,'parse-error'],
 ['overflow-index',base.replaceAll('IN[0]','IN[4294967296]'),false,'unsupported-feature'],
 ['negative-index',base.replaceAll('IN[0]','IN[-1]'),false,'unsupported-feature'],
 ['range-index',base.replace('DCL IN[0]','DCL IN[0..7]'),false,'parse-error'],
 ['embedded-nul',base+'\0INVALID',false,'invalid-input'],
 ['temp-uninitialized',base.replace('DCL IN[0]','DCL TEMP[0]').replace('IN[0]','TEMP[0]'),false,'parse-error'],
 ['unwritten-output',base.replace('DCL OUT[0], POSITION','DCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]'),false,'parse-error'],
 ['indirect-read',base.replace('MOV OUT[0], IN[0]','MOV OUT[0], IN[ADDR[0].x]'),false,'unsupported-feature'],
 ['sampler-vertex',base.replace('DCL IN[0]','DCL SAMP[0]\nDCL IN[0]'),false,'parse-error'],
 ['unsupported-opcode',base.replace('MOV','KILL'),false,'unsupported-feature'],
];
const original=bridge.translate({stage:'vertex',text:base});
assert.equal(original.ok,true); const saved=JSON.stringify(original);
const results=[];
for(const [name,text,ok,code]of cases){
 const got=bridge.translate({stage:'vertex',text});
 assert.equal(got.ok,ok,name); if(code)assert.equal(got.error.code,code,name);
 const native=spawnSync(path.join(root,'renderer/virgl-shader/build/native/virgl-shader'),['vertex'],{input:text,encoding:'utf8'});
 assert.equal(native.status,0,`${name}: native exit`);
 const n=JSON.parse(native.stdout);
 // Rejections differ in explanatory text between JS and C, but code and successful payload must agree.
 if(ok)assert.deepEqual(got,n,name);else assert.equal(got.error.code,n.error.code,name);
 assert.equal(JSON.stringify(bridge.translate({stage:'vertex',text:base})),saved,`${name}: recovery`);
 assert.equal(JSON.stringify(original),saved,`${name}: result lifetime`);
 assert.equal(JSON.stringify(other.translate({stage:'vertex',text:base})),saved,`${name}: instance isolation`);
 results.push({name,bytes:text.length,ok,code:got.error?.code,sha256:createHash('sha256').update(text).digest('hex')});
}
let seed=0xbace9137,accepted=0,rejected=0;
function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
for(let i=0;i<1536;i++){
 const a=Buffer.from(base);const pos=random()%a.length;a[pos]=random()%128;
 const text=a.toString('latin1'); const got=bridge.translate({stage:'vertex',text});
 assert.equal(typeof got.ok,'boolean');assert.ok(JSON.stringify(got).length<147456);
 if(got.ok)accepted++;else{rejected++;assert.equal(typeof got.error.code,'string');}
 assert.equal(JSON.stringify(bridge.translate({stage:'vertex',text:base})),saved);
 assert.equal(JSON.stringify(original),saved);
}
assert.equal(bridge.translate({stage:'vertex',text:base,flatshade:true}).error.code,'unsupported-feature');
original.metadata.stage='corrupted externally';
assert.equal(JSON.stringify(bridge.translate({stage:'vertex',text:base})),saved,'caller cannot mutate future results');
const allocator=configuration._malloc; configuration._malloc=()=>0;
assert.equal(bridge.translate({stage:'vertex',text:base}).error.code,'allocation-failed');
configuration._malloc=allocator;
assert.equal(JSON.stringify(bridge.translate({stage:'vertex',text:base})),saved,'recovery after injected JS allocation failure');
const report={allocationFailureRecovered:true,prediction:'exact text/line/instruction limits accept; one-past rejects; native/wasm success payloads match; retained JS outputs and independent instances survive hostile calls',status:'passed',cases:results,mutationSeed:'bace9137',mutations:1536,accepted,rejected,recoverySuccesses:1536+cases.length,retainedOutputSha256:createHash('sha256').update(saved).digest('hex')};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));

// Independent verifier numeric/declared-component oracle; no translator output generates expected results.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const root=process.cwd(), out=path.join(root,'evidence/virgl-captured-shaders/verifier');
const hash=(s)=>crypto.createHash('sha256').update(s).digest('hex');
const {createVirglShaderBridge}=await import(pathToFileURL(path.join(root,'renderer/virgl-shader/index.mjs')));
const bridge=await createVirglShaderBridge();
const captures=['e96102a3202dde8b0b05ffa142eb6064c5fe916b673bbf1d31464bcbac56fb33','80d6db6a6f10b93770698cfdd47232fed0fca94f4cb07ba7381bb38563de9808'].map((h,stage)=>({stage:stage?'fragment':'vertex',text:fs.readFileSync(path.join(root,`evidence/virgl-corpus/captures/textured-scene/shaders/${h}.tgsi`),'utf8')}));
const base=captures.map((r)=>bridge.translate(r));base.forEach((r)=>assert.equal(r.ok,true));
const cases=[];
function bitsCase(word,label){const n=BigInt(word);let expected=false; if(n>=0n&&n<=0xffffffffn&&word.length<=10){const bits=Number(n);const exponent=(bits>>>23)&255,mantissa=bits&0x7fffff;const magnitude=bits&0x7fffffff;expected=exponent!==255&&(exponent!==0||mantissa===0)&&magnitude<=0x49742400;}cases.push({name:label,stage:'vertex',expected,text:`VERT\nDCL OUT[0], POSITION\nIMM[0] UINT32 {${word}, 0, 0, 0}\nMOV OUT[0], IMM[0]\nEND\n`});}
for(let sign=0;sign<2;sign++)for(let exponent=0;exponent<256;exponent++)for(const mantissa of [0,1,0x7fffff]){const bits=(sign*0x80000000+exponent*0x800000+mantissa)>>>0;bitsCase(String(bits),`ieee-${sign}-${exponent}-${mantissa}`);}
for(const bits of [0,0x7fffff,0x800000,0x3f7fffff,0x3f800000,0x497423ff,0x49742400,0x49742401,0x7f800000,0x80000000,0xbf800000,0xc9742400,0xffffffff]){for(let width=String(bits).length;width<=11;width++){bitsCase(String(bits).padStart(width,'0'),`padding-${bits}-${width}`);}}
for(const bits of [0x100000000n,0x100000001n,0x100800000n,0x13f800000n,0x149742400n])bitsCase(String(bits),`overflow-alias-${bits}`);
for(let s=0;s<256;s++){const chars=[6,4,2,0].map((shift)=>'xyzw'[(s>>>shift)&3]).join('');cases.push({name:`generic-xy-read-${chars}`,stage:'fragment',expected:![...chars].some((x)=>x==='z'||x==='w'),text:`FRAG\nDCL IN[0].xy, GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\nMOV OUT[0], IN[0].${chars}\nEND\n`});}
const adjacent = [
 ['range-source-operand','vertex',false,'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL TEMP[0..1]\nMOV TEMP[0], IN[0]\nMOV OUT[0], TEMP[0..1]\nEND\n'],
 ['range-destination-operand','vertex',false,'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL TEMP[0..1]\nMOV TEMP[0..1], IN[0]\nMOV OUT[0], IN[0]\nEND\n'],
 ['late-immediate','vertex',false,'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[0]\nIMM[0] UINT32 {0, 0, 0, 0}\nEND\n'],
 ['mixed-float-and-uint-immediates','vertex',true,'VERT\nDCL OUT[0], POSITION\nIMM[0] FLT32 {1, 0, -1, 1}\nIMM[1] UINT32 {0, 0, 0, 1065353216}\nADD OUT[0], IMM[0], IMM[1]\nEND\n'],
 ['out-as-source','vertex',false,'VERT\nDCL OUT[0], POSITION\nMOV OUT[0], OUT[0]\nEND\n'],
 ['sampler-as-source','fragment',false,'FRAG\nDCL OUT[0], COLOR\nDCL SAMP[0]\nMOV OUT[0], SAMP[0]\nEND\n'],
 ['imm-declaration','vertex',false,'VERT\nDCL OUT[0], POSITION\nDCL IMM[0]\nEND\n'],
 ['late-declaration','vertex',false,'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[0]\nDCL TEMP[0..7]\nEND\n'],
 ['nonsequential-immediate','vertex',false,'VERT\nDCL OUT[0], POSITION\nIMM[1] UINT32 {0, 0, 0, 0}\nMOV OUT[0], IMM[1]\nEND\n'],
 ['input-as-destination','vertex',false,'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV IN[0], IN[0]\nMOV OUT[0], IN[0]\nEND\n'],
 ['constant-as-sampler','fragment',false,'FRAG\nDCL IN[0].xy, GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\nDCL CONST[0]\nTEX OUT[0], IN[0].xyyy, CONST[0], 2D\nEND\n'],
 ['vertex-tex','vertex',false,'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nTEX OUT[0], IN[0], SAMP[0], 2D\nEND\n'],
];
for(const [name,stage,expected,text] of adjacent) cases.push({name,stage,expected,text});
const stream=[];for(const c of cases){for(const r of [c,...captures])stream.push(Buffer.from(`${r.stage==='vertex'?0:1} ${Buffer.byteLength(r.text)}\n${r.text}`));}
const raw=Buffer.concat(stream),exe=path.join(root,'target/virgl-captured-verifier/stream');
const result=spawnSync(exe,[],{input:raw,maxBuffer:64*1024*1024,env:{...process.env,ASAN_OPTIONS:'abort_on_error=1',UBSAN_OPTIONS:'halt_on_error=1',LLVM_PROFILE_FILE:path.join(root,'target/virgl-captured-verifier/stream.profraw')}});
fs.writeFileSync(path.join(out,'numeric-native.stderr'),result.stderr??'');assert.equal(result.status,0,result.stderr?.toString());
const outputs=result.stdout.toString().trim().split('\n').map(JSON.parse);assert.equal(outputs.length,cases.length*3);
let accepts=0,rejects=0,recoveries=0;const rows=[];
for(const [i,c] of cases.entries()){
 const native=outputs[i*3],wasm=bridge.translate({stage:c.stage,text:c.text});assert.equal(native.ok,c.expected,c.name+' native');assert.equal(wasm.ok,c.expected,c.name+' wasm');assert.deepEqual(wasm,native,c.name+' cross-runtime');
 if(c.expected)accepts++;else {rejects++;assert.ok(['parse-error','unsupported-feature'].includes(wasm.error.code));assert.equal(Object.hasOwn(wasm,'glsl'),false);}
 for(const [j,request] of captures.entries()){assert.deepEqual(outputs[i*3+j+1],base[j],c.name+' native recovery');assert.deepEqual(bridge.translate(request),base[j],c.name+' Wasm recovery');recoveries+=2;}
 rows.push({name:c.name,expected:c.expected,actual:native.ok,code:native.error?.code,inputSha256:hash(c.text),resultSha256:hash(JSON.stringify(native))});
}
const report={prediction:'Independent sign/exponent/mantissa predicate determines acceptance, and undeclared z/w lanes always reject. Native and Wasm agree and recover byte-identically.',frozenHead:'8759a30622e6604b8cd3d5c35d110260c6fd1943',cases:cases.length,accepts,rejects,recoveries,streamSha256:hash(raw),nativeOutputSha256:hash(result.stdout),wasmSha256:hash(fs.readFileSync(path.join(root,'renderer/virgl-shader/build/wasm/virgl-shader.wasm'))),rows,status:'passed'};
fs.writeFileSync(path.join(out,'numeric-attack.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases:cases.length,accepts,rejects,recoveries,status:'passed'}));

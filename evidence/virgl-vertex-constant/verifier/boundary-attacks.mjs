import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createVirglShaderBridge} from '../../../renderer/virgl-shader/index.mjs';
import {parseConstantDomain} from '../../../renderer/virgl-command/constant-domain.mjs';
const bridge=await createVirglShaderBridge(),records=[];
function text(decl,body){return `VERT\n${decl}\nDCL OUT[0], POSITION\n0: ${body}\n1: END\n`;}
const cases=[
  ['absolute high source',text('DCL CONST[127]','ADD OUT[0], |CONST[127]|, CONST[127]')],
  ['negative high MOV',text('DCL CONST[127]','MOV OUT[0], -CONST[127]')],
  ['negative second high source',text('DCL CONST[127]','MUL OUT[0], CONST[127], -CONST[127]')],
  ['raw known producer plus high declaration',text('DCL CONST[127]\nIMM[0] UINT32 {0,0,0,0}','AND OUT[0], IMM[0], IMM[0]')],
  ['high suffix128 source',text('DCL CONST[127]\nDCL CONST[0]','MOV OUT[0], CONST[128]')],
  ['high plus low raw declaration',text('DCL CONST[0]\nDCL CONST[127]','ADD_PRECISE OUT[0], CONST[0], CONST[0]')],
  ['high raw branch dead-read declaration',`VERT\nDCL CONST[127]\nDCL OUT[0], POSITION\nIMM[0] UINT32 {0,0,0,0}\n0: MOV OUT[0], IMM[0]\n1: UIF IMM[0]\n2: MOV OUT[0], CONST[127]\n3: ENDIF\n4: END\n`],
];
for(const[name,source]of cases){
  const native=JSON.parse(execFileSync('renderer/virgl-shader/build/native/virgl-shader',['vertex'],{input:source,maxBuffer:4e6}));
  const wasm=bridge.translate({stage:'vertex',text:source});assert.deepEqual(native,wasm);assert.equal(native.ok,false,name);
  assert.equal(typeof native.error.code,'string');assert.equal(Object.hasOwn(native,'glsl'),false);records.push({name,text:source,native,wasm});
}
const high=bridge.translate({stage:'vertex',text:text('DCL CONST[0..127]','MOV OUT[0], CONST[127]')});assert.equal(high.ok,true);
const forged=[];
for(const[name,mutate,stage]of[
  ['v6 fragment',m=>m.stage='fragment','fragment'],
  ['v6 exact fields',m=>{m.exactBaseProfile='virgl-webgl2-straight-line-v5';m.constantExactDomains=[];},'vertex'],
  ['v6 finite conditional domain',m=>m.constantDomains=[{kind:'finite-f32-bank-v1',stage:'vertex',slot:0,name:'vsconst0',count:128}],'vertex'],
  ['exact overlay v6 base',m=>{m.profile='virgl-webgl2-raw-bits-v42';m.exactBaseProfile='virgl-webgl2-straight-line-v6';m.constantExactDomains=[];},'vertex'],
]){
  const metadata=structuredClone(high.metadata);mutate(metadata);const result=parseConstantDomain(metadata,stage);assert.equal(result.ok,false,name);forged.push({name,metadata,result});
}
fs.writeFileSync('evidence/virgl-vertex-constant/verifier/boundary-attacks.json',JSON.stringify({task:'E6-T11d1',status:'passed',records,forged},null,2)+'\n');
console.log('Seven complete native/Wasm raw/high modifier attacks and four forged authority contracts reject');

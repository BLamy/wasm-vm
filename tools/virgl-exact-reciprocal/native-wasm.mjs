#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
import {parseConstantDomain,checkExactBank} from '../../renderer/virgl-command/constant-domain.mjs';
import {cases} from './cases.mjs';

const output=path.resolve(process.argv[2]??'target/evidence/virgl-exact-reciprocal');
fs.mkdirSync(output,{recursive:true});
const rows=cases(),bytes=[],push=w=>{for(let i=0;i<4;i++)bytes.push((w>>>(8*i))&255);};
for(const x of 'VRP1')bytes.push(x.charCodeAt(0));push(rows.length);
for(const c of rows){
 const v=Buffer.from(c.vertexText),f=Buffer.from(c.fragmentText);
 for(const n of [v.length,f.length,c.vertexComponents.length,c.fragmentComponents.length])push(n);
 for(const word of [...c.vertexComponents,...c.fragmentComponents])for(const n of [word.register,word.component,word.word])push(n);
 bytes.push(...v,...f);
}
const fixture=Buffer.from(bytes),fixturePath=path.join(output,'inputs.bin');fs.writeFileSync(fixturePath,fixture);
const binary='renderer/virgl-shader/build/exact-reciprocal-sanitize/exact-reciprocal-test';
const native=spawnSync(binary,[],{input:fixture,encoding:'utf8',maxBuffer:32e6,
 env:{...process.env,LLVM_PROFILE_FILE:path.join(output,'native.profraw'),ASAN_OPTIONS:'abort_on_error=1',UBSAN_OPTIONS:'halt_on_error=1'}});
fs.writeFileSync(path.join(output,'native.stdout'),native.stdout??'');fs.writeFileSync(path.join(output,'native.stderr'),native.stderr??'');
assert.equal(native.status,0,native.stderr);const lines=native.stdout.trimEnd().split('\n');
assert.equal(lines.at(-1),'STATUS passed');assert.equal(lines.length,rows.length*2+1);
const bridge=await createVirglShaderBridge(),report={schema:'virgl-exact-reciprocal-v1',task:'E6-T12g6m4a',
 gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'running',
 fixtureSha256:createHash('sha256').update(fixture).digest('hex'),binarySha256:createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),
 wasmSha256:createHash('sha256').update(fs.readFileSync('renderer/virgl-shader/build/wasm/virgl-shader.wasm')).digest('hex'),
 cases:[],bankAttacks:[],metadataAttacks:[]};
for(let i=0;i<rows.length;i++){
 const c=rows[i],exact=JSON.parse(lines[2*i].slice(6)),old=JSON.parse(lines[2*i+1].slice(4));
 assert.equal(lines[2*i].slice(0,6),'EXACT ');assert.equal(lines[2*i+1].slice(0,4),'OLD ');
 const request={vertexText:c.vertexText,fragmentText:c.fragmentText,
  vertexComponents:c.vertexComponents,fragmentComponents:c.fragmentComponents};
 const wasm=bridge.translatePairExact(request),wasmOld=bridge.translatePair({vertexText:c.vertexText,fragmentText:c.fragmentText});
 assert.deepEqual(wasm,exact,c.name+' complete native/Wasm exact result');
 assert.deepEqual(wasmOld,old,c.name+' complete native/Wasm ordinary result');
 assert.equal(exact.ok,c.accept,c.name+' independent admitted boundary');
 if(c.name==='ordinary-winner')assert.deepEqual(exact,old,'ordinary winner complete bytes');
 else assert.equal(old.ok,false,c.name+' old rejection preserved');
 if(exact.ok&&c.mode!=='winner'){
  const p=exact.fragment,word=c.expectedWord;
  assert.equal(p.metadata.profile,'virgl-webgl2-raw-bits-v42');
  assert.ok(p.metadata.knownArithmeticContract.operations.includes('RCP'));
  if(c.name==='mixed-known-arithmetic')
   assert.deepEqual(p.metadata.knownArithmeticContract.operations,['ADD','MUL','RCP'],
    'all three known operations in one admitted exact-bank stage');
  assert.match(p.glsl,new RegExp(`known:reciprocal \\*/ uintBitsToFloat\\(${word}u\\)`),c.name+' matching float literal');
  assert.match(p.glsl,new RegExp(`known:word \\*/ raw_rhs\\.[xyzw] = ${word}u`),c.name+' matching raw literal');
  const parsed=parseConstantDomain(p.metadata,'fragment');assert.equal(parsed.ok,true,c.name+' real strict consumer');
  const count=p.metadata.uniforms[0].count,bank=Array(count*4).fill(0);
  bank[c.fragmentComponents[0].register*4+c.fragmentComponents[0].component]=c.word;
  assert.equal(checkExactBank(bank,parsed.exactDomain,parsed.exactBase).ok,true,c.name+' owned bank');
  const changed=bank.slice();changed[c.fragmentComponents[0].register*4+c.fragmentComponents[0].component]^=1;
  assert.equal(checkExactBank(changed,parsed.exactDomain,parsed.exactBase).ok,false,c.name+' wrong bank');
  assert.equal(checkExactBank(bank.slice(0,-1),parsed.exactDomain,parsed.exactBase).ok,false,c.name+' short bank');
  report.bankAttacks.push({name:c.name,word,wrong:'rejected',short:'rejected'});
  for(const [label,mutate] of [
   ['duplicate',m=>m.knownArithmeticContract.operations.push('RCP')],
   ['wrong-operation',m=>m.knownArithmeticContract.operations=['FLOOR']],
   ['missing-exact',m=>delete m.constantExactDomains],
   ['false-word',m=>m.constantExactDomains[0].components[0].word=(m.constantExactDomains[0].components[0].word^1)>>>0]]){
   const forged=structuredClone(p.metadata);mutate(forged);
   const parsedForge=parseConstantDomain(forged,'fragment');
   if(label==='false-word'){
    assert.equal(parsedForge.ok,true,'well-shaped changed precondition must remain explicit');
    assert.equal(checkExactBank(bank,parsedForge.exactDomain,parsedForge.exactBase).ok,false,'forged precondition rejects real bank');
   }else assert.equal(parsedForge.ok,false,c.name+'/'+label+' metadata rejected');
   report.metadataAttacks.push({name:c.name,label,ok:parsedForge.ok});
  }
 }
 report.cases.push({name:c.name,accept:c.accept,word:c.word,expectedWord:c.expectedWord,mode:c.mode,vertexSha256:createHash('sha256').update(c.vertexText).digest('hex'),fragmentSha256:createHash('sha256').update(c.fragmentText).digest('hex'),exact,old});
}
const original=fs.readFileSync('evidence/virgl-workload-inventory/captures/es2gears/shaders/c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f.tgsi','utf8');
assert.match(original,/34:\s+RCP TEMP\[48\]\.x, CONST\[30\]\.xxxx\n\s*35:\s+POW TEMP\[49\]\.x, TEMP\[47\]\.xxxx, TEMP\[48\]\.xxxx/);
assert.equal(rows.find(x=>x.name==='c580-pc34-35').fragmentComponents[0].word,0x40000000);
report.originalProvenance={sourceSha256:createHash('sha256').update(original).digest('hex'),pc34:'RCP TEMP[48].x, CONST[30].xxxx',pc35:'POW TEMP[49].x, TEMP[47].xxxx, TEMP[48].xxxx',capturedConst30Word:0x40000000};
report.status='passed';fs.writeFileSync(path.join(output,'native-wasm.json'),JSON.stringify(report,null,2)+'\n');
console.log(`${rows.length} native/Wasm exact reciprocal cases, ${report.bankAttacks.length} bank pairs, ${report.metadataAttacks.length} metadata attacks passed`);

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {call,selectorKeys} from './recorded-abi.mjs';
const directory=path.resolve(process.argv[2]),unpacked=path.join(directory,'unpacked'),sha=raw=>createHash('sha256').update(raw).digest('hex');
const load=file=>JSON.parse(fs.readFileSync(file)),rows=file=>fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse),result=[];
const {default:createOld}=await import(pathToFileURL(directory+'/actual-predecessor/virgl-shader.mjs'));
for(const temperature of ['hot','cold']){
 const dir=unpacked+'/'+temperature,nativePath=dir+'/native/native.jsonl',nativeRaw=fs.readFileSync(nativePath),sanRaw=fs.readFileSync(dir+'/native/sanitize.jsonl');assert.deepEqual(nativeRaw,sanRaw);
 const cases=load(dir+'/native/cases.json').cases,native=rows(nativePath),wasm=rows(dir+'/native/wasm.jsonl'),before=rows(dir+'/native/historical-abi.jsonl');assert.equal(cases.length,7163);assert.equal(native.length,cases.length);assert.equal(wasm.length,cases.length);
 const input=fs.readFileSync(dir+'/native/cases.bin');let offset=0;const u32=()=>{const n=input.readUInt32LE(offset);offset+=4;return n;};assert.equal(u32(),cases.length);
 for(const c of cases){assert.equal(u32(),c.kind);for(const name of selectorKeys)assert.equal(u32(),c.selectors[name]);for(const key of ['a','b']){const length=u32(),original=input.subarray(offset,offset+length);offset+=length;assert.deepEqual(original,Buffer.from(c[key]));}}assert.equal(offset,input.length,'no absent/trailing original input bodies');
 const generated=unpacked+'/'+temperature+'-generated/renderer/virgl-shader/build/wasm/virgl-shader.mjs';const {default:createCurrent}=await import(pathToFileURL(generated));
 const current=await createCurrent(),old=await createOld();let accepted=0,historical=0,textureCount=0,systemCount=0;const citations=[];
 for(const [index,c]of cases.entries()){
  const now=call(current,c),r=JSON.parse(now);assert.equal(now,wasm[index].response,c.name+' actual complete generated Wasm response');assert.deepEqual(r,native[index].result,c.name+' entire native response');assert.equal(r.ok,c.okay);
  if(c.kind<29){const prior=call(old,c);assert.equal(prior,now,c.name+' actual historical response bytes');assert.equal(before[historical].name,c.name);assert.equal(before[historical].originalResponse,prior);assert.equal(before[historical].currentResponse,now);historical++;}
  if(r.ok){accepted++;
   for(const original of native[index].originalTokens){assert.ok(original.rawWords.length>=3&&original.rawWords.length<=8192);assert.equal((original.rawWords[0]&255)+(original.rawWords[0]>>>8),original.rawWords.length);assert.ok(original.textureInstructions.every(t=>t.sources.every(s=>s.indirect===0)));textureCount+=original.textureInstructions.length;}
   const selected=c.kind>=29,parts=r.vertex?[r.vertex,r.fragment]:[r];
   if(selected)for(const [at,part]of parts.entries()){
    const tokens=native[index].originalTokens[at],prefix=part.metadata.stage==='vertex'?'vs':'fs',text=at?c.b:c.a;
    const sampled=[...new Set([...text.matchAll(/^\d+: (TEX|TXL|TXD|TXP|TXB)(?:_SAT)?(?:_PRECISE)? .* SAMP\[(\d+)\], SHADOW2D$/gm)].map(m=>+m[2]))].sort((a,b)=>a-b);
    assert.deepEqual(part.metadata.shadowUniforms,sampled.flatMap(index=>[{index,name:prefix+'shadmask'+index,type:'vec4',semantic:'SHADOW_MASK'},{index,name:prefix+'shadadd'+index,type:'vec4',semantic:'SHADOW_ADD'}]));
    if(tokens.systemDeclarations.length)systemCount++;
   }
  }else{assert.deepEqual(Object.keys(r),['ok','error']);assert.equal(r.error.code,c.code);assert.equal(native[index].originalTokens,null);}
  citations.push({name:c.name,case:index,nativeLine:index+1,wasmLine:index+1,inputKind:c.kind,responseSha256:sha(Buffer.from(now)),okay:r.ok});
 }
 assert.equal(accepted,5865);assert.equal(historical,4313);assert.equal(textureCount,5641);assert.equal(systemCount,82);assert.notEqual(current.HEAPU8.buffer,old.HEAPU8.buffer);assert.equal(current.HEAPU8.byteLength,16777216);assert.equal(old.HEAPU8.byteLength,16777216);
 const facade=load(dir+'/native/facade.json'),allocations=rows(dir+'/native/allocations.jsonl');assert.equal(facade.getters,0);assert.ok(facade.ownedSnapshots&&facade.peerIsolation&&facade.pressure.recovered);assert.equal(allocations.at(-1).faults,213);assert.equal(allocations.at(-1).recoveries,213);assert.ok(allocations.at(-1).callerMutation&&!allocations.at(-1).partialResults);
 for(const row of allocations.filter(r=>r.kind==='calloc-fault'||r.kind==='upstream-fault')){assert.equal(row.result.ok,false);assert.deepEqual(Object.keys(row.result),['ok','error']);}
 const summary={temperature,status:'passed',cases:cases.length,accepted,rejected:cases.length-accepted,historical,textureCount,systemCount,nativeSha256:sha(nativeRaw),sanitizedSha256:sha(sanRaw),casesBinSha256:sha(input),facadeSha256:sha(fs.readFileSync(dir+'/native/facade.json')),allocationsSha256:sha(fs.readFileSync(dir+'/native/allocations.jsonl')),allocationFaults:213,citations};result.push(summary);
 console.log('Independent actual original-body/native/sanitized/Wasm/historical audit:',temperature,cases.length,historical);
}
fs.writeFileSync(directory+'/original-response-audit.json',JSON.stringify({schema:'independent-shadow-original-response-audit-v1',status:'passed',records:result},null,2)+'\n');

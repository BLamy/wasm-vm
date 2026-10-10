// Promoted actual Wasm C failure and exact-recovery test after inputs allocate.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createVirglStandardShaderBridge} from '../../renderer/virgl-shader/standard.mjs';
const vertex='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
const fragment='FRAG\nDCL CONST[0]\nDCL OUT[0], COLOR\n0: MOV OUT[0], CONST[0]\n1: END\n';
const reference=await createVirglStandardShaderBridge(),base=reference.translate({stage:'vertex',text:vertex}),pairBase=reference.translatePair({vertexText:vertex,fragmentText:fragment});assert.ok(base.ok&&pairBase.ok);
const reflectionFailure=reference.translatePair(new Proxy({}, {ownKeys(){throw new Error('paired reflection');}}));
assert.deepEqual(reflectionFailure,{ok:false,error:{code:'invalid-input',message:'Standard pair reflection failed.'}});
const results=[];
for(const releasedBytes of [2048,65536]){
 const allocated=[];let runtime;
 const bridge=await createVirglStandardShaderBridge({onRuntimeInitialized(){runtime=this;for(const size of [65536,1024,1]){let p;while((p=this._malloc(size))!==0)allocated.push({pointer:p,size});}}});
 assert.equal(runtime.HEAPU8.buffer.byteLength,16777216);
 let remaining=releasedBytes;
 for(const size of [65536,1024])for(let i=allocated.length-1;i>=0&&remaining>=size;i--)if(allocated[i].size===size){runtime._free(allocated[i].pointer);remaining-=size;allocated.splice(i,1);}
 assert.equal(remaining,0,'precise pressure release');
 const single=bridge.translate({stage:'vertex',text:vertex}),pair=bridge.translatePair({vertexText:vertex,fragmentText:fragment});
 assert.equal(single.ok,false);assert.equal(pair.ok,false);assert.deepEqual(Object.keys(single),['ok','error']);assert.deepEqual(Object.keys(pair),['ok','error']);
 assert.ok(!single.error.message.startsWith('Wasm standard input'),'input malloc succeeded and C compiler itself rejected');
 for(const {pointer}of allocated.reverse())runtime._free(pointer);
 assert.deepEqual(bridge.translate({stage:'vertex',text:vertex}),base);assert.deepEqual(bridge.translatePair({vertexText:vertex,fragmentText:fragment}),pairBase);
 assert.equal(runtime.HEAPU8.buffer.byteLength,16777216);
 results.push({releasedBytes,single,pair,recovered:true,bytes:runtime.HEAPU8.buffer.byteLength});
}
await fs.writeFile((process.argv[2]??'target/evidence/virgl-standard-shader-adversarial')+'/wasm-pressure.json',JSON.stringify({status:'passed',results,reflectionFailure},null,2)+'\n');console.log(JSON.stringify(results));

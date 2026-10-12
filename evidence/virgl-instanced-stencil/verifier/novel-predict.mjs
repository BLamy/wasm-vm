import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {criticFixture,setup,state,draw} from './novel-fixture.mjs';
import {model} from '../../../tools/virgl-instanced-stencil/oracle.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const hex=b=>Buffer.from(b).toString('hex');
const predictions=[];
for(const format of [20,126])for(const seed of [0x510e527f,0x9b05688c,0x1f83d9ab]){
 const f=criticFixture(format,seed),packets=[setup(f),state(f),draw(f)],history=packets.map(b=>({ctx:1,hex:hex(b)}));
 const original=model(history,f.buffers,{format,width:f.width,height:f.height,input:f.source.planes[f.level].input});
 const sample=original.pixel(8,4);
 predictions.push({format,seed,preparedBeforeNativeExecution:true,packetHex:packets.map(hex),shaderSha256:sha(f.vertex),
  inputBodies:[...f.buffers].map(([id,b])=>({id,bytes:b.length,sha256:sha(b)})),originalInstances:7,originalPrimitives:original.primitives,
  normalizedOriginalIds:original.nativeIds,nativeCalls:original.primitives.length*2*7,
  originalBases:Array.from({length:7},(_,i)=>i),retainedDivisor3Offsets:[8,8,8,24,24,24,40],packedDivisor2Offsets:[12,12,16,16,20,20,24],
  sample:{x:8,y:4,expected:sample}});
}
await fs.writeFile(new URL('novel-predictions.json',import.meta.url),JSON.stringify({schema:'fresh-original-instanced-stencil-novel-predictions-v1',nativeEvidenceInspected:false,predictions},null,2)+'\n');
console.log(JSON.stringify(predictions.map(p=>({format:p.format,seed:p.seed,nativeCalls:p.nativeCalls,sample:p.sample}))));

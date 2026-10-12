// Critic-owned original bytes: restart strips cross two independent divisor phases.
import {fixture,setup,state,draw} from '../../../tools/virgl-instanced-stencil/fixtures.mjs';
export {setup,state,draw};
export function criticFixture(format,seed){
 const f=fixture({format,seed,instances:7,mode:5,indexSize:4,indexed:true,pattern:'edges',restartIndex:0xffffffff,
  divisor:3,attributeFormat:173,attributeDivisor:2,generic:false,name:`critic-${format}/u32-restart-strip/divisor3-packed2`});
 const raw=f.buffers.get(4),v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
 const phase=[[-1/32,1/16],[0,0],[1/32,-1/16]];
 for(let i=0;i<phase.length;i++){v.setFloat32(8+i*16,phase[i][0],true);v.setFloat32(12+i*16,phase[i][1],true);}
 return f;
}

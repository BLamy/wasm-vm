import {specimen,face,packet,join,shader,word,surface,textureTransfer,clear,dsa,refs,scissor} from '../virgl-stencil/fixtures.mjs';
export {packet,join,word,clear,dsa,refs,face};
export const vertex = incoming => `VERT
DCL IN[0]
DCL IN[1]
DCL IN[2]
DCL SV[0], INSTANCEID
DCL SV[1], VERTEXID
DCL OUT[0], POSITION
DCL OUT[1], GENERIC[0]
DCL TEMP[0..1]
IMM[0] FLT32 {0,0,${incoming*2-1},1}
IMM[1] UINT32 {17,255,0,0}
IMM[2] FLT32 {0.00390625,0.0625,1,0}
0: MOV OUT[0], IN[0]
1: ADD OUT[0].xy, IN[0], IN[1]
2: MOV OUT[0].z, IMM[0].zzzz
3: I2F TEMP[0].x, SV[1].xxxx
4: SEQ TEMP[0].x, TEMP[0].xxxx, IN[0].zzzz
5: MUL OUT[0].w, TEMP[0].xxxx, IN[0].wwww
6: UMUL TEMP[1].x, SV[1].xxxx, IMM[1].xxxx
7: AND TEMP[1].x, TEMP[1].xxxx, IMM[1].yyyy
8: U2F TEMP[1].x, TEMP[1].xxxx
9: MUL OUT[1].x, TEMP[1].xxxx, IMM[2].xxxx
10: I2F TEMP[0].y, SV[0].xxxx
11: MAD OUT[1].y, TEMP[0].yyyy, IMM[2].yyyy, IN[1].zzzz
12: MOV OUT[1].z, IN[2].zzzz
13: MOV OUT[1].w, IMM[0].wwww
14: END
`;
export const fragment = smooth => `FRAG\nDCL IN[0], GENERIC[0], ${smooth?'PERSPECTIVE':'CONSTANT'}\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n`;
export function fixture(options={}) {
 const o={format:20,seed:0xd9453211,ordinal:0,mode:4,indexSize:2,indexed:true,start:7,instances:1,indexOffset:6,vertexOffset:12,elementOffset:4,divisor:2,generic:true,enabled:true,restartIndex:17,pattern:'ordered',incoming:.25,cull:false,frontCcw:false,smooth:false,...options};
 if(options.indexOffset===undefined)o.indexOffset=3*o.indexSize;
 const f=specimen(o.format,o.seed,o.ordinal,{...o,front:face({zpass:2,writeMask:255}),back:face({zpass:3,writeMask:170}),frontRef:117,backRef:29,...options});
 f.width=f.source.planes[f.level].width;f.height=f.source.planes[f.level].height;
 f.name=options.name??`ordered-${f.format}/mode${f.mode}/${f.indexed?'u'+f.indexSize*8:'arrays'}/${f.pattern}`;
 f.vertex=vertex(f.incoming);f.fragment=fragment(f.smooth);
 const ids=o.indexSize===1?[53,9,141,211]:o.indexSize===4?[4099,701,65547,9031]:[53,9,301,711];
 let sequence=f.mode===4?[ids[0],ids[1],ids[2],ids[0],ids[2],ids[1],ids[0],ids[1],ids[2],ids[0],ids[2],ids[1]]:f.mode===5?[ids[0],ids[1],ids[2],ids[0],ids[1],ids[2]]:f.mode===6?[ids[0],ids[1],ids[2],ids[1],ids[2],ids[1]]:[...ids];
 if(f.mode===1)sequence=[ids[0],ids[1],ids[1],ids[2],ids[2],ids[3],ids[3],ids[0]];
 const baseSequence=[...sequence];
 if(f.pattern==='edges')sequence=[f.restartIndex,f.restartIndex,...sequence,f.restartIndex,f.restartIndex,...sequence,f.restartIndex];
 if(f.pattern==='all')sequence=Array(7).fill(f.restartIndex);
 if(f.pattern==='partial')sequence=sequence.slice(0,f.tail??2);
 if(f.pattern==='degenerate')sequence=f.mode<=3?[ids[0],ids[0],ids[1],ids[1],ids[2],ids[2],ids[3],ids[3],ids[0]]:[ids[0],ids[0],ids[1],ids[1],ids[2],ids[2],ids[0]];
 if(options.ids)sequence=[...options.ids];
 if(!f.indexed){f.enabled=false;f.restartIndex=0;sequence=Array.from({length:f.count??baseSequence.length},(_,i)=>f.start+i);}
 else sequence=sequence.map(id=>f.indexSize===1?id&255:f.indexSize===2?id&65535:id>>>0);
 f.count=sequence.length;f.ids=sequence;
 const valid=sequence.filter(id=>!f.indexed||!f.enabled||id!==f.restartIndex),maximum=valid.length?Math.max(...valid):0,prefix=f.vertexOffset+f.elementOffset;
 const positions=new Uint8Array(prefix+(maximum+1)*16-(f.shortVertex?1:0)),pv=new DataView(positions.buffer);
 const points=f.mode>=4?[[2,2],[18,2],[2,10],[18,10]]:[[2.5,2.5],[14.5,2.5],[14.5,12.5],[2.5,12.5]];
 const write=(id,index)=>{const p=points[index%points.length],raw=[p[0]/16-1,p[1]/8-1,id,1];for(let k=0;k<4;k++){const at=prefix+id*16+k*4;if(at+4<=positions.length)pv.setFloat32(at,raw[k],true);}};
 if(f.indexed)for(let i=0;i<ids.length;i++)write(ids[i],i);
 else for(let i=0;i<sequence.length;i++)write(sequence[i],f.mode===4?[0,1,2,0,2,1][i%6]:f.mode===5?i%3:f.mode===6?i===0?0:i%2?1:2:i%4);
 // An out-of-type restart is not a marker; the narrowed original word remains
 // an ordinary original vertex ID, including a disabled fixed sentinel.
 for(const id of valid)if(!ids.includes(id)&&f.indexed)write(id,3);
 const effective=Math.max(1,f.instances),elements=f.divisor?Math.floor((effective-1)/f.divisor)+1:maximum+1;
 const instanceBytes=new Uint8Array(8+elements*16-(f.shortInstance?1:0)),iv=new DataView(instanceBytes.buffer);
 for(let i=0;i<elements;i++)for(let k=0;k<4;k++)if(8+i*16+k*4+4<=instanceBytes.length)iv.setFloat32(8+i*16+k*4,[0,0,i/16,0][k],true);
 const genericBytes=new Uint8Array(12+(f.generic?1:maximum+1)*16),gv=new DataView(genericBytes.buffer);for(let i=0;i<(f.generic?1:maximum+1);i++)[0,0,.75,1].forEach((v,k)=>gv.setFloat32(12+i*16+k*4,v,true));
 f.buffers=new Map([[3,positions],[4,instanceBytes],[5,genericBytes]]);
 if(f.indexed){const raw=new Uint8Array(f.indexOffset+f.count*f.indexSize-(f.shortIndex?1:0)),dv=new DataView(raw.buffer);for(let i=0;i<f.count;i++){const at=f.indexOffset+i*f.indexSize;if(at+f.indexSize<=raw.length)f.indexSize===1?dv.setUint8(at,sequence[i]):f.indexSize===2?dv.setUint16(at,sequence[i],true):dv.setUint32(at,sequence[i],true);}f.buffers.set(22,raw);}
 return f;
}
export const draw=f=>packet(8,0,[f.indexed?0:f.start,f.count,f.mode,Number(f.indexed),f.instances,0,0,Number(f.enabled),f.enabled?f.restartIndex:0,0,0,0]);
export const state=f=>join(dsa(30,f.front,f.back,f),refs(f.frontRef,f.backRef));
export const raster=f=>join(packet(1,2,[40,2|1<<29|Number(f.frontCcw)<<15|Number(f.scissor)<<14|Number(f.cull)<<9,word(1),0,0xffff,word(1),0,0,0]),packet(2,2,[40]));
export function setup(f){return join(...[...f.buffers].map(([id,raw])=>textureTransfer(id,0,raw.length,1)),...f.source.planes.map(p=>textureTransfer(6,p.level,p.width,p.height,p.offset,p.stride)),
 shader(10,0,f.vertex),shader(11,1,f.fragment),packet(1,5,[12,f.elementOffset,0,0,31,0,f.divisor,1,31,0,0,2,31]),packet(2,5,[12]),
 packet(6,0,[16,f.vertexOffset,3,16,8,4,f.generic?0:16,12,5]),...(f.indexed?[packet(11,0,[22,f.indexSize,f.indexOffset])]:[]),
 surface(20,1,31,f.outputLevel),surface(21,6,f.format,f.level),packet(5,0,[1,21,20]),packet(4,0,[0,...[16,8,.5,16,8,.5].map(word)]),
 packet(31,0,[10,0]),packet(31,0,[11,1]),raster(f),scissor(3,3,17,9),clear(4,0,1,f.clearWords));}

/** Literal Gallium target/format inputs and independent RGBA8 byte oracle. */
export const shapes = Object.freeze([
  { target: 3, width: 5, height: 3, depth: 7, arraySize: 1, lastLevel: 2, levels: [[5,3,7],[2,1,3],[1,1,1]] },
  { target: 4, width: 5, height: 5, depth: 1, arraySize: 6, lastLevel: 2, levels: [[5,5,6],[2,2,6],[1,1,6]] },
  { target: 7, width: 5, height: 3, depth: 1, arraySize: 7, lastLevel: 2, levels: [[5,3,7],[2,1,7],[1,1,7]] },
]);
export const hex = bytes => [...bytes].map(value => value.toString(16).padStart(2,"0")).join("");
export const copy = value => JSON.parse(JSON.stringify(value,(_,v)=>ArrayBuffer.isView(v)?hex(new Uint8Array(v.buffer,v.byteOffset,v.byteLength)):v));
export function random(seed) { let state=seed>>>0;return()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;}; }
export function plane(seed, tag, level, [width,height,layers]) {
 const out=new Uint8Array(width*height*layers*4);
 for(let z=0;z<layers;z++)for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let lane=0;lane<4;lane++)
  out[((z*height+y)*width+x)*4+lane]=(seed+tag*43+level*29+z*31+y*17+x*13+lane*53)&255;
 return out;
}
export function patch(original,[width,height],box,tight) {
 const out=new Uint8Array(original);
 for(let z=0;z<box.depth;z++)for(let y=0;y<box.height;y++)for(let x=0;x<box.width;x++)for(let lane=0;lane<4;lane++)
  out[(((box.z+z)*height+box.y+y)*width+box.x+x)*4+lane]=tight[((z*box.height+y)*box.width+x)*4+lane];
 return out;
}
export const whole = ([width,height,depth]) => ({x:0,y:0,z:0,width,height,depth});
export function publicLayout([width,height],box,{offset=5,stride=0,layerStride=0}={}) {
 const rowBytes=box.width*4,rowStride=stride||width*4,layer=layerStride||rowStride*height;
 const footprint=(box.depth-1)*layer+(box.height-1)*rowStride+rowBytes;
 return {offset,rowBytes,rowStride,layerStride:layer,footprintBytes:footprint,requiredEnd:offset+footprint,tightBytes:rowBytes*box.height*box.depth};
}
export function scatter(tight,box,layout,bytes) {
 const out=new Uint8Array(bytes);
 for(let z=0;z<box.depth;z++)for(let y=0;y<box.height;y++)
  out.set(tight.subarray((z*box.height+y)*box.width*4,(z*box.height+y+1)*box.width*4),layout.offset+z*layout.layerStride+y*layout.rowStride);
 return out;
}
export function wire(id,level,box,{opcode=43,stride=0,layerStride=0,offset=5,direction=1,stagingId=200,flags=1,data=null}={}) {
 let payload=[id,level,0,stride,layerStride,box.x,box.y,box.z,box.width,box.height,box.depth];
 if(opcode===9) {
  const padded=new Uint8Array(Math.ceil(data.length/4)*4);padded.fill(0x59);padded.set(data);const view=new DataView(padded.buffer);
  payload.push(...Array.from({length:padded.length/4},(_,i)=>view.getUint32(i*4,true)));
 } else if(opcode===45) payload.push(stagingId,offset,flags);
 else payload.push(offset,direction);
 const out=new Uint8Array((payload.length+1)*4),view=new DataView(out.buffer);view.setUint32(0,opcode+(payload.length<<16),true);
 payload.forEach((v,i)=>view.setUint32((i+1)*4,v,true));return out;
}

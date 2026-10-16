// Original fields and independently counted NPOT extents; no renderer imports.
export const shapes=[
 {name:'cube',target:4,width:5,height:5,depth:1,arraySize:6,lastLevel:2,levels:[[5,5,6],[2,2,6],[1,1,6]]},
 {name:'array',target:7,width:7,height:5,depth:1,arraySize:7,lastLevel:2,levels:[[7,5,7],[3,2,7],[1,1,7]]},
];
export const formats=[16,18,20,21,126];
export const pixelBytes=fmt=>fmt===16?2:fmt===126?8:4;
export const hex=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join('');
export const whole=([width,height,depth])=>({x:0,y:0,z:0,width,height,depth});
const FLOATS=[0x3eaaab55,0x3f000001,0x3effffff,0x3f7fffff,0x35800000,0x3c012345,0x3f000000,0x3e800000,0,0x3f800000,0xbf800000,0x40000000,0x00800000,0x00900001];
const EXCEPTIONAL=[0x80000000,1,0x007fffff,0x80000001,0x7f800000,0xff800000,0x7fc01234,0x7f812345,0xffc56789];
const UN24=[0x5555a7,0,1,2,127,128,255,256,257,65535,65536,65537,0x3fffff,0x400000,0x400001,0x7ffffe,0x7fffff,0x800000,0x800001,0xfffffd,0xfffffe,0xffffff];
export function plane(seed,fmt,target,level,[w,h,d],tag=0,exceptional=false){
 const size=pixelBytes(fmt),bytes=new Uint8Array(w*h*d*size),view=new DataView(bytes.buffer);let state=(seed^Math.imul(target,0x9e3779b1)^Math.imul(level+tag,0x85ebca6b))>>>0;
 const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
 for(let i=0;i<w*h*d;i++) {
  const number=random(),stencil=(seed+i*73+level*29+tag*19)&255;
  if(fmt===16)view.setUint16(i*size,number&65535,true);
  else if(fmt===20||fmt===21){const z=i<UN24.length?UN24[(i+tag+level)%UN24.length]:number&0xffffff;view.setUint32(i*size,fmt===20?((z<<8)|stencil)>>>0:(z|((number^0xa7)<<24))>>>0,true);}
  else{const values=exceptional?EXCEPTIONAL:FLOATS;view.setUint32(i*size,values[(i+level+tag+number)%values.length],true);if(fmt===126)view.setUint32(i*size+4,(number&0xffffff00)|stencil,true);}
 }
 return bytes;
}
export function publicLayout(extent,box,fmt,fields={}) {
 const size=pixelBytes(fmt),rowBytes=box.width*size,rowStride=fields.stride||extent[0]*size,layerStride=fields.layerStride||rowStride*extent[1];
 return {offset:fields.offset??0,rowBytes,rowStride,layerStride,rowCount:box.height,layerCount:box.depth,footprintBytes:(box.depth-1)*layerStride+(box.height-1)*rowStride+rowBytes,tightBytes:rowBytes*box.height*box.depth};
}
export function scatter(tight,box,layout,original){
 const out=new Uint8Array(original);let at=0;
 for(let layer=0;layer<box.depth;layer++)for(let row=0;row<box.height;row++){const start=layout.offset+layer*layout.layerStride+row*layout.rowStride;out.set(tight.subarray(at,at+layout.rowBytes),start);at+=layout.rowBytes;}
 return out;
}
export function gather(backing,box,layout){
 const out=new Uint8Array(layout.tightBytes);let at=0;
 for(let layer=0;layer<box.depth;layer++)for(let row=0;row<box.height;row++){const start=layout.offset+layer*layout.layerStride+row*layout.rowStride;out.set(backing.subarray(start,start+layout.rowBytes),at);at+=layout.rowBytes;}
 return out;
}
export function patch(original,[width,height],box,tight,fmt){
 const size=pixelBytes(fmt),out=new Uint8Array(original);let offset=0;
 for(let layer=0;layer<box.depth;layer++)for(let row=0;row<box.height;row++){
  const at=(((box.z+layer)*height+box.y+row)*width+box.x)*size,n=box.width*size;out.set(tight.subarray(offset,offset+n),at);offset+=n;
 }
 return out;
}
export function cleared(fmt,[width,height,layers],values){
 const size=pixelBytes(fmt),out=new Uint8Array(width*height*layers*size),view=new DataView(out.buffer);
 for(let layer=0;layer<layers;layer++)for(let i=0;i<width*height;i++){
  const at=(layer*width*height+i)*size,[depth,stencil]=values[layer];
  if(fmt===16)view.setUint16(at,Math.round(depth*65535),true);
  else if(fmt===20||fmt===21){const z=Math.round(depth*0xffffff);view.setUint32(at,fmt===20?((z<<8)|stencil)>>>0:z,true);}
  else {view.setFloat32(at,depth,true);if(fmt===126)view.setUint32(at+4,stencil,true);}
 }
 return out;
}
export function wire(id,level,box,{opcode=43,stride=0,layerStride=0,offset=0,direction=1,stagingId=200,flags=1,data}={}){
 const words=[id,level,0,stride,layerStride,box.x,box.y,box.z,box.width,box.height,box.depth];
 if(opcode===43)words.push(offset,direction);else if(opcode===45)words.push(stagingId,offset,flags);
 else {if(opcode!==9||!(data instanceof Uint8Array))throw Error('literal inline packet');const padded=new Uint8Array(Math.ceil(data.length/4)*4);padded.set(data);const v=new DataView(padded.buffer);for(let at=0;at<padded.length;at+=4)words.push(v.getUint32(at,true));}
 const out=new Uint8Array((words.length+1)*4),v=new DataView(out.buffer);v.setUint32(0,(words.length<<16)|opcode,true);words.forEach((word,i)=>v.setUint32((i+1)*4,word>>>0,true));return out;
}

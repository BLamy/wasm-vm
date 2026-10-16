import {source as originalSource,metadata as depthMetadata,originalFormat,canonical,nativeMisses} from '../virgl-command/standard-floating-depth-fixtures.mjs';
import {packet,join,shader,word,imageView,sampler,surface,textureTransfer} from '../virgl-command/standard-byte-color-fixtures.mjs';
import {positions,vertex,draw,clear as colorClear} from '../virgl-packed-unsigned-consumer/fixtures.mjs';
export {packet,join,shader,word,imageView,sampler,surface,textureTransfer,positions,vertex,draw,originalFormat,canonical,nativeMisses};
export const metadata=(id,format,width,height,lastLevel=0,bind=2)=>({...depthMetadata(id,format,width,height,lastLevel,bind)});
export function source(format,seed,width=17,height=9,lastLevel=3){
 const value=originalSource(format,width,height,lastLevel,seed),bpp=originalFormat(format).guestPixelBytes;
 for(const plane of value.planes){
  const view=new DataView(plane.input.buffer);
  for(let i=0;i<plane.width*plane.height;i++)view.setFloat32(i*bpp,(1+((i*7+plane.level*13+(seed>>>0)%63)%63))/64,true);
  for(let y=0;y<plane.height;y++)value.backing.set(plane.input.subarray(y*plane.width*bpp,(y+1)*plane.width*bpp),plane.offset+y*plane.stride);
 }
 const backing=new Uint8Array(16000).fill(0xa7);backing.set(value.backing);value.backing=backing;return value;
}
const numbered=(decl,ops)=>decl.join('\n')+'\n'+ops.map((op,index)=>`${index}: ${op}\n`).join('');
export function sampleCases({smoke=false,seed=0xd9403211}={}){
 const cases=[];
 for(const format of [18,126])for(const stage of ['vertex','fragment'])for(const opcode of smoke?['TXL']:['TXF','TXL','TEX','TXD','TXB','TXQ']){
  if(stage==='vertex'&&opcode==='TXB')continue;
  for(const linear of [false]){
   const index=cases.length,firstLevel=opcode==='TXD'?1:index%3===0?0:1,lastLevel=firstLevel===0?4:index%3===1?3:2,lod=opcode==='TXL'&&linear?.5:['TXL','TXF','TXQ','TXD'].includes(opcode)?1:0,slot=index%2?15:0,
    src=source(format,seed^format,17,9,4),base=src.planes[firstLevel],coord=[.375,.25,0,lod],
    swizzle=[[0,1,2,3],[0,0,0,5],[2,4,0,5],[3,1,2,4]][index%4],
    decl=['DCL TEMP[0]',`DCL SAMP[${slot}]`,`DCL SVIEW[${slot}], 2D, FLOAT`,`IMM[0] FLT32 {${coord.join(',')}}`,`IMM[1] INT32 {${opcode==='TXQ'?Math.floor(lod):0},0,0,${Math.floor(lod)}}`,
     `IMM[2] FLT32 {${2/base.width},0,0,0}`,`IMM[3] FLT32 {0,${2/base.height},0,0}`];
   let ops=[`${opcode} TEMP[0], ${opcode==='TXF'?'IMM[1]':'IMM[0]'}, SAMP[${slot}], 2D`];
   if(opcode==='TXD')ops=[`TXD TEMP[0], IMM[0], IMM[2], IMM[3], SAMP[${slot}], 2D`];
   if(opcode==='TXQ')ops=['MOV TEMP[0], IMM[1]',`TXQ TEMP[0].xyw, IMM[1], SAMP[${slot}], 2D`,'U2F TEMP[0], TEMP[0]'];
   const vs=stage==='vertex'?numbered(['VERT','DCL IN[0]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]',...decl],['MOV OUT[0], IN[0]',...ops,'MOV OUT[1], TEMP[0]','END']):vertex,
    fs=stage==='fragment'?numbered(['FRAG','DCL OUT[0], COLOR',...decl],[...ops,'MOV OUT[0], TEMP[0]','END']):'FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n',outputLevel=index%2?1:0,
    targetWidth=outputLevel?9:5,targetHeight=outputLevel?7:3,width=targetWidth>>outputLevel,height=targetHeight>>outputLevel;
   cases.push({name:`depth-${format}/${stage}/${opcode}/${linear?'linear':'nearest'}`,kind:'sample',format,stage,opcode,slot,source:src,firstLevel,lastLevel,lod,coord,swizzle,linear,
    parameters:{s:2,t:2,r:2,min:Number(linear),mip:opcode==='TEX'||opcode==='TXB'?2:Number(linear),mag:Number(linear),minLod:-1000,maxLod:1000},
    width,height,targetWidth,targetHeight,outputLevel,outputLastLevel:2,outputFormat:31,vertex:vs,fragment:fs,clearWords:[-.25,.125,.75,.5].map(word)});
  }
 }
 return cases;
}
export function setupSample(f){return join(textureTransfer(3,0,positions.length,1),...f.source.planes.map(p=>textureTransfer(6,p.level,p.width,p.height,p.offset,p.stride)),
 shader(10,0,f.vertex),shader(11,1,f.fragment),packet(1,5,[12,0,0,0,31]),packet(2,5,[12]),packet(6,0,[16,0,3]),surface(20,1,f.outputFormat,f.outputLevel),
 packet(5,0,[1,0,20]),packet(4,0,[0,...[f.width/2,f.height/2,.5,f.width/2,f.height/2,.5].map(word)]),packet(31,0,[10,0]),packet(31,0,[11,1]),colorClear(4,f.clearWords));}
export const viewsSample=f=>join(sampler(50,f.parameters),imageView(51,6,f.format,f.firstLevel,f.lastLevel,f.swizzle),packet(10,0,[f.stage==='vertex'?0:1,f.slot,51]),packet(18,0,[f.stage==='vertex'?0:1,f.slot,50]));
export const readOutput=f=>packet(43,0,[1,f.outputLevel,0,f.width*16+3,0,0,0,0,f.width,f.height,1,5,2]);
const valueAt=(f,level,x,y)=>new DataView(f.source.planes[level].input.buffer).getFloat32((y*f.source.planes[level].width+x)*originalFormat(f.format).guestPixelBytes,true);
export function sampleValue(f){
 if(f.opcode==='TXQ'){const p=f.source.planes[f.firstLevel+Math.floor(f.lod)];return [p.width,p.height,0,f.lastLevel-f.firstLevel+1];}
 const lod=['TEX','TXB'].includes(f.opcode)?0:f.lod;
 const lookup=level=>{const p=f.source.planes[level];if(f.opcode==='TXF')return valueAt(f,level,0,0);
  const [u,v]=f.coord;if(!f.linear)return valueAt(f,level,Math.min(p.width-1,Math.floor(u*p.width)),Math.min(p.height-1,Math.floor(v*p.height)));
  const x=u*p.width-.5,y=v*p.height-.5,ix=Math.floor(x),iy=Math.floor(y),a=x-ix,b=y-iy,
   at=(xx,yy)=>valueAt(f,level,Math.max(0,Math.min(p.width-1,xx)),Math.max(0,Math.min(p.height-1,yy)));
  return (at(ix,iy)*(1-a)+at(ix+1,iy)*a)*(1-b)+(at(ix,iy+1)*(1-a)+at(ix+1,iy+1)*a)*b;
 };
 const first=f.firstLevel+Math.floor(lod),fraction=lod-Math.floor(lod),z=lookup(first)*(1-fraction)+(fraction?lookup(first+1)*fraction:0),lanes=[z,0,0,1];return f.swizzle.map(k=>k===4?0:k===5?1:lanes[k]);
}
export const floatWords=values=>values.map(word);
export function uniformPlane(width,height,words){const data=new Uint32Array(width*height*4);for(let i=0;i<width*height;i++)data.set(words,i*4);return new Uint8Array(data.buffer);}
export function missWords(observed,expected){const a=new Uint32Array(observed.buffer,observed.byteOffset,observed.byteLength/4),b=new Uint32Array(expected.buffer,expected.byteOffset,expected.byteLength/4);if(a.length!==b.length)return[{bytes:observed.length,expected:expected.length}];const misses=[];for(let i=0;i<a.length;i++)if(a[i]!==b[i]&&misses.length<8)misses.push({word:i,observed:a[i],expected:b[i]});return misses;}
export function depthClear(depth){const bytes=colorClear(1,[0,0,0,0]);new DataView(bytes.buffer).setFloat64(24,depth,true);return bytes;}
export const dsa=(handle,func,enabled=true,write=true)=>join(packet(1,3,[handle,Number(enabled)|Number(write)<<1|func<<2,0,0,0]),packet(2,3,[handle]));
export function depthCases({smoke=false,seed=0xd9403211}={}){
 const out=[];
 for(const format of [18,126])for(const func of smoke?[7]:[0,1,2,3,4,5,6,7])for(const write of smoke?[true]:[false,true])out.push({format,func,write,enabled:true,outputFormat:31});
 if(!smoke)for(const format of [18,126]){
  for(const write of [false,true])out.push({format,func:7,write,enabled:false,outputFormat:31});
  for(const outputFormat of [196,200])out.push({format,func:3,write:true,enabled:true,outputFormat});
 }
 return out.map((v,index)=>{
  const level=index%2,src=source(v.format,seed^v.format,9,7,2),p=src.planes[level],bpp=originalFormat(v.format).guestPixelBytes;
  for(const plane of src.planes){const dv=new DataView(plane.input.buffer);for(let i=0;i<plane.width*plane.height;i++)dv.setFloat32(i*bpp,[.25,.5,.75][i%3],true);
   for(let y=0;y<plane.height;y++)src.backing.set(plane.input.subarray(y*plane.width*bpp,(y+1)*plane.width*bpp),plane.offset+y*plane.stride);}
  const words=v.outputFormat===31?[.125,.75,-.5,1].map(word):v.outputFormat===200?[0xfffffff7,8,0x80000000,0x7fffffff]:[0xffffffff,17,0x80000000,1],clearWords=v.outputFormat===31?[.25,.5,.75,.125].map(word):[2,3,4,5],
   fragment=numbered(['FRAG','DCL OUT[0], COLOR',`IMM[0] UINT32 {${words.join(',')}}`],['MOV OUT[0], IMM[0]','END']);
  return {...v,name:`surface-${v.format}/${v.outputFormat}/func${v.func}/test${Number(v.enabled)}/write${Number(v.write)}`,kind:'surface',source:src,level,width:p.width,height:p.height,targetWidth:9,targetHeight:7,outputLevel:level,outputLastLevel:2,vertex,fragment,words,clearWords};
 });
}
export function setupDepth(f){return join(textureTransfer(3,0,positions.length,1),...f.source.planes.map(p=>textureTransfer(6,p.level,p.width,p.height,p.offset,p.stride)),
 shader(10,0,f.vertex),shader(11,1,f.fragment),packet(1,5,[12,0,0,0,31]),packet(2,5,[12]),packet(6,0,[16,0,3]),surface(20,1,f.outputFormat,f.outputLevel),surface(21,6,f.format,f.level),
 packet(5,0,[1,21,20]),packet(4,0,[0,...[f.width/2,f.height/2,.5,f.width/2,f.height/2,.5].map(word)]),packet(31,0,[10,0]),packet(31,0,[11,1]),colorClear(4,f.clearWords),dsa(30,f.func,f.enabled,f.write));}
export function depthExpected(f){
 const p=f.source.planes[f.level],input=p.input.slice(),dv=new DataView(input.buffer),color=uniformPlane(f.width,f.height,f.clearWords),cv=new Uint32Array(color.buffer),bpp=originalFormat(f.format).guestPixelBytes;
 for(let i=0;i<f.width*f.height;i++){
  const z=dv.getFloat32(i*bpp,true),pass=!f.enabled||[false,.5<z,.5===z,.5<=z,.5>z,.5!==z,.5>=z,true][f.func];
  if(pass)cv.set(f.words,i*4);if(pass&&f.enabled&&f.write)dv.setFloat32(i*bpp,.5,true);
 }
 return {input,color};
}

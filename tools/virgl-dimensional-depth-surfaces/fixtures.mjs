// Literal original wire and independent complete-image model, without renderer imports.
import {packet,join,shader,word} from '../virgl-command/standard-image-fixtures.mjs';
import {clear,dsa,face,refs} from '../virgl-stencil/fixtures.mjs';
export {packet,join,shader,word,clear,dsa,face,refs};
export const BASE='2aca65e9328aa1433fb516511ca554fdd96b422d';
export const keys=['id','target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags'];
export const metadata=(id,target,format,bind,width,height,depth=1,arraySize=1,lastLevel=0)=>({id,target,format,bind,width,height,depth,arraySize,lastLevel,nrSamples:0,flags:0});
export const bytesPerPixel=format=>format===16?2:format===126?8:4;
export const stencilOffset=format=>format===20?0:format===126?4:null;
export const surface=(handle,id,level,layer,format,lastLayer=layer)=>packet(1,8,[handle,id,format,level,layer|lastLayer<<16]);
export const VERTEX='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
export const fragment=color=>'FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {'+color.join(',')+'}\n0: MOV OUT[0], IMM[0]\n1: END\n';
export function cases({smoke=false}={}){
 const rows=[];
 for(const target of [4,7])for(const format of [16,18,20,21,126])for(const bind of smoke?[9]:[1,9])for(const level of [0,1,2]){
  const layers=target===4?6:5;
  for(const layer of smoke?[layers-1]:Array.from({length:layers},(_,i)=>i))rows.push({target,format,bind,level,layer,name:`target${target}/format${format}/role${bind}/mip${level}/layer${layer}`});
 }
 return rows;
}
export function setDepth(format,bytes,pixel,depth){
 const size=bytesPerPixel(format),at=pixel*size,v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(format===16)v.setUint16(at,Math.round(depth*65535),true);
 else if(format===20)v.setUint32(at,((Math.round(depth*0xffffff)<<8)|bytes[at])>>>0,true);
 else if(format===21)v.setUint32(at,Math.round(depth*0xffffff),true);
 else v.setFloat32(at,depth,true);
}
export function fixture(spec,seed){
 const source=metadata(6,spec.target,spec.format,spec.bind,5,spec.target===4?5:3,1,spec.target===4?6:spec.target===7?5:1,2);
 const levels=Array.from({length:3},(_,level)=>{
  const width=Math.max(1,Math.floor(source.width/2**level)),height=Math.max(1,Math.floor(source.height/2**level)),layers=source.arraySize,size=bytesPerPixel(spec.format),bytes=new Uint8Array(width*height*layers*size);
  for(let z=0;z<layers;z++)for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const pixel=(z*height+y)*width+x,at=pixel*size,s=(seed+level*43+z*31+y*17+x*7)&255;
   setDepth(spec.format,bytes,pixel,(seed+level+z+y+x)&1);
   const offset=stencilOffset(spec.format);if(offset!==null)bytes[at+offset]=s;
   // The pinned original X padding is canonically zero on inverse transfer.
   if(spec.format===126)bytes.fill(s^0xa7,at+5,at+8);
   if(spec.format===21)bytes[at+3]=s^0x71;
  }
  return {level,width,height,layers,bytes};
 });
 const p=levels[spec.level],points=[...new Map([[0,0],[p.width-1,p.height-1]].map(v=>[v.join(','),v])).values()];
 const positions=z=>new Uint8Array(new Float32Array(points.flatMap(([x,y])=>[(2*x+1)/p.width-1,(2*y+1)/p.height-1,z,1])).buffer);
 const colorTarget=spec.colorTarget??2,colorLayer=spec.colorLayer??0;
 const color=metadata(1,colorTarget,67,2,p.width,p.height,1,colorTarget===4?6:colorTarget===7?5:1);
 return {...spec,seed,source,levels,points,positions:positions(-1),farPositions:positions(1),width:p.width,height:p.height,color,colorLayer,stencil:seed&255,reference:(seed+97)&255};
}
export function canonical(format,input){
 const bytes=input.slice(),size=bytesPerPixel(format);
 for(let at=0;at<bytes.length;at+=size){if(format===21)bytes[at+3]=0;if(format===126)bytes.fill(0,at+5,at+8);}
 return bytes;
}
export function expected(f,{near=true,far=true,clearDepth=true,clearStencil=true,prior=f.levels}={}){
 const planes=prior.map(p=>({...p,bytes:canonical(f.format,p.bytes)})),p=planes[f.level],size=bytesPerPixel(f.format),offset=stencilOffset(f.format);
 if(clearDepth||clearStencil)for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++){
  const pixel=(f.layer*p.height+y)*p.width+x;if(clearDepth)setDepth(f.format,p.bytes,pixel,1);if(clearStencil&&offset!==null)p.bytes[pixel*size+offset]=f.stencil;
 }
 for(const [x,y]of f.points){const pixel=(f.layer*p.height+y)*p.width+x;if(near)setDepth(f.format,p.bytes,pixel,0);if(offset!==null&&near)p.bytes[pixel*size+offset]=far?f.reference^255:f.reference;}
 const color=new Uint8Array(f.width*f.height*f.color.arraySize*4);
 for(let i=0;i<color.length/4;i++)color.set([11,29,47,83],i*4);
 for(let i=0;i<f.width*f.height;i++)color.set([255,0,255,0],(f.colorLayer*f.width*f.height+i)*4);
 if(near)for(const [x,y]of f.points)color.set([0,255,0,255],((f.colorLayer*f.height+y)*f.width+x)*4);
 return {planes,color};
}
export const draw=count=>packet(8,0,[0,count,0,0,1,0,0,0,0,0,0xffffffff,0]);
export const viewport=(w,h)=>packet(4,0,[0,...[w/2,h/2,.5,w/2,h/2,.5].map(word)]);
export function setup(f){
 const stencil=stencilOffset(f.format)!==null,front=face({enabled:stencil,zpass:2,zfail:7}),back=face({enabled:stencil,zpass:2,zfail:7});
 return join(shader(10,0,VERTEX),shader(11,1,fragment([0,1,0,1])),shader(42,1,fragment([1,0,0,1])),packet(1,5,[12,0,0,0,31]),packet(2,5,[12]),packet(6,0,[16,0,3]),surface(20,1,0,f.colorLayer,67),surface(21,6,f.level,f.layer,f.format),packet(5,0,[1,21,20]),viewport(f.width,f.height),packet(31,0,[10,0]),packet(31,0,[11,1]),packet(1,2,[40,2|1<<29,word(1),0,0xffff,word(1),0,0,0]),packet(2,2,[40]),dsa(30,front,back,{depthEnable:true,depthWrite:true,depthFunc:1}),refs(f.reference,f.reference));
}

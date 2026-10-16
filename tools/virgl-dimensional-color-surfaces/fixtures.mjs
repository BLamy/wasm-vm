// Original wire and image expectations. No renderer or generated shader input.
import {packet,join,shader,clear,word} from '../virgl-command/standard-image-fixtures.mjs';
export {packet,join,shader,clear,word};
export const BASE='2691b24e6c00478f8d69f81180b6827761de246a';
export const keys=['id','target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags'];
export const metadata=(id,target,format,bind,width,height,depth=1,arraySize=1,lastLevel=0)=>({id,target,format,bind,width,height,depth,arraySize,lastLevel,nrSamples:0,flags:0});
export const VERTEX='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
export const FRAGMENT='FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {0,1,0,1}\n0: MOV OUT[0], IMM[0]\n1: END\n';
export const CLEAR=[1,0,1,0],PAINT=[0,255,0,255];
export function cases({smoke=false}={}){
 const rows=[];
 for(const target of [3,4,7])for(const bind of smoke?[10]:[2,10])for(const level of [0,1,2]){
  const layers=target===3?Math.max(1,Math.floor(5/2**level)):target===4?6:5;
  for(const layer of smoke?[layers-1]:Array.from({length:layers},(_,i)=>i))rows.push({target,bind,level,layer,name:`target${target}/role${bind}/mip${level}/layer${layer}`});
 }
 return rows;
}
export function fixture(spec,seed){
 const source=metadata(6,spec.target,67,spec.bind,5,spec.target===4?5:3,spec.target===3?5:1,spec.target===4?6:spec.target===7?5:1,2);
 const levels=Array.from({length:3},(_,level)=>{
  const width=Math.max(1,Math.floor(source.width/2**level)),height=Math.max(1,Math.floor(source.height/2**level)),layers=source.target===3?Math.max(1,Math.floor(source.depth/2**level)):source.arraySize;
  const bytes=new Uint8Array(width*height*layers*4);
  for(let z=0;z<layers;z++)for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let lane=0;lane<4;lane++)bytes[((z*height+y)*width+x)*4+lane]=(seed+level*43+z*31+y*17+x*7+lane*53)&255;
  return {level,width,height,layers,bytes};
 });
 const selected=levels[spec.level],points=[[0,0],[selected.width-1,selected.height-1]],positions=[];
 for(const [x,y] of points)positions.push((2*x+1)/selected.width-1,(2*y+1)/selected.height-1,0,1);
 return {...spec,seed,source,levels,points,positions:new Uint8Array(new Float32Array(positions).buffer),width:selected.width,height:selected.height};
}
export function expected(f){
 return f.levels.map(p=>{
  const bytes=p.bytes.slice();
  if(p.level===f.level){
   for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++)bytes.set([255,0,255,0],((f.layer*p.height+y)*p.width+x)*4);
   for(const [x,y]of f.points)bytes.set(PAINT,((f.layer*p.height+y)*p.width+x)*4);
  }
  return {...p,bytes};
 });
}
export const surface=(handle,id,level,layer,format=67,lastLayer=layer)=>packet(1,8,[handle,id,format,level,layer|lastLayer<<16]);
export function setup(f){return join(shader(10,0,VERTEX),shader(11,1,FRAGMENT),packet(1,5,[12,0,0,0,31]),packet(2,5,[12]),packet(6,0,[16,0,3]),surface(20,6,f.level,f.layer),packet(5,0,[1,0,20]),packet(4,0,[0,...[f.width/2,f.height/2,.5,f.width/2,f.height/2,.5].map(word)]),packet(31,0,[10,0]),packet(31,0,[11,1]),packet(1,2,[40,2|1<<29,word(1),0,0xffff,word(1),0,0,0]),packet(2,2,[40]));}
export const draw=()=>packet(8,0,[0,2,0,0,1,0,0,0,0,0,0xffffffff,0]);

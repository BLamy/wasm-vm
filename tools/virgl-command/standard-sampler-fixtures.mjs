/** Original sampler words and shader fixtures; no renderer-derived predictions. */
import {packet,join,meta,transfer,shader,clear} from '../../renderer/virgl-command/tests/standard-instanced-draws.mjs';
export const word=n=>new DataView(new Float32Array([n]).buffer).getUint32(0,true);
export const wraps=[0,2,4];
export function sampler(handle,{s=0,t=0,r=0,min=0,mip=2,mag=0,compare=0,compareFunction=0,seamless=false,anisotropy=0,bias=0,minLod=-1000,maxLod=1000,border=[0,0,0,0]}={}){
 return packet(1,7,[handle,(s|t<<3|r<<6|min<<9|mip<<11|mag<<13|compare<<15|compareFunction<<16|Number(seamless)<<19|anisotropy<<20)>>>0,word(bias),word(minLod),word(maxLod),...border]);
}
export const view=(handle,id,swizzle=[0,1,2,3])=>packet(1,6,[handle,id,67|2<<24,0,0,swizzle.reduce((n,k,i)=>n|k<<i*3,0)]);
export const bind=(stage,v,state=8)=>join(packet(10,0,[stage,0,v]),packet(18,0,[stage,0,state]));
export const draw=()=>packet(8,0,[0,3,4,0,1,0,0,0,0,0,0xffffffff,0]);
const program=(stage,dcl,ops)=>(stage?'FRAG\n':'VERT\n')+dcl+'\n'+[...ops,'END'].map((op,i)=>i+': '+op+'\n').join('');
export function image(width,height,seed=0){
 const bytes=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4;
  bytes.set([((2*x+3*y+seed)%15)*16,((5*x+y+2+seed)%15)*16,((x+7*y+4+seed)%15)*16,32+((3*x+2*y+seed)%12)*16],i);
 }
 return bytes;
}
export function specimen({stage='fragment',scale=2,offset=[-.375,-.625],vsCoord=[-.375,1.125],textureWidth=5,textureHeight=3,width=8,height=8,swizzle=[0,1,2,3],vertexSwizzle=[0,1,2,3]}={}){
 const texturedVS=stage!=='fragment',texturedFS=stage!=='vertex';
 const s={stage,scale,offset,vsCoord,textureWidth,textureHeight,width,height,swizzle,vertexSwizzle,images:[image(textureWidth,textureHeight,1),image(textureWidth,textureHeight,0)],positions:new Uint8Array(new Float32Array([-1,-1,0,1,3,-1,0,1,-1,3,0,1]).buffer)};
 s.vertex=program(0,'DCL IN[0]\nDCL OUT[0], POSITION'+(texturedFS?'\nDCL OUT[1], GENERIC[0]':'')+(texturedVS?'\nDCL OUT[2], GENERIC[1]\nDCL SAMP[0]\nDCL SVIEW[0], 2D, FLOAT':'')+'\nIMM[0] FLT32 {'+[scale,scale,0,0].join(',')+'}\nIMM[1] FLT32 {'+[...offset,0,0].join(',')+'}\nIMM[2] FLT32 {'+[...vsCoord,0,0].join(',')+'}',
  ['MOV OUT[0], IN[0]',...(texturedFS?['MAD OUT[1], IN[0], IMM[0], IMM[1]']:[]),...(texturedVS?['TEX OUT[2], IMM[2], SAMP[0], 2D']:[])]);
 s.fragment=program(1,(texturedFS?'DCL IN[0], GENERIC[0], PERSPECTIVE\nDCL SAMP[0]\nDCL SVIEW[0], 2D, FLOAT\n':'')+(texturedVS?'DCL IN[1], GENERIC[1], PERSPECTIVE\n':'')+'DCL OUT[0], COLOR\nDCL TEMP[0]\nIMM[0] FLT32 {0.5,0.5,0.5,0.5}',
  stage==='fragment'?['TEX OUT[0], IN[0], SAMP[0], 2D']:stage==='vertex'?['MOV OUT[0], IN[1]']:['TEX TEMP[0], IN[0], SAMP[0], 2D','ADD TEMP[0], TEMP[0], IN[1]','MUL OUT[0], TEMP[0], IMM[0]']);
 return s;
}
export function setup(r,s,parameters={}, {create=true,state=8,viewHandles=[5,6]}={}){
 if(create){r.add(meta(3,0,64,0,s.positions.length),s.positions);for(let k=0;k<2;k++)r.add(meta(5+k,2,67,8,s.textureWidth,s.textureHeight),s.images[k]);}
 return join(transfer(3,s.positions.length),...s.images.map((_,k)=>transfer(5+k,s.textureWidth,s.textureHeight)),shader(1,0,s.vertex),shader(2,1,s.fragment),
  packet(1,5,[3,0,0,0,31]),packet(2,5,[3]),packet(6,0,[16,0,3]),packet(1,8,[4,1,67,0,0]),packet(5,0,[1,0,4]),packet(4,0,[0,...[s.width/2,s.height/2,.5,s.width/2,s.height/2,.5].map(word)]),
  view(viewHandles[0],5,s.vertexSwizzle),view(viewHandles[1],6,s.swizzle),sampler(state,parameters),...(s.stage!=='fragment'?[bind(0,viewHandles[0],state)]:[]),...(s.stage!=='vertex'?[bind(1,viewHandles[1],state)]:[]),packet(31,0,[1,0]),packet(31,0,[2,1]),clear([0,0,0,0]));
}

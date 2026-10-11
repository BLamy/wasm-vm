import {packet,join,shader,word,surface,textureTransfer,positions,vertex,draw,metadata,floatWords,uniformPlane,missWords} from '../virgl-packed-depth-consumer/fixtures.mjs';
export {packet,join,shader,word,surface,textureTransfer,positions,vertex,draw,metadata,floatWords,uniformPlane,missWords};
export const bytesPerPixel=format=>format===126?8:format===16?2:4;
export const stencilOffset=format=>format===20?0:format===126?4:null;
export const faceWord=f=>(Number(f.enabled)|f.func<<1|f.fail<<4|f.zpass<<7|f.zfail<<10|f.valueMask<<13|f.writeMask<<21)>>>0;
export const face=(changes={})=>({enabled:true,func:7,fail:0,zpass:0,zfail:0,valueMask:255,writeMask:255,...changes});
export function dsa(handle,front,back,{depthEnable=false,depthWrite=false,depthFunc=7,alphaFunc=0,alphaRef=0}={}){
 return join(packet(1,3,[handle,Number(depthEnable)|Number(depthWrite)<<1|depthFunc<<2|alphaFunc<<9,faceWord(front),faceWord(back),word(alphaRef)]),packet(2,3,[handle]));
}
export const refs=(front,back)=>packet(13,0,[front|back<<8]);
export function clear(buffers,stencil=0,depth=.5,color=[-.25,.125,.75,.5].map(word)){
 const bytes=packet(7,0,[buffers,...color,0,0,stencil]);new DataView(bytes.buffer).setFloat64(24,depth,true);return bytes;
}
export const raster=(handle,{frontCcw=false,scissor=false}={})=>join(packet(1,2,[handle,2|1<<29|Number(frontCcw)<<15|Number(scissor)<<14,word(1),0,0xffff,word(1),0,0,0]),packet(2,2,[handle]));
export const scissor=(x,y,w,h)=>packet(15,0,[0,x|y<<16,(x+w)|(y+h)<<16]);
export function source(format,seed=0xd9443211,width=65,height=33,lastLevel=2){
 const bpp=bytesPerPixel(format),planes=[];let cursor=7;
 for(let level=0;level<=lastLevel;level++){
  const w=Math.max(1,width>>level),h=Math.max(1,height>>level),input=new Uint8Array(w*h*bpp),v=new DataView(input.buffer),stride=w*bpp+11,offset=cursor;cursor+=h*stride+23;
  for(let i=0;i<w*h;i++){
   const z=[0,.25,.75,1][(i+level)%4],s=(i+seed+level*31)&255;
   if(format===20)v.setUint32(i*4,(Math.round(z*0xffffff)<<8)|s,true);
   else if(format===21)v.setUint32(i*4,Math.round(z*0xffffff)|((s^0xa5)<<24),true);
   else if(format===16)v.setUint16(i*2,Math.round(z*65535),true);
   else {v.setFloat32(i*bpp,z,true);if(format===126){input[i*bpp+4]=s;input.fill((i*13+seed)&255,i*bpp+5,i*bpp+8);}}
  }
  planes.push({level,width:w,height:h,input,stride,offset});
 }
 const backing=new Uint8Array(cursor+45000).fill(0xb3);
 for(const p of planes)for(let y=0;y<p.height;y++)backing.set(p.input.subarray(y*p.width*bpp,(y+1)*p.width*bpp),p.offset+y*p.stride);
 return {metadata:metadata(6,format,width,height,lastLevel,9),planes,backing};
}
export function positionsFor(incoming=0,reverse=false){
 const out=positions.slice(),v=new DataView(out.buffer);for(let i=0;i<6;i++)v.setFloat32(i*16+8,incoming*2-1,true);
 if(reverse)for(const first of [0,3]){const a=out.slice((first+1)*16,(first+2)*16);out.copyWithin((first+1)*16,(first+2)*16,(first+3)*16);out.set(a,(first+2)*16);}return out;
}
export function specimen(format,seed,index,changes={}){
 const level=index%2,src=source(format,seed^index),p=src.planes[level],words=[.25,.5,.75,1].map(word),clearWords=[-.25,.125,.75,.5].map(word),front=face(),back=face();
 return {name:'stencil-'+format+'/'+index,format,kind:'draw',source:src,level,width:p.width,height:p.height,targetWidth:65,targetHeight:33,outputLevel:level,outputLastLevel:2,outputFormat:31,vertex,
  fragment:'FRAG\nDCL OUT[0], COLOR\nIMM[0] UINT32 {'+words.join(',')+'}\n0: MOV OUT[0], IMM[0]\n1: END\n',words,clearWords,
  front,back,frontRef:127,backRef:127,depthEnable:false,depthWrite:false,depthFunc:7,incoming:index%2,reverse:Boolean(index%2),frontCcw:Boolean(index%3===0),scissor:false,...changes};
}
export const isFront=f=>f.reverse===f.frontCcw;
export function setup(f){return join(textureTransfer(3,0,positions.length,1),...f.source.planes.map(p=>textureTransfer(6,p.level,p.width,p.height,p.offset,p.stride)),
 shader(10,0,f.vertex),shader(11,1,f.fragment),packet(1,5,[12,0,0,0,31]),packet(2,5,[12]),packet(6,0,[16,0,3]),surface(20,1,31,f.outputLevel),surface(21,6,f.format,f.level),packet(5,0,[1,21,20]),
 packet(4,0,[0,...[f.width/2,f.height/2,.5,f.width/2,f.height/2,.5].map(word)]),packet(31,0,[10,0]),packet(31,0,[11,1]),raster(40,f),scissor(2,3,5,4),clear(4,0,1,f.clearWords));}
export const state=f=>join(dsa(30,f.front,f.back,f),refs(f.frontRef,f.backRef));
const compare=(func,a,b)=>[false,a<b,a===b,a<=b,a>b,a!==b,a>=b,true][func];
export function operation(op,s,ref){return [s,0,ref,Math.min(255,s+1),Math.max(0,s-1),(s+1)&255,(s-1)&255,s^255][op];}
export const depthAt=(format,input,i)=>format===20?(new DataView(input.buffer).getUint32(i*4,true)>>>8)/0xffffff:format===21?(new DataView(input.buffer).getUint32(i*4,true)&0xffffff)/0xffffff:format===16?new DataView(input.buffer).getUint16(i*2,true)/65535:new DataView(input.buffer).getFloat32(i*bytesPerPixel(format),true);
export function setDepth(format,input,i,z){const v=new DataView(input.buffer);if(format===20)v.setUint32(i*4,(Math.round(z*0xffffff)<<8)|input[i*4],true);else if(format===21)v.setUint32(i*4,Math.round(z*0xffffff),true);else if(format===16)v.setUint16(i*2,Math.round(z*65535),true);else v.setFloat32(i*bytesPerPixel(format),z,true);}
export function expected(f,prior=f.source.planes[f.level].input,{present=true}={}){
 const input=prior.slice(),color=uniformPlane(f.width,f.height,f.clearWords),c=new Uint32Array(color.buffer),offset=stencilOffset(f.format),frontOnly=f.front.enabled&&!f.back.enabled,
  selected=frontOnly||isFront(f)?f.front:f.back,ref=frontOnly||isFront(f)?f.frontRef:f.backRef,enabled=present&&(f.front.enabled||f.back.enabled);
 for(let i=0;i<f.width*f.height;i++){
  const z=depthAt(f.format,input,i),old=offset===null?0:input[i*bytesPerPixel(f.format)+offset],test=!enabled||compare(selected.func,ref&selected.valueMask,old&selected.valueMask),depth=!f.depthEnable||compare(f.depthFunc,f.incoming,z),pass=test&&depth,
   inside=!f.scissor||(i%f.width>=2&&i%f.width<7&&Math.floor(i/f.width)>=3&&Math.floor(i/f.width)<7);
  if(!inside)continue;
  if(enabled){const op=!test?selected.fail:depth?selected.zpass:selected.zfail,n=operation(op,old,ref);input[i*bytesPerPixel(f.format)+offset]=(old&(~selected.writeMask&255))|(n&selected.writeMask);}
  if(pass)c.set(f.words,i*4);if(pass&&f.depthEnable&&f.depthWrite)setDepth(f.format,input,i,f.incoming);
 }
 return {input,color};
}
export function cases({mode='operations',seed=0xd9443211,smoke=false}={}){
 const rows=[];let index=0;const push=(format,changes)=>{const f=specimen(format,seed,index++,changes);rows.push(f);return f;};
 if(mode==='operations')for(const format of [20,126])for(const op of smoke?[2]:[0,1,2,3,4,5,6,7])for(const path of ['fail','depth-fail','depth-pass'])for(const side of ['front','back']){
  const mode=index%3,f=push(format,{name:`stencil-${format}/op${op}/${path}/${side}`,depthEnable:path!=='fail',depthWrite:path==='depth-pass'&&Boolean(index%2),depthFunc:path==='depth-fail'?0:7});
  f.reverse=side==='front'?f.frontCcw:!f.frontCcw;
  const selected=face({func:path==='fail'?0:7,[path==='fail'?'fail':path==='depth-fail'?'zfail':'zpass']:op}),other=face({func:path==='fail'?7:0,fail:7,zfail:5,zpass:6});
  if(mode===0){f.front=selected;f.back=face({enabled:false,func:3,valueMask:85,writeMask:170,zpass:7});f.backRef=29;}
  else {f.front=side==='front'?selected:other;f.back=side==='back'?selected:other;if(mode===2)f.front.enabled=false;}
 }
 if(mode==='compares')for(const format of [20,126])for(const func of smoke?[1,4]:[0,1,2,3,4,5,6,7])for(const side of ['front','back']){
  const f=push(format,{name:`stencil-${format}/compare${func}/${side}`,frontRef:129,backRef:129});f.reverse=side==='front'?f.frontCcw:!f.frontCcw;
  f.front=face({func:side==='front'?func:7,fail:7,zpass:2,valueMask:func%2?85:255});f.back=face({func:side==='back'?func:0,fail:7,zpass:2,valueMask:f.front.valueMask});
 }
 if(mode==='masks')for(const format of [20,126])for(const mask of smoke?[0,85,255]:[0,1,15,85,127,128,170,255]){
  const ref=(mask*7+93)&255,f=push(format,{name:`stencil-${format}/mask${mask}`,frontRef:ref,backRef:ref,depthEnable:false,depthWrite:true});f.front=face({zpass:2,writeMask:mask});f.back=face({zpass:7,writeMask:mask});
 }
 if(mode==='clears')for(const format of [20,126])for(const buffers of [2,3,6,7])for(const level of [0,1]){
  const f=push(format,{name:`stencil-${format}/clear${buffers}/mip${level}`,kind:'clear',level,outputLevel:level,frontRef:31,backRef:31,scissor:true,clearBuffers:buffers,clearStencil:[256,0x123456a5,0x80000001,0xffffffff][(index-1)%4],clearDepth:.5});const p=f.source.planes[level];f.width=p.width;f.height=p.height;
  f.front=face({writeMask:index%2?85:0,zpass:3});f.back=face({writeMask:f.front.writeMask,zpass:4});
 }
 if(mode==='inactive')for(const format of [20,126])for(const frontOnly of [false,true]){
  const f=push(format,{name:`stencil-${format}/inactive-fields/${frontOnly}`,alphaFunc:6,alphaRef:-.375,frontRef:13,backRef:29,scissor:true});
  f.front=face({enabled:frontOnly,func:7,writeMask:85,valueMask:170,zpass:2});f.back=face({enabled:false,func:0,writeMask:15,valueMask:240,fail:7,zfail:6,zpass:5});
 }
 if(mode==='boundaries')for(const format of [20,126])for(let i=0;i<4;i++){
  const f=push(format,{name:`stencil-${format}/lifetime${i}`,terminalMode:['complete','cancel','owner-first','renderer-first'][i]});f.front=face({zpass:3,writeMask:85});f.back=face({zpass:7,writeMask:85});
 }
 return rows;
}

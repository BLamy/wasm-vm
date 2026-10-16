// Original guest packets and analytic RGBA8 oracles, independent of the renderer.
import {dimensionalFixtures,pairTexts,legal} from '../virgl-dimensional-shaders/fixtures.mjs';
import {packet,join,shader,word,sampler,surface} from '../virgl-command/standard-image-fixtures.mjs';
export {packet,join,shader,word,sampler,surface};
export const BASE='deb7b3113f9adeb2e6e80449a6710dd3295093ea';
export const profile='virgl-webgl2-standard-dimensional-texture-gles3-v1';
export const keys=['id','target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags'];
const numbers={'2D':2,'3D':3,CUBE:4,'2D_ARRAY':7};
export const targetNumber=target=>numbers[target];
export const metadata=(id,target,format,bind,width,height,depth=1,arraySize=1,lastLevel=0)=>({id,target,format,bind,width,height,depth,arraySize,lastLevel,nrSamples:0,flags:0});
export function cases({smoke=false}={}){
  const rows=dimensionalFixtures().filter(f=>f.type==='FLOAT');
  if(smoke)return rows.filter(f=>f.opcode==='TXL'&&f.slot===7&&!f.label).map(f=>({...f,firstLevel:1,lastLevel:2,swizzle:[3,4,5,0]}));
  const out=rows.map((f,i)=>({...f,firstLevel:0,lastLevel:2,swizzle:[[0,1,2,3],[3,4,5,0],[5,4,5,4]][i%3]}));
  for(const stage of ['vertex','fragment'])for(const target of ['3D','CUBE','2D_ARRAY'])for(const opcode of ['TEX','TXL','TXD','TXF','TXP','TXQ','TXB'])if(legal(stage,target,opcode)){
    const f={stage,target,type:'FLOAT',opcode,slot:7,firstLevel:1,lastLevel:2,swizzle:[2,5,4,0],biasProbe:opcode==='TXB'};
    out.push({...f,name:`private/${stage}/${target}/${opcode}`,...pairTexts(stage,f)});
  }
  for(const stage of ['vertex','fragment'])for(const target of ['3D','CUBE','2D_ARRAY']){
    for(const mode of ['npot','linear','mip-linear','repeat','mirror','lod-clamp','short-range']){
      const f={stage,target,type:'FLOAT',opcode:mode==='repeat'||mode==='mirror'?'TEX':'TXL',slot:15,
        firstLevel:0,lastLevel:mode==='short-range'?0:2,swizzle:[3,0,4,5],
        width:mode==='npot'?(target==='CUBE'?5:5):4,height:mode==='npot'?(target==='CUBE'?5:3):4,
        depth:mode==='npot'?7:4,arraySize:mode==='npot'?7:5,mode,
        ...(mode==='linear'||mode==='mip-linear'?{linear:true}:{}),...(mode==='mip-linear'?{fixedLod:.5}:{}),
        ...(mode==='lod-clamp'?{minLod:1,maxLod:1}:{}),...(mode==='repeat'?{wrap:0}:{}),...(mode==='mirror'?{wrap:4}:{})};
      out.push({...f,name:`state/${stage}/${target}/${mode}`,...pairTexts(stage,f)});
    }
    if(target==='2D_ARRAY')for(const [firstLayer,lastLayer]of [[1,3],[4,4]])for(const opcode of ['TXL','TXF','TXQ']){
      const f={stage,target,type:'FLOAT',opcode,slot:7,firstLevel:1,lastLevel:2,firstLayer,lastLayer,swizzle:[0,1,2,3],layerProbe:true};
      out.push({...f,name:`subset/${stage}/${firstLayer}-${lastLayer}/${opcode}`,...pairTexts(stage,f)});
    }
  }
  return out;
}
export function fixture(spec){
  const f={width:4,height:4,depth:4,arraySize:5,firstLevel:0,lastLevel:2,firstLayer:0,
    swizzle:[0,1,2,3],wrap:2,minLod:-1000,maxLod:1000,...spec};
  f.lastLayer=spec.lastLayer??(f.target==='CUBE'?5:f.target==='2D_ARRAY'?f.arraySize-1:0);
  f.sourceExpression=spec.source;
  f.source=metadata(6,targetNumber(f.target),67,10,f.width,f.height,f.target==='3D'?f.depth:1,f.target==='CUBE'?6:f.target==='2D_ARRAY'?f.arraySize:1,2);
  f.levels=Array.from({length:3},(_,level)=>{
    const width=Math.max(1,Math.floor(f.width/2**level)),height=Math.max(1,Math.floor(f.height/2**level)),layers=f.target==='3D'?Math.max(1,Math.floor(f.depth/2**level)):f.source.arraySize;
    const bytes=new Uint8Array(width*height*layers*4);
    for(let z=0;z<layers;z++)for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let lane=0;lane<4;lane++)
      bytes[((z*height+y)*width+x)*4+lane]=((level*5+z*3+x*7+y*11)>>lane&1)*255;
    return {level,width,height,layers,bytes};
  });
  const base=localExtent(f,0);f.grid={width:f.biasProbe?4:Math.max(6,base.layers),height:f.biasProbe?4:f.lastLevel-f.firstLevel+1};
  const positions=[],coordinates=[],dx=[],dy=[];
  if(f.biasProbe){
    for(const [x,y]of [[0,0],[1,0],[0,1],[0,1],[1,0],[1,1]]){
      positions.push(2*x-1,2*y-1,0,1);
      const face=f.face??0,d=directions[face];
      const c=f.target==='CUBE'?d.map((v,axis)=>v||(axis===(face<2?2:0)?2*x-1:0)):[x,y,f.target==='3D'?.875:base.layers-1];
      coordinates.push(...c,8);dx.push(0,0,0,0);dy.push(0,0,0,0);
    }
  }else for(let y=0;y<f.grid.height;y++)for(let x=0;x<f.grid.width;x++){
    positions.push(2*(x+.5)/f.grid.width-1,2*(y+.5)/f.grid.height-1,0,1);
    coordinates.push(...coordinate(f,x,y));
    if(f.target==='3D')dx.push(0,0,2**y/base.layers,0);
    else if(f.target==='CUBE')dx.push(...(x%6<2?[0,0,2**(y+1)/base.width]:[2**(y+1)/base.width,0,0]),0);
    else dx.push(2**y/base.width,0,99,0);
    dy.push(0,0,0,0);
  }
  f.inputs=[new Uint8Array(new Float32Array(positions).buffer),new Uint8Array(new (['TXF','TXQ'].includes(f.opcode)?Uint32Array:Float32Array)(coordinates).buffer),
    new Uint8Array(new Float32Array(dx).buffer),new Uint8Array(new Float32Array(dy).buffer)];
  return f;
}
export function localExtent(f,level){
  const l=f.firstLevel+level;
  return {width:Math.max(1,Math.floor(f.width/2**l)),height:Math.max(1,Math.floor(f.height/2**l)),
    layers:f.target==='3D'?Math.max(1,Math.floor(f.depth/2**l)):f.target==='CUBE'?6:f.lastLayer-f.firstLayer+1};
}
const directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],neighbors=[-2,-.49,.49,.51,1.49,1.51,3.49,3.51,4.49,8];
function coordinate(f,x,y){
  const local=['TXL','TXF','TXQ','TXD'].includes(f.opcode)?y:0,e=localExtent(f,local),layer=Math.min(e.layers-1,Math.floor(x*e.layers/f.grid.width));
  if(f.opcode==='TXQ')return [y,0,0,0];
  if(f.opcode==='TXF')return [x%e.width,y%e.height,f.layerProbe?Math.max(0,Math.min(e.layers-1,x)):layer,y];
  const lod=f.fixedLod??y;
  if(f.target==='CUBE')return [...directions[x%6],f.opcode==='TXL'?lod:.5];
  const z=f.target==='3D'?(layer+.5)/e.layers:f.layerProbe?neighbors[x%neighbors.length]:layer;
  if(f.opcode==='TXP')return [1.25,.75,z*2,2];
  return [f.wrap===2?.625:-.375,f.wrap===2?.375:1.375,z,f.opcode==='TXL'?lod:.5];
}
const wrap=(i,size,mode)=>mode===2?Math.max(0,Math.min(size-1,i)):mode===0?((i%size)+size)%size:((i%(size*2)+size*2)%(size*2)<size?((i%(size*2)+size*2)%(size*2)):size*2-1-((i%(size*2)+size*2)%(size*2)));
function sampled(f,x,y){
  let level=['TXL','TXF','TXQ','TXD'].includes(f.opcode)?f.fixedLod??y:f.biasProbe?f.lastLevel-f.firstLevel:0;
  if(f.opcode==='TXQ'){const e=localExtent(f,y);return [e.width,e.height,['CUBE','2D'].includes(f.target)?0:e.layers,f.lastLevel-f.firstLevel+1];}
  if(!['TXF','TXQ'].includes(f.opcode))level=Math.max(0,Math.min(f.lastLevel-f.firstLevel,Math.max(f.minLod,Math.min(f.maxLod,level))));
  let c=f.biasProbe?f.target==='CUBE'?directions[f.face??0]:[.5,.5,f.target==='3D'?.875:localExtent(f,0).layers-1]:coordinate(f,x,y);
  if(f.sourceExpression?.endsWith('wzyx'))c=c.toReversed();
  if(f.sourceExpression?.startsWith('|'))c=c.map(Math.abs);
  if(f.sourceExpression?.startsWith('-|'))c=c.map(v=>-Math.abs(v));
  if(f.opcode==='TXP')c=c.map((v,lane)=>lane<3?v/c[3]:v);
  const at=(local)=>{
    const e=localExtent(f,local);let layer,u=c[0],v=c[1],z=c[2];
    if(f.target==='CUBE'){
      const major=Math.max(...c.slice(0,3).map(Math.abs)),axis=c.slice(0,3).findIndex(v=>Math.abs(v)===major);layer=axis*2+Number(c[axis]<0);
      const [a,b]=axis===0?[c[0]>0?-c[2]:c[2],-c[1]]:axis===1?[c[0],c[1]>0?c[2]:-c[2]]:[c[2]>0?c[0]:-c[0],-c[1]];
      u=(a/major+1)/2;v=(b/major+1)/2;
    }else layer=f.opcode==='TXF'?z:f.target==='3D'?null:Math.max(0,Math.min(e.layers-1,Math.floor(z+.5)));
    const texel=(xx,yy,zz)=>{
      const originalLayer=zz+(f.target==='2D_ARRAY'?f.firstLayer:0),originalLevel=f.firstLevel+local;
      if(f.gpuOverride?.[originalLevel+':'+originalLayer])return f.gpuOverride[originalLevel+':'+originalLayer];
      const code=5*originalLevel+3*originalLayer+7*xx+11*yy;
      return [0,1,2,3].map(lane=>Math.floor(code/2**lane)%2);
    };
    if(f.opcode==='TXF')return texel(c[0],c[1],layer);
    const a=u*e.width-.5,b=v*e.height-.5,d=z*e.layers-.5;
    if(!f.linear)return texel(wrap(Math.floor(u*e.width),e.width,f.wrap),wrap(Math.floor(v*e.height),e.height,f.wrap),
      layer??wrap(Math.floor(z*e.layers),e.layers,f.wrap));
    const ix=Math.floor(a),iy=Math.floor(b),iz=Math.floor(d),fx=a-ix,fy=b-iy,fz=d-iz,out=[0,0,0,0];
    for(let k=0;k<(layer===null?2:1);k++)for(let j=0;j<2;j++)for(let i=0;i<2;i++){
      const t=texel(wrap(ix+i,e.width,f.target==='CUBE'?2:f.wrap),wrap(iy+j,e.height,f.target==='CUBE'?2:f.wrap),layer??wrap(iz+k,e.layers,f.wrap)),weight=(i?fx:1-fx)*(j?fy:1-fy)*(layer===null?(k?fz:1-fz):1);
      out.forEach((_,lane)=>out[lane]+=t[lane]*weight);
    }return out;
  };
  const first=f.linear?Math.floor(level):Math.floor(level+.5),fraction=f.linear?level-first:0,a=at(first),b=fraction?at(first+1):a;
  return a.map((v,lane)=>v*(1-fraction)+b[lane]*fraction);
}
export function expected(f){
  const words=new Uint32Array(f.grid.width*f.grid.height*4);
  for(let y=0;y<f.grid.height;y++)for(let x=0;x<f.grid.width;x++){
    const sampledWords=sampled(f,x,y),lanes=f.opcode==='TXQ'?sampledWords:f.swizzle.map(k=>word(k===4?0:k===5?1:sampledWords[k])),out=[0x12345678,0x80000001,0xdeadbeef,0xffffffff];
    for(let lane=0;lane<4;lane++)if(!f.mask||f.mask.includes('xyzw'[lane]))out[lane]=lanes[lane];words.set(out,(y*f.grid.width+x)*4);
  }return new Uint8Array(words.buffer);
}
export function view(f,{handle=51,resource=6,target=targetNumber(f.target),format=67,first=f.firstLevel,last=f.lastLevel,firstLayer=f.firstLayer,lastLayer=f.lastLayer,swizzle=f.swizzle,stage=f.stage,slot=f.slot,stateHandle=50}={}){
  return join(sampler(stateHandle,{s:f.wrap,t:f.wrap,r:f.wrap,min:Number(Boolean(f.linear)),mag:Number(Boolean(f.linear)),mip:f.linear?1:0,minLod:f.minLod,maxLod:f.maxLod}),
    packet(1,6,[handle,resource,format|target<<24,firstLayer|lastLayer<<16,first|last<<8,swizzle.reduce((n,k,i)=>n|k<<i*3,0)]),
    packet(10,0,[stage==='vertex'?0:1,slot,handle]),packet(18,0,[stage==='vertex'?0:1,slot,stateHandle]));
}
export function setup(f){
  return join(shader(10,0,f.vertexText),shader(11,1,f.fragmentText),packet(1,5,[12,...f.inputs.flatMap((_,i)=>[0,0,i,i===1&&['TXF','TXQ'].includes(f.opcode)?196:31])]),
    packet(2,5,[12]),packet(6,0,f.inputs.flatMap((_,i)=>[16,0,[3,4,5,7][i]])),surface(20,1,196,0),packet(5,0,[1,0,20]),
    packet(4,0,[0,...[f.grid.width/2,f.grid.height/2,.5,f.grid.width/2,f.grid.height/2,.5].map(word)]),packet(31,0,[10,0]),packet(31,0,[11,1]),
    packet(1,2,[40,2|1<<29,word(1),0,0xffff,word(1),0,0,0]),packet(2,2,[40]));
}
export const draw=f=>packet(8,0,[0,f.inputs[0].length/16,f.biasProbe?4:0,0,1,0,0,0,0,0,0xffffffff,0]);

// Fixed original literals: simultaneous stages at slot7, plus two independent
// ranges of one original allocation. Expected words never use generated GLSL.
export function sharingCases(){
  const text=(stage,target,coordinate)=>stage==='vertex'?
    `VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL SAMP[7]\nDCL SVIEW[7], ${target}, FLOAT\nIMM[0] FLT32 {${coordinate.join(',')}}\n0: MOV OUT[0], IN[0]\n1: TXL OUT[1], IMM[0], SAMP[7], ${target}\n2: END\n`:
    `FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\nDCL SAMP[7]\nDCL SVIEW[7], ${target}, FLOAT\nDCL TEMP[0]\nIMM[0] FLT32 {${coordinate.join(',')}}\n0: TXL TEMP[0], IMM[0], SAMP[7], ${target}\n1: XOR OUT[0], TEMP[0], IN[0]\n2: END\n`;
  const coordinate=target=>target==='CUBE'?[1,0,0,0]:[.625,.375,target==='3D'?.75:1,0];
  const literal=(f)=>{
    const e=localExtent(f,0),c=coordinate(f.target),x=f.target==='CUBE'?Math.floor(e.width/2):Math.floor(.625*e.width),y=f.target==='CUBE'?Math.floor(e.height/2):Math.floor(.375*e.height),
      layer=f.target==='CUBE'?0:f.target==='3D'?Math.floor(.75*e.layers):Math.max(0,Math.min(e.layers-1,c[2]))+f.firstLayer,
      code=5*f.firstLevel+3*layer+7*x+11*y;
    return [0,1,2,3].map(lane=>word(Math.floor(code/2**lane)%2));
  };
  const rows=[];
  for(const [vertexTarget,fragmentTarget,same]of [['3D','CUBE',false],['CUBE','2D_ARRAY',false],['2D_ARRAY','3D',false],['3D','3D',true],['CUBE','CUBE',true],['2D_ARRAY','2D_ARRAY',true]]){
    const f=fixture({name:`sharing/${vertexTarget}/${fragmentTarget}/${same?'same-allocation':'different-dimensions'}`,stage:'fragment',target:fragmentTarget,type:'FLOAT',opcode:'TXL',slot:7,firstLevel:1,lastLevel:2,
      ...(fragmentTarget==='2D_ARRAY'?{firstLayer:1,lastLayer:3}:{})});
    const v=fixture({stage:'vertex',target:vertexTarget,type:'FLOAT',opcode:'TXL',slot:7,firstLevel:same?0:1,lastLevel:same?0:2,
      ...(vertexTarget==='2D_ARRAY'?{firstLayer:0,lastLayer:1}:{})});
    if(!same)v.source.id=8;
    f.vertexText=text('vertex',vertexTarget,coordinate(vertexTarget));f.fragmentText=text('fragment',fragmentTarget,coordinate(fragmentTarget));
    f.extraTextures=same?[]:[v];f.extraViews=[{fixture:v,resource:same?6:8,handle:53,stateHandle:52}];
    f.expectedSamplers={fssamp7:{target:f.source.target,last:f.lastLevel-f.firstLevel},vssamp7:{target:v.source.target,last:v.lastLevel-v.firstLevel}};
    const a=literal(f),b=literal(v),words=a.map((w,i)=>(w^b[i])>>>0);
    f.literalOracle={fragment:a,vertex:b,xor:words};f.expectedPlane=new Uint8Array(new Uint32Array(Array(f.grid.width*f.grid.height).fill(words).flat()).buffer);
    rows.push(f);
  }return rows;
}

// Literal original TGSI and depth fields, independent of the compiler/emitter.
import {shadowText,passFragment} from '../virgl-shadow-shaders/fixtures.mjs';
import {zeroSelectors} from '../virgl-instance-base/fixtures.mjs';
export {zeroSelectors,selectorKeys} from '../virgl-instance-base/fixtures.mjs';
export const profile='virgl-webgl2-standard-dimensional-shadow-texture-gles3-v1';
export const targets=['CUBE','2D_ARRAY'];
export const maskValues=[1,2,.5,4], addValues=[-.5,.25,.125,-2];
const directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const neighbors=[-2,-.49,.49,.51,1.49,1.51,3.49,3.51,4.49,8];
const baseOpcode=f=>f.opcode.replace(/_SAT|_PRECISE/g,'');
export function legal(stage,target,opcode){return ['TEX','TXD','TXQ'].includes(opcode)||(opcode==='TXB2'&&stage==='fragment'&&target==='CUBE');}
function numbered(text,change){const at=text.indexOf('0:'),lines=text.slice(at).trim().split('\n').map(s=>s.replace(/^\d+: /,''));return text.slice(0,at)+change(lines).map((s,i)=>i+': '+s+'\n').join('');}
export function comparisonText(stage,f={}){
 const target=f.target??'CUBE',instructionTarget=f.ordinary?target:'SHADOW'+target,opcode=f.opcode??'TEX',slot=f.slot??0;
 let text=shadowText(stage,{opcode,slot,declaration:f.declaration??(f.explicit?'SHADOW'+target:target),type:f.type??'FLOAT',target:f.instructionTarget??instructionTarget,mask:f.mask??'',source:f.source??'IN[1]'});
 if(opcode.startsWith('TXB2'))text=text.replace(', SAMP['+slot+'],',', '+(f.biasSource??'IN[2]')+', SAMP['+slot+'],');
 if(opcode==='TXQ')text=text.replace('IMM[1], SAMP','IN[1], SAMP');
 if(f.biasProbe)text=text.replace('GENERIC[0], CONSTANT','GENERIC[0], PERSPECTIVE');
 if(f.query)text=numbered(text,lines=>{
   const sample=lines.findIndex(s=>s.startsWith(opcode+' ')),q='TXQ TEMP[1], IMM[1], SAMP['+slot+'], '+(f.queryShadow?'SHADOW'+target:target);
   lines.splice(sample+(f.query==='after'?1:0),0,q);
   lines.splice(lines.length-1,0,'MOV '+(stage==='vertex'?'OUT[1]':'OUT[0]')+'.yzw, TEMP[1]');return lines;
 });
 return text;
}
export function pairTexts(stage,f){
 if(stage==='vertex')return {vertexText:comparisonText(stage,f),fragmentText:passFragment};
 return {vertexText:'VERT\nDCL IN[0]\nDCL IN[1]\nDCL IN[2]\nDCL IN[3]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL OUT[2], GENERIC[1]\nDCL OUT[3], GENERIC[2]\n0: MOV OUT[0], IN[0]\n1: MOV OUT[1], IN[1]\n2: MOV OUT[2], IN[2]\n3: MOV OUT[3], IN[3]\n4: END\n',fragmentText:comparisonText(stage,f)};
}
export function signatureCases(){
 const cases=[];
 for(const stage of ['vertex','fragment'])for(const target of targets)for(const explicit of [false,true])for(const type of ['FLOAT','SINT','UINT'])for(const slot of [0,7,15])for(const opcode of ['TEX','TXD','TXQ','TXB','TXB2','TXL','TXF','TXP']){
   const declaration=explicit?'SHADOW'+target:target,dst=stage==='vertex'?'OUT[1]':'OUT[0]';
   const prefix=(stage==='vertex'?'VERT\nDCL IN[0]\nDCL IN[1]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n':'FRAG\nDCL IN[1], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\n')+'DCL SAMP['+slot+']\nDCL SVIEW['+slot+'], '+declaration+', '+type+'\nIMM[0] FLT32 {0.25, 0.5, 1.0, 0.0}\nIMM[1] FLT32 {0.5, 0.25, 0.0, 1.0}\n';
   const args=opcode==='TXD'?'IN[1], IMM[0], IMM[1]':opcode==='TXB2'?'IN[1], IMM[0]':'IN[1]',ops=(stage==='vertex'?['MOV OUT[0], IN[0]']:[]).concat(opcode+' '+dst+', '+args+', SAMP['+slot+'], SHADOW'+target,'END');
   const okay=type==='FLOAT'&&legal(stage,target,opcode);
   cases.push({name:['signature',stage,'SHADOW'+target,declaration,type,slot,opcode].join('/'),kind:stage==='vertex'?43:44,a:prefix+ops.map((s,i)=>i+': '+s+'\n').join(''),b:'',selectors:zeroSelectors(),okay,code:okay?null:'unsupported-feature'});
 }
 return cases;
}
export function comparisonFixtures(){
 const rows=[],add=f=>{
   const pair=pairTexts(f.stage,f),selectors={...zeroSelectors(),unsignedMask:baseOpcode(f)==='TXQ'?2:0,unsignedColorMask:1};
   rows.push({...f,name:[f.stage,f.target,f.opcode,f.slot,f.explicit?'shadow-view':'plain-view',f.label??''].join('/'),...pair,selectors});
 };
 for(const stage of ['vertex','fragment'])for(const target of targets)for(const opcode of ['TEX','TXD','TXQ',...(stage==='fragment'&&target==='CUBE'?['TXB2']:[])])for(const slot of [0,7,15])for(const explicit of [false,true])add({stage,target,opcode,slot,explicit,biasProbe:opcode==='TXB2',bias:2,face:0});
 for(const stage of ['vertex','fragment'])for(const target of targets){
   for(const baseLevel of [1,2])add({stage,target,opcode:'TEX',slot:7,baseLevel,label:'base-'+baseLevel});
   for(const mask of ['x','y','z','w','xz','yw'])add({stage,target,opcode:'TEX',slot:15,mask,label:'mask-'+mask});
   for(const source of ['IN[1].wzyx','|IN[1].xyzw|','-|IN[1].xyzw|'])add({stage,target,opcode:'TEX',slot:0,source,label:source});
   for(const opcode of ['TEX_SAT','TEX_PRECISE','TEX_SAT_PRECISE'])add({stage,target,opcode,slot:7,label:'qualifier'});
   for(const query of ['before','after'])for(const queryShadow of [false,true])add({stage,target,opcode:'TEX',slot:7,query,queryShadow,label:query+'-'+queryShadow});
   for(const query of ['before','after'])add({stage,target,opcode:'TEX',slot:15,ordinary:true,query,queryShadow:true,label:'ordinary-query-'+query});
 }
 for(const stage of ['vertex','fragment']){
   for(const scale of [2,8])add({stage,target:'CUBE',opcode:'TXD',slot:7,scale,label:'projected-'+scale});
   for(const derivativeZ of [-99,65536])add({stage,target:'2D_ARRAY',opcode:'TXD',slot:7,derivativeZ,label:'ignored-z-'+derivativeZ});
   add({stage,target:'2D_ARRAY',opcode:'TEX',slot:7,layerProbe:true,label:'round-clamp-layers'});
 }
 for(const bias of [0,2])for(let face=0;face<6;face++)add({stage:'fragment',target:'CUBE',opcode:'TXB2',slot:7,biasProbe:true,bias,face,label:'bias-'+bias+'-face-'+face});
 for(const mask of ['x','yw'])add({stage:'vertex',target:'2D_ARRAY',opcode:'TXQ',slot:15,mask,label:'query-mask-'+mask});
 return rows;
}
export function extent(target,level){const width=Math.max(1,4>>level);return {width,height:width,layers:target==='CUBE'?6:5};}
export function depth(level,layer,x,y,seed=0){return .0625+(level*128+layer*16+y*4+x+(seed&31))/1024;}
export function textureInputs(f){return [0,1,2].map(level=>{const e=extent(f.target,level),values=[];for(let z=0;z<e.layers;z++)for(let y=0;y<e.height;y++)for(let x=0;x<e.width;x++)values.push(depth(level,z,x,y,f.seed));return {level,...e,bytes:new Uint8Array(new Float32Array(values).buffer)};});}
export function grid(f){return {width:f.biasProbe?4:f.layerProbe?neighbors.length:6,height:f.biasProbe?4:3};}
function selected(f,x,y){
 const op=baseOpcode(f),level=op==='TXD'||op==='TXQ'?y:f.baseLevel??0,e=extent(f.target,level);
 const layer=f.target==='CUBE'?x:Math.min(4,Math.max(0,f.layerProbe?Math.floor(neighbors[x]+.5):Math.floor(x*5/grid(f).width)));
 return {level,...e,layer,tx:f.target==='CUBE'?Math.floor(e.width/2):Math.floor(.625*e.width),ty:f.target==='CUBE'?Math.floor(e.height/2):Math.floor(.375*e.height)};
}
function sourceCoordinates(f,x,y){
 const s=selected(f,x,y),reference=depth(s.level,s.layer,s.tx,s.ty,f.seed)+((x+y)%3-1)/8192;
 if(baseOpcode(f)==='TXQ')return [y,0,0,0];
 let c=f.target==='CUBE'?[...directions[x].map(v=>v*(f.scale??1)),reference]:[.625,.375,f.layerProbe?neighbors[x]:s.layer,reference];
 if(f.source?.endsWith('wzyx'))c=c.reverse();
 if(f.source?.startsWith('|'))c=c.map(v=>-Math.abs(v));
 return c;
}
function modified(f,c){if(f.source?.endsWith('wzyx'))c=c.toReversed();if(f.source?.startsWith('|'))c=c.map(Math.abs);if(f.source?.startsWith('-|'))c=c.map(v=>-Math.abs(v));return c;}
export function inputBytes(f){
 const g=grid(f),positions=[],coordinates=[],dx=[],dy=[];
 if(f.biasProbe){
   for(const [x,y]of [[0,0],[1,0],[0,1],[0,1],[1,0],[1,1]]){
     positions.push(2*x-1,2*y-1,0,1);const face=f.face??0,c=directions[face].map((v,axis)=>v||(axis===(face<2?2:0)?2*x-1:0));
     coordinates.push(...c,.25);dx.push(f.bias??2,0,0,0);dy.push(0,0,0,0);
   }
 }else for(let y=0;y<g.height;y++)for(let x=0;x<g.width;x++){
   positions.push(2*(x+.5)/g.width-1,2*(y+.5)/g.height-1,0,1);coordinates.push(...sourceCoordinates(f,x,y));
   if(f.target==='CUBE')dx.push(...(x<2?[0,0,(f.scale??1)*2**y/2]:[(f.scale??1)*2**y/2,0,0]),0);
   else dx.push(2**y/4,0,f.derivativeZ??99,0);
   dy.push(0,0,0,0);
 }
 const Constructor=baseOpcode(f)==='TXQ'?Uint32Array:Float32Array;
 return {...g,vertices:positions.length/4,positions:new Uint8Array(new Float32Array(positions).buffer),coordinates:new Uint8Array(new Constructor(coordinates).buffer),dx:new Uint8Array(new Float32Array(dx).buffer),dy:new Uint8Array(new Float32Array(dy).buffer)};
}
function floatWord(value){return new Uint32Array(new Float32Array([value]).buffer)[0];}
export function expectedWords(f,x,y){
 const op=baseOpcode(f);let sampled,level=op==='TXQ'||op==='TXD'?y:f.baseLevel??0;
 if(op==='TXQ'){const e=extent(f.target,level);sampled=[e.width,e.height,f.target==='CUBE'?0:e.layers,3-(f.baseLevel??0)];}
 else{
   let d,ref;
   if(f.biasProbe){level=f.bias===0?0:2;d=depth(level,f.face??0,0,0,f.seed);ref=.25;}
   else{
     const c=modified(f,sourceCoordinates(f,x,y)),e=extent(f.target,level);let layer,tx,ty;
     if(f.target==='CUBE'){
       const a=c.slice(0,3).map(Math.abs),axis=a.indexOf(Math.max(...a));layer=axis*2+Number(c[axis]<0);tx=Math.floor(e.width/2);ty=Math.floor(e.height/2);
     }else{layer=Math.min(4,Math.max(0,Math.floor(c[2]+.5)));tx=Math.min(e.width-1,Math.max(0,Math.floor(c[0]*e.width)));ty=Math.min(e.height-1,Math.max(0,Math.floor(c[1]*e.height)));}
     d=depth(level,layer,tx,ty,f.seed);ref=c[3];
   }
   sampled=f.ordinary?[d,0,0,1].map(floatWord):maskValues.map((mask,lane)=>{let value=Number(ref<=d)*mask+addValues[lane];if(f.opcode.includes('_SAT'))value=Math.max(0,Math.min(1,value));return floatWord(value);});
 }
 const output=[0x12345678,0x80000001,0xdeadbeef,0xffffffff];for(let lane=0;lane<4;lane++)if(!f.mask||f.mask.includes('xyzw'[lane]))output[lane]=sampled[lane];
 if(f.query){const e=extent(f.target,f.baseLevel??0);output[1]=e.height;output[2]=f.target==='CUBE'?0:e.layers;output[3]=3-(f.baseLevel??0);}
 return output;
}

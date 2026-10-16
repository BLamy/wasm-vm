// Original TGSI/layout specimens and independent expected capture words.
export const profile='virgl-webgl2-standard-stream-output-gles3-v1';
export const zeroSelectors=()=>({signedMask:0,unsignedMask:0,packedSignedMask:0,packedNormalizedMask:0,bufferZeroMask:0,signedColorMask:0,unsignedColorMask:0});
export const fragmentText='FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {0.0, 0.0, 0.0, 1.0}\n0: MOV OUT[0], IMM[0]\n1: END\n';
export const entry=(registerIndex,startComponent,numComponents,outputBuffer,destinationOffset,stream=0)=>[(registerIndex|(startComponent<<8)|(numComponents<<10)|(outputBuffer<<13)|(destinationOffset<<16))>>>0,stream>>>0];
export const layout=(strides,entries)=>entries.length?[entries.length,...strides,...entries.flat()]:[0];
export function text(register=1,mode='copy'){
 const outputs=register===0?'DCL OUT[0], POSITION\n':`DCL OUT[0], POSITION\nDCL OUT[${register}], GENERIC[0]\n`;
 const prefix='VERT\nDCL CONST[0..1]\nDCL TEMP[0]\n'+outputs;
 const rows=['MOV OUT[0], CONST[0]'];
 if(mode==='copy'&&register)rows.push(`MOV OUT[${register}], CONST[1]`);
 else if(mode==='partial')rows.push(`MOV OUT[${register}].xz, CONST[1].wzyx`);
 else if(mode==='alias')rows.push('MOV TEMP[0], CONST[1]','MOV TEMP[0].xy, TEMP[0].yxwz',`MOV OUT[${register}], TEMP[0]`);
 else if(mode==='conditional')rows.push('UIF CONST[1].xxxx',`MOV OUT[${register}].zw, CONST[1]`,'ENDIF');
 else if(mode==='unwritten'){}
 rows.push('END');return prefix+rows.map((s,i)=>i+': '+s+'\n').join('');
}
export function wideText(){
 const rows=['MOV OUT[0], CONST[0]'];
 for(let i=0;i<16;i++)rows.push(`MOV OUT[${i+1}], CONST[${i}]`);
 rows.push('END');return 'VERT\nDCL CONST[0..15]\nDCL OUT[0], POSITION\n'+Array.from({length:16},(_,i)=>`DCL OUT[${i+1}], GENERIC[${i}]\n`).join('')+rows.map((s,i)=>i+': '+s+'\n').join('');
}
export function components(words,buffer){
 const count=words[0],out=[];
 for(let i=0;i<count;i++){
  const value=words[5+i*2],outputBuffer=value>>>13&7;if(outputBuffer!==buffer)continue;
  const registerIndex=value&255,start=value>>>8&3,num=value>>>10&7;
  for(let lane=0;lane<num;lane++)out.push({registerIndex,component:start+lane,destinationOffset:(value>>>16)+lane});
 }
 return out;
}
export function outputWords(f,constants){
 const out=new Map([[0,constants[0].slice()]]),reg=f.register;
 if(f.kind==='wide'){for(let i=0;i<16;i++)out.set(i+1,constants[i].slice());out.set(0,constants[0].slice());return out;}
 if(reg!==0||f.mode!=='copy'){
  const value=reg===0?constants[0].slice():[0,0,0,0],source=constants[1];
  if(f.mode==='copy'||f.mode==='alias')for(let i=0;i<4;i++)value[i]=source[i];
  if(f.mode==='alias'){const old=value.slice();value[0]=old[1];value[1]=old[0];}
  if(f.mode==='partial'){value[0]=source[3];value[2]=source[1];}
  if(f.mode==='conditional'&&source[0]!==0){value[2]=source[2];value[3]=source[3];}
  out.set(reg,value);
 }
 return out;
}
export function captureFixtures(){
 const rows=[];
 for(const register of [0,1,31])for(let buffer=0;buffer<4;buffer++)for(let start=0;start<4;start++)for(let count=1;count<=4-start;count++){
  const strides=[0,0,0,0];strides[buffer]=8;
  rows.push({name:`components/${register}/${buffer}/${start}/${count}`,kind:'ordinary',register,mode:'copy',vertexText:text(register),fragmentText,words:layout(strides,[entry(register,start,count,buffer,2)]),buffer});
 }
 for(const register of [1,31])for(const mode of ['partial','alias','conditional','unwritten'])for(let buffer=0;buffer<4;buffer++){
  const strides=[0,0,0,0];strides[buffer]=65535;
  rows.push({name:`register/${register}/${mode}/${buffer}`,kind:'ordinary',register,mode,vertexText:text(register,mode),fragmentText,words:layout(strides,[entry(register,0,4,buffer,65531)]),buffer});
 }
 for(let buffer=0;buffer<4;buffer++){
  const strides=[0,0,0,0];strides[buffer]=64;
  rows.push({name:`floor64/${buffer}`,kind:'wide',vertexText:wideText(),fragmentText,words:layout(strides,Array.from({length:16},(_,i)=>entry(i+1,0,4,buffer,i*4))),buffer});
 }
 const all=layout([32,32,32,32],Array.from({length:128},(_,i)=>entry(1,i%4,1,Math.floor(i/32),i%32)));
 for(let buffer=0;buffer<4;buffer++)rows.push({name:`outputs128/${buffer}`,kind:'ordinary',register:1,mode:'copy',vertexText:text(1),fragmentText,words:all,buffer});
 return rows;
}

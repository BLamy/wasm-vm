// Original bytes and native draw fields. This oracle never reads emitted ESSL.
export const selectorKeys=['signedMask','unsignedMask','packedSignedMask','packedNormalizedMask','bufferZeroMask','signedColorMask','unsignedColorMask'];
export const zeroSelectors=()=>Object.fromEntries(selectorKeys.map(key=>[key,0]));
export const bases=[0,1,17,65535,0x80000000,0xffffffff];
export const fragmentText='FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';
export const constantWords=[0x12345678,0x80000000,0x7fc01234,0xffffffff];
export const imageWords=[17,0xffffffff,0x87654321,0x80000001];
export const dimensionalWords=[0xdeadbeef,0xabcdef01,0x90abcdef,0x7f800001];
export function vertexText(variant='both01',composition='none'){
 const decls=variant==='both10'?[[0,'INSTANCEID'],[1,'VERTEXID']]:variant==='instance1'?[[1,'INSTANCEID']]:variant==='vertex1'?[[1,'VERTEXID']]:variant==='absent'?[]:variant==='unused'?[[0,'INSTANCEID'],[1,'VERTEXID']]:[[0,'VERTEXID'],[1,'INSTANCEID']];
 const instance=decls.find(d=>d[1]==='INSTANCEID')?.[0],vertex=decls.find(d=>d[1]==='VERTEXID')?.[0],composed=composition!=='none';
 let prefix='VERT\nDCL IN[0]\nDCL IN[1]\n'+(composed?'DCL IN[2]\n':'')+decls.map(([i,s])=>`DCL SV[${i}], ${s}\n`).join('')+'DCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL TEMP[0]\n';
 if(composed)prefix+='DCL CONST[0]\nDCL CONST[5][2]\nDCL SAMP[3]\nDCL SVIEW[3], 2D, UINT\n';
 prefix+='IMM[0] UINT32 {3735928559,2147483649,305419896,4294967295}\n';
 if(composed)prefix+='IMM[1] INT32 {0,0,0,0}\n';
 const lines=['ADD OUT[0], IN[0], IN[1]','MOV OUT[1], IMM[0]'];
 if(variant!=='unused'){
  if(instance!==undefined)lines.push(`MOV OUT[1].x, ${variant==='negabs'?'-|':''}SV[${instance}].wzyx${variant==='negabs'?'|':''}`);
  if(vertex!==undefined)lines.push(`MOV OUT[1].y, SV[${vertex}].xxxx`);
 }
 if(composed)lines.push('TXF TEMP[0], IMM[1], SAMP[3], 2D','XOR TEMP[0], TEMP[0], CONST[0]','XOR TEMP[0], TEMP[0], CONST[5][2]','XOR TEMP[0], TEMP[0], IN[2]','MOV OUT[1].z, TEMP[0].xxxx');
 lines.push('END');return prefix+lines.map((line,i)=>`${i}: ${line}\n`).join('');
}
function attributeWord(vertex,composition){
 if(composition==='uint')return [0xffffffff,0x80000000,0x7fc01234,17][vertex%4];
 if(composition==='sint')return [-1,-2147483648,2147483647,-17][vertex%4]>>>0;
 const signed=[511,-512,-1,17][vertex%4],value=composition==='packed-normalized'?Math.fround(Math.max(-1,signed/511)):signed;
 return new Uint32Array(new Float32Array([value]).buffer)[0];
}
export function expectedWords(f,vertex,instance){
 const out=[0xdeadbeef,0x80000001,0x12345678,0xffffffff],hasInstance=!['vertex1','absent','unused'].includes(f.variant),hasVertex=!['instance1','absent','unused'].includes(f.variant);
 if(hasInstance){out[0]=(f.base+instance)>>>0;if(f.variant==='negabs')out[0]=((out[0]&0x7fffffff)^0x80000000)>>>0;}
 if(hasVertex)out[1]=vertex>>>0;
 if(f.composition!=='none')out[2]=(attributeWord(vertex,f.composition)^constantWords[0]^dimensionalWords[0]^imageWords[0])>>>0;
 return out;
}
export function inputBytes(f){
 const width=f.vertices.length,height=f.instances,count=Math.max(...f.vertices)+1,positions=new Float32Array(count*4),offsets=new Float32Array(height*4);
 for(const [x,v]of f.vertices.entries()){positions[v*4]=Math.fround(2*(x+.5)/width-1);positions[v*4+3]=1;}
 for(let i=0;i<height;i++)offsets[i*4+1]=Math.fround(2*(i+.5)/height-1);
 let attribute=null;
 if(f.composition==='uint'||f.composition==='sint'){
  const data=f.composition==='uint'?new Uint32Array(count*4):new Int32Array(count*4);
  for(let v=0;v<count;v++)for(let c=0;c<4;c++)data[v*4+c]=attributeWord(v,f.composition);attribute=new Uint8Array(data.buffer);
 }else if(f.composition!=='none'){
  const data=new Uint32Array(count);for(let v=0;v<count;v++)data[v]=([511,512,1023,17][v%4]|(1023<<10)|(512<<20)|(3<<30))>>>0;attribute=new Uint8Array(data.buffer);
 }
 let indices=null;
 if(f.indexBits){const data=new globalThis['Uint'+f.indexBits+'Array'](f.vertices.length+f.indexPrefix);data.set(f.vertices,f.indexPrefix);indices=new Uint8Array(data.buffer);}
 return {width,height,count,positions:new Uint8Array(positions.buffer),offsets:new Uint8Array(offsets.buffer),attribute,indices};
}
export function instanceFixtures(){
 const fixtures=[];
 const add=(name,fields={})=>{
  const f={name,variant:'both01',composition:'none',base:0,instances:3,ordinary:false,indexBits:0,indexPrefix:0,vertices:[5,6,7,8],...fields},selectors=zeroSelectors();
  if(f.composition==='uint')selectors.unsignedMask=4;
  if(f.composition==='sint')selectors.signedMask=4;
  if(f.composition.startsWith('packed')){selectors.packedSignedMask=4;if(f.composition==='packed-normalized')selectors.packedNormalizedMask=4;}
  if(f.bufferZero)selectors.bufferZeroMask=1;
  selectors[f.signedOutput?'signedColorMask':'unsignedColorMask']=1;
  fixtures.push({...f,selectors,vertexText:vertexText(f.variant,f.composition),fragmentText});
 };
 for(const base of bases)for(const indexBits of [0,8,16,32])add(`raw/base${base}/index${indexBits}`,{base,indexBits,indexPrefix:indexBits?3:0,vertices:indexBits===8?[23,3,201,11]:indexBits===16?[701,3,1003,17]:indexBits===32?[4099,17,2051,7]:[5,6,7,8]});
 for(const variant of ['both10','instance1','vertex1','absent','unused','negabs'])for(const base of [0,0xffffffff])add(`${variant}/base${base}`,{variant,base,indexBits:16,indexPrefix:1,vertices:[13,1,97,5]});
 for(const indexBits of [0,8,16,32])for(const ordinary of [true,false])add(`single/index${indexBits}/ordinary${ordinary}`,{indexBits,indexPrefix:indexBits?2:0,vertices:indexBits?[19,3,29,11]:[7,8,9,10],base:17,instances:1,ordinary});
 for(const composition of ['uint','sint','packed','packed-normalized'])for(const bufferZero of [false,true])for(const signedOutput of [false,true])add(`composed/${composition}/buffer${bufferZero}/signed${signedOutput}`,{composition,bufferZero,signedOutput,base:0xffffffff,variant:'both10',indexBits:32,indexPrefix:3,vertices:[15,4,21,10]});
 return fixtures;
}

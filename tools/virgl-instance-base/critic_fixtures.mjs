export const selectorKeys=['signedMask','unsignedMask','packedSignedMask','packedNormalizedMask','bufferZeroMask','signedColorMask','unsignedColorMask'];
export const immediate=[0x11223344,0xa953612b,0x9f870ffd,0xffffffff];
export const xorWord=0x5a971c83;
export const fragmentText='FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';
export function originalVertex(variant){
 const declarations=variant==='absent'?'':'DCL SV[0], INSTANCEID\nDCL SV[1], VERTEXID\n';
 const operations=['ADD OUT[0], IN[0], IN[1]','MOV OUT[1], IMM[0]'];
 if(variant==='used')operations.push('MOV OUT[1].xz, -SV[0].wzyx','MOV OUT[1].y, |SV[1].yxxx|','XOR OUT[1].w, SV[0].xxxx, IMM[1].xxxx');
 operations.push('END');
 return 'VERT\nDCL IN[0]\nDCL IN[1]\n'+declarations+'DCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nIMM[0] UINT32 {'+immediate.join(',')+'}\nIMM[1] UINT32 {'+[xorWord,xorWord,xorWord,xorWord].join(',')+'}\n'+operations.map((line,i)=>i+': '+line+'\n').join('');
}
export function fixtures(initial){
 let seed=initial>>>0;const next=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
 const selectors=Object.fromEntries(selectorKeys.map(k=>[k,k==='unsignedColorMask'?1:0]));
 const specs=[{indexBits:8,base:0xffffffff},{indexBits:16,base:0x7fffffff},{indexBits:32,base:0x80000001},{indexBits:0,base:65535,ordinary:true,instances:1},{indexBits:16,base:17,variant:'unused'},{indexBits:32,base:0xffffffff,variant:'absent'}];
 const result=specs.map((spec,i)=>{
  const f={name:'critic/'+i+'/seed'+initial,variant:'used',instances:4,ordinary:false,indexPrefix:2,...spec,selectors:{...selectors}};
  const limit=f.indexBits===8?233:f.indexBits===16?1157:6151;
  if(!f.indexBits){const first=next()%37+3;f.vertices=[first,first+1,first+2];}
  else{const set=new Set();while(set.size<3)set.add(next()%limit+1);f.vertices=[...set];}
  f.vertexText=originalVertex(f.variant);f.fragmentText=fragmentText;f.pollDelay=(next()>>>16)%3;
  return f;
 });
 for(let i=result.length-1;i>0;i--){const j=next()%(i+1);[result[i],result[j]]=[result[j],result[i]];}
 return result;
}
export function predicted(f,vertex,instance){
 if(f.variant!=='used')return [...immediate];
 const id=(f.base+instance)>>>0;
 return [(id^0x80000000)>>>0,vertex&0x7fffffff,(id^0x80000000)>>>0,(id^xorWord)>>>0];
}

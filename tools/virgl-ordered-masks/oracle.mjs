// Literal TGSI predictions; no compiler IR, GLSL or GPU result is consulted.
import {interpret,vectors,bank as wordBank} from '../virgl-precise-word/oracle.mjs';
const require=(ok,message)=>{if(!ok)throw new Error(message);};
export const MASKS=['x','y','z','w','xy','xz','xw','yz','yw','zw','xyz','xyw','xzw','yzw','xyzw'];
export function kernelVectors(kernel,seed=0x6a57be21){
 if(kernel.kind==='lighting')return[{name:'negative-unit-normal',texcoordWord:0x3ec00017}];
 if(kernel.variant.startsWith('numeric'))return[{name:'exact-dyadic-inputs',a:[0,0,0,0],b:[0,0,0,0]}];
 const all=vectors(seed);return[all[0],all[1],all[4],all[10]];
}
export function bank(kernel,vector){
 if(kernel.kind!=='lighting')return wordBank(kernel,vector);
 const words=Array(32).fill(0);
 for(let i=0;i<4;i++)words[i*4+i]=0x3f800000;
 for(let i=0;i<3;i++)words[16+i*4+i]=0x3f800000;
 if(kernel.variant==='d4f702f7')words[31]=0x3f800000;
 return words;
}
export function expected(kernel,vector,fixture){
 if(kernel.kind==='lighting'){
  // Both literal matrices are identities. Normal=(-1,0,0). glmark's
  // normal dot is negative; kmscube's light x=(2-position.x)>0 on [-1,1].
  // Each MAX_PRECISE selects the original +0 word. No exact RSQ/DP3 claim.
  return{words:[0,vector.texcoordWord,0,vector.texcoordWord],lighting:{normal:[-1,0,0],clipXBounds:[-1,1],strictNegativeDot:true,selectedZeroWord:0,texcoordWord:vector.texcoordWord}};
 }
 const entry=fixture.cases.find(e=>e.name===kernel.case);require(entry,'literal mask shader');
 const inputs={0:[0,0,0,0x3f800000],1:[0x30400000,0x30400000,0,0x3f800000],2:[0x3e800000,0x3f400000,0,0x3f800000],3:[0x3f000017,0x3e000000,0,0x3f800000]};
 if(kernel.stage==='fragment')for(const m of entry.text.matchAll(/DCL IN\[(\d+)\], GENERIC\[(\d+)\]/g))inputs[Number(m[1])]=[inputs[1],inputs[2],inputs[3]][Number(m[2])];
 const state=interpret(entry.text,inputs,bank(kernel,vector));let words=state.registers.get('TEMP[117]');
 require(words?.length===4&&words.every(Number.isInteger),'complete initialized observed word');
 if(kernel.variant==='output')words=[... 'xyzw'].map((c,i)=>kernel.mask.includes(c)?words[3-i]:i%2?0xffffffff:0);
 return{words,branches:state.branches,loops:state.loops,addresses:state.addresses,accesses:state.accesses};
}
export function proof(seed=0x6a57be21){
 const input=[0x12345678,0x87654321,0x80000000,0x7fc01234],mapped=[input[0],input[2],input[1],input[3]],checks=[];
 for(const mask of MASKS){const wanted=input.slice();for(const c of mask)wanted['xyzw'.indexOf(c)]=mapped['xyzw'.indexOf(c)];
  const state=interpret('VERT\nDCL TEMP[0]\nIMM[0] UINT32 {'+input.join(',')+'}\nMOV TEMP[0], IMM[0]\nMOV_PRECISE TEMP[0].'+mask+', TEMP[0].xzyw\nEND\n',{},[]);
  const actual=state.registers.get('TEMP[0]');require(JSON.stringify(actual)===JSON.stringify(wanted),'literal global-lane alias snapshot '+mask);checks.push({mask,input,wanted});
 }
 return{schema:'ordered-mask-independent-proof-v1',seed:seed>>>0,checks,numericDomain:'Exact dyadic values; no exceptional float arithmetic claim',lightingDomain:'Strictly negative finite lighting selects an unchanged +0 word'};
}

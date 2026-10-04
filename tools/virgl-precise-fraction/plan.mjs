// Complete source/vector schedule declared before physical observations.
import {SEEDS,physicalVectors,carrier,bitplane,bankVariants,normalOrZero,selectedWords} from './cases.mjs';
export const primarySafe=(op,v,variant='direct')=>v.a.every(normalOrZero)&&v.b.every(normalOrZero)&&selectedWords(op,v,variant).every(normalOrZero);
export function faultWitness(item,fault){
 if(item.op!=='FRC_PRECISE'||item.backend!=='owned'||item.variant!=='direct'||item.bank||item.inputSource||item.modifier)return false;
 const words=item.vectors.flatMap(v=>v.input.a);
 return fault==='negative'?words.some(w=>(w&0x80000000)&&((w&0x7fffffff)>0)&&((w>>>23)&255)<150):
  fault==='rounding'?words.includes(0xb3000000):words.some(w=>((w>>>23)&255)===255);
}
export function physicalPlan(seed,primary){
 const vertices=[],fragments=[],byText=new Set(primary.map(p=>p.text));
 const add=(op,inputs,variant='direct',bank=false,backend='owned',modifier='',inputSource=false,textInput=inputs[0])=>{
  if(!inputs.length)return;const text=carrier(op,textInput,variant,bank,modifier,inputSource);
  if(backend==='mesa'&&!byText.has(text))return;
  vertices.push({op,variant,bank,backend,modifier,inputSource,textInput,text,
   vectors:inputs.flatMap(input=>(variant==='join'?[0,0xffffffff]:[0]).flatMap(condition=>[0,1].map(position=>({input,condition,position}))))});
 };
 for(const op of ['FRC','FRC_PRECISE']){
  const inputs=physicalVectors(op,seed);
  for(const input of inputs){add(op,[input]);if(primarySafe(op,input))add(op,[input],'direct',false,'mesa');}
  for(const variant of bankVariants(op)){
   add(op,inputs,variant,true);
   if(variant!=='join')add(op,inputs.filter(v=>primarySafe(op,v,variant)),variant,true,'mesa','',false,inputs[0]);
  }
  for(const variant of ['alias','masked','swizzled','join'])add(op,[inputs[0]],variant);
  for(const input of inputs.filter((_,i)=>i%12===0))for(let plane=0;plane<32;plane++){
   const text=bitplane(op,input,plane),item={op,input,plane,text};fragments.push({...item,backend:'owned'});
   if(byText.has(text)&&primarySafe(op,input))fragments.push({...item,backend:'mesa'});
  }
 }
 const input={name:'physical-input',a:[0x3fc00000,0xbfc00000,0,0x80000000],b:[0,0,0,0]};
 for(const op of ['FRC','FRC_PRECISE']){
  add(op,[input],'direct',false,'owned','',true);add(op,[input],'direct',false,'mesa','',true);
  for(const bank of [false,true])add(op,[input],'direct',bank,'owned','neg');
  if(op==='FRC_PRECISE'){
   const special={name:'private-bank-exceptional',a:[1,0x80000001,0x7fc12345,0xff800001],b:[0x80000001,1,0x7f800001,0xffc54321]};
   for(const variant of ['direct','swizzled','alias','join'])add(op,[special],variant,true);
  }
 }
 let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
 const positions=Array.from({length:2},()=>[(next()%191-95)/128,(next()%191-95)/128,.125,1]);
 return{seed,vertices,fragments,positions};
}
if(typeof process!=='undefined'&&process.argv[1]?.endsWith('/plan.mjs')){
 const fs=await import('node:fs');const primary=JSON.parse(fs.readFileSync(process.argv[2]));console.log(JSON.stringify(SEEDS.map(seed=>physicalPlan(seed,primary))));
}

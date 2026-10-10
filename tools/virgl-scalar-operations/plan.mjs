// Complete source/vector schedule declared before any GPU observation.
import {SEEDS,physicalVectors,carrier,bitplane,bankVariants,normalOrZero} from './cases.mjs';
export function physicalPlan(seed,primary){
  const vertices=[],fragments=[],byName=new Map(primary.map(p=>[p.name,p]));
  const add=(op,inputs,variant='direct',bank=false,backend='owned',modifier='',inputSource=false,textInput=inputs[0])=>
    vertices.push({op,variant,bank,backend,modifier,inputSource,text:carrier(op,textInput,variant,bank,modifier,inputSource),
      vectors:inputs.flatMap(input=>(variant==='join'?[0,0xffffffff]:[0]).flatMap(condition=>[0,1].map(position=>({input,condition,position}))))});
  for(const op of ['TRUNC','SSG']){
    const inputs=physicalVectors(op,seed);
    for(const input of inputs){add(op,[input]);if(byName.has(op+'-'+input.name)&&input.a.every(normalOrZero))add(op,[input],'direct',false,'mesa');}
    for(const variant of bankVariants(op)){
      add(op,inputs,variant,true);
      if(variant!=='join')add(op,inputs.filter(v=>v.a.every(normalOrZero)&&v.b.every(normalOrZero)),variant,true,'mesa','',false,inputs[0]);
    }
    for(const variant of ['alias','masked','swizzled','join'])add(op,[inputs[0]],variant);
    for(const input of inputs.filter((_,i)=>i%8===0))for(let plane=0;plane<32;plane++){
      const item={op,input,plane,text:bitplane(op,input,plane)};fragments.push({...item,backend:'owned'});
      if(byName.has(`${op}-${input.name}-plane-${plane}`)&&input.a.every(normalOrZero))fragments.push({...item,backend:'mesa'});
    }
  }
  const input={name:'physical-input',a:[0x3fc00000,0xbfc00000,0,0x80000000],b:[0,0,0,0]};
  for(const op of ['TRUNC','SSG']){
    add(op,[input],'direct',false,'owned','',true);add(op,[input],'direct',false,'mesa','',true);
    add(op,[input],'direct',false,'owned','neg');add(op,[input],'direct',true,'owned','neg');
    const subnormal={name:'finite-bank-subnormal',a:[1,0x80000001,0x7fffff,0x807fffff],b:[0x80000001,1,0,0x80000000]};
    for(const variant of ['direct','swizzled','alias','join'])add(op,[subnormal],variant,true);
  }
  let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
  const positions=Array.from({length:2},()=>[(next()%191-95)/128,(next()%191-95)/128,.125,1]);
  return {seed,vertices,fragments,positions};
}
if(process.argv[1]?.endsWith('/plan.mjs')){
  const fs=await import('node:fs');const primary=JSON.parse(fs.readFileSync(process.argv[2]));
  console.log(JSON.stringify(SEEDS.map(seed=>physicalPlan(seed,primary))));
}

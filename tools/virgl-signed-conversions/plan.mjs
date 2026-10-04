// Declare the full physical evidence set before reading any GPU result.
import {SEEDS,vectors,selectedWords,normalOrZero,carrier,bitplane,bankVariants} from './cases.mjs';
export function physicalPlan(seed,primary){
  const vertices=[],fragments=[],byName=new Map(primary.map(p=>[p.name,p]));
  const add=(op,inputs,variant='direct',bank=false,backend='owned',modifier='',inputSource=false,textInput=inputs[0])=>
    vertices.push({op,variant,bank,backend,modifier,inputSource,text:carrier(op,textInput,variant,bank,modifier,inputSource),
      vectors:inputs.flatMap(input=>(variant==='join'?[0,0xffffffff]:[0]).flatMap(condition=>[0,1].map(position=>({input,condition,position}))))});
  for(const op of ['I2F','F2I']){
    const inputs=vectors(op,seed);
    for(const input of inputs){add(op,[input]);if(byName.has(op+'-'+input.name)&&selectedWords(op,input).every(normalOrZero))add(op,[input],'direct',false,'mesa');}
    for(const variant of bankVariants(op)){
      add(op,inputs,variant,true);
      if(variant!=='join'){
        const admitted=inputs.filter(v=>selectedWords(op,v,variant).every(normalOrZero)&&
          (!['alias','masked'].includes(variant)||v.a.every(normalOrZero)));
        if(admitted.length)add(op,admitted,variant,true,'mesa','',false,inputs[0]);
      }
    }
    for(const variant of ['alias','masked','swizzled','join'])add(op,[inputs[0]],variant);
    for(const input of inputs.filter((_,i)=>i%8===0))for(let plane=0;plane<32;plane++){
      const item={op,input,plane,text:bitplane(op,input,plane)};
      fragments.push({...item,backend:'owned'});
      if(byName.has(`${op}-${input.name}-plane-${plane}`)&&selectedWords(op,input).every(normalOrZero))fragments.push({...item,backend:'mesa'});
    }
  }
  const input={name:'physical-input',a:[0x3f000000,0xbf000000,0,0x80000000],b:[0,0,0,0]};
  add('I2F',[input],'direct',false,'owned','',true);add('I2F',[input],'direct',false,'mesa','',true);
  for(const [modifier,a]of [['neg',[0x3fc00000,0xbfc00000,0,0x80000000]],['abs',[0x3fc00000,0xbfc00000,1,0x80000001]],['negabs',[0xcf000000,0x4f000000,0x3fc00000,0]]])
    add('F2I',[{name:'modifier-'+modifier,a,b:a}],'direct',false,'owned',modifier);
  let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
  const positions=Array.from({length:2},()=>[(next()%191-95)/128,(next()%191-95)/128,.125,1]);
  return {seed,vertices,fragments,positions};
}
if(process.argv[1]?.endsWith('/plan.mjs')){
  const fs=await import('node:fs');const primary=JSON.parse(fs.readFileSync(process.argv[2]));
  console.log(JSON.stringify(SEEDS.map(seed=>physicalPlan(seed,primary))));
}

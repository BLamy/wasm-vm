// Whole physical schedule is declared from source inputs before observations.
import {OPS,SEEDS,vectors,carrier,bitplane,VARIANTS} from './cases.mjs';
import {CAPTURES,captureInput,captureText} from './captures.mjs';
export function faultWitness(item,fault){
 return item.backend==='owned'&&item.op.endsWith('_SAT')&&!item.bank&&!item.modifier&&!item.inputSource&&item.variant==='direct'&&
  (fault==='order'?item.op==='DIV_SAT'&&item.textInput.name==='post-order':item.op==='MOV_SAT'&&item.textInput.name==='clamp-plateaus');
}
export function physicalPlan(seed,primary){
 const vertices=[],fragments=[],byText=new Set(primary.map(p=>p.text));
 const add=(op,inputs,variant='direct',bank=false,backend='owned',modifier='',inputSource=false,textInput=inputs[0])=>{
  if(!inputs.length)return;const text=carrier(op,textInput,variant,bank,modifier,inputSource);if(backend==='mesa'&&!byText.has(text))return;
  vertices.push({op,variant,bank,backend,modifier,inputSource,textInput,text,
   vectors:inputs.flatMap(input=>(variant==='join'?[0,0xffffffff]:[0]).flatMap(condition=>[0,1].map(position=>({input,condition,position}))))});
 };
 for(const op of OPS){const inputs=vectors(op,seed),bankInputs=inputs.filter(v=>v.d.every(w=>w===0x3f800000));
  for(const input of inputs){add(op,[input]);add(op,[input],'direct',false,'mesa');}
  for(const variant of VARIANTS){add(op,bankInputs,variant,true);if(variant!=='join')add(op,bankInputs,variant,true,'mesa','',false,bankInputs[0]);}
  for(const variant of ['alias','masked','swizzled','join'])add(op,[inputs[0]],variant);
  for(const input of inputs.filter(v=>!v.name.startsWith('random-')))for(let plane=0;plane<32;plane++){
   const text=bitplane(op,input,plane),item={op,input,plane,text};fragments.push({...item,backend:'owned'});if(byText.has(text))fragments.push({...item,backend:'mesa'});
  }
  add(op,[inputs[0]],'direct',false,'owned','',true);add(op,[inputs[0]],'direct',false,'mesa','',true);
  if(op!=='MOV')for(const bank of [false,true]){add(op,[inputs[0]],'direct',bank,'owned','neg');add(op,[inputs[0]],'direct',bank,'mesa','neg');}
 }
 for(const capture of CAPTURES)for(const backend of ['owned','mesa']){const text=captureText(capture);if(backend==='mesa'&&!byText.has(text))continue;
  vertices.push({op:capture.op,variant:capture.variant,bank:false,backend,modifier:'',inputSource:false,textInput:captureInput,text,textOverride:text,capture,
   vectors:[0,1].map(position=>({input:captureInput,condition:0,position}))});
 }
 let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
 return{seed,vertices,fragments,positions:Array.from({length:2},()=>[(next()%191-95)/128,(next()%191-95)/128,.125,1])};
}
if(typeof process!=='undefined'&&process.argv[1]?.endsWith('/plan.mjs')){const fs=await import('node:fs');console.log(JSON.stringify(SEEDS.map(seed=>physicalPlan(seed,JSON.parse(fs.readFileSync(process.argv[2]))))));}

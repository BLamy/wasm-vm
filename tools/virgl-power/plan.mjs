// Declare every physical equation, stage, mask, source version and seed first.
import {SEEDS,vectors,carrier,bytesFragment,VARIANTS,selected} from './cases.mjs';
import {CAPTURES,captureInput,captureText} from './captures.mjs';
export function physicalPlan(seed,primary){
 const vertices=[],fragments=[],texts=new Set(primary.map(c=>c.text));
 const vertex=(input,variant='direct',modifier='',text=carrier('POW',input,variant,modifier),capture=null)=>{
  for(const backend of ['owned','mesa']){if(backend==='mesa'&&!texts.has(text))continue;
   vertices.push({op:'POW',input,variant,modifier,text,backend,capture,vectors:(variant.startsWith('join')?[0,0xffffffff]:[0]).flatMap(condition=>[0,1].map(position=>({condition,position,selected:selected('POW',input,variant,condition,modifier,backend)})))});}
 };
 const fragment=(input,lane=0,variant='direct',modifier='')=>{const text=bytesFragment('POW',input,lane,variant,modifier);
  for(const backend of ['owned','mesa']){if(backend==='mesa'&&!texts.has(text))continue;fragments.push({op:'POW',input,lane,variant,modifier,text,backend,selected:selected('POW',input,variant,0,modifier,backend)[lane]});}
 };
 for(const input of vectors('POW',seed)){vertex(input);vertex(input,'swizzle-xxxx-xxxx');for(let lane=0;lane<4;lane++){fragment(input,lane);fragment(input,lane,'swizzle-xxxx-xxxx');}}
 vertex({name:'partial-joined',a:Array(4).fill(0x3f800000),b:Array(4).fill(0x3fc00000),e:Array(4).fill(0x3f800000),f:Array(4).fill(0x3fc00000)},'join-source');
 const input=vectors()[0];for(const variant of VARIANTS){vertex(input,variant);if(variant!=='join')for(let lane=0;lane<4;lane++)fragment(input,lane,variant);}
 for(const modifier of ['neg-base','neg-exponent','neg-both']){const signed={...input,a:input.a.map(w=>modifier==='neg-exponent'?w:(w^0x80000000)>>>0),e:input.e.map(w=>modifier==='neg-base'?w:(w^0x80000000)>>>0)};
  for(const variant of ['direct','alias','alias-exponent','mask-10-xyzw-wzyx'])vertex(signed,variant,modifier);}
 for(const capture of CAPTURES)vertex(captureInput(capture),capture.variant,'',captureText(capture),capture);
 let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
 return {seed,positions:Array.from({length:2},()=>[(next()%191-95)/128,(next()%191-95)/128,.125,1]),vertices,fragments};
}
export function faultWitness(item){return item.backend==='owned'&&item.variant==='direct'&&item.modifier===''&&item.input.name==='boundary-0';}
if(typeof process!=='undefined'&&process.argv[1]?.endsWith('/plan.mjs')){const fs=await import('node:fs');console.log(JSON.stringify(SEEDS.map(s=>physicalPlan(s,JSON.parse(fs.readFileSync(process.argv[2]))))));}

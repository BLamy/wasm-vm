// Entire execution schedule is declared before any physical observation.
import {OPS,SEEDS,vectors,carrier,bytesFragment,VARIANTS,selected} from './cases.mjs';
import {CAPTURES,captureInput,captureText} from './captures.mjs';
export function physicalPlan(seed,primary){
 const vertices=[],fragments=[],texts=new Set(primary.map(c=>c.text));
 const vertex=(op,input,variant='direct',modifier='',text=carrier(op,input,variant,modifier),capture=null)=>{
  for(const backend of ['owned','mesa']){if(backend==='mesa'&&!texts.has(text))continue;
   vertices.push({op,input,variant,modifier,text,backend,capture,vectors:(variant.startsWith('join')?[0,0xffffffff]:[0]).flatMap(condition=>[0,1].map(position=>({condition,position,selected:selected(op,input,variant,condition,modifier,backend)})))});}
 };
 const fragment=(op,input,lane=0,variant='direct',modifier='')=>{const text=bytesFragment(op,input,lane,variant,modifier);
  for(const backend of ['owned','mesa']){if(backend==='mesa'&&!texts.has(text))continue;fragments.push({op,input,lane,variant,modifier,text,backend,selected:selected(op,input,variant,0,modifier,backend)[lane]});}
 };
 for(const op of OPS){
  for(const input of vectors(op,seed)){vertex(op,input);vertex(op,input,'swizzle-xxxx');for(let lane=0;lane<4;lane++){fragment(op,input,lane);fragment(op,input,lane,'swizzle-xxxx');}}
  vertex(op,{name:'partial-joined',a:Array(4).fill(0x3f800000),b:Array(4).fill(0x3fc00000)},'join-source');
  const input=vectors(op)[13];for(const variant of VARIANTS){vertex(op,input,variant);if(variant!=='join')for(let lane=0;lane<4;lane++)fragment(op,input,lane,variant);}
  const neg=op==='EX2'?vectors(op)[7]:{name:'negative-log-input',a:[0xc0400000,0xbf000000,0xbf800000,0xc0000000],b:[0xc0000000,0xc0800000,0xc1000000,0xc1800000]};
  for(const variant of ['direct','alias','mask-10','join'])vertex(op,neg,variant,'neg');
 }
 for(const capture of CAPTURES)vertex(capture.op,captureInput(capture.op),capture.variant,'',captureText(capture),capture);
 let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
 return {seed,positions:Array.from({length:2},()=>[(next()%191-95)/128,(next()%191-95)/128,.125,1]),vertices,fragments};
}
export function faultWitness(item,fault){return item.backend==='owned'&&item.variant==='direct'&&item.modifier===''&&item.input.name==='boundary-13'&&item.op===(fault==='lg2'?'LG2':'EX2');}
if(typeof process!=='undefined'&&process.argv[1]?.endsWith('/plan.mjs')){const fs=await import('node:fs');console.log(JSON.stringify(SEEDS.map(s=>physicalPlan(s,JSON.parse(fs.readFileSync(process.argv[2]))))));}

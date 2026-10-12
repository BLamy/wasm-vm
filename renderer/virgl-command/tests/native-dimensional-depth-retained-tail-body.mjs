import {checker} from './submit-acceptance.mjs';
import {runRetainedTail} from './native-dimensional-depth-retained-tail.mjs';
const hex=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join('');
const copy=v=>JSON.parse(JSON.stringify(v));
export async function run({seed=362436069,fault=false}={}){
 const c=checker(),native=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true});c.truth(native,'critic actual depth GPU');
 const calls=[],live=new Set(),objects=new WeakMap(),faults=[];let next=1,budgets=()=>null,armed=false;
 const describe=v=>{if(v===null||typeof v!=='object')return v===undefined?{undefined:true}:v;if(ArrayBuffer.isView(v))return{type:v.constructor.name,bytes:hex(new Uint8Array(v.buffer,v.byteOffset,v.byteLength))};if(!objects.has(v))objects.set(v,next++);return{object:objects.get(v),type:v.constructor?.name??'object'};};
 const gl=new Proxy(native,{get(target,name){const method=Reflect.get(target,name,target);if(typeof method!=='function')return method;return(...args)=>{
  const before=args.map(describe),budget=copy(budgets()),delivered=args.slice();
  if(fault&&armed&&name==='framebufferTextureLayer'&&args[0]===native.READ_FRAMEBUFFER&&args[3]===2&&args[4]===6){delivered[4]=5;faults.push({sequence:calls.length,name,before,delivered:delivered.map(describe)});}
  const result=method.apply(target,delivered);if((/^create/.test(name)||name==='fenceSync')&&result)live.add(result);if(/^delete/.test(name)&&args[0])live.delete(args[0]);calls.push({sequence:calls.length,name,before,delivered:delivered.map(describe),budget,after:args.map(describe),result:describe(result)});return result;
 };}});
 const rows=[];window.__privateDepthReport={rows,calls,faults};window.__privateDepthActive=()=>({calls,live:live.size,faults});
 try{const result=await runRetainedTail({gl,c,seed,recording:{setBudgets(fn){budgets=fn;},addRow(row){rows.push(row);},calls(){return calls.length;},armTail(){armed=true;}}});c.equal(live.size,0,'critic all native owners retire');c.equal(native.getError(),native.NO_ERROR,'critic final GL error');return{status:'passed',result,nativeCalls:calls,faults,summary:{status:'passed',cases:result.rows.length,assertions:c.assertions,nativeCalls:calls.length,liveObjects:live.size}};}
 catch(error){error.privatePoint={calls,live:live.size,faults};throw error;}
}

import {checker} from '../../renderer/virgl-command/tests/submit-acceptance.mjs';
import {runPrivate} from './private.mjs';
import {runPrivateBoundaries} from './private-boundaries.mjs';
const hex=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join('');
const copy=v=>JSON.parse(JSON.stringify(v));
export async function run({seed=0x7e8193a5}={}){
 const c=checker(),native=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true});c.truth(native,'real private depth GPU');
 const calls=[],live=new Set(),objects=new WeakMap();let next=1,budgets=()=>null,fault={name:null,hits:0,events:[]};
 const describe=v=>{if(v===null||typeof v!=='object')return v===undefined?{undefined:true}:v;if(ArrayBuffer.isView(v))return{type:v.constructor.name,bytes:hex(new Uint8Array(v.buffer,v.byteOffset,v.byteLength))};if(!objects.has(v))objects.set(v,next++);return{object:objects.get(v),type:v.constructor?.name??'object'};};
 const gl=new Proxy(native,{get(target,name){const method=Reflect.get(target,name,target);if(typeof method!=='function')return method;return(...args)=>{
  const before=args.map(describe),budget=copy(budgets()),delivered=args.slice();let result;
  if(fault.name===name){
   fault.hits++;fault.name=null;
   if(name==='createTexture'||name==='createBuffer')result=null;
   else{if(name==='texStorage2D'||name==='texStorage3D')delivered[3]=0;else if(name==='bufferData')delivered[1]=-1;else if(name==='blitFramebuffer')delivered[8]=-1;result=method.apply(target,delivered);}
   fault.events.push({sequence:calls.length,name,before,delivered:delivered.map(describe),result:describe(result)});
  }else result=method.apply(target,delivered);
  if(/^create/.test(name)&&result)live.add(result);if(/^delete/.test(name)&&args[0])live.delete(args[0]);calls.push({sequence:calls.length,name,before,delivered:delivered.map(describe),budget,after:args.map(describe),result:describe(result)});return result;
 };}});
 window.__privateDepthActive=()=>({calls,live:live.size});
 const rows=[];window.__privateDepthReport={rows,calls};
 try{
  const recording={setBudgets(fn){budgets=fn;},addRow(row){rows.push(row);},calls(){return calls.length;},arm(name){fault={name,hits:0,events:[]};},disarm(){const result=copy(fault);fault={name:null,hits:0,events:[]};return result;}};
  const result=await runPrivate({gl,c,seed,recording});
  const boundaries=runPrivateBoundaries({gl,c,recording});
  c.equal(live.size,0,'private GPU owners all retired');c.equal(native.getError(),native.NO_ERROR,'private final native error');
  return {status:'passed',result,boundaries,nativeCalls:calls,summary:{status:'passed',cases:result.rows.length,boundaryCases:boundaries.rows.length,assertions:c.assertions,nativeCalls:calls.length,liveObjects:live.size}};
 }catch(error){error.privatePoint={calls,live:live.size};throw error;}
 finally{window.__privateDepthActive=null;}
}

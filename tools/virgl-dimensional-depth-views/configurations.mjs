import {createStandardDimensionalDepthViewResourceStore,createStandardDimensionalDepthViewTransferBackend} from '../../renderer/virgl-command/resources.mjs';
import {createVirglStandardDimensionalAsyncRenderer,STANDARD_DIMENSIONAL_ASYNC_PROFILE} from '../../renderer/virgl-command/state.mjs';
import {createVirglStandardDimensionalTextureShaderBridge} from '../../renderer/virgl-shader/standard.mjs';
import {packet} from './fixtures.mjs';
const hex=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join('');

// Direct historical factory configuration; this does not claim a guest queue run.
export async function runConfigurations({gl,c}) {
 const {backend}=c.ok(createStandardDimensionalDepthViewTransferBackend(gl)),owner=c.ok(createStandardDimensionalDepthViewResourceStore({backend})),store=owner.store;
 const shaderBridge=await createVirglStandardDimensionalTextureShaderBridge(),{renderer}=c.ok(createVirglStandardDimensionalAsyncRenderer({gl,shaderBridge,resources:store,bindings:owner.bindings,asyncAccess:owner.asyncAccess,uniformAccess:owner.uniformAccess,imageAccess:owner.imageAccess}));
 const rows=[];
 try {
  c.equal(c.ok(renderer.inspect()).profile,STANDARD_DIMENSIONAL_ASYNC_PROFILE,'historical renderer profile');
  c.ok(store.createContext(1));c.ok(renderer.createContext(1));
  const empty=c.ok(renderer.beginSubmission(1,new Uint8Array(),{contextId:1}));c.equal(empty.profile,STANDARD_DIMENSIONAL_ASYNC_PROFILE,'historical decoder selected');
  let completed;for(let i=0;i<20000;i++){completed=c.ok(renderer.step(empty.job));if(completed.status==='done')break;await new Promise(resolve=>setTimeout(resolve,1));}
  c.equal(completed.status,'done','historical empty submission completes');c.ok(completed.result);c.equal(completed.result.profile,STANDARD_DIMENSIONAL_ASYNC_PROFILE,'historical completion profile');
  rows.push({kind:'empty',wire:'',begun:{profile:empty.profile,commandCount:empty.commandCount},completed});
  for(const target of [4,7]){
   const wire=packet(1,6,[12,88,16|(target<<24),0,2<<8,0x688]),before=c.ok(renderer.inspect()),result=renderer.beginSubmission(1,wire,{contextId:1});
   c.equal(result.ok,false,'historical dimensional depth view stays closed');c.equal(result.error.code,'unsupported-feature','original view refusal');c.equal(result.appliedCommands,0,'refusal applies no commands');
   rows.push({kind:'refusal',target,wire:hex(wire),before,result,after:c.ok(renderer.inspect())});
  }
 } finally {c.ok(renderer.dispose());c.ok(store.dispose());}
 const final=c.ok(store.inspect());c.equal(final.budgets.gpuBytes,0,'historical factory final GPU budget');
 return {rows,final,actualGuestQueue:false};
}

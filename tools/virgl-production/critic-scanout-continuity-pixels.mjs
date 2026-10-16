// Independent literal canvas oracle. Original worker device/transport is covered by the worker gate.
import {PresentationController} from '/web/src/sink/presentation.js';
import {createVirglScanoutPresenter} from '/web/src/sink/virgl-scanout-presenter.js';
import {createWorkerScanoutPresenter,qualifyVirglHost} from '/web/renderer/virgl-command/production.mjs';

export async function runCriticScanoutContinuity({mainHandlerSource}) {
  const report=globalThis.__criticScanoutContinuity={scope:'Actual hardware qualification plus original Canvas2D, retained presenter and extracted original main callback; in-process ACK adapter, not a native-MMIO claim',status:'running',rows:[],assertions:0};
  const need=(value,message)=>{report.assertions++;if(!value)throw Error(message);};
  const rgba=color=>Array.from({length:16},()=>color).flat();
  const colors={red:[231,17,29,255],green:[13,229,47,255],blue:[19,31,227,255],purple:[173,37,201,255]},zero=Array(64).fill(0);
  const frame=(color,partial=false)=>({scanout:0,format:1,rect:partial?{x:1,y:1,width:2,height:2}:{x:0,y:0,width:4,height:4},resourceWidth:4,resourceHeight:4,pixels:Uint32Array.from({length:16},()=>((color[3]<<24)|(color[0]<<16)|(color[1]<<8)|color[2])>>>0)});
  const canvas=()=>{const c=document.createElement('canvas');c.width=c.height=4;document.body.append(c);return c;};
  const pixels=c=>[...c.getContext('2d').getImageData(0,0,4,4).data];
  const equal=(row,name,actual,expected)=>{row.observations.push({name,actual,expected});need(actual.length===expected.length&&actual.every((value,index)=>value===expected[index]),name);};
  const tick=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const start=name=>{const row={name,status:'running',observations:[]};report.rows.push(row);return row;};
  const gpu=document.createElement('canvas').getContext('webgl2',{failIfMajorPerformanceCaveat:true,antialias:false});
  const profile=await qualifyVirglHost(gpu);report.hardware={identity:profile.identity,renderer:profile.renderer,hostWords:[...profile.hostWords],physicalProbes:profile.probes.length,queryProbes:profile.queryProbes,multisample:profile.multisample};
  need(/Metal.*Apple|Apple.*Metal/.test(profile.identity),'actual Apple Metal qualification');
  try {
    {
      const row=start('production-worker-page-main-retained'),c=canvas(),controller=new PresentationController(c,{width:4,height:4,scheduleFrames:true});controller.setViewport(4,4);
      const receipts=[],messages=[];
      const handle=new Function('presentation','displayViewport','displayStatusEl',mainHandlerSource+';return handleDisplayFrame;')(controller,null,null);
      let presenter;
      presenter=createWorkerScanoutPresenter(value=>{messages.push(value.type??'frame');if(value.presentationToken){handle({...value,onRetired:(status,presentation)=>presenter.acknowledge(value.presentationToken,status,presentation)});}else handle(value);});
      const enqueue=(generation,color,partial=false)=>{const value=presenter.enqueueOwned({bindingGeneration:generation,frame:frame(color,partial)},receipt=>receipts.push(receipt));need(value.ok,'enqueue production retained frame');return value.token;};
      need(presenter.rebind('0000000000000001').ok,'initial binding');enqueue('0000000000000001',colors.red);await tick();equal(row,'initial literal red pixels',pixels(c),rgba(colors.red));
      const old=enqueue('0000000000000001',colors.blue);need(presenter.rebind('0000000000000002',true).ok,'valid production preserving rebind');
      equal(row,'front retained across actual production rebind',pixels(c),rgba(colors.red));await tick();equal(row,'queued old frame never reaches canvas',pixels(c),rgba(colors.red));
      need(receipts.filter(r=>r.token.sequence===old.sequence).length===1&&receipts.find(r=>r.token.sequence===old.sequence).status==='cancelled','old token cancelled exactly once');
      need(presenter.acknowledge(old,'drawn')===false,'stale drawn acknowledgement refused');
      const fresh=enqueue('0000000000000002',colors.green,true);await tick();equal(row,'first partial backing after same-size flip paints full new resource',pixels(c),rgba(colors.green));
      need(receipts.find(r=>r.token.sequence===fresh.sequence)?.status==='drawn','fresh receipt actually drawn');
      const stale=enqueue('0000000000000002',colors.blue);need(presenter.rebind('0000000000000003',true).ok,'rapid preserving rebind3');need(presenter.rebind('0000000000000004',true).ok,'rapid preserving rebind4');await tick();equal(row,'rapid rebind never paints stale queued blue',pixels(c),rgba(colors.green));
      need(receipts.filter(r=>r.token.sequence===stale.sequence).length===1,'rapid cancelled receipt used once');
      need(!presenter.rebind('0000000000000004',true).ok,'same-generation rebind refused');equal(row,'refused rebind has no visible effect',pixels(c),rgba(colors.green));
      need(presenter.rebind('0000000000000005').ok,'explicit disable-style clear');equal(row,'explicit clear erases front',pixels(c),zero);await tick();equal(row,'old pixels not replayed after clear',pixels(c),zero);
      enqueue('0000000000000005',colors.purple,true);await tick();equal(row,'partial after explicit clear repaints full resource',pixels(c),rgba(colors.purple));
      controller.dispose();presenter.dispose();need(controller.snapshot().errors.length===0,'production controller errors empty');row.receipts=receipts;row.messages=messages;row.presenter=presenter.inspect();row.status='passed';
    }
    {
      const row=start('ordinary-scheduled-presentation'),c=canvas(),controller=new PresentationController(c,{width:4,height:4,scheduleFrames:true});controller.setViewport(4,4);
      controller.present(frame(colors.red));await tick();equal(row,'ordinary initial red',pixels(c),rgba(colors.red));
      controller.present(frame(colors.blue));controller.present({type:'invalidate'});equal(row,'ordinary invalidate keeps displayed red',pixels(c),rgba(colors.red));await tick();equal(row,'ordinary pending blue discarded',pixels(c),rgba(colors.red));need(controller.snapshot().latest===null,'ordinary invalidation revokes recovery source');
      controller.present(frame(colors.green,true));await tick();equal(row,'ordinary partial after invalidate paints full backing',pixels(c),rgba(colors.green));controller.present({type:'clear'});equal(row,'ordinary explicit clear erases',pixels(c),zero);await tick();equal(row,'ordinary clear does not replay old frame',pixels(c),zero);controller.dispose();row.status='passed';
    }
    {
      const row=start('isolated-retained-presenter'),c=canvas(),made=createVirglScanoutPresenter({canvas:c,controllerOptions:{width:4,height:4}});need(made.ok,'isolated presenter construction');const p=made.presenter,receipts=[];
      const enqueue=(generation,color)=>{const r=p.enqueueOwned({bindingGeneration:generation,frame:frame(color)},receipt=>receipts.push(receipt));need(r.ok,'isolated enqueue');return r.token;};
      need(p.rebind('0000000000000001').ok,'isolated initialbind');enqueue('0000000000000001',colors.red);await tick();equal(row,'isolated initial red',pixels(c),rgba(colors.red));
      const old=enqueue('0000000000000001',colors.blue);need(p.rebind('0000000000000002',true).ok,'isolated preserving rebind');equal(row,'isolated front kept across rebind',pixels(c),rgba(colors.red));await tick();equal(row,'isolated queued old not painted',pixels(c),rgba(colors.red));need(receipts.filter(r=>r.token===old).length===1&&receipts.find(r=>r.token===old).status==='cancelled','isolated cancellation used once');
      enqueue('0000000000000002',colors.green);await tick();equal(row,'isolated fresh green',pixels(c),rgba(colors.green));need(p.dispose().ok,'isolated dispose');equal(row,'isolated teardown erases front',pixels(c),zero);need(p.inspect().errors.length===0,'isolated errors empty');row.receipts=receipts.map(r=>({...r,token:'opaque'}));row.status='passed';
    }
    report.status='passed';return report;
  }catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};throw error;}
}

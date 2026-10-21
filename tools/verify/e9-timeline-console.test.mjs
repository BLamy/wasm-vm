import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import initSession from '../../web/session-pkg/wasm_vm_session.js';

// Initialize the unchanged session dependency from local bytes before importing its
// browser adapter. These are byte-format fixtures, not authenticated guest output;
// the built-browser acceptance separately records genuine pinned Linux UART bytes.
await initSession({module_or_path:await readFile(new URL('../../web/session-pkg/wasm_vm_session_bg.wasm',import.meta.url))});
const {renderReplayConsole}=await import('../../web/session-timeline-runtime.js');
const {SessionTimeline}=await import('../../web/session-timeline.js');
const at={transition:'7',retired:'6',phase:'before',ordinal:0,sequence:'2'};
const bytes=text=>new TextEncoder().encode(text);
const candidate=(output,position=at)=>({
  exactSessionWitness:()=>({...position,digest:Uint8Array.from({length:32},(_,i)=>i)}),
  exactSessionHostQueues:()=>({output}),
});
const receipt=(sequence,text,extra={})=>({kind:'host',channel:21,sequence,bytes:bytes(text),...extra});

test('console includes only delivered serial drains followed by the restored output queue',()=>{
  const frame=renderReplayConsole({receipts:[
    receipt('1','first '),receipt('2','second'),receipt('3',' future'),
    receipt('2',' other channel',{channel:20}),receipt('2',' observation',{kind:'observation'}),
  ]},candidate(bytes(' + pending')),at);
  assert.equal(frame.console,'first second + pending');
  assert.deepEqual(frame.position,at);
  assert.equal(frame.digest,'000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
});

test('console retains the exact last 65536 bytes across receipt and queue boundaries',()=>{
  const frame=renderReplayConsole({receipts:[receipt('1','A'.repeat(40000)),receipt('2','B'.repeat(40000))]},candidate(bytes('CDE')),at);
  assert.equal(frame.console,'A'.repeat(25533)+'B'.repeat(40000)+'CDE');
  assert.equal(bytes(frame.console).length,65536);
});

test('a frame cannot represent a different machine position',()=>{
  assert.throws(()=>renderReplayConsole({receipts:[]},candidate(new Uint8Array(),{...at,ordinal:1}),at),/Replay view position mismatch/);
});

function controlsAt(position){
  const names=['sessions','refresh','open','record','stop','mode','active','position','scrub','target','seek','back','forward','play','pause','preview','points','point-go','events','event-go','console','digest','status'];
  const elements=names.map(name=>({dataset:{timeline:name},value:'0',textContent:'',before(){},addEventListener(){},setAttribute(){}}));
  const root={dataset:{},querySelectorAll:()=>elements,setAttribute(){}};
  // This control fixture only needs the constructor's GPU preview container.
  // The recorded production-browser proof checks the actual DOM and canvas.
  const previousDocument=globalThis.document;let timeline;
  globalThis.document={createElement:()=>({dataset:{}})};
  try{timeline=new SessionTimeline(root,{store:{}});}
  finally{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;}
  const begin={...at,transition:'0',retired:'0',sequence:'0'},end={...at,transition:'10',retired:'9'};
  const calls={seek:0,close:0};
  timeline.preview={id:'history',compatible:true};
  timeline.owner={id:'history',manifest:{begin,end},events:[],controller:{
    selected:{position},cancel(){},close(){calls.close++;},seekTransition(){calls.seek++;},seekPosition(){calls.seek++;},
  }};
  return {timeline,begin,end,calls};
}

test('same-transition event coordinates do not enable an impossible reverse step',()=>{
  const {timeline,end}=controlsAt({...at,transition:'0',retired:'0',ordinal:1,sequence:'1'});
  timeline.render();assert.equal(timeline.c.back.disabled,true);
  timeline.owner.controller.selected.position=end;timeline.render();assert.equal(timeline.c.forward.disabled,true);
  timeline.close();
});

test('play at the saved end stops without issuing another seek and can retire its owner',async()=>{
  const {timeline,calls}=controlsAt({...at,transition:'10',retired:'9'});
  await timeline.play();
  assert.equal(timeline.playing,false);assert.equal(calls.seek,0);assert.equal(timeline.c.status.textContent,'End of saved replay.');
  timeline.close();assert.equal(calls.close,1);assert.equal(timeline.owner,null);
});

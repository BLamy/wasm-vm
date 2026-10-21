// The selected library preview, pending target and published replay are distinct owners.
import {SessionStore} from './session-store.js';
import {openTimelineReplay,recordTimelineSample} from './session-timeline-runtime.js';

const decode=new TextDecoder();
const same=(a,b)=>['transition','retired','sequence','phase','ordinal'].every(k=>a[k]===b[k]);
const positionText=p=>`transition ${p.transition} · retired ${p.retired} · ${p.phase}:${p.ordinal} · event ${p.sequence}`;
const pointOrder=(a,b)=>{
  for(const [x,y] of [[BigInt(a.transition),BigInt(b.transition)],[a.phase==='before'?0:1,b.phase==='before'?0:1],
    [a.ordinal,b.ordinal],[BigInt(a.sequence),BigInt(b.sequence)]])if(x!==y)return x<y?-1:1;
  return 0;
};
export async function mountSessionTimeline(root,options={}){
  if(!root)return null;
  const timeline=new SessionTimeline(root,options);await timeline.initialize();return timeline;
}
export class SessionTimeline {
  constructor(root,{store=null,pauseLive=async()=>{},beforeFrame=async()=>{}}={}){
    this.root=root;this.store=store;this.pauseLive=pauseLive;this.beforeFrame=beforeFrame;
    this.c=Object.fromEntries([...root.querySelectorAll('[data-timeline]')].map(el=>[el.dataset.timeline,el]));
    this.gpuFrame=document.createElement('div');this.gpuFrame.dataset.timelineGpuFrame='';this.c.console.before(this.gpuFrame);
    this.epoch=0;this.refreshEpoch=0;this.playEpoch=0;this.preview=null;this.owner=null;this.active=null;this.operation=null;this.playing=false;this.recording=null;
    const c=this.c;
    c.sessions.addEventListener('change',()=>void this.select(c.sessions.value));
    for(const [key,action] of [['refresh',()=>this.refresh()],['open',()=>this.open()],['record',()=>this.record()],
      ['back',()=>this.step(-1)],['forward',()=>this.step(1)],['play',()=>this.play()],['pause',()=>this.pause()],
      ['seek',()=>this.seek(c.target.value)],['point-go',()=>this.navigate('points')],['event-go',()=>this.navigate('events')]])
      c[key].addEventListener('click',()=>void this.guard(action));
    c.stop.addEventListener('click',()=>{this.recording?.abort();this.status('Stopping the sample at a committed replay point…');});
    c.target.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();void this.guard(()=>this.seek(c.target.value));}});
    c.scrub.addEventListener('input',()=>{
      if(!this.owner)return;this.stopPlaying();this.cancelRequest();
      const {begin,end}=this.owner.manifest,span=BigInt(end.transition)-BigInt(begin.transition);
      c.target.value=(BigInt(begin.transition)+span*BigInt(c.scrub.value)/1000n).toString();
      this.showTarget(c.target.value);this.status('Preview target only. Release the slider to restore.');this.render();
    });
    c.scrub.addEventListener('change',()=>void this.guard(()=>this.seek(c.target.value)));
    this.status('Reading saved sessions…');this.render();
  }
  status(message,state='ready'){
    this.c.status.textContent=message;this.root.dataset.state=state;
  }
  showTarget(value){this.c.preview.textContent=`Preview target: transition ${value}. The active replay position changes after restoration completes.`;}
  fillEvents(owner){
    this.c.events.replaceChildren();
    for(let i=0;i<owner.events.length;i++){
      const row=owner.events[i];this.c.events.add(new Option(`Event ${row.sequence} · ${row.kind} · ${row.transition}${row.phase==='observe'?' (after observation)':''}`,String(i)));
    }
  }
  stopPlaying(){this.playing=false;this.playEpoch++;clearTimeout(this.playTimer);}
  retire(owner){if(!owner)return;owner.controller.close();this.retire(owner.previous);owner.previous=null;}
  cancelRequest(){this.epoch++;this.operation=null;this.owner?.controller.cancel();}
  pause(){this.stopPlaying();this.cancelRequest();this.status(this.active?'Replay paused at the displayed position.':'Restoration cancelled; no replay position is active.');this.render();}
  async guard(action){try{return await action();}catch(error){this.status(error.message,'error');this.render();}}
  async initialize(){
    try{this.store??=await SessionStore.open();await this.refresh();}
    catch(error){this.status(`Local history unavailable: ${error.message}`,'error');this.render();}
  }
  async refresh(preferred=this.c.sessions.value){
    const token=++this.refreshEpoch,rows=await this.store.list();if(token!==this.refreshEpoch)return;
    const options=[...rows.sessions,...rows.unavailable.map(r=>({...r,mode:'incomplete'}))];
    this.c.sessions.replaceChildren();
    if(!options.length)this.c.sessions.add(new Option('No saved sessions',''));
    for(const row of options)this.c.sessions.add(new Option(`${row.id} · ${row.mode}`,row.id));
    this.c.sessions.value=options.some(r=>r.id===preferred)?preferred:options[0]?.id??'';
    await this.select(this.c.sessions.value);
  }
  async select(id){
    this.refreshEpoch++;this.stopPlaying();this.cancelRequest();const token=this.epoch;this.preview=null;this.c.sessions.value=id;
    this.c.points.replaceChildren();this.c.events.replaceChildren();this.c.preview.textContent='';this.render();
    if(!id){this.status('No saved histories yet. Record a Linux sample to try time travel.');return;}
    this.status('Reading preview. The displayed replay remains at its last restored position.','loading');
    try{
      const opened=await this.store.openSession(id);if(!opened)throw Error('This session is incomplete or no longer available.');
      const manifest=JSON.parse(decode.decode(opened.manifest));if(token!==this.epoch)return;
      let compatible=manifest.policy.mode==='exact-replay'&&manifest.policy.profile==='rv64-linux-software-v1'&&manifest.machine.gpu===null;
      if(manifest.policy.mode==='exact-replay'&&manifest.machine.gpu){
        const vm=manifest.assets.find(asset=>asset.role==='vm');
        const {readCheckpointObject}=await import('./session-checkpoints.js');
        const config=JSON.parse(decode.decode(await readCheckpointObject(this.store,vm.content,8*1048576)));
        compatible=config.version===1&&config.runtime==='rv64-linux-gpu-exact-session-v1'&&config.clock?.mode==='icount'&&config.clock.divider===64&&config.clock.interactive===null;
        if(token!==this.epoch)return;
      }
      this.preview={id,manifest,compatible};
      for(const point of manifest.checkpoints)this.c.points.add(new Option(`${point.id} · ${point.position.transition}`,point.id));
      if(this.owner?.id===id)this.fillEvents(this.owner);
      this.status(manifest.machine.gpu&&!compatible?'GPU checkpoints are available in Local saved sessions. This saved clock/runtime does not support event replay.':compatible
        ?'Selected preview only. Open replay restores a private machine and pauses the live guest.'
        :'This is an incomplete recording or a checkpoint-only session. Full replay is unavailable.',compatible?'ready':'gated');
    }catch(error){if(token===this.epoch)this.status(`Cannot preview this session: ${error.message}`,'error');}
    this.render();
  }
  async open(){
    if(!this.preview?.compatible||this.recording)throw Error('Select a completed recording first.');
    this.stopPlaying();this.cancelRequest();const token=this.epoch,id=this.preview.id,previous=this.owner;
    const owner={id,controller:null,manifest:null,events:[],previous};
    this.operation={token,owner,stage:'open'};
    this.status('Authenticating saved replay…','restoring');this.render();
    try{
      const replay=await openTimelineReplay({store:this.store,id,beforeFrame:frame=>this.beforeFrame(frame),
        onProgress:message=>{if(this.owner===owner&&this.operation?.token===this.epoch)this.status(message,'restoring');},
        onPublish:selection=>{
          if(this.owner!==owner||this.operation?.token!==this.epoch)throw Error('Replay publication lost ownership.');
          if(!same(selection.position,selection.rendered.position))throw Error('The replay frame does not match the selected machine.');
          this.active={id,position:{...selection.position},digest:selection.rendered.digest,checkpointId:selection.checkpointId};
          this.c.console.textContent=selection.rendered.console||'(No serial output at this position.)';
          this.gpuFrame.replaceChildren(...(selection.rendered.canvas?[selection.rendered.canvas]:[]));
          this.c.position.textContent=positionText(selection.position);this.c.position.dataset.transition=selection.position.transition;
          this.c.digest.textContent=selection.rendered.digest;this.c.active.textContent=`Active replay: ${id}`;
          this.c.target.value=selection.position.transition;
          const span=BigInt(owner.manifest.end.transition)-BigInt(owner.manifest.begin.transition);
          this.c.scrub.value=span?String((BigInt(selection.position.transition)-BigInt(owner.manifest.begin.transition))*1000n/span):'0';
          this.c.preview.textContent='';
          if(owner.previous){this.retire(owner.previous);owner.previous=null;}
          this.render();
        }});
      Object.assign(owner,replay);
      if(token!==this.epoch){owner.controller.close();return {status:'cancelled'};}
      await this.pauseLive();if(token!==this.epoch){owner.controller.close();return {status:'cancelled'};}
      this.owner=owner;
      this.fillEvents(owner);
      const outcome=await this.request(()=>owner.controller.seekPosition(owner.manifest.begin));
      // Cancellation can mean a newer seek already owns this controller. Only a
      // successful publication or explicit retirement may release its machine chain.
      return outcome;
    }catch(error){
      if(this.owner===owner){owner.controller?.close();this.owner=previous;}
      else if(!owner.controller||this.owner!==previous)owner.controller?.close();
      if(token===this.epoch){this.operation=null;this.status(`Cannot open replay: ${error.message}`,'error');this.render();}
      return {status:'error',error:error.message};
    }
  }
  async request(action){
    const token=++this.epoch,owner=this.owner;this.operation={token,owner};this.status('Restoring preview target…','restoring');this.render();
    try{
      const result=await action();
      if(token===this.epoch&&this.owner===owner){this.operation=null;
        this.status(result.status==='ready'?'Replay restored. The position and console show the active machine.':'Restoration cancelled; the last restored machine is still displayed.');this.render();}
      return result;
    }catch(error){
      if(token===this.epoch){this.operation=null;this.stopPlaying();this.status(`Restoration failed: ${error.message}`,'error');this.render();}
      return {status:'error',error:error.message};
    }
  }
  canControl(){return !!this.owner&&this.preview?.id===this.owner.id&&!this.recording;}
  async seek(transition){
    if(!this.canControl())throw Error('Open the selected replay first.');
    this.stopPlaying();this.showTarget(transition);return this.request(()=>this.owner.controller.seekTransition(transition));
  }
  async step(direction){
    if(!this.canControl()||!this.owner.controller.selected)throw Error('Restore a position before stepping.');
    this.stopPlaying();return this.request(()=>direction<0?this.owner.controller.reverseStep():this.owner.controller.forwardStep());
  }
  async navigate(kind){
    if(!this.canControl())throw Error('Open the selected replay first.');this.stopPlaying();
    if(kind==='points'){
      const target=this.owner.manifest.checkpoints.find(p=>p.id===this.c.points.value)?.position;
      if(!target)throw Error('Choose a saved keyframe.');this.showTarget(target.transition);
      return this.request(()=>this.owner.controller.seekPosition(target));
    }
    const event=this.owner.events[Number(this.c.events.value)];if(!event)throw Error('Choose a recorded event.');
    if(event.phase==='before')return this.request(()=>this.owner.controller.seekPosition(event));
    const next=BigInt(event.transition)+1n,end=BigInt(this.owner.manifest.end.transition);
    return this.request(()=>this.owner.controller.seekTransition((next>end?end:next).toString()));
  }
  async play(){
    if(!this.canControl()||!this.owner.controller.selected)throw Error('Restore a position before playing.');
    this.stopPlaying();this.playing=true;this.render();const owner=this.owner,playToken=this.playEpoch;
    const advance=async()=>{
      if(!this.playing||owner!==this.owner||playToken!==this.playEpoch)return;
      const current=owner.controller.selected.position,end=owner.manifest.end;
      if(pointOrder(current,end)>=0){this.stopPlaying();this.status('End of saved replay.');this.render();return;}
      const next=BigInt(current.transition)+65536n,limit=BigInt(end.transition);
      const result=await this.request(()=>next>=limit?owner.controller.seekPosition(end):owner.controller.seekTransition(next.toString()));
      if(playToken!==this.playEpoch)return;
      if(result.status==='ready'&&this.playing&&owner===this.owner)this.playTimer=setTimeout(advance,50);
      else {this.stopPlaying();this.render();}
    };
    await advance();
  }
  async record(){
    if(this.recording)return;this.pause();const signal=new AbortController();this.recording=signal;this.render();
    try{
      await this.pauseLive();
      const result=await recordTimelineSample({store:this.store,id:'linux-sample-'+crypto.randomUUID(),signal:signal.signal,
        onProgress:message=>{if(this.recording===signal)this.status(message,'recording');}});
      this.recording=null;await this.refresh(result.id);await this.open();
    }catch(error){this.status(`Sample recording failed: ${error.message}. Existing histories are preserved.`,'error');}
    finally{this.recording=null;this.render();}
  }
  get snapshot(){return {preview:this.preview?.id??null,active:this.active&&structuredClone(this.active),playing:this.playing,
    pending:!!this.operation,mode:this.recording?'recording':this.active?'replay':'live',status:this.c.status.textContent};}
  render(){
    const c=this.c,ready=!!this.store,recording=!!this.recording,control=this.canControl(),selected=control&&this.owner.controller.selected;
    c.sessions.disabled=c.refresh.disabled=c.record.disabled=!ready||recording;c.stop.disabled=!recording;
    c.open.disabled=!this.preview?.compatible||recording;
    c.scrub.disabled=c.target.disabled=c.seek.disabled=c['point-go'].disabled=!control;
    c.points.disabled=!this.preview||recording;
    c.events.disabled=c['event-go'].disabled=!control||!this.owner.events.length;
    c.play.disabled=!selected||this.playing;c.back.disabled=!selected||BigInt(selected.position.transition)<=BigInt(this.owner.manifest.begin.transition);
    c.forward.disabled=!selected||BigInt(selected.position.transition)>=BigInt(this.owner.manifest.end.transition);
    c.pause.disabled=!this.playing&&!this.operation;
    c.mode.textContent=recording?'Recording a separate Linux sample; replay paused':this.active?this.playing?'Replay · playing':'Replay · paused':'Live view · no replay restored';
    c.scrub.setAttribute('aria-valuetext',`Preview transition ${c.target.value||'0'}`);
    this.root.setAttribute('aria-busy',String(!!this.operation||recording));
  }
  close(){this.pause();this.recording?.abort();this.retire(this.owner);this.owner=null;}
}

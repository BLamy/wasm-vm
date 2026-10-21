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
    this.branch=null;this.branchCreation=null;this.branchBusy=false;this.branchEpoch=0;this.branchRunning=false;this.branchRunEpoch=0;this.branchRun=null;
    const c=this.c;
    c.sessions.addEventListener('change',()=>void this.guard(()=>this.select(c.sessions.value)));
    for(const [key,action] of [['refresh',()=>this.refresh()],['open',()=>this.open()],['record',()=>this.record()],
      ['back',()=>this.step(-1)],['forward',()=>this.step(1)],['play',()=>this.play()],['pause',()=>this.pause()],
      ['seek',()=>this.seek(c.target.value)],['point-go',()=>this.navigate('points')],['event-go',()=>this.navigate('events')]])
      c[key].addEventListener('click',()=>void this.guard(action));
    for(const [key,action]of [['branch-create',()=>this.continueHere()],['branch-run',()=>this.runBranch()],['branch-pause',()=>this.pauseBranch()],
      ['branch-save',()=>this.saveBranch()],['branch-discard',()=>this.discardBranch()],['branch-live',()=>this.goLiveBranch()],['branch-send',()=>this.sendBranchInput()]])
      c[key]?.addEventListener('click',()=>void this.guard(action));
    c['branch-input']?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void this.guard(()=>this.sendBranchInput());}});
    c['record-file']?.addEventListener('click',()=>void this.guard(()=>this.record(true)));
    c.stop.addEventListener('click',()=>{this.recording?.abort();this.status('Stopping the recording…');});
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
  pause(){
    if(this.branchCreation){this.branchCreation.abort();this.branchCreation=null;this.branchEpoch++;this.status('Continuation creation cancelled. The saved parent is unchanged.');this.render();return;}
    if(this.branch)return this.pauseBranch();
    this.stopPlaying();this.cancelRequest();this.status(this.active?'Replay paused at the displayed position.':'Restoration cancelled; no replay position is active.');this.render();
  }
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
    if(this.branchLocked())throw Error('Save or discard the continuation before selecting another history.');
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
    if(this.branchLocked())throw Error('Save or discard the continuation before opening another replay.');
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
  branchLocked(){return !!this.branch||!!this.branchCreation||this.branchBusy;}
  canControl(){return !!this.owner&&this.preview?.id===this.owner.id&&!this.recording&&!this.branchLocked();}
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
  async record(fileExample=false){
    if(this.branchLocked())throw Error('Save or discard the continuation before recording a sample.');
    if(this.recording)return;this.pause();const signal=new AbortController();this.recording=signal;this.render();
    try{
      await this.pauseLive();
      const record=fileExample?(await import('./session-file-sample.js')).recordFileTimelineSample:recordTimelineSample;
      const result=await record({store:this.store,id:'linux-sample-'+crypto.randomUUID(),signal:signal.signal,
        onProgress:message=>{if(this.recording===signal)this.status(message,'recording');}});
      this.recording=null;await this.refresh(result.id);await this.open();
      if(result.past)await this.request(()=>this.owner.controller.seekPosition(result.past));
    }catch(error){this.status(`Sample recording failed: ${error.message}. Existing histories are preserved.`,'error');}
    finally{this.recording=null;this.render();}
  }
  paintBranch(view,id){
    this.active={id,position:{...view.position},digest:view.digest??null,checkpointId:null,continuation:true};
    this.c.console.textContent=view.console||'(No serial output at this position.)';
    this.gpuFrame.replaceChildren(...(view.canvas?[view.canvas]:[]));this.c.position.textContent=positionText(view.position);
    this.c.position.dataset.transition=view.position.transition;this.c.digest.textContent=view.digest??'Pause the continuation to compute its state digest.';
    this.c.active.textContent=`Active continuation: ${id}`;
  }
  async continueHere(){
    if(!this.canControl()||!this.owner.controller.canContinue)throw Error('Select an available completed replay point before continuing.');
    this.pause();const token=++this.branchEpoch,source=this.owner,signal=new AbortController();this.branchCreation=signal;
    this.status('Preparing a private continuation…','restoring');this.render();
    try{
      const {createSessionBranch}=await import('./session-branches.js');
      if(signal.signal.aborted||token!==this.branchEpoch)return;
      const branch=await createSessionBranch({store:this.store,parent:source,signal:signal.signal,onProgress:message=>{if(token===this.branchEpoch)this.status(message,'restoring');}});
      if(token!==this.branchEpoch||signal.signal.aborted){await branch.discard();return;}
      this.branch=branch;this.branchCreation=null;
      const view=await branch.view();if(this.branch!==branch||token!==this.branchEpoch)return;
      this.paintBranch(view,branch.id);
      if(this.c['branch-origin'])this.c['branch-origin'].textContent=`Continuation ${branch.id} from ${source.id} at ${positionText(source.controller.selected.position)}. Network offline.`;
      this.status('Continuation paused. Run it or send serial input; the saved parent remains unchanged.');
    }catch(error){if(token===this.branchEpoch&&!signal.signal.aborted)throw error;}
    finally{if(token===this.branchEpoch){this.branchCreation=null;this.render();}}
  }
  async runBranch(){
    const branch=this.branch;if(!branch||this.branchBusy||this.branchRunning)return;
    const token=++this.branchRunEpoch;this.branchRunning=true;this.status('Continuation running · network offline','recording');this.render();
    const work=(async()=>{
      let shown=0;
      try{
        while(this.branch===branch&&this.branchRunning&&token===this.branchRunEpoch){
          await branch.advance(32768);
          if(this.branch!==branch||token!==this.branchRunEpoch)break;
          if(performance.now()-shown>100){this.paintBranch(branch.preview(),branch.id);shown=performance.now();}
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      }catch(error){
        if(this.branch===branch&&token===this.branchRunEpoch){this.branchRunning=false;this.status(`Continuation paused: ${error.message}`,'error');}
      }finally{if(this.branch===branch&&token===this.branchRunEpoch){this.branchRunning=false;this.render();}}
    })();this.branchRun=work;try{await work;}finally{if(this.branchRun===work)this.branchRun=null;}
  }
  async pauseBranch(){
    const branch=this.branch;if(!branch)return;
    this.branchRunning=false;this.branchRunEpoch++;await this.branchRun?.catch(()=>{});
    if(this.branch!==branch)return;
    const view=await branch.view();if(this.branch!==branch)return;
    this.paintBranch(view,branch.id);this.status('Continuation paused · network offline.');this.render();
  }
  async sendBranchInput(){
    const branch=this.branch;if(!branch||this.branchBusy)throw Error('Open an available continuation first.');
    const bytes=new TextEncoder().encode(this.c['branch-input'].value+'\n');
    try{await branch.sendInput(bytes);if(this.branch!==branch)return;this.c['branch-input'].value='';this.paintBranch(branch.preview(),branch.id);this.render();}
    catch(error){if(this.branch===branch)throw error;}
  }
  async goLiveBranch(){
    const branch=this.branch;if(!branch||this.branchBusy)throw Error('Open an available continuation first.');
    try{await branch.goLive();}catch(error){if(this.branch===branch)throw error;}
  }
  async saveBranch(){
    const branch=this.branch;if(!branch||this.branchBusy)return;const token=++this.branchEpoch;
    await this.pauseBranch();if(this.branch!==branch||token!==this.branchEpoch)return;
    this.branchBusy=true;this.status('Saving the continuation…','recording');this.render();
    try{
      const saved=await branch.finish();if(this.branch!==branch||token!==this.branchEpoch)return;
      this.branch=null;this.branchBusy=false;await this.refresh(saved.id);await this.open();
    }catch(error){if(token===this.branchEpoch)throw error;}
    finally{if(token===this.branchEpoch){this.branchBusy=false;this.render();}}
  }
  async discardBranch(restore=true){
    const token=++this.branchEpoch,branch=this.branch;this.branchCreation?.abort();this.branchCreation=null;
    this.branchRunning=false;this.branchRunEpoch++;this.branch=null;this.branchBusy=true;if(restore)this.render();
    try{await branch?.discard();}
    finally{
      if(token===this.branchEpoch){
        this.branchBusy=false;
        if(restore){
          const selected=this.owner?.controller.selected;
          if(selected){const view=selected.rendered;this.active={id:this.owner.id,position:{...view.position},digest:view.digest,checkpointId:selected.checkpointId};
            this.c.console.textContent=view.console||'(No serial output at this position.)';this.gpuFrame.replaceChildren(...(view.canvas?[view.canvas]:[]));
            this.c.position.textContent=positionText(view.position);this.c.position.dataset.transition=view.position.transition;this.c.digest.textContent=view.digest;this.c.active.textContent=`Active replay: ${this.owner.id}`;}
          this.status('Unsaved continuation discarded. The saved parent is unchanged.');this.render();
        }
      }
    }
  }
  get snapshot(){return {preview:this.preview?.id??null,active:this.active&&structuredClone(this.active),playing:this.playing,
    pending:!!this.operation||!!this.branchCreation||this.branchBusy,mode:this.recording?'recording':this.branch?'continuation':this.active?'replay':'live',status:this.c.status.textContent};}
  render(){
    const c=this.c,ready=!!this.store,recording=!!this.recording,control=this.canControl(),selected=control&&this.owner.controller.selected;
    const branch=this.branch,locked=this.branchLocked();
    c.sessions.disabled=c.refresh.disabled=c.record.disabled=!ready||recording||locked;c.stop.disabled=!recording;
    if(c['record-file'])c['record-file'].disabled=!ready||recording||locked;
    c.open.disabled=!this.preview?.compatible||recording||locked;
    c.scrub.disabled=c.target.disabled=c.seek.disabled=c['point-go'].disabled=!control;
    c.points.disabled=!this.preview||recording||locked;
    c.events.disabled=c['event-go'].disabled=!control||!this.owner.events.length;
    c.play.disabled=!selected||this.playing;c.back.disabled=!selected||BigInt(selected.position.transition)<=BigInt(this.owner.manifest.begin.transition);
    c.forward.disabled=!selected||BigInt(selected.position.transition)>=BigInt(this.owner.manifest.end.transition);
    c.pause.disabled=!this.playing&&!this.operation&&!this.branchCreation;
    c.mode.textContent=recording?'Recording a separate Linux sample; replay paused':branch?this.branchRunning?'Continuation · running · offline':'Continuation · paused · offline':this.active?this.playing?'Replay · playing':'Replay · paused':'Live view · no replay restored';
    if(c['branch-create']){
      c['branch-create'].disabled=!selected||!this.owner.controller.canContinue;
      c['branch-create'].title=selected&&!this.owner.controller.canContinue?'Select a completed, available command boundary.':'';
      c['branch-controls'].hidden=!branch&&!this.branchCreation;c['branch-origin'].hidden=!branch;
      c['branch-run'].disabled=!branch||this.branchRunning||this.branchBusy;
      c['branch-pause'].disabled=!branch||!this.branchRunning||this.branchBusy;
      c['branch-save'].disabled=c['branch-live'].disabled=c['branch-input'].disabled=c['branch-send'].disabled=!branch||this.branchBusy;
      c['branch-discard'].disabled=(!branch&&!this.branchCreation)||this.branchBusy;
      c['branch-discard'].textContent=this.branchCreation?'Cancel continuation':'Discard unsaved continuation';
    }
    c.scrub.setAttribute('aria-valuetext',`Preview transition ${c.target.value||'0'}`);
    this.root.setAttribute('aria-busy',String(!!this.operation||recording||this.branchCreation||this.branchBusy));
  }
  close(){this.stopPlaying();this.cancelRequest();this.recording?.abort();const closed=this.discardBranch(false);this.retire(this.owner);this.owner=null;return closed;}
}

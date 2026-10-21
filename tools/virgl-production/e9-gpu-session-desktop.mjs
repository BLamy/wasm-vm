// E9-T17: the actual Omarchy/Mesa guest, public canvas, trusted input and session store.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyPublicDesktopInput} from './critic-fast-boots-input.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const database='wasm-vm-sessions-v1-e9-gpu-desktop',id='omarchy-gpu-history';
const firstPath='/home/omarchy/.e9t17-first',secondPath='/home/omarchy/.e9t17-second',
  thirdPath='/home/omarchy/.e9t17-third';
const first='touch '+firstPath,second='touch '+secondPath,third='touch '+thirdPath;
const absent=path=>'test ! -e '+path;
const present=path=>'test -e '+path+' && echo PRESENT';

async function observe(page,label,output){
  const value=await page.evaluate(async()=>{
    const c=window.__linuxCtl,canvas=document.querySelector('#ide-display-canvas');
    const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    const digest=await crypto.subtle.digest('SHA-256',pixels);
    return {ready:wvmDemo.isGuestReady(),owner:wvmDemo.guestSession(),documentTimeOrigin:performance.timeOrigin,
      restored:await c.restoredFromBootSnapshot(),
      gpu:await c.gpuStats(),clock:await c.guestClockState(),scheduler:await c.schedulerStats(),
      display:window.__presentation.state(),screen:{width:canvas.width,height:canvas.height,
        sha256:[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join(''),
        sample:[...canvas.getContext('2d').getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data]}};
  });
  await fs.writeFile(path.join(output,label+'.json'),JSON.stringify(value,null,2)+'\n');
  await page.locator('#ide-display-canvas').screenshot({path:path.join(output,label+'.png')});
  assert.equal(value.ready,true,label+' actual guest ready');
  assert.equal(value.gpu.qualified,true,label+' hardware GPU remains qualified');
  assert.equal(value.gpu.lost,false,label+' no context loss');
  assert.ok(value.display.drawnPresents>0,label+' physical canvas has drawn');
  assert.ok(value.screen.sample.slice(0,3).some(channel=>channel!==0),label+' physical canvas is not blank');
  assert.ok(value.gpu.scanout.retirements.some(row=>row.epoch===value.gpu.epoch&&row.status==='drawn'),
    label+' current-epoch physical scanout retirement');
  return value;
}

async function command(page,guestCommand,script){
  const result=await guestCommand(page,script,300000);
  assert.equal(result.exit,0,script);return result;
}
async function fingerprint(page){
  return page.evaluate(async({id,database})=>{
    const {SessionStore}=await import('/session-store.js'),{checkpointHash}=await import('/session-checkpoints.js');
    const store=await SessionStore.open(database);
    try{const opened=await store.openSession(id);return {sha256:checkpointHash(opened.manifest),revision:String(opened.revision),
      manifest:JSON.parse(new TextDecoder().decode(opened.manifest))};}
    finally{await store.close();}
  },{id,database});
}
async function waitReopenedDesktop(page,oldOwner){
  await page.waitForFunction(async previous=>{
    const gpu=await globalThis.__linuxCtl?.gpuStats?.();
    return globalThis.wvmDemo?.guestSession?.()?.key!==previous && gpu?.qualified && gpu?.scanout?.retirements?.some(row=>
      row.epoch===gpu.epoch&&row.status==='drawn');
  },oldOwner,{timeout:300000});
  await page.waitForFunction(()=>document.querySelector('[data-session="gpu-capture"]')?.disabled===false,
    null,{timeout:300000});
}
async function libraryDrawer(page,open){
  if(await page.locator('#session-library').evaluate(element=>element.open)!==open)
    await page.locator('#session-library > summary').click();
}
async function librarySettled(page){
  await page.waitForFunction(()=>{
    const root=document.querySelector('#session-library');
    return root?.getAttribute('aria-busy')==='false'
      &&['ready','incompatible','incomplete','storage-error'].includes(root.dataset.state);
  },null,{timeout:300000});
  const state=await page.locator('#session-library').evaluate(element=>({state:element.dataset.state,
    status:element.querySelector('[data-session="status"]').textContent,
    id:element.querySelector('[data-session="active"]').dataset.id,
    point:element.querySelector('[data-session="active"]').dataset.point,
    selected:element.querySelector('[data-session="sessions"]').value,
    selectedPoint:element.querySelector('[data-session="points"]').value}));
  assert.equal(state.state,'ready',JSON.stringify(state));return state;
}
async function saveAndOpenVisibleLibrary(page,output,source){
  await libraryDrawer(page,true);
  await page.locator('[data-session="gpu-capture"]').click();
  const saved=await librarySettled(page);
  assert.match(saved.id,/^gpu-session-/);assert.match(saved.point,/^gpu-point-/);
  assert.equal(saved.selected,saved.id);assert.equal(saved.selectedPoint,saved.point);
  const manifest=await page.evaluate(async id=>{
    const {SessionStore}=await import('/session-store.js'),store=await SessionStore.open();
    try{return JSON.parse(new TextDecoder().decode((await store.openSession(id)).manifest));}
    finally{await store.close();}
  },saved.id);
  assert.equal(manifest.checkpoints.length,1);assert.equal(manifest.checkpoints[0].id,saved.point);
  await page.locator('[data-session="open"]').click();
  const opened=await librarySettled(page);
  assert.equal(opened.id,saved.id);assert.equal(opened.point,saved.point);
  await waitReopenedDesktop(page,source.owner.key);await libraryDrawer(page,false);
  const observed=await observe(page,'e9-gpu-library-opened',output);
  assert.notEqual(observed.gpu.epoch,source.gpu.epoch,'native saved epoch advances in the new library worker');
  return {saved,opened,position:manifest.checkpoints[0].position,savedGpuEpoch:source.gpu.epoch,observed};
}
async function reopenVisibleLibraryFromGeneralPage(page,saved,output,oldOwner){
  const general=new URL(page.url());general.search='?noAutoBoot=1';general.hash='ide';
  await page.goto(general.href,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>globalThis.__ready===true,null,{timeout:60000});
  await libraryDrawer(page,true);await librarySettled(page);
  await page.locator('[data-session="sessions"]').selectOption(saved.id);
  await page.waitForFunction(id=>document.querySelector('[data-session="sessions"]').value===id
    &&document.querySelector('#session-library').dataset.state==='ready',saved.id,{timeout:300000});
  await page.locator('[data-session="points"]').selectOption(saved.point);
  await Promise.all([
    page.waitForURL(url=>url.searchParams.get('gpuSessionId')===saved.id
      &&url.searchParams.get('gpuSessionPoint')===saved.point,{waitUntil:'domcontentloaded',timeout:300000}),
    page.locator('[data-session="open"]').click(),
  ]);
  await waitReopenedDesktop(page,oldOwner);
  const active=await librarySettled(page);
  assert.equal(active.id,saved.id);assert.equal(active.point,saved.point);
  assert.equal(active.selected,saved.id);assert.equal(active.selectedPoint,saved.point);
  await libraryDrawer(page,false);
  return {url:page.url(),active,observed:await observe(page,'e9-gpu-library-route-reopened',output)};
}

export async function verifyGpuSessionDesktop(page,guestCommand,output,archive){
  const report={task:'E9-T17',scope:'original Omarchy Linux/Mesa desktop, current GPU worker, public canvas and trusted guest input',
    status:'running',database,id,points:[],checks:[]};
  const save=()=>fs.writeFile(path.join(output,'e9-gpu-session-desktop.json'),JSON.stringify(report,null,2)+'\n');
  try{
    const initial=await observe(page,'e9-gpu-desktop-initial',output);
    assert.equal(initial.restored,false,'cold real desktop, not the retained historical factory');
    report.guestRenderer=await command(page,guestCommand,'/opt/virgl-proof/eglinfo -B -p gbm -a gles');
    assert.match(report.guestRenderer.stdout,/virgl\s*\(/);
    assert.doesNotMatch(report.guestRenderer.stdout,/llvmpipe|softpipe|lavapipe/i);
    const typed=await verifyPublicDesktopInput(page,guestCommand,output,{name:'e9-gpu-desktop-original-input',
      initialClockMode:initial.clock.mode,prepareFactory:true,barActions:false,barContentRequired:false,delay:0,text:first,markerAbsent:absent(firstPath),
      markerRead:present(firstPath),expected:'PRESENT',
      beforeTyping:async({foot})=>{
        report.originalFootPid=foot.pid;
        report.points.push({name:'before-input',capture:await page.evaluate(({id,database})=>
          wvmDemo.captureGpuSession(id,'before-input',database),{id,database})});
        report.before=await observe(page,'e9-gpu-before-input',output);await save();
      }});
    report.typed=typed;
    await command(page,guestCommand,'sync');
    report.points.push({name:'after-input',capture:await page.evaluate(({id,database})=>
      wvmDemo.captureGpuSession(id,'after-input',database),{id,database})});
    report.after=await observe(page,'e9-gpu-after-input',output);
    assert.notEqual(report.before.screen.sha256,report.after.screen.sha256,'actual desktop positions have distinct scanout pixels');
    report.originalSession=await fingerprint(page);
    const stored=report.originalSession.manifest;
    report.descriptors=await page.evaluate(async({id,database})=>{
      const {SessionStore}=await import('/session-store.js'),{readCheckpointObject}=await import('/session-checkpoints.js');
      const {decodeCheckpointData}=await import('/renderer/virgl-command/checkpoint-codec.mjs');
      const store=await SessionStore.open(database);
      try{const manifest=JSON.parse(new TextDecoder().decode((await store.openSession(id)).manifest));
        const descriptors=[];
        for(const point of manifest.checkpoints){const bytes=await readCheckpointObject(store,point.machine,4096);
          if(new TextDecoder().decode(bytes.subarray(0,8))!=='WVGKEY01')throw Error('descriptor framing');
          descriptors.push({id:point.id,value:decodeCheckpointData(bytes.subarray(8))});}
        return descriptors;
      }finally{await store.close();}
    },{id,database});
    for(const [index,row]of report.descriptors.entries()){
      const point=stored.checkpoints[index],descriptor=row.value;
      assert.equal(row.id,point.id);assert.deepEqual(descriptor.position,point.position);
      assert.deepEqual(descriptor.pair,point.gpu);assert.equal(descriptor.diskRoot,point.disk_root);
      assert.equal(descriptor.profileSha256,stored.machine.gpu.profile);
      assert.match(descriptor.rendererSha256,/^[0-9a-f]{64}$/);
      assert.match(descriptor.nativeSha256,/^[0-9a-f]{64}$/);assert.match(descriptor.diskSha256,/^[0-9a-f]{64}$/);
    }
    report.manifest={id:stored.id,clock:stored.policy.clock,profile:stored.policy.profile,
      checkpoints:stored.checkpoints.map(point=>({id:point.id,position:point.position,
        disk_root:point.disk_root,gpu:point.gpu,machine:point.machine}))};
    assert.deepEqual(stored.checkpoints.map(point=>point.id),['before-input','after-input']);
    assert.notEqual(stored.checkpoints[0].gpu.sha256,stored.checkpoints[1].gpu.sha256,'actual RAM/GPU pairs differ');
    assert.notEqual(stored.checkpoints[0].disk_root,stored.checkpoints[1].disk_root,'trusted file write changes historical disk root');
    assert.ok(BigInt(stored.checkpoints[0].position.transition)<BigInt(stored.checkpoints[1].position.transition));
    assert.equal(report.typed.status,'passed','trusted input completed before read-only evidence handoff');
    report.retainedObjects=await archive.capture(page,report.originalSession);await save();
    report.preflight=await page.evaluate(async({id,database})=>{
      const {SessionStore}=await import('/session-store.js'),{SessionGpuCheckpoints}=await import('/session-gpu-checkpoints.js');
      const store=await SessionStore.open(database);
      try{await store.withReadLease(()=>new SessionGpuCheckpoints(store).admit(id,'before-input','0'.repeat(64),'0'.repeat(64)));
        return {accepted:true};}
      catch(error){return {accepted:false,error:String(error)};}
      finally{await store.close();}
    },{id,database});
    assert.equal(report.preflight.accepted,false,'foreign runtime refused before current owner retires');
    assert.equal((await page.evaluate(()=>__linuxCtl.gpuStats())).epoch,report.after.gpu.epoch,
      'foreign runtime preserves the running desktop');
    assert.equal(await page.evaluate(()=>wvmDemo.guestSession().key),report.after.owner.key);
    report.afterBuildRefusal=await fingerprint(page);assert.deepEqual(report.afterBuildRefusal,report.originalSession);
    await page.evaluate(async()=>{await __linuxCtl.pause();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
    report.beforeHostRefusal=await observe(page,'e9-gpu-before-host-refusal',output);
    report.hostPreflight=await page.evaluate(async({id,database})=>{
      const original=WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter=function(parameter){
        return parameter===this.MAX_TEXTURE_SIZE?2048:original.call(this,parameter);
      };
      try{
        await wvmDemo.restoreGpuSession(id,'before-input',database);
        return {accepted:true};
      }catch(error){return {accepted:false,error:String(error),epoch:(await __linuxCtl.gpuStats()).epoch};}
      finally{WebGL2RenderingContext.prototype.getParameter=original;}
    },{id,database});
    assert.equal(report.hostPreflight.accepted,false,'incompatible physical GPU refused before retirement');
    assert.match(report.hostPreflight.error,/saved limit|WebGL2 limits/);
    assert.equal(report.hostPreflight.epoch,report.after.gpu.epoch,'host preflight preserves original worker');
    report.afterHostRefusal=await observe(page,'e9-gpu-after-host-refusal',output);
    assert.equal(report.afterHostRefusal.owner.key,report.beforeHostRefusal.owner.key);
    assert.equal(report.afterHostRefusal.screen.sha256,report.beforeHostRefusal.screen.sha256);
    report.afterHostSession=await fingerprint(page);assert.deepEqual(report.afterHostSession,report.originalSession);
    await page.evaluate(()=>__linuxCtl.resume());
    report.crosswires=[];
    for(const component of ['disk_root','gpu','bootargs']){
      const candidate='e9-t17-crosswire-'+component;
      await page.evaluate(async({id,database,candidate,component})=>{
        const {SessionStore}=await import('/session-store.js'),{sessionValidateManifest}=await import('/session-pkg/wasm_vm_session.js');
        const {readCheckpointObject,checkpointReference,checkpointChunks}=await import('/session-checkpoints.js');
        const store=await SessionStore.open(database);let writer;
        try{const manifest=JSON.parse(new TextDecoder().decode((await store.openSession(id)).manifest));
          manifest.id=candidate;writer=await store.writer(candidate);
          if(component==='bootargs'){
            const vm=manifest.assets.find(asset=>asset.role==='vm');
            const config=JSON.parse(new TextDecoder().decode(await readCheckpointObject(store,vm.content,8*1048576)));
            config.bootargs+=' verifier_incompatible_boot=1';
            const bytes=new TextEncoder().encode(JSON.stringify(config)),ref=checkpointReference(bytes);
            await writer.put(ref,checkpointChunks(bytes));vm.content=ref;manifest.machine.vm_build=ref.sha256;
          }else manifest.checkpoints[0][component]=structuredClone(manifest.checkpoints[1][component]);
          await writer.publish(sessionValidateManifest(new TextEncoder().encode(JSON.stringify(manifest))));
        }finally{await writer?.release();await store.close();}
      },{id,database,candidate,component});
      const attack=await page.evaluate(async({candidate,database})=>{
        try{await wvmDemo.restoreGpuSession(candidate,'before-input',database);return {accepted:true};}
        catch(error){return {accepted:false,error:String(error),owner:wvmDemo.guestSession().key};}
      },{candidate,database});
      assert.equal(attack.accepted,false);assert.match(attack.error,component==='bootargs'?/configuration identity/:/keyframe component binding/);
      assert.equal(attack.owner,report.after.owner.key);
      const surviving=await fingerprint(page);assert.deepEqual(surviving,report.originalSession);
      report.crosswires.push({component,...attack,originalSha256:surviving.sha256,originalRevision:surviving.revision});
      await page.evaluate(async({candidate,database})=>{
        const {SessionStore}=await import('/session-store.js'),store=await SessionStore.open(database);
        try{await store.deleteSession(candidate);}finally{await store.close();}
      },{candidate,database});
    }
    await save();

    await page.evaluate(()=>{globalThis.__e9RetiredGpuController=__linuxCtl;});
    report.beforeRestore=await page.evaluate(({id,database})=>wvmDemo.restoreGpuSession(id,'before-input',database),{id,database});
    assert.equal(report.beforeRestore.restored,true);
    await waitReopenedDesktop(page,report.after.owner.key);
    report.beforeReopened=await observe(page,'e9-gpu-before-reopened',output);
    assert.notEqual(report.beforeReopened.owner.key,report.after.owner.key,'fresh first restore owner');
    assert.notEqual(report.beforeReopened.gpu.epoch,report.before.gpu.epoch,'native saved epoch advances in the first restore worker');
    report.retiredController=await page.evaluate(async()=>{
      try{return {accepted:await __e9RetiredGpuController.sendKeyboardEvent(1,30,1)};}
      catch(error){return {accepted:false,error:String(error)};}
    });
    assert.equal(report.retiredController.accepted,false,'retired worker cannot accept stale input');
    assert.equal(report.beforeReopened.gpu.scanout.binding.target.metadata.id,report.before.gpu.scanout.binding.target.metadata.id);
    await command(page,guestCommand,absent(firstPath));
    const footA=await command(page,guestCommand,'XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j clients');
    assert.ok(JSON.parse(footA.stdout).some(row=>row.pid===report.originalFootPid),'original Foot process identity survives RAM restore');
    report.afterFirstRestoreInput=await verifyPublicDesktopInput(page,guestCommand,output,{name:'e9-gpu-desktop-first-restore-input',
      initialClockMode:report.beforeReopened.clock.mode,prepareFactory:true,barActions:false,barContentRequired:false,delay:0,text:second,
      markerAbsent:absent(secondPath),markerRead:present(secondPath),expected:'PRESENT'});
    report.firstContinued=await observe(page,'e9-gpu-first-continued',output);
    assert.ok(report.firstContinued.gpu.counters.draws>report.beforeReopened.gpu.counters.draws,'guest draws after first restore');
    await save();

    report.afterRestore=await page.evaluate(({id,database})=>wvmDemo.restoreGpuSession(id,'after-input',database),{id,database});
    assert.equal(report.afterRestore.restored,true);
    await waitReopenedDesktop(page,report.firstContinued.owner.key);
    report.afterReopened=await observe(page,'e9-gpu-after-reopened',output);
    assert.notEqual(report.afterReopened.owner.key,report.firstContinued.owner.key,'fresh second restore owner');
    assert.notEqual(report.afterReopened.gpu.epoch,report.after.gpu.epoch,'native saved epoch advances in the second restore worker');
    assert.equal(report.afterReopened.gpu.scanout.binding.target.metadata.id,report.after.gpu.scanout.binding.target.metadata.id);
    await command(page,guestCommand,present(firstPath));
    await command(page,guestCommand,absent(secondPath));
    report.afterSecondRestoreInput=await verifyPublicDesktopInput(page,guestCommand,output,{name:'e9-gpu-desktop-second-restore-input',
      initialClockMode:report.afterReopened.clock.mode,prepareFactory:true,barActions:false,barContentRequired:false,delay:0,text:third,
      markerAbsent:absent(thirdPath),markerRead:present(thirdPath),expected:'PRESENT'});
    report.secondContinued=await observe(page,'e9-gpu-second-continued',output);
    assert.ok(report.secondContinued.gpu.counters.draws>report.afterReopened.gpu.counters.draws,'guest draws after second restore');
    report.library=await saveAndOpenVisibleLibrary(page,output,report.secondContinued);
    await command(page,guestCommand,present(firstPath));
    await command(page,guestCommand,present(thirdPath));
    await command(page,guestCommand,absent(secondPath));
    await save();
    await page.evaluate(()=>wvmDemo.loseGpuContext('now'));
    await page.waitForFunction(async()=>Boolean((await __linuxCtl.gpuStats()).lost),null,{timeout:30000});
    report.contextLoss=await page.evaluate(async({id,database})=>{
      try{await wvmDemo.captureGpuSession(id,'lost-context',database);return {accepted:true};}
      catch(error){return {accepted:false,error:String(error)};}
    },{id,database});
    assert.equal(report.contextLoss.accepted,false,'lost context cannot publish a desktop point');
    assert.match(report.contextLoss.error,/unavailable|lost|qualified|ready/);
    const surviving=await page.evaluate(async({id,database})=>{
      const {SessionStore}=await import('/session-store.js'),store=await SessionStore.open(database);
      try{return JSON.parse(new TextDecoder().decode((await store.openSession(id)).manifest)).checkpoints.map(point=>point.id);}
      finally{await store.close();}
    },{id,database});
    assert.deepEqual(surviving,['before-input','after-input'],'both earlier points survive rejected capture');
    report.afterContextLoss=await fingerprint(page);assert.deepEqual(report.afterContextLoss,report.originalSession);
    report.libraryReopened=await reopenVisibleLibraryFromGeneralPage(page,report.library.saved,output,
      report.library.observed.owner.key);
    assert.notEqual(report.libraryReopened.observed.documentTimeOrigin,report.library.observed.documentTimeOrigin,
      'general-page Open navigates to a fresh desktop document');
    assert.notEqual(report.libraryReopened.observed.gpu.epoch,report.library.savedGpuEpoch,
      'native saved epoch advances after public library navigation');
    await command(page,guestCommand,present(firstPath));
    await command(page,guestCommand,present(thirdPath));
    await command(page,guestCommand,absent(secondPath));
    const routePath='/home/omarchy/.e9t17-route';
    report.routeInput=await verifyPublicDesktopInput(page,guestCommand,output,{name:'e9-gpu-desktop-route-input',
      initialClockMode:report.libraryReopened.observed.clock.mode,prepareFactory:true,barActions:false,barContentRequired:false,delay:0,
      text:'touch '+routePath,markerAbsent:absent(routePath),markerRead:present(routePath),expected:'PRESENT'});
    report.routeContinued=await observe(page,'e9-gpu-route-continued',output);
    assert.ok(report.routeContinued.gpu.counters.draws>report.libraryReopened.observed.gpu.counters.draws,
      'actual guest renders after the public library navigation restore');
    report.status='passed';await save();return report;
  }catch(error){report.status='failed';report.failure=error.stack||String(error);await save();throw error;}
}

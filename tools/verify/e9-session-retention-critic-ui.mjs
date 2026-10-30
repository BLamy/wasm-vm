// Fresh-critic regressions over real storage and the shipped visible controls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function checkRetentionLibraryCritic(page, fixture, {url, output}) {
const out=path.resolve(output);await fs.mkdir(out,{recursive:true});let failure;
const control=name=>page.locator(`[data-session="${name}"]`);
const idle=()=>page.waitForFunction(()=>window.library&&!library.busy&&library.root.dataset.state!=='loading');
const click=async name=>{await control(name).click();await idle();};
const report={status:'running',scope:'Actual IndexedDB and visible deletion/cleanup controls; injected display-label quota and controller/save failure at the existing library boundary, not a guest-quota proof',checks:{}};
try{
  await page.goto(url);
  await page.evaluate(async fixture=>{
    const {SessionStore}=await import('./session-store.js'),{mountSessionLibrary}=await import('./session-library.js');
    const store=await SessionStore.open();const rows=[];
    for(const id of ['ui-parent','ui-sibling']){
      const w=await store.writer(id);for(const item of fixture.shared)await w.put(item.ref,[new Uint8Array(item.bytes)]);
      await w.publish(new TextEncoder().encode(JSON.stringify({...fixture.template,id})));await w.release();rows.push({id,name:id,started:1,updated:1,points:[],draft:false});
    }
    await store.close();localStorage.setItem('wasm-vm.session-library.v1',JSON.stringify({version:1,rows}));
    window.owner=null;window.library=await mountSessionLibrary(document.querySelector('#session-library'),{current:()=>owner});
    window.raw=await new Promise((resolve,reject)=>{const r=indexedDB.open('wasm-vm-sessions-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  },fixture);
  await control('sessions').selectOption('ui-parent');await idle();
  await page.evaluate(async()=>{window.held=await library.store.writer('ui-parent');});
  page.once('dialog',d=>d.accept());await click('delete');
  report.checks.busy=await page.evaluate(async()=>({state:library.root.dataset.state,message:library.controls.status.textContent,preserved:(await library.store.openSession('ui-parent')).revision}));
  assert.equal(report.checks.busy.state,'storage-error');assert.match(report.checks.busy.message,/Storage is busy/);assert.equal(report.checks.busy.preserved,'1');
  await page.evaluate(()=>held.release());
  const leaf=fixture.shared[5];
  await page.evaluate(async hash=>{await new Promise((resolve,reject)=>{const tx=raw.transaction('chunks','readwrite',{durability:'strict'});tx.objectStore('chunks').delete(hash);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});},leaf.ref.sha256);
  page.once('dialog',d=>d.accept());await click('delete');
  report.checks.refused=await page.evaluate(async()=>({state:library.root.dataset.state,message:library.controls.status.textContent,parent:await library.store.openSession('ui-parent'),sibling:(await library.store.openSession('ui-sibling')).revision,cleanupEnabled:!library.controls.cleanup.disabled,deleteEnabled:!library.controls.delete.disabled}));
  assert.equal(report.checks.refused.state,'storage-error');assert.match(report.checks.refused.message,/Cleanup refused:.*Repair or delete/);assert.equal(report.checks.refused.parent,null);assert.equal(report.checks.refused.sibling,'1');assert.equal(report.checks.refused.cleanupEnabled,true);assert.equal(report.checks.refused.deleteEnabled,true);
  await page.locator('#session-library').screenshot({path:path.join(out,'cleanup-refused.png')});
  await page.evaluate(async leaf=>{await new Promise((resolve,reject)=>{const tx=raw.transaction('chunks','readwrite',{durability:'strict'});tx.objectStore('chunks').put(new Blob([new Uint8Array(leaf.bytes)]),leaf.ref.sha256);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});},leaf);
  await click('cleanup');report.checks.cleanupRetry=await control('status').innerText();assert.match(report.checks.cleanupRetry,/Cleanup completed/);
  await page.evaluate(async fixture=>{
    const id='ui-label-victim',w=await library.store.writer(id);await w.publish(new TextEncoder().encode(JSON.stringify({...fixture.template,id})));await w.release();
    const next=new Map(library.metadata);next.set(id,{id,name:'Label victim',started:1,updated:1,points:[],draft:false});library.persistMetadata(next);await library.refresh(id);
    window.originalSetItem=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key==='wasm-vm.session-library.v1'&&!JSON.parse(value).rows.some(row=>row.id===id))throw new DOMException('injected deletion-label quota','QuotaExceededError');return originalSetItem.call(this,key,value);};
  },fixture);
  page.once('dialog',d=>d.accept());await click('delete');
  report.checks.labelFailure=await page.evaluate(async()=>({state:library.root.dataset.state,message:library.controls.status.textContent,row:await library.store.openSession('ui-label-victim'),label:[...library.controls.sessions.options].find(x=>x.value==='ui-label-victim')?.textContent,openDisabled:library.controls.open.disabled}));
  assert.equal(report.checks.labelFailure.row,null);assert.equal(report.checks.labelFailure.state,'storage-error');assert.match(report.checks.labelFailure.message,/display label could not be removed; retry Delete/);assert.match(report.checks.labelFailure.label,/incomplete/);assert.equal(report.checks.labelFailure.openDisabled,true);
  await page.locator('#session-library').screenshot({path:path.join(out,'label-delete-retry.png')});
  await page.evaluate(()=>{Storage.prototype.setItem=originalSetItem;});
  await control('sessions').selectOption('ui-label-victim');await idle();page.once('dialog',d=>d.accept());await click('delete');
  report.checks.labelRetry=await control('sessions').locator('option[value="ui-label-victim"]').count();assert.equal(report.checks.labelRetry,0);
  report.checks.readFailure=await page.evaluate(async()=>{let code;try{await library.store.withReadLease(()=>{throw Error('bounded read failure');});}catch(e){code=e.message;}return {code,collected:await library.store.collectGarbage(),locks:(await navigator.locks.query()).held};});
  assert.equal(report.checks.readFailure.code,'bounded read failure');assert.equal(report.checks.readFailure.collected.collected,true);assert.deepEqual(report.checks.readFailure.locks,[]);
  report.checks.retryFailure=await page.evaluate(async()=>{
    let calls=0,paused=true;const controller={isPaused:async()=>{calls++;return paused;},pause:async()=>{calls++;paused=true;},softwareCheckpointConfiguration:async()=>{calls++;return {};},captureSoftwareCheckpoint:async()=>{calls++;return new Uint8Array(0);},resume:async()=>{calls++;paused=false;}};
    owner={controller,ready:true,profile:true};const opened=await library.store.openSession('ui-sibling');library.pausedRecording={id:'ui-sibling',controller,revision:opened.revision,prefixHash:library.hash(opened.manifest)};
    library.active={id:'ui-sibling',point:'initial',controller,unsaved:true,running:false};const actual=library.checkpoints.save;library.checkpoints.save=async()=>{throw Error('bounded retry-save failure');};
    await library.run(()=>library.retry(),'capturing');library.checkpoints.save=actual;
    const after=await library.store.openSession('ui-sibling'),r={calls,message:library.controls.status.textContent,paused:!!library.pausedRecording,recording:!!library.recording,revision:after.revision,manifestUnchanged:library.hash(after.manifest)===library.hash(opened.manifest),locks:(await navigator.locks.query()).held};
    await library.run(()=>library.resume(),'resuming');r.resumeMessage=library.controls.status.textContent;library.render();return r;
  });
  assert.equal(report.checks.retryFailure.paused,true);assert.equal(report.checks.retryFailure.recording,false);assert.equal(report.checks.retryFailure.manifestUnchanged,true);assert.deepEqual(report.checks.retryFailure.locks,[]);assert.match(report.checks.retryFailure.resumeMessage,/Recording remains paused/);
  await control('sessions').selectOption('ui-sibling');await idle();page.once('dialog',d=>d.accept());await click('delete');
  report.checks.deletePaused=await page.evaluate(()=>({paused:!!library.pausedRecording,active:library.active,selected:library.selected,message:library.controls.status.textContent}));
  assert.equal(report.checks.deletePaused.paused,false);assert.equal(report.checks.deletePaused.active.unsaved,true);assert.equal(report.checks.deletePaused.active.point,null);assert.equal(report.checks.deletePaused.selected,'');
  report.status='passed';
}catch(e){report.status='failed';report.failure={message:e.message,stack:e.stack};failure=e;}
finally {
  await page.evaluate(async()=>{raw?.close();await library?.store.close();}).catch(()=>{});
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
}
if(failure)throw failure;
return report;
}

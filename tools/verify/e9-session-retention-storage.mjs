// Real IndexedDB reachability/limit proofs. Synthetic payloads test storage, not a model VM.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {checkSessionStoreCritic} from './e9-session-store-critic.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = bytes => ({ref: {sha256: sha(bytes), length: String(bytes.length)}, bytes: [...bytes]});
export async function retentionFixture(root) {
  const directory = path.join(root, 'crates/storage/tests/session_manifest/fixtures');
  const template = JSON.parse(await fs.readFile(path.join(directory, 'manifest-v1.json'), 'utf8'));
  const assets = ['vm-runtime-v1', 'wasm-module-v1', 'kernel-v1', 'base-image-v1'].map(value => blob(Buffer.from(value)));
  const sharedMachine = blob(Buffer.from('checkpoint-v1')), privateMachine = blob(Buffer.from('parent-only-machine-v2\n'));
  const sharedLeaves = [0x51, 0x52].map(value => blob(Buffer.alloc(4096, value))), privateLeaf = blob(Buffer.alloc(4096, 0x53));
  const diskRoot = (generation, leaves) => blob(Buffer.from(JSON.stringify({version: {major: 1, minor: 0}, base: template.machine.base_image,
    image_len: '8192', generation: String(generation), blocks: leaves.map((leaf, index) => ({index: String(index), sha256: leaf.ref.sha256}))})));
  const sharedRoot = diskRoot(1, sharedLeaves), privateRoot = diskRoot(2, [sharedLeaves[0], privateLeaf]);
  const payload = blob(Buffer.from('indirect event payload retained by sibling\n'));
  const events = JSON.parse(await fs.readFile(path.join(directory, 'chunk-v1.json'), 'utf8'));
  events[0].payload = {storage: 'blob', content: payload.ref};
  const eventChunk = blob(Buffer.from(JSON.stringify(events)));
  template.extensions = []; template.events[0].content = eventChunk.ref;
  template.checkpoints[0].disk_root = sharedRoot.ref.sha256;
  const shared = [...assets, sharedMachine, ...sharedLeaves, sharedRoot, payload, eventChunk];
  const unique = [privateMachine, privateLeaf, privateRoot];
  return {template, shared, unique, sharedMachine, privateMachine, sharedRoot, privateRoot, payload,
    expectedSharedBytes: shared.reduce((sum, entry) => sum + entry.bytes.length, 0)};
}

export async function checkRetentionStorage(page, {namespace, fixture}) {
  const result = await page.evaluate(async ({namespace, fixture}) => {
    const {SessionStore, SESSION_DATABASE_VERSION} = await import('./session-store.js');
    const encode = value => new TextEncoder().encode(JSON.stringify(value));
    const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    const refused = async action => {try {await action(); return 'accepted';} catch (error) {return error.code;}};
    let store = await SessionStore.open(namespace);
    const db = await new Promise((resolve, reject) => {const r = indexedDB.open(namespace); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);});
    const read = (table, key) => new Promise((resolve, reject) => {const r = db.transaction(table).objectStore(table).get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);});
    const write = (table, key, value) => new Promise((resolve, reject) => {
      const tx = db.transaction(table, 'readwrite', {durability: 'strict'}), rows = tx.objectStore(table);
      if (value === undefined) rows.delete(key); else rows.put(value, key);
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
    const keys = table => new Promise((resolve, reject) => {const r = db.transaction(table).objectStore(table).getAllKeys(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);});
    const put = async (writer, blobs) => {for (const entry of blobs) await writer.put(entry.ref, [new Uint8Array(entry.bytes)]);};
    const saved = async id => {const opened = await store.openSession(id); return opened && {revision: opened.revision, hash: await digest(opened.manifest)};};
    const parent = {...structuredClone(fixture.template), id: 'retention-parent'}, sibling = {...structuredClone(parent), id: 'retention-sibling'};
    let writer = await store.writer(parent.id);
    await put(writer, fixture.shared); await writer.publish(encode(parent));
    const initial = await saved(parent.id), initialStats = await store.statistics();
    const blockedByWriter = await refused(() => store.deleteSession(parent.id));
    const duplicateWriter = await refused(() => store.writer(parent.id));
    await writer.release();
    const siblingWriter = await store.writer(sibling.id); await siblingWriter.publish(encode(sibling)); await siblingWriter.release();
    const siblingOriginal = await saved(sibling.id);
    const duplicated = await store.statistics();
    let readEntered, finishRead;
    const entered = new Promise(resolve => {readEntered = resolve;}), finish = new Promise(resolve => {finishRead = resolve;});
    const reading = store.withReadLease(async () => {readEntered(); await finish;});
    await entered; const blockedByRead = await refused(() => store.collectGarbage()); finishRead(); await reading;
    const invalidLimits = [];
    for (const limits of [null, {}, {maxBytes: 0, maxCheckpoints: 1}, {maxBytes: 1048576, maxCheckpoints: 0},
      {maxBytes: 1048576, maxCheckpoints: 4097}, {maxBytes: 1048576, maxCheckpoints: 1, extra: true}]) {
      invalidLimits.push(await refused(() => store.setRetention(limits)));
    }
    await store.setRetention({maxBytes: 1048576, maxCheckpoints: 1});
    writer = await store.writer(parent.id); await put(writer, fixture.unique);
    const extended = structuredClone(parent);
    extended.end.transition = String(BigInt(extended.end.transition) + 1n); extended.end.retired = String(BigInt(extended.end.retired) + 1n);
    extended.checkpoints.push({id: 'parent-later', position: {...extended.end}, next_sequence: String(BigInt(extended.end.sequence) + 1n),
      machine: fixture.privateMachine.ref, disk_root: fixture.privateRoot.ref.sha256, gpu: null});
    const pointLimit = await refused(() => writer.publish(encode(extended))), prefixAfterLimit = await saved(parent.id);
    // A real strict transaction rejects the next unique MiB before either chunk or counter commits.
    const oversized = new Uint8Array(1048576).fill(0x71), oversizedRef = {sha256: await digest(oversized), length: String(oversized.length)};
    const beforeByteLimit = await store.statistics(), byteLimit = await refused(() => writer.put(oversizedRef, [oversized]));
    const afterByteLimit = await store.statistics();
    await store.setRetention({maxBytes: 2097152, maxCheckpoints: 2}); await writer.publish(encode(extended)); await writer.release();
    const parentExtended = await saved(parent.id), beforeDelete = await store.statistics();
    const deleted = await store.deleteSession(parent.id), afterDelete = await store.statistics(), siblingAfter = await saved(sibling.id);
    const kept = [];
    for (const entry of fixture.shared) {
      const bytes = [];
      for await (const part of store.stream(entry.ref)) bytes.push(...part);
      kept.push({sha256: entry.ref.sha256, actual: await digest(new Uint8Array(bytes)), bytes});
    }
    const removed = [];
    for (const entry of fixture.unique) removed.push({sha256: entry.ref.sha256, code: await refused(() => store.objectReference(entry.ref.sha256))});
    const payloadStillThere = await store.objectReference(fixture.payload.ref.sha256);

    // Interrupt the mark/sweep boundary with one real out-of-band metadata corruption.
    const orphan = new Uint8Array([10, 20, 30, 40]), orphanRef = {sha256: await digest(orphan), length: '4'};
    const orphanWriter = await store.writer('retention-orphan'); await orphanWriter.put(orphanRef, [orphan]); await orphanWriter.release();
    const beforeSweep = {objects: await keys('objects'), chunks: await keys('chunks'), stats: await store.statistics()};
    const originalDescriptor = await read('objects', fixture.sharedMachine.ref.sha256);
    let injected;
    globalThis.__e9SessionStoreProbe = event => {
      if (event.phase !== 'gc-marked') return;
      delete globalThis.__e9SessionStoreProbe;
      const changed = structuredClone(originalDescriptor); changed.parts[0].sha256 = '0'.repeat(64);
      injected = write('objects', fixture.sharedMachine.ref.sha256, changed);
    };
    const changedDuringSweep = await refused(() => store.collectGarbage()); await injected;
    delete globalThis.__e9SessionStoreProbe;
    const afterFailedSweep = {objects: await keys('objects'), chunks: await keys('chunks'), stats: await store.statistics()};
    await write('objects', fixture.sharedMachine.ref.sha256, originalDescriptor);

    const doomedWriter = await store.writer('retention-doomed');
    await doomedWriter.publish(encode({...sibling, id: 'retention-doomed'})); await doomedWriter.release();
    // Missing surviving machine data blocks collection instead of treating the session as dead.
    const originalChunk = await read('chunks', fixture.sharedMachine.ref.sha256);
    await write('chunks', fixture.sharedMachine.ref.sha256, undefined);
    const unavailable = await store.list(), blockedMissing = await refused(() => store.collectGarbage());
    const partialDelete = await store.deleteSession('retention-doomed'), deletedDoomed = await store.openSession('retention-doomed');
    const orphanPreserved = await store.objectReference(orphanRef.sha256);
    await write('chunks', fixture.sharedMachine.ref.sha256, originalChunk);
    const retry = await store.collectGarbage();
    const unsupported = {...sibling, id: 'retention-optional', extensions: [{kind: 'annotation.future', required: false, bytes: [17]}]};
    const unsupportedWriter = await store.writer(unsupported.id); await unsupportedWriter.publish(encode(unsupported)); await unsupportedWriter.release();
    const unsupportedCleanup = await refused(() => store.collectGarbage()), removedUnsupported = await store.deleteSession(unsupported.id);
    const badRoot = new TextEncoder().encode('malformed root'), badRef = {sha256: await digest(badRoot), length: String(badRoot.length)};
    const bad = structuredClone(sibling); bad.id = 'retention-bad-root'; bad.checkpoints[0].disk_root = badRef.sha256;
    const badWriter = await store.writer(bad.id); await badWriter.put(badRef, [badRoot]); await badWriter.publish(encode(bad)); await badWriter.release();
    const badRootCleanup = await refused(() => store.collectGarbage()), removedBadRoot = await store.deleteSession(bad.id);
    const finalSibling = await saved(sibling.id), finalStats = await store.statistics();
    await store.close(); db.close();
    store = await SessionStore.open(namespace); const reopened = await saved(sibling.id), reopenedStats = await store.statistics(); await store.close();
    return {version: SESSION_DATABASE_VERSION, initial, initialStats, duplicated, siblingOriginal, blockedByWriter, duplicateWriter, blockedByRead, invalidLimits,
      pointLimit, prefixAfterLimit, beforeByteLimit, byteLimit, afterByteLimit, parentExtended, beforeDelete, deleted, afterDelete, siblingAfter,
      kept, removed, payloadStillThere, beforeSweep, changedDuringSweep, afterFailedSweep, unavailable, blockedMissing, orphanPreserved, retry,
      partialDelete, deletedDoomed, unsupportedCleanup, removedUnsupported, badRootCleanup, removedBadRoot, finalSibling, finalStats, reopened, reopenedStats};
  }, {namespace, fixture});
  assert.equal(result.version, 2);
  assert.equal(result.initialStats.payloadBytes, fixture.expectedSharedBytes);
  assert.equal(result.duplicated.payloadBytes, fixture.expectedSharedBytes, 'shared data must be counted once');
  assert.equal(result.blockedByWriter, 'MaintenanceBusy'); assert.equal(result.blockedByRead, 'MaintenanceBusy'); assert.equal(result.duplicateWriter, 'WriterBusy');
  assert.ok(result.invalidLimits.every(code => code === 'Retention'));
  assert.equal(result.pointLimit, 'RetentionLimit'); assert.deepEqual(result.prefixAfterLimit, result.initial);
  assert.equal(result.byteLimit, 'RetentionLimit'); assert.deepEqual(result.afterByteLimit, result.beforeByteLimit);
  assert.equal(result.parentExtended.revision, '2'); assert.equal(result.deleted.deleted, true); assert.equal(result.deleted.collected, true);
  assert.equal(result.afterDelete.payloadBytes, fixture.expectedSharedBytes); assert.ok(result.deleted.reclaimedBytes > 0);
  for (const state of [result.siblingAfter, result.finalSibling, result.reopened]) assert.deepEqual(state, result.siblingOriginal);
  for (const entry of fixture.shared) {
    const kept = result.kept.find(item => item.sha256 === entry.ref.sha256);
    assert.equal(kept.actual, entry.ref.sha256); assert.deepEqual(kept.bytes, entry.bytes);
  }
  assert.ok(result.removed.every(entry => entry.code === 'MissingObject'));
  assert.deepEqual(result.payloadStillThere, fixture.payload.ref);
  assert.equal(result.changedDuringSweep, 'Corrupt'); assert.deepEqual(result.afterFailedSweep, result.beforeSweep, 'partial sweep must roll back');
  assert.ok(result.unavailable.unavailable.some(row => row.id === 'retention-sibling'));
  assert.equal(result.blockedMissing, 'Corrupt'); assert.equal(result.orphanPreserved.length, '4'); assert.equal(result.retry.collected, true);
  assert.equal(result.partialDelete.deleted, true); assert.equal(result.partialDelete.collected, false); assert.equal(result.partialDelete.error.code, 'Corrupt'); assert.equal(result.deletedDoomed, null);
  assert.equal(result.unsupportedCleanup, 'UnsupportedRetention'); assert.equal(result.removedUnsupported.collected, true);
  assert.equal(result.badRootCleanup, 'DiskRoot'); assert.equal(result.removedBadRoot.collected, true);
  assert.equal(result.finalStats.payloadBytes, fixture.expectedSharedBytes); assert.deepEqual(result.reopenedStats, result.finalStats);
  return result;
}

export async function checkLegacyStoreBoundary(page, root, namespace) {
  const directory = path.join(root, 'crates/storage/tests/session_manifest/fixtures');
  const template = JSON.parse(await fs.readFile(path.join(directory, 'manifest-v1.json'), 'utf8'));
  const bytes = ['vm-runtime-v1', 'wasm-module-v1', 'kernel-v1', 'base-image-v1', 'checkpoint-v1', 'e9:before\n'].map(value => Buffer.from(value));
  bytes.push(await fs.readFile(path.join(directory, 'chunk-v1.json')));
  const fixture = {template, blobs: bytes.map(blob)};
  return checkSessionStoreCritic(page, {name: namespace, fixture});
}

// Build an actual version-one database with its original published row and Blob records.
// The migration counts metadata only; all old bytes and the commit cursor must survive.
export async function checkMigration(page,{namespace,fixture}) {
  const result=await page.evaluate(async({namespace,fixture})=>{
    const {SessionStore,SESSION_DATABASE_VERSION}=await import('./session-store.js');
    const source=await SessionStore.open(namespace+'-source'),writer=await source.writer('migrated');
    for(const entry of fixture.shared)await writer.put(entry.ref,[new Uint8Array(entry.bytes)]);
    const value={...fixture.template,id:'migrated'};await writer.publish(new TextEncoder().encode(JSON.stringify(value)));await writer.release();
    const original=await source.openSession('migrated');
    const raw=await new Promise((resolve,reject)=>{const r=indexedDB.open(namespace+'-source');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const entries={};
    for(const table of ['chunks','objects','sessions'])entries[table]=await new Promise((resolve,reject)=>{
      const tx=raw.transaction(table),rows=tx.objectStore(table),keys=rows.getAllKeys(),values=rows.getAll();
      tx.oncomplete=()=>resolve(keys.result.map((key,i)=>[key,values.result[i]]));tx.onabort=()=>reject(tx.error);
    });raw.close();await source.close();
    const legacy=await new Promise((resolve,reject)=>{const r=indexedDB.open(namespace,1);
      r.onupgradeneeded=()=>{for(const table of ['chunks','objects','sessions'])r.result.createObjectStore(table);};
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await new Promise((resolve,reject)=>{const tx=legacy.transaction(['chunks','objects','sessions'],'readwrite',{durability:'strict'});
      for(const [table,rows]of Object.entries(entries))for(const [key,value]of rows)tx.objectStore(table).put(value,key);
      tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});legacy.close();
    const migrated=await SessionStore.open(namespace),saved=await migrated.openSession('migrated'),stats=await migrated.statistics();
    const matches=original.revision===saved.revision&&original.manifest.length===saved.manifest.length&&original.manifest.every((b,i)=>b===saved.manifest[i]);
    await migrated.close();return {version:SESSION_DATABASE_VERSION,matches,stats,revision:saved.revision,manifest:[...saved.manifest]};
  },{namespace,fixture});
  assert.equal(result.version,2);assert.equal(result.matches,true);assert.equal(result.stats.payloadBytes,fixture.expectedSharedBytes);assert.equal(result.revision,'1');return result;
}

export async function checkMaintenanceSchedules(context,page,url,{namespace,fixture}) {
  const other=await context.newPage();await other.goto(url,{waitUntil:'domcontentloaded'});await other.waitForFunction(()=>window.__ready===true);
  const result=[];
  try{
    for(const target of [page,other])await target.evaluate(async namespace=>{const {SessionStore}=await import('./session-store.js');window.__retentionRaceStore=await SessionStore.open(namespace);},namespace);
    for(let seed=17;seed<33;seed++){
      const mode=seed%2?'writer':'reader',delay=seed*13%7;
      await page.evaluate(async({mode,seed,delay,fixture})=>{
        const store=__retentionRaceStore;
        if(mode==='writer'){
          window.__retentionRaceLease=await store.writer('schedule-'+seed);
          await new Promise(resolve=>setTimeout(resolve,delay));
          for(const entry of fixture.shared)await __retentionRaceLease.put(entry.ref,[new Uint8Array(entry.bytes)]);
        }else{
          let entered,release;const ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
          const pending=store.withReadLease(async()=>{entered();await gate;});window.__retentionRaceLease={release:()=>{release();return pending;}};await ready;
        }
      },{mode,seed,delay,fixture});
      const busy=await other.evaluate(async()=>{try{await __retentionRaceStore.collectGarbage();return 'accepted';}catch(error){return error.code;}});
      assert.equal(busy,'MaintenanceBusy');
      await page.evaluate(async({mode,seed,fixture})=>{
        if(mode==='writer'){const manifest={...fixture.template,id:'schedule-'+seed};await __retentionRaceLease.publish(new TextEncoder().encode(JSON.stringify(manifest)));}
        await __retentionRaceLease.release();delete window.__retentionRaceLease;
      },{mode,seed,fixture});
      const after=await other.evaluate(async()=>({cleanup:await __retentionRaceStore.collectGarbage(),list:await __retentionRaceStore.list()}));
      assert.equal(after.cleanup.collected,true);assert.equal(after.list.unavailable.length,0);result.push({seed,mode,delay,busy,...after});
    }
  }finally{for(const target of [page,other])await target.evaluate(()=>window.__retentionRaceStore?.close()).catch(()=>{});await other.close();}
  return result;
}

export async function checkCleanupCrashes(context,page,url,{namespace,fixture}) {
  const result=[];
  for(const cut of ['gc-metadata-deleted','gc-before-sweep-commit']){
    await page.evaluate(async({namespace,fixture,cut})=>{
      const {SessionStore}=await import('./session-store.js'),store=await SessionStore.open(namespace),writer=await store.writer('crash-parent');
      const orphan=new Uint8Array([cut.length,1,9,7]),sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',orphan)),b=>b.toString(16).padStart(2,'0')).join('');
      try{await writer.put({sha256:sha,length:'4'},[orphan]);await writer.publish(new TextEncoder().encode(JSON.stringify({...fixture.template,id:'crash-parent'})));}
      finally{await writer.release();await store.close();}
    },{namespace,fixture,cut});
    const child=await context.newPage();await child.goto(url,{waitUntil:'domcontentloaded'});await child.waitForFunction(()=>window.__ready===true);
    const cdp=await context.newCDPSession(child);await cdp.send('Debugger.enable');
    const paused=new Promise(resolve=>cdp.once('Debugger.paused',resolve));
    const pending=child.evaluate(async({namespace,cut})=>{
      const {SessionStore}=await import('./session-store.js'),store=await SessionStore.open(namespace);
      window.__e9SessionStoreProbe=event=>{if(event.phase===cut){window.__cut=event;debugger;}};
      if(cut==='gc-metadata-deleted')await store.deleteSession('crash-parent');else await store.collectGarbage();
    },{namespace,cut}).catch(error=>({closed:error.message}));
    let timer;
    const pause=await Promise.race([paused,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('missing GC crash boundary '+cut)),30000);})]);clearTimeout(timer);
    const state=await cdp.send('Debugger.evaluateOnCallFrame',{callFrameId:pause.callFrames[0].callFrameId,expression:'JSON.stringify(window.__cut)',returnByValue:true});
    assert.equal(JSON.parse(state.result.value).phase,cut);
    const crashed=new Promise(resolve=>child.once('crash',resolve));const crash=cdp.send('Page.crash').catch(error=>({expected:error.message}));
    await Promise.race([crashed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('GC renderer did not crash')),10000);})]);clearTimeout(timer);
    await child.close();await crash;await pending;
    const recovered=await page.evaluate(async({namespace,fixture})=>{
      const {SessionStore}=await import('./session-store.js'),store=await SessionStore.open(namespace);
      try{
        const saved=await store.openSession('retention-sibling'),before=await store.statistics(),hashes=[];
        for(const entry of fixture.shared){const bytes=[];for await(const part of store.stream(entry.ref))bytes.push(...part);
          const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))),b=>b.toString(16).padStart(2,'0')).join('');hashes.push({expected:entry.ref.sha256,actual});}
        const parent=await store.openSession('crash-parent');const cleanup=await store.collectGarbage();
        return {revision:saved.revision,manifest:[...saved.manifest],before,hashes,parent:parent&&{revision:parent.revision,manifest:[...parent.manifest]},cleanup,after:await store.statistics()};
      }finally{await store.close();}
    },{namespace,fixture});
    assert.ok(recovered.hashes.every(row=>row.expected===row.actual));assert.equal(recovered.revision,'1');assert.equal(recovered.cleanup.collected,true);
    if(cut==='gc-metadata-deleted')assert.equal(recovered.parent,null);else assert.equal(recovered.parent.revision,'1');
    result.push({cut,paused:JSON.parse(state.result.value),...recovered});
  }
  return result;
}

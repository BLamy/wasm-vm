#!/usr/bin/env node
// E9-T04: real Linux file changes, immutable IndexedDB roots and private worker boots.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkDiskRootCritic,checkDiskRootIoCritic} from './e9-disk-roots-critic.mjs';
import {chromium} from '../../web/node_modules/playwright/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argument = flag => {const at = process.argv.indexOf(flag); return at < 0 ? null : process.argv[at + 1];};
assert.ok(argument('--output'));
const output = path.resolve(argument('--output')), development = process.argv.includes('--development');
const remote = argument('--url') ? new URL(argument('--url')) : null;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const web = path.join(root, 'web/dist');
const fixture = JSON.parse(await fs.readFile(path.join(web, 'session-software-fixture.json'), 'utf8'));
const imageText = await fs.readFile(path.join(web, 'session-alpine-image.json'), 'utf8');
const pinTemplate=JSON.parse(await fs.readFile(path.join(root,'crates/storage/tests/session_manifest/fixtures/manifest-v1.json'),'utf8'));
const pinPayloads=['vm-runtime-v1','wasm-module-v1','kernel-v1','base-image-v1','checkpoint-v1','e9:before\n'].map(value=>Buffer.from(value));
pinPayloads.push(await fs.readFile(path.join(root,'crates/storage/tests/session_manifest/fixtures/chunk-v1.json')));
const pinFixture={template:pinTemplate,blobs:pinPayloads.map(bytes=>({sha256:sha(bytes),length:String(bytes.length),bytes:[...bytes]}))};
assert.equal(sha(imageText), fixture.image_manifest_sha256);
const report = {task:'E9-T04', status:'running', development, head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  started:new Date().toISOString(), errors:[], checks:{}, roots:{}, guests:{}, served:[]};
let server, context, page;
const served = new Map();
await fs.mkdir(output, {recursive:true});
function runOracle(phase) {
  const result = execFileSync('python3',['tools/verify/e9-disk-roots-files.py',phase,'--output',output],{cwd:root,encoding:'utf8'});
  return result.trim();
}
const allowedExports = /^(?:before|after|fork|live)(?:\.captured\.wvod|\.restored\.wvod|\.root\.json)$|^before-again\.restored\.wvod$|^live-disk-(?:before|after)\.json$/;

async function boot(id, diskRoot = null) {
  console.log('Booting actual guest:',id);
  await page.evaluate(async ({id, diskRoot, fixture}) => {
    const {startLinuxBootWorker} = await import('./linux-worker-host.js');
    const state = {id, output:'', events:[], errors:[]};
    window.guests[id] = state;
    state.controller = await startLinuxBootWorker({manifestUrl:fixture.boot_manifest, mode:'chunked',
      imageManifestUrl:fixture.image_manifest, baseUrl:fixture.base_url, bootProfileUrl:null,
      persist:diskRoot === null, sessionDiskRoot:diskRoot, bootSnapshot:false, ramMib:fixture.ram_mib,
      // A noninteractive PID-1 shell reads the real UART without a terminal cursor handshake.
      // The kernel passes +i to init after --. Fenced commands still execute in the guest.
      bootargs:fixture.bootargs, guestClock:'icount', icountDivider:10,
      jit:true, quantum:500000,
      onOutput:bytes => {state.output+=new TextDecoder().decode(bytes);state.parser?.feed(bytes);},
      onState:value => state.events.push(value), onError:error => state.errors.push(String(error))});
  }, {id,diskRoot,fixture});
  let sampling=false;
  const progress=setInterval(async()=>{
    if(sampling)return;sampling=true;
    try{
      const observed=await page.evaluate(async id=>({id,bytes:guests[id].output.length,tail:guests[id].output.slice(-2000),
        errors:guests[id].errors,scheduler:await guests[id].controller.schedulerStats()}),id);
      await fs.writeFile(path.join(output,'guest-'+id+'-progress.json'),JSON.stringify(observed,null,2)+'\n');
      console.log('Guest progress',id,observed.bytes,'UART bytes,',observed.scheduler.retiredInstructions,'retired:',observed.tail.slice(-100));
    }catch(error){console.log('Guest observation:',error.message);}finally{sampling=false;}
  },15000);
  try {
    await page.waitForFunction(id => {
      const state = guests[id];
      return state?.errors.length || (state?.output??'').includes('Run /bin/sh as init process');
    }, id, {timeout:900000});
  }finally{clearInterval(progress);}
  const guest = await page.evaluate(id => ({output:guests[id].output,events:guests[id].events,errors:guests[id].errors}), id);
  assert.deepEqual(guest.errors, []);
  report.guests[id] = guest;
  assert.equal((await command(id, 'printf E9_ROOT_"SHELL"')).stdout.trim(), 'E9_ROOT_SHELL');
  console.log('Guest shell ready:',id);
}

async function command(id, commandText) {
  const result = await page.evaluate(async ({id,commandText}) => {
    const {createFencedRpc,formatRpcCommand} = await import('./guest-rpc.js');
    const state=guests[id], rid='e9root'+(++window.rpcSequence), parser=createFencedRpc(rid);
    const result=await new Promise((resolve,reject) => {
      const timeout=setTimeout(()=>{state.parser=null;reject(Error('actual guest command timed out: '+id+'; UART tail: '+JSON.stringify(state.output.slice(-1000))));},180000);
      state.parser={feed(bytes) {const value=parser.feed(bytes);if(value){clearTimeout(timeout);state.parser=null;resolve(value);}}};
      Promise.resolve(state.controller.sendInput(new TextEncoder().encode(formatRpcCommand(commandText,rid)))).catch(reject);
    });
    state.events.push({command:commandText,result}); return result;
  }, {id,commandText});
  assert.equal(result.exit,0,JSON.stringify({id,commandText,result}));
  return result;
}
async function file(id, expected) {
  const result=await command(id,'base64 /root/e9-session/state');
  assert.equal(Buffer.from(result.stdout.trim(),'base64').toString(),expected);
  return {base64:result.stdout.trim(),sha256:sha(Buffer.from(expected)),hex:Buffer.from(expected).toString('hex')};
}
async function capture(id, name) {
  return page.evaluate(async ({id,name}) => {
    const controller=guests[id].controller;
    await controller.pause(); const before=await controller.schedulerStats(),bytes=await controller.captureDiskDelta();
    const after=await controller.schedulerStats(),digest=await controller.stateDigest();
    if(before.retiredInstructions!==after.retiredInstructions)throw Error('disk drain executed guest instructions');
    await controller.resume();
    window.deltas[name]=bytes;
    await saveEvidence(name+'.captured.wvod',bytes);
    return {bytes:bytes.length,digest,generation:String(new DataView(bytes.buffer,bytes.byteOffset).getBigUint64(49,true)),
      before,after};
  }, {id,name});
}
async function saveRoot(name) {
  return page.evaluate(async name => {
    const captured=await roots.capture(lease,deltas[name],imageText);
    const inspected=await roots.inspect(captured.content.sha256);
    await saveEvidence(name+'.root.json',inspected.bytes);
    await saveEvidence(name+'.restored.wvod',await roots.restore(captured.content.sha256,imageText,captured.generation));
    return captured;
  }, name);
}
const privateDescriptor = captured => ({database:report.namespace,sha256:captured.content.sha256,generation:captured.generation});

async function refusalChecks(captured) {
  return page.evaluate(async captured=>{
    const {SessionDiskRoots}=await import('./session-disk-roots.js');
    const result={producers:[],corruption:[]};
    const create=()=>{
      const bytes=new Uint8Array(61+2*4104),view=new DataView(bytes.buffer);
      bytes.set(new TextEncoder().encode('WVOD1'));view.setUint32(5,4096,true);view.setBigUint64(9,536870912n,true);
      bytes.set(Uint8Array.from(JSON.parse(imageText).chunks[0].match(/../g),x=>parseInt(x,16)),17);
      // Actual base binding comes from an authenticated real root, not the first image chunk.
      view.setBigUint64(49,18446744073709551614n,true);view.setUint32(57,2,true);
      view.setBigUint64(61,0n,true);view.setBigUint64(61+4104,1n,true);
      bytes.fill(0x7a,69,61+4104);bytes.fill(0x7b,61+4104+8);return bytes;
    };
    const actual=await roots.inspect(captured.content.sha256);
    const base=Uint8Array.from(actual.root.base.match(/../g),x=>parseInt(x,16));
    for(const fault of ['mutated','detached','released']) {
      const writer=await store.writer('producer-'+fault),delta=create();delta.set(base,17);
      let release,started;const held=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});let first=true;
      const gated={async put(...args){const value=await writer.put(...args);if(first){first=false;started();await held;}return value;}};
      const pending=roots.capture(gated,delta,imageText).then(()=> 'accepted',error=>error.code);
      await entered;
      if(fault==='mutated')delta.fill(0xf0,61+4104+8);
      if(fault==='detached')structuredClone(delta.buffer,{transfer:[delta.buffer]});
      if(fault==='released')await writer.release();
      release();const code=await pending;await writer.release();result.producers.push({fault,code});
    }
    for(const change of [bytes=>bytes.subarray(0,60),bytes=>{bytes[0]^=1;return bytes;},
      bytes=>{new DataView(bytes.buffer).setUint32(5,512,true);return bytes;},
      bytes=>{new DataView(bytes.buffer).setUint32(57,65537,true);return bytes;},
      bytes=>{new DataView(bytes.buffer).setBigUint64(61+4104,0n,true);return bytes;}]) {
      const delta=create();delta.set(base,17);let writes=0,code;
      try{await roots.capture({put(){writes++;throw Error('invalid input reached persistence');}},change(delta),imageText);code='accepted';}
      catch(error){code=error.code;}
      result.producers.push({fault:'malformed',code,writes});
    }
    const leaf=actual.root.blocks[0].sha256;
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(storeDatabaseName);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const original=await new Promise((resolve,reject)=>{const r=db.transaction('chunks').objectStore('chunks').get(leaf);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const write=async fault=>new Promise((resolve,reject)=>{
      const tx=db.transaction('chunks','readwrite',{durability:'strict'}),store=tx.objectStore('chunks');
      if(fault==='missing')store.delete(leaf);else store.put(fault==='corrupt'?new Blob([new Uint8Array(4096).fill(0xfe)]):original,leaf);
      tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
    });
    try {
      for(const fault of ['corrupt','missing']) {
        await write(fault);const codes=[];
        for(const operation of ['verify','restore'])try{await roots[operation](captured.content.sha256,imageText,captured.generation);codes.push('accepted');}catch(error){codes.push(error.code);}
        result.corruption.push({fault,leaf,codes});await write('repair');
      }
    }finally{await write('repair');db.close();}
    const {SessionSha256,sessionValidateDiskRoot}=await import('./session-pkg/wasm_vm_session.js');
    const digest=bytes=>{const h=new SessionSha256();try{h.update(bytes);return h.finish();}finally{h.free();}};
    const writer=await store.writer('graph-refusals');
    try {
      const empty={version:{major:1,minor:0},base:actual.root.base,image_len:actual.root.image_len,generation:'0',blocks:[]};
      const bytes=sessionValidateDiskRoot(new TextEncoder().encode(JSON.stringify(empty)));
      const ref={sha256:digest(bytes),length:String(bytes.length)};await writer.put(ref,[bytes]);
      const wrong={...empty,blocks:[{index:'0',sha256:ref.sha256}]};
      const wrongBytes=sessionValidateDiskRoot(new TextEncoder().encode(JSON.stringify(wrong)));
      const wrongRef={sha256:digest(wrongBytes),length:String(wrongBytes.length)};await writer.put(wrongRef,[wrongBytes]);
      try{await roots.liveReferences([wrongRef.sha256,ref.sha256]);result.conflictingLength='accepted';}catch(error){result.conflictingLength=error.code;}
      try{await roots.restore(wrongRef.sha256,imageText,'0');result.wrongObjectLength='accepted';}catch(error){result.wrongObjectLength=error.code;}
      const part=new Uint8Array(1024*1024).fill(32),hasher=new SessionSha256();let hash;
      try{for(let i=0;i<13;i++)hasher.update(part);hash=hasher.finish();}finally{hasher.free();}
      const large={sha256:hash,length:String(13*part.length)};
      await writer.put(large,(function*(){for(let i=0;i<13;i++)yield part;})());
      try{await roots.inspect(large.sha256);result.metadataBound='accepted';}catch(error){result.metadataBound=error.code;}
    }finally{await writer.release();}
    try{new SessionDiskRoots({});result.badDatabase='accepted';}catch(error){result.badDatabase=error.code;}
    try{await roots.liveReferences(new Array(4097).fill(captured.content.sha256));result.rootBound='accepted';}catch(error){result.rootBound=error.code;}
    result.emptyReferences=await roots.liveReferences([]);
    const {SessionStore}=await import('./session-store.js'), closed=await SessionStore.open(storeDatabaseName);await closed.close();
    try{await closed.objectReference(captured.content.sha256);result.closed='accepted';}catch(error){result.closed=error.code;}
    result.restored=await roots.verify(captured.content.sha256,imageText,captured.generation);return result;
  },captured);
}

try {
  if (!development) assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}),'','frozen source must be clean');
  report.checks.base=runOracle('prepare');
  if (!remote) {
    const releaseFallback=new Map();
    for(const manifestName of ['artifacts-alpine.json','artifacts-omarchy-virgl.json']) {
      const manifest=JSON.parse(await fs.readFile(path.join(web,manifestName),'utf8'));
      for(const asset of Object.values(manifest.artifacts)) {
        const pathname='/'+asset.url.replace(/^\.\//,'');
        releaseFallback.set(pathname,'https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/sha256/'+asset.sha256+pathname);
      }
    }
    const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css'};
    server=createServer(async(request,response)=>{
      try {
        const pathname=new URL(request.url,'http://localhost').pathname;
        if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
        const base=pathname.startsWith('/releases/')?root:web, file=path.resolve(base,'.'+decodeURIComponent(pathname));
        if(!file.startsWith(base+path.sep)){response.writeHead(404).end();return;}
        let bytes;
        try {bytes=await fs.readFile(file);} catch(error) {
          if(error.code==='ENOENT'&&releaseFallback.has(pathname)){response.writeHead(302,{Location:releaseFallback.get(pathname)}).end();return;}
          throw error;
        }
        served.set(pathname,{path:path.relative(root,file),bytes:bytes.length,sha256:sha(bytes)});
        response.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store',
          'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
      } catch {response.writeHead(404).end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  } else assert.equal(remote.href,'https://wasm-vm.pages.dev/');
  report.url=remote?new URL('app.html?noAutoBoot&testHooks=1',remote).href:`http://127.0.0.1:${server.address().port}/app.html?noAutoBoot&testHooks=1`;
  context=await chromium.launchPersistentContext(path.join(output,'chromium-profile'),{executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless:true,args:['--enable-gpu','--use-gl=angle','--use-angle=metal'],viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});
  page=context.pages()[0]??await context.newPage();
  await page.coverage.startJSCoverage({resetOnNavigation:false});
  await page.route('**/__e9-proof/*',async route=>{
    const name=new URL(route.request().url()).pathname.split('/').at(-1);
    assert.ok(allowedExports.test(name));assert.equal(route.request().method(),'POST');
    await fs.writeFile(path.join(output,name),route.request().postDataBuffer());
    await route.fulfill({status:204,body:''});
  });
  page.on('console',message=>{if(message.type()==='error'){
    if(message.location().url===new URL('/favicon.ico',report.url).href&&/\b404\b/.test(message.text())) (report.ignoredFaviconErrors??=[]).push(message.text());
    else report.errors.push(message.text());
  }});
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(report.url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__ready===true,null,{timeout:60000});
  const version=await context.newCDPSession(page);report.browser=await version.send('Browser.getVersion');await version.detach();
  if(remote) {
    report.checks.publicBytes=[];
    for(const name of ['session-disk-roots.js','session-store.js','session-alpine-image.json','session-software-fixture.json',
      'loader.js','linux-worker-protocol.js','linux-worker-host.js','gpu-runtime-worker.js','gpu-checkpoint-build.js','roadmap.js','tasks.json',
      'pkg/wasm_vm_wasm.js','pkg/wasm_vm_wasm_bg.wasm','session-pkg/wasm_vm_session.js','session-pkg/wasm_vm_session_bg.wasm']) {
      const response=await context.request.get(new URL(name,remote).href);assert.equal(response.status(),200);
      const bytes=await response.body(),expected=sha(await fs.readFile(path.join(web,name)));
      assert.equal(sha(bytes),expected,name);
      report.checks.publicBytes.push({name,bytes:bytes.length,sha256:expected,status:response.status()});
    }
  }
  await page.locator('#suite-run').click();
  await page.waitForFunction(()=>document.querySelector('#metric-done')?.textContent==='127',null,{timeout:600000});
  report.checks.suite={passed:Number(await page.locator('#metric-pass').textContent()),failed:Number(await page.locator('#metric-fail').textContent())};
  assert.deepEqual(report.checks.suite,{passed:127,failed:0});
  const pip=await page.locator('.cap',{hasText:'Immutable historical disk roots'}).locator('.cap-pip').getAttribute('class');
  assert.match(pip,development?/\b(?:in-progress|verified)\b/:/\bverified\b/);report.checks.roadmap=pip;
  await page.locator('#panel-tests').screenshot({path:path.join(output,'browser.png')});
  report.checks.critic=await checkDiskRootCritic(page,fixture);
  report.checks.ioCritic=await checkDiskRootIoCritic(page,fixture);
  report.namespace='wasm-vm-sessions-v1-disk-proof-'+Date.now().toString(36);
  await page.evaluate(async({name,imageText})=>{
    const {SessionStore}=await import('./session-store.js'),{SessionDiskRoots}=await import('./session-disk-roots.js');
    window.store=await SessionStore.open(name);window.roots=new SessionDiskRoots(store);window.lease=await store.writer('disk-root-owner');
    window.storeDatabaseName=name;
    window.imageText=imageText;window.guests={};window.deltas={};window.rpcSequence=0;
    window.saveEvidence=async(name,bytes)=>{const response=await fetch('./__e9-proof/'+name,{method:'POST',body:bytes});if(!response.ok)throw Error('evidence export failed');};
  },{name:report.namespace,imageText});

  await boot('live');
  await command('live',"mkdir -p /root/e9-session; printf 'e9:before\\n' > /root/e9-session/state; sync");
  report.checks.beforeFile=await file('live','e9:before\n');
  report.checks.beforeCapture=await capture('live','before');
  // Hold only the caller's first completed put Promise. Every byte still uses the real lease/IDB.
  await page.evaluate(()=>{
    let release;window.publicationGate=new Promise(resolve=>{release=resolve;});window.releasePublication=release;
    let first=true;
    const heldWriter={async put(...args){const result=await lease.put(...args);if(first){first=false;window.publicationHeld=true;await publicationGate;}return result;}};
    window.beforePending=roots.capture(heldWriter,deltas.before,imageText);
  });
  await page.waitForFunction(()=>window.publicationHeld===true);
  await command('live',"printf 'e9:after\\n' | dd of=/root/e9-session/state conv=notrunc 2>/dev/null; truncate -s 9 /root/e9-session/state; sync");
  report.checks.afterFile=await file('live','e9:after\n');
  report.checks.afterCapture=await capture('live','after');
  report.roots.after=await saveRoot('after');
  report.roots.before=await page.evaluate(async()=>{
    releasePublication();const root=await beforePending;
    await saveEvidence('before.root.json',(await roots.inspect(root.content.sha256)).bytes);
    await saveEvidence('before.restored.wvod',await roots.restore(root.content.sha256,imageText,root.generation));return root;
  });
  assert.notEqual(report.roots.before.content.sha256,report.roots.after.content.sha256);
  await command('live',"printf 'e9:live\\n' | dd of=/root/e9-session/state conv=notrunc 2>/dev/null; truncate -s 8 /root/e9-session/state; sync");
  report.checks.liveFile=await file('live','e9:live\n');report.checks.liveCapture=await capture('live','live');
  report.roots.live=await saveRoot('live');
  await page.evaluate(async()=>{await guests.live.controller.pause();await guests.live.controller.captureDiskDelta();});
  // Snapshot actual durable live block/meta rows, rather than relying on the live guest's RAM cache.
  await page.evaluate(async()=>{
    const {overlayDbName}=await import('./pkg/wasm_vm_wasm.js');window.liveDatabase=overlayDbName(imageText,null);
    const {SessionSha256}=await import('./session-pkg/wasm_vm_session.js');
    window.diskRows=async()=>{
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(liveDatabase);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const rows=[];
      for(const name of ['blocks','meta']) await new Promise((resolve,reject)=>{
        const tx=db.transaction(name),r=tx.objectStore(name).openCursor();
        r.onsuccess=()=>{const c=r.result;if(!c)return;const bytes=new Uint8Array(c.value),hash=new SessionSha256();
          try{hash.update(bytes);rows.push({store:name,key:c.key,bytes:bytes.length,sha256:hash.finish()});}finally{hash.free();}c.continue();};
        tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
      });db.close();return JSON.stringify(rows);
    };
    window.liveDiskBefore=await diskRows();
    await saveEvidence('live-disk-before.json',new TextEncoder().encode(liveDiskBefore));
  });
  report.checks.liveDiskBefore=await page.evaluate(()=>({bytes:liveDiskBefore.length,database:liveDatabase}));

  // Restore in reverse order into actual fresh private Linux workers.
  for(const [id,point,expected] of [['newer','after','e9:after\n'],['older','before','e9:before\n']]) {
    await boot(id,privateDescriptor(report.roots[point]));
    report.checks[id+'File']=await file(id,expected);
    if(id==='older') {
      await command(id,"printf 'e9:fork\\n' | dd of=/root/e9-session/state conv=notrunc 2>/dev/null; truncate -s 8 /root/e9-session/state; sync");
      report.checks.forkFile=await file(id,'e9:fork\n');report.checks.forkCapture=await capture(id,'fork');
      report.roots.fork=await saveRoot('fork');
    }
    await page.evaluate(async id=>{const {stopLinuxController}=await import('./linux-worker-host.js');await stopLinuxController(guests[id].controller);},id);
  }
  report.checks.diskUnchanged=await page.evaluate(async()=>{
    const after=await diskRows();await saveEvidence('live-disk-after.json',new TextEncoder().encode(after));return after===liveDiskBefore;
  });
  assert.equal(report.checks.diskUnchanged,true);
  report.checks.verifiedRoots=await page.evaluate(async values=>{
    const result=[];for(const value of values)result.push(await roots.verify(value.content.sha256,imageText,value.generation));return result;
  },Object.values(report.roots));
  report.checks.identityRefusals=await page.evaluate(async value=>{
    const results=[];
    for(const [image,generation] of [[imageText,String(BigInt(value.generation)+1n)],[imageText,Number(value.generation)],
      [imageText.replace('"image_len":536870912','"image_len":536870911'),value.generation]]){
      try{await roots.restore(value.content.sha256,image,generation);results.push('accepted');}catch(error){results.push(error.code);}
    }return results;
  },report.roots.before);
  assert.deepEqual(report.checks.identityRefusals,['DiskRoot','DiskRoot','DiskRoot']);
  // Storage-format pin fixtures exercise actual session-row deletion and surviving root reachability.
  // Their placeholder machine payloads deliberately make no T05 coherent-checkpoint claim.
  report.checks.childDeletion=await page.evaluate(async({fixture,parent,child})=>{
    const enc=new TextEncoder();
    for(const [id,root] of [['disk-parent',parent],['disk-child',child]]) {
      const writer=await store.writer(id), manifest=structuredClone(fixture.template);manifest.id=id;manifest.checkpoints[0].disk_root=root.content.sha256;
      try {
        for(const blob of fixture.blobs)await writer.put({sha256:blob.sha256,length:blob.length},[new Uint8Array(blob.bytes)]);
        await writer.publish(enc.encode(JSON.stringify(manifest)));
      } finally {await writer.release();}
    }
    const before=await roots.liveReferences([parent.content.sha256,child.content.sha256]);
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(storeDatabaseName);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction('sessions','readwrite',{durability:'strict'});tx.objectStore('sessions').delete('disk-child');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
    const after=await roots.liveReferences([parent.content.sha256]);
    const row=await store.openSession('disk-parent');
    return {before,after,parentPresent:!!row,child:await store.openSession('disk-child'),
      verified:await roots.verify(parent.content.sha256,imageText,parent.generation)};
  },{fixture:pinFixture,parent:report.roots.before,child:report.roots.fork});
  assert.equal(report.checks.childDeletion.parentPresent,true);assert.equal(report.checks.childDeletion.child,null);
  assert.ok(report.checks.childDeletion.after.every(ref=>report.checks.childDeletion.before.some(old=>old.sha256===ref.sha256&&old.length===ref.length)));
  report.checks.refusals=await refusalChecks(report.roots.before);
  assert.deepEqual(report.checks.refusals.producers.slice(0,3),[{fault:'mutated',code:'Digest'},{fault:'detached',code:'SourceChanged'},{fault:'released',code:'WriterClosed'}]);
  assert.ok(report.checks.refusals.producers.slice(3).every(item=>item.writes===0&&item.code!=='accepted'));
  assert.ok(report.checks.refusals.corruption.every(item=>item.codes.every(code=>code==='Corrupt')));
  assert.equal(report.checks.refusals.badDatabase,'Database');assert.equal(report.checks.refusals.rootBound,'Bound');assert.equal(report.checks.refusals.closed,'Closed');
  assert.equal(report.checks.refusals.conflictingLength,'Corrupt');assert.equal(report.checks.refusals.wrongObjectLength,'Corrupt');assert.equal(report.checks.refusals.metadataBound,'Bound');
  assert.deepEqual(report.checks.refusals.emptyReferences,[]);
  await page.evaluate(async({root,generation})=>{await saveEvidence('before-again.restored.wvod',await roots.restore(root,imageText,generation));},
    {root:report.roots.before.content.sha256,generation:report.roots.before.generation});
  assert.deepEqual(await fs.readFile(path.join(output,'before-again.restored.wvod')),await fs.readFile(path.join(output,'before.captured.wvod')));
  // Independently compare the actual dirty file block across live and sibling writes.
  const blockWith=(bytes,needle)=>{
    const count=bytes.readUInt32LE(57);for(let i=0;i<count;i++){const at=61+i*4104;
      if(bytes.subarray(at+8,at+4104).includes(Buffer.from(needle)))return String(bytes.readBigUInt64LE(at));}
    throw Error('no dirty file block contains '+needle);
  };
  const beforeFileBlock=blockWith(await fs.readFile(path.join(output,'before.captured.wvod')),'e9:before\n');
  const afterFileBlock=blockWith(await fs.readFile(path.join(output,'after.captured.wvod')),'e9:after\n');
  const forkFileBlock=blockWith(await fs.readFile(path.join(output,'fork.captured.wvod')),'e9:fork\n');
  assert.equal(beforeFileBlock,afterFileBlock);assert.equal(beforeFileBlock,forkFileBlock);
  report.checks.sameFileBlock=beforeFileBlock;
  report.checks.filesystemOracle=runOracle('inspect');
  await page.evaluate(async()=>{const {stopLinuxController}=await import('./linux-worker-host.js');await stopLinuxController(guests.live.controller);await lease.release();await store.close();});
  assert.deepEqual(report.errors,[]);
  await page.screenshot({path:path.join(output,'roots-complete.png')});
  // The changed page host must still pair the published factory with its archived v2 client.
  await page.locator('#desktop-graphics').selectOption('gpu');
  assert.equal((await page.evaluate(()=>window.wvmDemo.bootOmarchy())).ok,true);
  await page.waitForFunction(()=>window.wvmDemo?.isGuestReady?.()&&window.__linux?.restoredFromBootSnapshot?.(),null,{timeout:600000});
  report.checks.gpu=await page.evaluate(async()=>({gpu:await __linuxCtl.gpuStats(),scheduler:await __linuxCtl.schedulerStats()}));
  assert.ok(report.checks.gpu.gpu.qualified&&!report.checks.gpu.gpu.lost&&!report.checks.gpu.gpu.poisoned);
  assert.ok(report.checks.gpu.scheduler.retiredInstructions>0);
  assert.ok(report.checks.gpu.gpu.scanout.retirements.some(r=>r.epoch===report.checks.gpu.gpu.epoch&&r.status==='drawn'));
  assert.deepEqual(report.errors,[]);report.status='passed';
  await page.screenshot({path:path.join(output,'gpu-factory-ready.png')});
  console.log('Historical roots: actual guest files, reverse-order private boots, sibling writes and native ext4 oracle passed.');
} catch(error) {report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);}
finally {
  if(page&&!page.isClosed()) {
    try {report.finalGuests=await page.evaluate(()=>Object.fromEntries(Object.entries(window.guests??{}).map(([id,state])=>[id,{output:state.output,events:state.events,errors:state.errors}])));} catch{}
    try {await fs.writeFile(path.join(output,'javascript-coverage.json'),JSON.stringify(await page.coverage.stopJSCoverage()));}catch{}
  }
  if(context)await context.tracing.stop({path:path.join(output,'browser-trace.zip')}).catch(()=>{});
  if(context)await context.close().catch(()=>{});
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  report.served=[...served.values()];report.finished=new Date().toISOString();
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
}

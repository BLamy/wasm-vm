#!/usr/bin/env node
// Actual local workerd R2 proof. No remote binding or network publication here.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createBindingUploader,WRANGLER_VERSION} from '../publish-omarchy-chunks-proxy.mjs';
import {publishChunks,DEFAULT_PUBLIC_BASE} from '../publish-omarchy-chunks.mjs';
import {createWranglerProcessProxy} from './omarchy-r2-owner.mjs';
const options={};for(let i=2;i<process.argv.length;i+=2)options[process.argv[i]]=process.argv[i+1];
assert.ok(options['--output']&&options['--wrangler-module'],'--output and --wrangler-module required');
const output=path.resolve(options['--output']),entry=path.resolve(options['--wrangler-module']);
await mkdir(output,{recursive:false});
const hash=b=>createHash('sha256').update(b).digest('hex');
const pkg=JSON.parse(await readFile(path.resolve(path.dirname(entry),'../package.json')));
assert.equal(pkg.name,'wrangler');assert.equal(pkg.version,WRANGLER_VERSION);
const {getPlatformProxy}=await import(pathToFileURL(entry).href);
const config=path.join(output,'local-wrangler.json');
await writeFile(config,JSON.stringify({name:'omarchy-local-publisher-proof',compatibility_date:'2026-10-01',r2_buckets:[{binding:'ASSETS',bucket_name:'wasm-vm',remote:false}]},null,2)+'\n');
const report={scope:'Actual local workerd R2 conditional/checksum and existing strict publisher integration; not remote authentication or public HTTPS proof',status:'running',wranglerVersion:pkg.version,events:[],publicReads:[],startedUtc:new Date().toISOString()};
let proxy,adapter,processProxy,processAdapter,closed=0;
try{
  proxy=await getPlatformProxy({configPath:config,envFiles:[],persist:false,remoteBindings:false});
  const r2=proxy.env.ASSETS;
  let opened=0;
  adapter=createBindingUploader({getProxy:async()=>{opened++;return {env:proxy.env,dispose:async()=>{closed++;await proxy.dispose();}};},record:async event=>report.events.push(event)});
  const fetchImpl=async url=>{
    assert.ok(String(url).startsWith(DEFAULT_PUBLIC_BASE+'/'));const key=String(url).slice(DEFAULT_PUBLIC_BASE.length+1);
    const object=await r2.get(key);report.publicReads.push({key,status:object?200:404});
    return new Response(object?await object.arrayBuffer():null,{status:object?200:404});
  };
  const fixture=path.join(output,'fixture');await mkdir(path.join(fixture,'chunks'),{recursive:true});
  const a=Buffer.from(Array.from({length:262144},(_,i)=>(i*17+(i>>>8)*29)&255));
  const b=Buffer.from(Array.from({length:262144},(_,i)=>(255-i*11+(i>>>9)*7)&255));
  const ah=hash(a),bh=hash(b);await writeFile(path.join(fixture,'chunks',ah+'.bin'),a);await writeFile(path.join(fixture,'chunks',bh+'.bin'),b);
  const manifest={version:1,image_len:786432,chunk_size:262144,layout:'split',chunks:[ah,bh,ah]};
  const manifestPath=path.join(fixture,'manifest.json');await writeFile(manifestPath,JSON.stringify(manifest)+'\n');
  report.first=await publishChunks({manifestPath,publish:true,fetchImpl,uploader:adapter.upload,publicRetryDelaysMs:[0]});
  assert.equal(report.first.uploaded,2);assert.equal(report.first.finalManifest,'uploaded-verified');assert.equal(opened,1);
  const puts=report.events.filter(x=>x.phase==='conditional-put');assert.equal(puts.length,3);
  assert.ok(puts.at(-1).key.startsWith('chunked-omarchy/manifest-'),'manifest is last');
  for(const [digest,literal] of [[ah,a],[bh,b]]){
    const object=await r2.get('chunked-omarchy/chunks/'+digest+'.bin');
    assert.deepEqual(Buffer.from(await object.arrayBuffer()),literal);
    assert.equal(Buffer.from(object.checksums.sha256).toString('hex'),digest);
  }
  const extra=Buffer.alloc(262144,219),eh=hash(extra);
  await writeFile(path.join(fixture,'chunks',eh+'.bin'),extra);
  await writeFile(manifestPath,JSON.stringify({...manifest,image_len:1048576,chunks:[ah,bh,ah,eh]})+'\n');
  report.authenticated=await publishChunks({manifestPath,publish:true,objectChecker:adapter.check,uploader:adapter.upload});
  assert.equal(report.authenticated.verifiedExisting,2);assert.equal(report.authenticated.uploaded,1);
  assert.equal(report.authenticated.finalManifest,'uploaded-verified');
  assert.equal(report.events.filter(x=>x.phase==='conditional-put').at(-1).key,report.authenticated.manifestKey);
  const key='chunked-omarchy/chunks/'+ah+'.bin',before=await r2.head(key);
  await adapter.upload({bucket:'wasm-vm',key,sourcePath:path.join(fixture,'chunks',ah+'.bin')});
  const after=await r2.head(key);assert.equal(after.version,before.version,'conditional existing object is not overwritten');
  assert.equal(report.events.at(-1).state,'existing-condition-refused');
  report.conditionalExisting={beforeVersion:before.version,afterVersion:after.version};
  await assert.rejects(r2.put('local-checksum-negative',Buffer.from([1,2,3]),{sha256:hash(Buffer.from([1,2,4]))}));
  assert.equal(await r2.head('local-checksum-negative'),null,'actual R2 refuses corrupted bytes');
  let repeatOpens=0;const repeat=createBindingUploader({getProxy:async()=>{repeatOpens++;throw Error('existing exact objects need no authentication');}});
  report.repeat=await publishChunks({manifestPath,publish:true,fetchImpl,uploader:repeat.upload});
  assert.equal(report.repeat.verifiedExisting,3);assert.equal(report.repeat.finalManifest,'existing-exact');assert.equal(repeatOpens,0);await repeat.dispose();
  // A corrupt existing object prevents every write, including a different
  // missing chunk and the final manifest. This is deliberately local sabotage.
  const badDir=path.join(output,'corrupt-fixture');await mkdir(path.join(badDir,'chunks'),{recursive:true});
  const c=Buffer.alloc(262144,73),ch=hash(c),d=Buffer.alloc(262144,19),dh=hash(d);
  await writeFile(path.join(badDir,'chunks',ch+'.bin'),c);await writeFile(path.join(badDir,'chunks',dh+'.bin'),d);
  await r2.put('chunked-omarchy/chunks/'+ch+'.bin',Buffer.from([4,5,6]));
  const badManifest=path.join(badDir,'manifest.json');await writeFile(badManifest,JSON.stringify({version:1,image_len:524288,chunk_size:262144,layout:'split',chunks:[ch,dh]})+'\n');
  const listedState=async()=>Promise.all((await r2.list()).objects.map(async object=>({
    key:object.key,size:object.size,version:object.version,
    sha256:hash(Buffer.from(await(await r2.get(object.key)).arrayBuffer())),
  })));
  const listedBefore=await listedState();let forbiddenWrites=0;
  await assert.rejects(publishChunks({manifestPath:badManifest,publish:true,objectChecker:adapter.check,uploader:async()=>{forbiddenWrites++;}}),/refusing to overwrite/);
  assert.equal(forbiddenWrites,0);assert.deepEqual(await listedState(),listedBefore);
  report.corruption={writes:forbiddenWrites,missingChunkStillMissing:await r2.head('chunked-omarchy/chunks/'+dh+'.bin')===null};
  assert.equal(report.corruption.missingChunkStillMissing,true);report.status='passed';
  processProxy=await createWranglerProcessProxy({modulePath:entry,configPath:config,record:async event=>report.events.push(event)});
  processAdapter=createBindingUploader({getProxy:async()=>processProxy,record:async event=>report.events.push(event)});
  report.ownedProcessFirst=await publishChunks({manifestPath,publish:true,objectChecker:processAdapter.check,uploader:processAdapter.upload});
  assert.equal(report.ownedProcessFirst.uploaded,3);assert.equal(report.ownedProcessFirst.finalManifest,'uploaded-verified');
  report.ownedProcessRepeat=await publishChunks({manifestPath,publish:true,objectChecker:processAdapter.check,uploader:processAdapter.upload});
  assert.equal(report.ownedProcessRepeat.verifiedExisting,3);assert.equal(report.ownedProcessRepeat.finalManifest,'existing-exact');
}catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
  if(processAdapter)await processAdapter.dispose();else await processProxy?.dispose();
  if(adapter)await adapter.dispose();
  if(proxy&&!closed){await proxy.dispose();closed++;}
  report.closedOwners=closed;report.finishedUtc=new Date().toISOString();
  report.sources=[];
  for(const p of [fileURLToPath(import.meta.url),...['tools/publish-omarchy-chunks-proxy.mjs','tools/publish-omarchy-chunks.mjs','tools/verify/omarchy-r2-owner.mjs','tools/verify/omarchy-r2-worker.mjs'].map(p=>path.resolve(p)),entry]){
    const b=await readFile(p);report.sources.push({path:p,bytes:b.length,sha256:hash(b)});
  }
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,closedOwners:closed,first:report.first?.finalManifest,repeat:report.repeat?.finalManifest,error:report.error}));
}

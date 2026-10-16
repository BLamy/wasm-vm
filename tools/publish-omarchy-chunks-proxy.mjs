#!/usr/bin/env node
// Reuse Wrangler's documented authenticated remote R2 binding for the existing
// strict publisher. The default remains a read-only plan; no credentials are read.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {appendFile, mkdir, readFile, realpath, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {publishChunks, validateLocalManifest, DEFAULT_BUCKET, DEFAULT_PUBLIC_BASE, CHUNK_SIZE, UPLOAD_TIMEOUT_MS} from './publish-omarchy-chunks.mjs';
import {createWranglerProcessProxy} from './verify/omarchy-r2-owner.mjs';

export const WRANGLER_VERSION='4.151.0';
export const ACCOUNT_ID='cc8e2f38f1862286b90e834d8f267d1a';
export const MAX_MANIFEST_BYTES=4*1024*1024;
const hash=b=>createHash('sha256').update(b).digest('hex');

export async function checkedPayload(key, sourcePath) {
  const chunk=key.match(/^chunked-omarchy\/chunks\/([0-9a-f]{64})\.bin$/);
  const manifest=key.match(/^chunked-omarchy\/manifest-([0-9a-f]{64})\.json$/);
  assert.ok(chunk||manifest,'only immutable Omarchy chunk/manifest keys are allowed');
  const size=(await stat(sourcePath)).size;
  assert.ok(size>0&&size<=(chunk?CHUNK_SIZE:MAX_MANIFEST_BYTES),'bounded upload payload');
  const bytes=await readFile(sourcePath);
  assert.equal(bytes.length,size,'staged size is unchanged');
  const digest=(chunk||manifest)[1];
  assert.equal(hash(bytes),digest,'staged bytes match the immutable key');
  return {bytes,digest,contentType:chunk?'application/octet-stream':'application/json'};
}

export function createBindingUploader({getProxy,bucket=DEFAULT_BUCKET,record=async()=>{},putTimeoutMs=UPLOAD_TIMEOUT_MS,startupTimeoutMs=60000,disposeTimeoutMs=10000}) {
  assert.equal(typeof getProxy,'function');
  let starting,live,closed=false,cancelStartup;
  const disposals=new Map();
  const disposeOwner=owner=>{
    if(!disposals.has(owner))disposals.set(owner,(async()=>{
      let timer;
      try{await Promise.race([Promise.resolve().then(()=>owner.dispose()),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('R2 owner disposal timed out')),disposeTimeoutMs);})]);}
      finally{clearTimeout(timer);}
    })());
    return disposals.get(owner);
  };
  const binding=async()=>{
    assert.equal(closed,false,'uploader is open');
    starting??=new Promise((resolve,reject)=>{
      let finished=false;
      const fail=error=>{if(finished)return;finished=true;clearTimeout(timer);reject(error);};
      const timer=setTimeout(()=>fail(Error('R2 binding startup timed out')),startupTimeoutMs);
      cancelStartup=()=>fail(Error('R2 binding startup cancelled'));
      Promise.resolve().then(getProxy).then(async owner=>{
        live=owner;
        if(finished||closed){await disposeOwner(owner);return;}
        assert.equal(typeof owner?.env?.ASSETS?.put,'function','actual R2 binding');
        assert.equal(typeof owner?.dispose,'function','owned proxy lifecycle');
        await record({phase:'binding-open'});
        if(finished||closed){await disposeOwner(owner);return;}
        finished=true;clearTimeout(timer);resolve(owner.env.ASSETS);
      }).catch(error=>{fail(error);});
    });
    return starting;
  };
  return {
    async check({key,expectedSize,expectedSha}) {
      assert.match(key,/^chunked-omarchy\/(?:chunks\/[0-9a-f]{64}\.bin|manifest-[0-9a-f]{64}\.json)$/);
      assert.ok(Number.isSafeInteger(expectedSize)&&expectedSize>0&&expectedSize<=MAX_MANIFEST_BYTES);
      const r2=await binding();
      const value=r2.read?await r2.read(key,expectedSize):await(async()=>{
        const object=await r2.get(key);
        if(!object)return null;
        return {size:object.size,bytes:object.size<=expectedSize?Buffer.from(await object.arrayBuffer()):null};
      })();
      const state=!value?'missing':value.size===expectedSize&&value.bytes?.length===expectedSize&&hash(value.bytes)===expectedSha?'exact':'mismatch';
      const result={state,status:null,transport:'authenticated-wrangler-r2'};
      await record({phase:'r2-binding-check',key,expectedSize,expectedSha,state,
        actualSize:value?.size??null,actualSha256:value?.bytes?hash(value.bytes):null});
      return result;
    },
    async upload({bucket:requestedBucket,key,sourcePath}) {
      assert.equal(closed,false,'uploader is open');
      assert.equal(requestedBucket,bucket,'upload bucket is fixed');
      // Read once into a private bounded buffer before creating/authenticating
      // the proxy. R2 independently validates the same SHA256 on receipt.
      const payload=await checkedPayload(key,sourcePath);
      const r2=await binding();
      let timer,result;
      try{
        result=await Promise.race([
          r2.put(key,payload.bytes,{onlyIf:{etagDoesNotMatch:'*'},sha256:payload.digest,
            httpMetadata:{contentType:payload.contentType,cacheControl:'public, max-age=31536000, immutable'}}),
          new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('R2 upload timed out for '+key)),putTimeoutMs);}),
        ]);
      }finally{clearTimeout(timer);}
      if(result){assert.equal(result.key,key);assert.equal(result.size,payload.bytes.length);}
      // A concurrent creator can win the conditional put. The strict outer
      // publisher still GETs and hashes the complete public object afterward.
      await record({phase:'conditional-put',key,bytes:payload.bytes.length,sha256:payload.digest,
        state:result?'created':'existing-condition-refused'});
    },
    async dispose() {
      if(closed)return;
      closed=true;
      cancelStartup?.();
      if(starting)await starting.catch(()=>{});
      if(live){await disposeOwner(live);await record({phase:'binding-closed'});}
    },
  };
}

export async function wranglerProxy({modulePath,configPath,record=async()=>{}}) {
  assert.ok(path.isAbsolute(modulePath),'explicit absolute Wrangler module path');
  const entry=await realpath(modulePath);
  const packagePath=path.resolve(path.dirname(entry),'../package.json');
  const packageBytes=await readFile(packagePath),pkg=JSON.parse(packageBytes);
  assert.equal(pkg.name,'wrangler');assert.equal(pkg.version,WRANGLER_VERSION,'pinned Wrangler API');
  await record({phase:'wrangler-source',version:pkg.version,entry,entrySha256:hash(await readFile(entry)),
    packageSha256:hash(packageBytes),configSha256:hash(await readFile(configPath))});
  const {getPlatformProxy}=await import(pathToFileURL(entry).href);
  // envFiles[] prevents unrelated dotenv files entering this release helper.
  return getPlatformProxy({configPath,envFiles:[],persist:false,remoteBindings:true});
}

function args(argv) {
  const options={manifestPath:null,output:null,modulePath:null,publish:false};
  for(let i=0;i<argv.length;i++){
    const k=argv[i];
    if(k==='--publish')options.publish=true;
    else if(k==='--manifest')options.manifestPath=argv[++i];
    else if(k==='--output')options.output=argv[++i];
    else if(k==='--wrangler-module')options.modulePath=argv[++i];
    else throw Error('unknown argument '+k);
  }
  assert.ok(options.manifestPath&&options.output,'--manifest and --output are required');
  if(options.publish)assert.ok(options.modulePath,'--publish requires --wrangler-module');
  return options;
}

async function main() {
  const options=args(process.argv.slice(2)),output=path.resolve(options.output);
  await mkdir(output,{recursive:false});
  const journal=path.join(output,'uploads.ndjson'),configPath=path.join(output,'wrangler.json');
  await writeFile(journal,'',{flag:'wx',mode:0o600});
  const sourcePins=[];
  for(const source of [fileURLToPath(import.meta.url),...['./publish-omarchy-chunks.mjs','./verify/omarchy-r2-owner.mjs','./verify/omarchy-r2-worker.mjs'].map(name=>fileURLToPath(new URL(name,import.meta.url)))]){
    const bytes=await readFile(source),copy='executed-'+path.basename(source);
    await writeFile(path.join(output,copy),bytes,{flag:'wx'});
    sourcePins.push({path:source,copy,bytes:bytes.length,sha256:hash(bytes)});
  }
  const validated=await validateLocalManifest(path.resolve(options.manifestPath));
  const inputManifest=validated.manifestBytes;
  await writeFile(path.join(output,'input-manifest.json'),inputManifest,{flag:'wx'});
  let recording=Promise.resolve(),recordingError;
  const record=event=>{
    recording=recording.then(async()=>{
      if(!recordingError)try{await appendFile(journal,JSON.stringify({time:new Date().toISOString(),...event})+'\n');}
      catch(error){recordingError=error;}
    });
    return recording.then(()=>{if(recordingError)throw recordingError;});
  };
  const config={name:'wasm-vm-release-publisher',account_id:ACCOUNT_ID,compatibility_date:'2026-10-01',
    r2_buckets:[{binding:'ASSETS',bucket_name:DEFAULT_BUCKET,remote:true}]};
  await writeFile(configPath,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
  const adapter=createBindingUploader({getProxy:()=>createWranglerProcessProxy({modulePath:path.resolve(options.modulePath),configPath,record}),record});
  const start=new Date().toISOString();let result,failure,cleanupError;
  try {
    let lastPrint=0;
    result=await publishChunks({manifestPath:path.resolve(options.manifestPath),publish:options.publish,
      validatedManifest:validated,objectChecker:options.publish?adapter.check:null,
      bucket:DEFAULT_BUCKET,publicBase:DEFAULT_PUBLIC_BASE,uploader:adapter.upload,
      onProgress:event=>{
        if(recordingError)throw recordingError;
        void record(event).catch(()=>{});
        if(Date.now()-lastPrint>15000||event.phase==='manifest'){
          lastPrint=Date.now();console.log(JSON.stringify({phase:event.phase,processed:event.processed,total:event.total,state:event.state}));
        }
      }});
  } catch(error){failure={message:error.message,stack:error.stack};}
  try{await adapter.dispose();}catch(error){cleanupError=String(error);}
  await recording;
  if(recordingError&&!failure)failure={message:recordingError.message,stack:recordingError.stack};
  if(result&&(result.manifestSha256!==hash(inputManifest)||hash(await readFile(path.resolve(options.manifestPath)))!==hash(inputManifest))&&!failure)
    failure={message:'Captured, published and current manifest identities differ'};
  for(const source of sourcePins)if(hash(await readFile(source.path))!==source.sha256&&!failure)
    failure={message:'Publisher source changed during the recorded run: '+source.path};
  const receipt={schema:1,startedUtc:start,finishedUtc:new Date().toISOString(),status:failure||cleanupError?'failed':'passed',
    mode:options.publish?'publish':'plan',scriptSha256:hash(await readFile(fileURLToPath(import.meta.url))),
    wranglerVersion:WRANGLER_VERSION,verificationTransport:options.publish?'authenticated-wrangler-r2':'local-plan',config,sourcePins,
    manifest:{path:path.resolve(options.manifestPath),bytes:inputManifest.length,sha256:hash(inputManifest)},result,failure,cleanupError,
    uploadJournal:{path:'uploads.ndjson',bytes:(await stat(journal)).size,sha256:hash(await readFile(journal))}};
  await writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({status:receipt.status,result,failure,cleanupError,receipt:path.join(output,'receipt.json')},null,2));
  if(failure||cleanupError)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});

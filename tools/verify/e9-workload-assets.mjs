// Original T01 identities and materialized base bytes for untimed qualification.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath}from'node:url';
import {createHash}from'node:crypto';
import {createReadStream}from'node:fs';
export const WORKLOAD_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const R2='https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(ok,why)=>{if(!ok)throw Error('qualification assets: '+why);};
export async function fileSha(file){const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return hash.digest('hex');}
export function pinnedImage(bytes,expected){
 need(bytes instanceof Uint8Array&&bytes.length<=4*1048576&&sha(bytes)===expected,'immutable manifest hash');
 const image=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 need(image.version===1&&image.layout==='split'&&Number.isSafeInteger(image.image_len)&&image.image_len>0&&Number.isSafeInteger(image.chunk_size)&&image.chunk_size>=4096&&image.chunk_size<=4194304&&image.image_len%image.chunk_size===0,'image shape');
 need(Array.isArray(image.chunks)&&image.chunks.length===image.image_len/image.chunk_size&&image.chunks.every(id=>typeof id==='string'&&/^[0-9a-f]{64}$/.test(id)),'complete manifest closure');
 return image;
}
async function publicBody(url,length,attempts){
 need(url.startsWith(R2)&&Number.isSafeInteger(length)&&length>0&&length<=4*1048576,'finite public object');
 for(let number=1;number<=3;number++){
  const attempt={number,url};attempts.push(attempt);
  try{
   const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(60000)});attempt.status=response.status;need(response.status===200&&response.body,'public status');
   const reader=response.body.getReader(),bytes=new Uint8Array(length);let at=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;need(value.length<=length-at,'public body ceiling');bytes.set(value,at);at+=value.length;}}finally{await reader.cancel().catch(()=>{});}
   need(at===length,'public exact length');return bytes;
  }catch(error){attempt.error=String(error.stack??error);if(number===3)throw error;}
 }
}
export async function inspectMaterializedChunks(directory,image){
 const ids=new Set(image.chunks),rows=[];await fs.mkdir(directory,{recursive:true});
 for(const name of (await fs.readdir(directory)).sort()){
  need(/^[0-9a-f]{64}\.bin$/.test(name)&&ids.has(name.slice(0,-4)),'unexpected cached base member');
  const file=path.join(directory,name),stat=await fs.lstat(file);need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===image.chunk_size,'owned cached base shape');
  const bytes=await fs.readFile(file);need(sha(bytes)===name.slice(0,-4),'cached base hash (including unrequested members)');rows.push({sha256:name.slice(0,-4),bytes:bytes.length});
 }
 return rows;
}
export async function loadQualificationAssets(profile,{webRoot=path.join(WORKLOAD_ROOT,'web/dist'),cacheRoot=path.join(WORKLOAD_ROOT,'target/e9-workload-base-cache')}={}){
 need(['software','desktop'].includes(profile),'profile');
 const contractBytes=await fs.readFile(path.join(WORKLOAD_ROOT,'docs/design/session-replay-contract.json'));need(sha(contractBytes)==='646899bea0da60ba13020a2015f6214236526082a8e34952cca91481cb89dba1','unchanged T01 contract');
 const contract=JSON.parse(contractBytes),fixture=contract.fixtures.find(row=>row.id===(profile==='software'?'software-alpine-v1':'desktop-gpu-candidate-v1'));
 const fixtureBytes=await fs.readFile(path.join(WORKLOAD_ROOT,fixture.manifest));need(sha(fixtureBytes)===fixture.manifest_sha256,'original boot manifest');
 const fixtureManifest=JSON.parse(fixtureBytes);need(JSON.stringify(fixtureManifest.artifacts)===JSON.stringify(fixture.artifacts),'original artifacts');
 const receipt={profile,scope:'untimed identity/qualification input, no performance result',contractSha256:sha(contractBytes),bootManifestSha256:sha(fixtureBytes),originalFixture:fixture,attempts:[],chunks:[]};
 const kernel=await fs.readFile(path.join(WORKLOAD_ROOT,fixture.artifacts.kernel.url));need(kernel.length===fixture.artifacts.kernel.size&&sha(kernel)===fixture.artifacts.kernel.sha256,'original kernel');
 const wasm=await fs.readFile(path.join(webRoot,'pkg/wasm_vm_wasm_bg.wasm')),rendererAsset=await fs.readFile(path.join(webRoot,'gpu-checkpoint-build.js'));
 const sourceReference=await fs.readFile(path.join(WORKLOAD_ROOT,'docs/design/session-replay-performance-reference-v1.json')),
   previousSerialization=await fs.readFile(path.join(WORKLOAD_ROOT,'docs/design/session-workload-qualification-v1.json')),
   secondSerialization=await fs.readFile(path.join(WORKLOAD_ROOT,'docs/design/session-workload-qualification-v2.json')),
   thirdSerialization=await fs.readFile(path.join(WORKLOAD_ROOT,'docs/design/session-workload-qualification-v3.json')),
   serialization=await fs.readFile(path.join(WORKLOAD_ROOT,'docs/design/session-workload-qualification-v4.json'));
 const amendment=JSON.parse(sourceReference);need(amendment.originalContract.sha256===receipt.contractSha256&&JSON.stringify(amendment.unchanged.workload)===JSON.stringify(contract.workload)&&JSON.stringify(amendment.unchanged.budgets)===JSON.stringify(contract.budgets),'no reference workload/budget drift');
 need(sha(previousSerialization)==='f59e6190ec3006eaf22c8eda0d9e6915065458a709505afd4ac9e33601767b27','preserved first qualification serialization');
 need(sha(secondSerialization)==='7ea0bb9bc4329da72a9497d184ba139bbc5677ed4e4ea2ba43a6593b0812c5e9','preserved Chrome .86 qualification serialization');
 need(sha(thirdSerialization)==='5802635c6c7a9c7e1746e1da5b7b4c7460c5c2c2564c6e7492b69456d8492082','preserved tool-aware qualification serialization');
 need(sha(serialization)==='a191b05860be6f32bcc356953ecd4e969eebd47426689d27f643b7bcde13c2c8','frozen supported-retention qualification serialization');
 const qualification=JSON.parse(serialization);
 need(qualification.version===4&&qualification.previousQualification.sha256===sha(thirdSerialization)
   &&qualification.originalContract.sha256===receipt.contractSha256
   &&qualification.referenceAmendment.sha256===sha(sourceReference)
   &&qualification.referenceAmendment.originalBrowser==='Chrome 155.0.8059.80'
   &&qualification.referenceAmendment.qualificationBrowser==='Chrome 155.0.8059.86'
   &&qualification.profiles.desktop.includes('12 GiB')&&qualification.profiles.desktop.includes('ICount/64')
   &&qualification.history.includes('actual initial frames')
   &&qualification.retention.defaultMaxBytes===2*1024**3
   &&qualification.retention.maxBytes===8*1024**3
   &&qualification.retention.maxCheckpoints===4096,'frozen desktop qualification profile/reference');
 let imageBytes,image,disk,chunkPrefix,busybox=null;
 try{
 if(profile==='software'){
  const software=JSON.parse(await fs.readFile(path.join(WORKLOAD_ROOT,'web/session-software-fixture.json')));imageBytes=await fs.readFile(path.join(WORKLOAD_ROOT,'web/session-alpine-image.json'));image=pinnedImage(imageBytes,software.image_manifest_sha256);chunkPrefix=new URL('chunks/',software.base_url).href;
  const raw=path.join(WORKLOAD_ROOT,fixture.artifacts.rootfs.url);need((await fs.stat(raw)).size===fixture.artifacts.rootfs.size,'full software image size');receipt.rawImage={path:raw,bytes:fixture.artifacts.rootfs.size,sha256:await fileSha(raw)};need(receipt.rawImage.sha256===fixture.artifacts.rootfs.sha256,'full software image hash');disk=await fs.open(raw,'r');receipt.bootargs=software.bootargs;
 }else{
  const tool=qualification.auxiliaryDesktopTool;
  need(tool.sourcePath==='releases/initramfs/busybox'
    &&tool.sourceSha256==='9958179c84ee901615fef183214b90ec2306b5579d0640f520790105f4d79f30'
    &&tool.sourceBytes===1741320&&tool.transportSha256==='dac2c1dd4ebc37266d5152eae3160f662f587f7e9deb91a35aa6f3d7c75f4679'
    &&tool.transportBytes===1168752&&tool.transportPaddedBytes===1171456
    &&tool.guestPath==='/usr/local/bin/busybox','pinned Omarchy auxiliary tool');
  busybox=await fs.readFile(path.join(WORKLOAD_ROOT,tool.sourcePath));
  need(busybox.length===tool.sourceBytes&&sha(busybox)===tool.sourceSha256,'original static RV64 BusyBox');
  receipt.auxiliaryTool={path:tool.sourcePath,bytes:busybox.length,sha256:sha(busybox)};
  const entry=fixture.chunked_image;need(entry.sha256==='8a793846f109a08242688fa32d531f230d7a3e2a7bdb3c694dbfc1abb70367a8'&&entry.size===3539054,'original desktop base');await fs.mkdir(cacheRoot,{recursive:true});const file=path.join(cacheRoot,'manifest-'+entry.sha256+'.json');
  try{imageBytes=await fs.readFile(file);receipt.manifestSource='hash-authenticated-local-cache';}catch(error){if(error.code!=='ENOENT')throw error;imageBytes=await publicBody(R2+entry.key,entry.size,receipt.attempts);need(sha(imageBytes)===entry.sha256,'downloaded desktop manifest');await fs.writeFile(file,imageBytes,{flag:'wx'});receipt.manifestSource='pinned-public-object';}
  need(imageBytes.length===entry.size,'desktop manifest bytes');image=pinnedImage(imageBytes,entry.sha256);need(image.image_len===12884901888&&image.chunk_size===262144,'pinned 12 GiB base distinct from RAM');chunkPrefix=R2+'chunked-omarchy/chunks/';receipt.bootargs='root=/dev/vda rw console=ttyS0 earlycon=sbi plymouth.enable=0';receipt.historicalWarmCheckpointExecuted=false;
 }
 const directory=path.join(cacheRoot,profile+'-chunks');const initialCache=await inspectMaterializedChunks(directory,image),ids=new Set(image.chunks),first=new Map();image.chunks.forEach((id,index)=>{if(!first.has(id))first.set(id,index);});
 Object.assign(receipt,{kernel:{bytes:kernel.length,sha256:sha(kernel)},wasm:{bytes:wasm.length,sha256:sha(wasm)},renderer:{bytes:rendererAsset.length,sha256:sha(rendererAsset)},image:{bytes:imageBytes.length,sha256:sha(imageBytes),imageBytes:image.image_len,chunkBytes:image.chunk_size,chunks:image.chunks.length,uniqueChunks:ids.size},referenceSha256:sha(sourceReference),serializationSha256:sha(serialization),initialMaterializedCache:initialCache,qualifiedClock:{mode:'icount',divider:profile==='software'?10:64,interactive:null},ramMib:profile==='software'?256:1024});
 const inFlight=new Map();
 async function readChunk(id){
  need(typeof id==='string'&&ids.has(id),'owned manifest member');if(inFlight.has(id))return inFlight.get(id);
  const pending=(async()=>{
   let bytes,source;
   if(disk){bytes=Buffer.alloc(image.chunk_size);need((await disk.read(bytes,0,bytes.length,first.get(id)*image.chunk_size)).bytesRead===bytes.length,'raw image read');source='full-authenticated-raw-image';}
   else{const file=path.join(directory,id+'.bin');try{const stat=await fs.lstat(file);need(stat.isFile()&&!stat.isSymbolicLink(),'owned cached chunk');bytes=await fs.readFile(file);source='authenticated-cache';}catch(error){if(error.code!=='ENOENT')throw error;bytes=await publicBody(chunkPrefix+id+'.bin',image.chunk_size,receipt.attempts);need(sha(bytes)===id,'downloaded chunk hash');await fs.writeFile(file,bytes,{flag:'wx'});source='pinned-public-object';}}
   need(bytes.length===image.chunk_size&&sha(bytes)===id,'materialized member hash');receipt.chunks.push({sha256:id,bytes:bytes.length,source});return bytes;
  })();inFlight.set(id,pending);try{return await pending;}finally{inFlight.delete(id);}
 }
 return {profile,receipt,qualification,contract,fixture,contractBytes,fixtureBytes,kernel,wasm,rendererAsset,busybox,image,imageBytes,imageManifest:new TextDecoder('utf-8',{fatal:true}).decode(imageBytes),readChunk,async inspectCache(){const rows=await inspectMaterializedChunks(directory,image);receipt.finalMaterializedCache=rows;return rows;},async close(){await disk?.close();}};
 }catch(error){
  try{await disk?.close();}catch(closeError){if(error&&typeof error==='object')error.assetCloseError=String(closeError.stack??closeError);}
  throw error;
 }
}

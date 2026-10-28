#!/usr/bin/env node
// Bounded input-integrity probes for the private E9-T22s cold continuation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {authenticateOfflineBase,verifiedBaseRequest} from './e9-cold-block-base-integrity.mjs';

const args=process.argv.slice(2),value=name=>{
  const at=args.indexOf(name);assert(at>=0&&args[at+1],name);return args[at+1];
};
const source=await fs.realpath(path.resolve(value('--source')));
const baseReportFile=path.resolve(value('--base-report'));
const basePointer=JSON.parse(await fs.readFile(baseReportFile));
const out=path.resolve(value('--output'));
const root=path.resolve(import.meta.dirname,'../..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(out,{recursive:false});
const archive=JSON.parse(await fs.readFile(path.join(source,'saved/storage.json')));
const objects=new Map(archive.stores.objects.map(row=>[row.key,row.value]));
const sourceChunks=path.join(source,'saved/chunks');
const readObject=async ref=>{
  const descriptor=objects.get(ref.sha256);assert(descriptor);
  const parts=await Promise.all(descriptor.parts.map(part=>
    fs.readFile(path.join(sourceChunks,part.sha256+'.bin'))));
  const bytes=Buffer.concat(parts);
  assert.equal(bytes.length,Number(ref.length));assert.equal(sha(bytes),ref.sha256);
  return bytes;
};
const report={task:'E9-T22s',status:'running',source,attacks:[]};
try{
  const manifestFile=path.join(root,'target/e9-workload-base-cache',
    'manifest-'+basePointer.manifestSha256+'.json');
  const authenticated=await authenticateOfflineBase(baseReportFile,manifestFile);
  const image=authenticated.image;
  report.base={reportSha256:authenticated.reportSha256,
    indexSha256:authenticated.indexSha256,
    manifestSha256:authenticated.manifestSha256,
    uniqueChunks:authenticated.uniqueChunks};
  const unrequested=image.chunks.find(digest=>!objects.has(digest));
  assert(unrequested,'need an original-image chunk absent from retained source graph');
  const ref={sha256:unrequested,length:'262144'};
  const original=await verifiedBaseRequest(authenticated.files,ref);
  await assert.rejects(verifiedBaseRequest(new Map(),ref),
    /outside the authenticated original image/);
  report.attacks.push({name:'unavailable-unrequested-base-chunk',result:'rejected-before-guest',
    sha256:unrequested});
  const mutated=Buffer.from(original);mutated[0]^=1;
  const baseMutant=path.join(out,'mutated-unrequested-base.bin');
  await fs.writeFile(baseMutant,mutated);
  await assert.rejects(verifiedBaseRequest(new Map([[unrequested,baseMutant]]),ref),
    /offline base bytes changed since preflight/);
  report.attacks.push({name:'corrupt-unrequested-base-chunk',result:'rejected-before-guest',
    expectedSha256:unrequested,mutantSha256:sha(mutated)});

  const session=archive.stores.sessions[0];assert(session);
  const manifest=JSON.parse(Buffer.from(session.value.manifest));
  const checkpoint=manifest.checkpoints.find(row=>
    row.position.transition==='14350000000');
  assert(checkpoint,'pre-error RAM delta is missing');
  const descriptorBytes=await readObject(checkpoint.machine);
  assert.equal(descriptorBytes.subarray(0,8).toString(),'WVKEYF01');
  const descriptor=JSON.parse(descriptorBytes.subarray(8));
  const ramRef=descriptor.chunks[0];assert(ramRef);
  const ramBytes=await readObject(ramRef);
  assert.equal(ramBytes.subarray(0,8).toString(),'WVRAMD01');
  const ramPart=objects.get(ramRef.sha256).parts[0];
  const corruptedRam=Buffer.from(await fs.readFile(path.join(sourceChunks,ramPart.sha256+'.bin')));
  corruptedRam[32]^=1;
  const view=path.join(out,'ram-delta-mutant');
  await fs.mkdir(path.join(view,'saved/chunks'),{recursive:true});
  for(const name of ['report.json','initial.state','final.state',
    'replay-window-0.state','replay-window-1.state'])
    await fs.symlink(path.join(source,name),path.join(view,name));
  await fs.symlink(path.join(source,'saved/storage.json'),path.join(view,'saved/storage.json'));
  for(const name of await fs.readdir(sourceChunks)){
    const target=path.join(view,'saved/chunks',name);
    if(name===ramPart.sha256+'.bin')await fs.writeFile(target,corruptedRam);
    else await fs.symlink(path.join(sourceChunks,name),target);
  }
  const closure=spawnSync('node',['tools/verify/e9-workload-retained-closure.mjs',
    '--directory',view,'--prefix'],{cwd:root,encoding:'utf8',timeout:15*60*1000});
  assert.equal(closure.status,1,'corrupted RAM delta must fail the source-graph oracle');
  const rejected=JSON.parse(await fs.readFile(path.join(view,'retained-closure/report.json')));
  assert.equal(rejected.status,'failed');
  assert(rejected.error.includes(ramPart.sha256),
    'RAM-delta rejection must cite the corrupted physical chunk');
  report.attacks.push({name:'corrupt-retained-ram-delta',result:'rejected-before-guest',
    checkpoint:checkpoint.id,ramObjectSha256:ramRef.sha256,
    physicalChunkSha256:ramPart.sha256,mutantSha256:sha(corruptedRam),
    oracleReportSha256:sha(await fs.readFile(path.join(view,'retained-closure/report.json')))});
  report.status='input-integrity-attacks-passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,attacks:report.attacks.map(row=>row.name),
    error:report.error}));}

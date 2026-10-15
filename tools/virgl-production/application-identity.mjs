// Hash the actual captured guest filesystem on the host; never emulate a
// hundreds-of-megabytes cryptographic workload merely to identify an app.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createReadStream,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodeGpuCheckpointPair} from '../../web/gpu-checkpoint.js';
import {GPU_CHECKPOINT_BUILD_ID} from '../../web/gpu-checkpoint-build.js';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const sha=b=>createHash('sha256').update(b).digest('hex');
async function hashFile(filename){const h=createHash('sha256');for await(const b of createReadStream(filename))h.update(b);return h.digest('hex');}
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
let uploadSequence=0;

export function parseIdentityDelta(bytes,manifest){
  assert.equal(bytes.subarray(0,5).toString('latin1'),'WVOD1');
  assert.ok(bytes.length>=61);assert.equal(bytes.readUInt32LE(5),4096);
  assert.equal(bytes.readBigUInt64LE(9),BigInt(manifest.image_len));
  const canonical=Object.fromEntries(['version','image_len','chunk_size','layout','chunks'].map(k=>[k,manifest[k]]));
  assert.equal(bytes.subarray(17,49).toString('hex'),sha(Buffer.from(JSON.stringify(canonical))));
  const count=bytes.readUInt32LE(57);assert.equal(bytes.length,61+count*4104);
  const rows=[];let previous=-1n;
  for(let n=0;n<count;n++){
    const at=61+n*4104,index=bytes.readBigUInt64LE(at);
    assert.ok(index>previous&&index<BigInt(manifest.image_len/4096));previous=index;
    rows.push({offset:Number(index)*4096,at:at+8});
  }
  return rows;
}

export function createApplicationIdentityProof(page,command,output,options={}){
  const cache=new Map();
  const imageDirectory=path.resolve(options.imageDirectory||process.env.CRITIC_FAST_BOOT_IMAGE_DIRECTORY||process.env.OMARCHY_DESKTOP_IMAGE_DIRECTORY||path.join(repo,'target/virgl-production/image-13'));
  let baseHash;
  async function run(text){const result=await command(page,text,300000);await fs.appendFile(path.join(output,'application-identity-commands.ndjson'),JSON.stringify({scope:options.name,command:text,result,time:Date.now()})+'\n');assert.equal(result.exit,0,text);return result;}
  async function metadata(pid,executable){
    assert.ok(Number.isInteger(pid)&&pid>1);
    const code=`import os,json,stat;from pathlib import Path;p=Path('/proc/${pid}');e=p/'exe';f=Path(${JSON.stringify(executable)});fields=lambda s:dict(dev=s.st_dev,ino=s.st_ino,size=s.st_size,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,mtimeNs=str(s.st_mtime_ns),ctimeNs=str(s.st_ctime_ns));raw=(p/'stat').read_text();print(json.dumps(dict(pid=${pid},exe=os.readlink(e),exeStat=fields(e.stat()),pathStat=fields(f.stat()),rootStat=fields((p/'root').stat()),starttime=raw[raw.rfind(')')+2:].split()[19],status=(p/'status').read_text(),maps=(p/'maps').read_text(),cmdline=(p/'cmdline').read_bytes().replace(bytes([0]),b' ').decode(),mountinfo=(p/'mountinfo').read_text())))`;
    const result=await run('python3 -c '+quote(code)),data=JSON.parse(result.stdout);
    assert.equal(data.exe,executable);assert.match(data.status,/Uid:\s+1000\s+1000\s+1000\s+1000/);
    assert.deepEqual(data.exeStat,data.pathStat);assert.equal(data.exeStat.dev,data.rootStat.dev);
    assert.equal(data.rootStat.ino,2);assert.equal(data.exeStat.uid,0);assert.equal(data.exeStat.mode&0o022,0);
    assert.ok(data.mountinfo.split('\n').some(line=>/ \/ \/ .* - ext4 \/dev\/vda /.test(line)),'actual process uses the expected root filesystem');
    return {data,result};
  }
  const stable=(a,b)=>{assert.equal(a.pid,b.pid);assert.equal(a.exe,b.exe);assert.equal(a.starttime,b.starttime);assert.deepEqual(a.exeStat,b.exeStat);assert.deepEqual(a.pathStat,b.pathStat);assert.deepEqual(a.rootStat,b.rootStat);};
  async function capture(directory){
    await fs.copyFile(fileURLToPath(import.meta.url),path.join(directory,'application-identity-source.mjs'));
    const manifestBytes=await fs.readFile(path.join(imageDirectory,'manifest.json')),manifest=JSON.parse(manifestBytes);
    const preparation=JSON.parse(await fs.readFile(path.join(imageDirectory,'preparation.json')));
    assert.equal(sha(manifestBytes),preparation.manifestSha256);
    const descriptor=JSON.parse(await fs.readFile(path.join(repo,'web/artifacts-omarchy-virgl.json')));
    const expectedIdentity={buildId:GPU_CHECKPOINT_BUILD_ID,kernelSha256:descriptor.artifacts.kernel.sha256,imageManifestSha256:sha(manifestBytes),ramMib:1024,
      bootargs:'root=/dev/vda rw console=ttyS0 earlycon=sbi plymouth.enable=0',guestClock:'icount',icountDivider:64,interactiveClock:'paced-on-keyboard'};
    const sync=await run('sync');
    const pairPath=path.join(directory,'actual.wvgpair'),file=await fs.open(pairPath,'wx');let next=0,total;
    const binding='__appIdentityUpload'+process.pid+'_'+uploadSequence++;
    await page.exposeFunction(binding,async entry=>{
      assert.equal(entry.offset,next);assert.ok(Number.isSafeInteger(entry.total)&&entry.total>0&&entry.total<=512*1024*1024);
      if(total===undefined)total=entry.total;assert.equal(entry.total,total);
      const b=Buffer.from(entry.base64,'base64');assert.equal(b.toString('base64'),entry.base64);assert.ok(b.length>0&&b.length<=1024*1024&&next+b.length<=total);
      const result=await file.write(b,0,b.length,next);assert.equal(result.bytesWritten,b.length);next+=b.length;
    });
    let capture;
    try{capture=await page.evaluate(async binding=>{
      const c=window.__linuxCtl,wasPaused=await c.isPaused();await c.pause();
      try{
        const before={clock:await c.guestClockState(),scheduler:await c.schedulerStats()};
        const bytes=await c.saveGpuCheckpoint();
        for(let at=0;at<bytes.length;at+=49152){const b=bytes.subarray(at,Math.min(bytes.length,at+49152));await window[binding]({offset:at,total:bytes.length,base64:btoa(String.fromCharCode(...b))});}
        const after={clock:await c.guestClockState(),scheduler:await c.schedulerStats()};return{before,after,bytes:bytes.length};
      }finally{if(!wasPaused)await c.resume();}
    },binding);}finally{await file.close();}
    assert.equal(next,total);assert.equal(next,capture.bytes);assert.deepEqual(capture.after.clock,capture.before.clock);
    assert.equal(capture.after.scheduler.retiredInstructions,capture.before.scheduler.retiredInstructions);
    const bytes=await fs.readFile(pairPath),decoded=await decodeGpuCheckpointPair(bytes,expectedIdentity),delta=Buffer.from(decoded.disk);
    const native=Buffer.from(decoded.native),trailer=native.length-84;
    assert.equal(native.subarray(0,8).toString('latin1'),'WVMRESU1');
    assert.equal(native.subarray(trailer,trailer+8).toString('latin1'),'WVGRESU1');
    assert.equal(native.readUInt32LE(trailer+8),1);assert.equal(native.readBigUInt64LE(trailer+12),BigInt(trailer));
    assert.equal(native.subarray(trailer+20,trailer+52).toString('hex'),decoded.witness);
    assert.equal(sha(native.subarray(0,-32)),native.subarray(-32).toString('hex'));
    assert.equal(native.subarray(44,76).toString('hex'),delta.subarray(17,49).toString('hex'));
    assert.equal(native.readBigUInt64LE(76),delta.readBigUInt64LE(49));
    const rows=parseIdentityDelta(delta,manifest);await fs.writeFile(path.join(directory,'actual.wvod'),delta);
    await fs.writeFile(path.join(directory,'base-manifest.json'),manifestBytes);
    const base=path.join(imageDirectory,'guest.ext4');baseHash??=await hashFile(base);assert.equal(baseHash,preparation.imageSha256);
    const disk=path.join(directory,'reconstructed.ext4');execFileSync('cp',['-c',base,disk]);assert.equal(await hashFile(disk),baseHash);
    const handle=await fs.open(disk,'r+');try{for(const row of rows){const result=await handle.write(delta,row.at,4096,row.offset);assert.equal(result.bytesWritten,4096);}}finally{await handle.close();}
    return {sync,capture,pair:{path:path.relative(output,pairPath),bytes:bytes.length,sha256:sha(bytes)},identity:decoded.identity,epoch:decoded.epoch,clockState:decoded.clockState,witness:decoded.witness,
      diskSha256:sha(delta),baseImageSha256:baseHash,manifestSha256:sha(manifestBytes),deltaBlocks:rows.length,directory,disk};
  }
  async function dump(proof,executable,stat,label){
    assert.match(executable,/^\/usr\/[A-Za-z0-9_./-]+$/);assert.ok(Number.isSafeInteger(stat.ino)&&stat.ino>0);
    const docker=command=>{
      const args=['run','--rm','--network','none','-v',proof.directory+':/proof','wasm-vm-omarchy-image:profile','debugfs','-R',command,'/proof/reconstructed.ext4'];
      const result=spawnSync('docker',args,{encoding:'utf8',maxBuffer:8*1024*1024});
      appendFileSync(path.join(proof.directory,'host-commands.ndjson'),JSON.stringify({command:['docker',...args],status:result.status,stdout:result.stdout,stderr:result.stderr,time:Date.now()})+'\n');
      assert.equal(result.status,0);return result.stdout;
    };
    const inode=docker('stat <'+stat.ino+'>'),pathname=docker('stat '+executable);
    await fs.writeFile(path.join(proof.directory,label+'-inode.txt'),inode);await fs.writeFile(path.join(proof.directory,label+'-path.txt'),pathname);
    for(const text of [inode,pathname]){
      assert.equal(Number(text.match(/Inode:\s+(\d+)/)?.[1]),stat.ino);assert.equal(Number(text.match(/\bSize:\s+(\d+)/)?.[1]),stat.size);
      assert.equal(parseInt(text.match(/\bMode:\s+0?([0-7]+)/)?.[1],8),stat.mode);
      assert.equal(Number(text.match(/User:\s+(\d+)/)?.[1]),stat.uid);assert.equal(Number(text.match(/Group:\s+(\d+)/)?.[1]),stat.gid);
      for(const [field,key]of [['mtime','mtimeNs'],['ctime','ctimeNs']]){
        const m=text.match(new RegExp(field+':\\s+0x([0-9a-f]+):([0-9a-f]+)'));
        assert.ok(m,'recorded ext4 timestamp');const extra=BigInt('0x'+m[2]);const ns=(BigInt('0x'+m[1])+((extra&3n)<<32n))*1000000000n+(extra>>2n);
        assert.equal(ns.toString(),String(stat[key]));
      }
    }
    const body=label+'.elf';await fs.writeFile(path.join(proof.directory,label+'-dump.txt'),docker('dump <'+stat.ino+'> /proof/'+body));
    const file=path.join(proof.directory,body);assert.equal((await fs.stat(file)).size,stat.size);
    const digest=await hashFile(file);assert.equal(digest,options.executables[executable]);
    const result={executable,executableSha256:digest,stat,body:path.relative(output,file)};await fs.writeFile(path.join(proof.directory,label+'-identity.json'),JSON.stringify(result,null,2)+'\n');return result;
  }
  return {
    async process(client,executable,label){
      const before=await metadata(client.pid,executable),prior=cache.get(executable);
      if(prior&&prior.after.data.pid===client.pid&&prior.after.data.starttime===before.data.starttime){stable(prior.after.data,before.data);const after=await metadata(client.pid,executable);stable(before.data,after.data);return{window:client,process:before.result,before,after,executable,executableSha256:prior.executableSha256,reusedProof:prior.proof};}
      if(before.data.exeStat.size<=1024*1024){
        const hash=await run('sha256sum /proc/'+client.pid+'/exe'),digest=hash.stdout.trim().split(/\s+/)[0];assert.equal(digest,options.executables[executable]);
        const after=await metadata(client.pid,executable);stable(before.data,after.data);
        const result={window:client,process:before.result,before,after,executable,executableSha256:digest,nativeHash:hash};cache.set(executable,result);return result;
      }
      const directory=path.join(output,label+'-filesystem');await fs.mkdir(directory,{recursive:false});
      const proof=await capture(directory),after=await metadata(client.pid,executable);stable(before.data,after.data);
      const body=await dump(proof,executable,before.data.exeStat,'executable');
      const receipt={...proof,directory:path.relative(output,proof.directory),disk:path.relative(output,proof.disk),before,after,body};
      await fs.writeFile(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
      const result={window:client,process:before.result,before,after,executable,executableSha256:body.executableSha256,proof:path.relative(output,path.join(directory,'receipt.json'))};cache.set(executable,result);return result;
    },
    async file(executable,label){
      const code=`import os,json,stat;s=os.stat(${JSON.stringify(executable)});print(json.dumps(dict(dev=s.st_dev,ino=s.st_ino,size=s.st_size,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,mtimeNs=str(s.st_mtime_ns),ctimeNs=str(s.st_ctime_ns))))`;
      const command='python3 -c '+quote(code),result=await run(command),stat=JSON.parse(result.stdout);
      assert.equal(stat.uid,0);assert.equal(stat.mode&0o022,0);
      const directory=path.join(output,label+'-filesystem');await fs.mkdir(directory,{recursive:false});const proof=await capture(directory);
      const after=await run(command);assert.deepEqual(JSON.parse(after.stdout),stat);
      const body=await dump(proof,executable,stat,'executable');const receipt={...proof,directory:path.relative(output,proof.directory),disk:path.relative(output,proof.disk),before:result,after,body};
      await fs.writeFile(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');return receipt;
    }
  };
}

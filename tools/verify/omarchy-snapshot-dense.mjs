// Regression for the native save path used by production GPU checkpoints. A literal RV64 guest
// writes alternating zero/nonzero RAM; the shipping WasmLinux saves, restores and saves it again.
// This is a RAM-allocation proof, not a Linux desktop or GPU qualification claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const out=path.resolve(process.argv[2]||'target/evidence/omarchy-snapshot-dense');
const fillMib=process.argv[3]===undefined?null:Number(process.argv[3]);
fs.mkdirSync(out,{recursive:false});
if(fillMib===null){
  const cases=[];
  for(const mib of [192,928]){
    const directory=path.join(out,'pattern-'+mib);
    const result=spawnSync(process.execPath,[fileURLToPath(import.meta.url),directory,String(mib)],
      {cwd:repo,encoding:'utf8',timeout:180000,maxBuffer:1024*1024});
    fs.writeFileSync(path.join(out,'pattern-'+mib+'.log'),result.stdout+'\n'+result.stderr);
    assert.equal(result.status,0,'real WasmLinux '+mib+' MiB dense RAM case: '+result.stderr);
    const body=fs.readFileSync(path.join(directory,'report.json'));
    const report=JSON.parse(body);assert.equal(report.status,'passed');
    cases.push({fillMib:mib,report:path.relative(out,path.join(directory,'report.json')),sha256:sha(body)});
  }
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({status:'passed',cases},null,2)+'\n');
  console.log('OMARCHY_DENSE_SNAPSHOT_PASS '+JSON.stringify(cases));
}else{
  assert.ok([192,928].includes(fillMib));
  const root=path.join(repo,'web/dist/pkg'),js=path.join(root,'wasm_vm_wasm.js');
  const binary=path.join(root,'wasm_vm_wasm_bg.wasm');
  const report={status:'running',scope:'1 GiB shipping-WasmLinux RAM snapshot bound and exact restore',
    head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),
    fillMib,ramMib:1024,source:{},stages:[]};
  for(const name of ['crates/core/src/resume.rs','tools/verify/omarchy-snapshot-dense.mjs',
    'web/dist/pkg/wasm_vm_wasm.js','web/dist/pkg/wasm_vm_wasm_bg.wasm']){
    const body=fs.readFileSync(path.join(repo,name));report.source[name]={bytes:body.length,sha256:sha(body)};
  }
  const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  const note=(name,values={})=>{report.stages.push({name,time:performance.now(),...values});save();};
  const I=(funct,rd,rs,imm)=>(((imm&4095)<<20)|(rs<<15)|(funct<<12)|(rd<<7)|0x13)>>>0;
  const L=(rd,imm)=>((imm<<12)|(rd<<7)|0x37)>>>0;
  const S=(rs,base,funct)=>((rs<<20)|(base<<15)|(funct<<12)|0x23)>>>0;
  const B=(rs1,rs2,offset)=>{const n=offset&8191;return ((((n>>12)&1)<<31)|(((n>>5)&63)<<25)|(rs2<<20)|(rs1<<15)|(6<<12)|(((n>>1)&15)<<8)|(((n>>11)&1)<<7)|0x63)>>>0;};
  // x5=0x82000000; x6=end; x7=0x00010001. Store a word, advance four bytes, loop;
  // emit 'X' through the real UART, then WFI. The untouched kernel/FDT regions stay outside fill.
  const words=[L(5,0x82),I(1,5,5,12),L(6,0x82+fillMib/16),I(1,6,6,12),L(7,0x10),I(0,7,7,1),
    S(7,5,2),I(0,5,5,4),B(5,6,-8),L(5,0x10000),I(0,6,0,88),S(6,5,0),0x10500073,0xffdff06f];
  const guest=Buffer.alloc(words.length*4);words.forEach((word,n)=>guest.writeUInt32LE(word,n*4));
  fs.writeFileSync(path.join(out,'guest.bin'),guest);
  report.guest={words,bytes:guest.length,sha256:sha(guest),rangeStart:'0x82000000',
    rangeEnd:'0x'+(0x82000000+fillMib*1024*1024).toString(16),patternWord:'0x00010001'};
  const begin=32*1024*1024,end=begin+fillMib*1024*1024;
  function inspect(snapshot){
    const bytes=Buffer.from(snapshot.buffer,snapshot.byteOffset,snapshot.byteLength);
    assert.equal(bytes.subarray(0,8).toString(),'WVMRESU1');assert.equal(bytes.readUInt32LE(8),1);
    let ram;
    for(let at=84;at<bytes.length;){
      assert.ok(at+8<=bytes.length);const tag=bytes.readUInt32LE(at),len=bytes.readUInt32LE(at+4);at+=8;
      assert.ok(at+len<=bytes.length);
      if(tag===2){assert.equal(ram,undefined);ram=bytes.subarray(at,at+len);}at+=len;
    }
    assert.ok(ram);assert.ok(ram.length<=1024*1024*1024+5,'RAM payload does not inflate');
    let decoded=0,checked=0,chunks=0;
    for(let at=0;at<ram.length;){
      assert.ok(at+5<=ram.length);const kind=ram[at],len=ram.readUInt32LE(at+1);at+=5;chunks++;
      assert.ok(len>0&&decoded+len<=1024*1024*1024);
      assert.ok(kind===0||kind===1);
      if(kind===1)assert.ok(at+len<=ram.length);
      const from=Math.max(begin,decoded),to=Math.min(end,decoded+len);
      let mismatch=-1;
      for(let offset=from;offset<to;offset++){
        const actual=kind===0?0:ram[at+offset-decoded],expected=(offset-begin)%2===0?1:0;
        if(actual!==expected){mismatch=offset;break;}
      }
      assert.equal(mismatch,-1,'every guest-written alternating byte matches');
      checked+=Math.max(0,to-from);decoded+=len;if(kind===1)at+=len;
    }
    assert.equal(decoded,1024*1024*1024);assert.equal(checked,fillMib*1024*1024);
    return{ramBytes:decoded,encodedBytes:ram.length,checkedPatternBytes:checked,chunks,ramPayloadSha256:sha(ram)};
  }
  let machine;
  try{
    const api=await import(pathToFileURL(js)),wasm=api.initSync({module:fs.readFileSync(binary)});let serial='';
    machine=new api.WasmLinux(1024,guest,new Uint8Array(),'',bytes=>{serial+=new TextDecoder().decode(bytes);},false);
    // The no-disk constructor has no resume base until the normal initramfs identity API stamps
    // its kernel binding. Bind this literal kernel before saving; never weaken a restore guard.
    const resumeIdentity=createHash('sha256').update(guest).digest();
    machine.stampBootSnapshotIdentity(resumeIdentity);report.resumeIdentity=resumeIdentity.toString('hex');
    machine.enableJit(1);const deadline=performance.now()+120000;let retired=0;
    while(!serial.includes('X')){
      assert.ok(performance.now()<deadline);const result=machine.runChunk(2000000);retired+=Number(result.retired);
      assert.ok(!result.done);assert.ok(retired<1000000000);
    }
    const clock=machine.guestClockState(),digest=machine.stateDigest();
    note('filled',{serial,retired,clock,digest,linearBytes:wasm.memory.buffer.byteLength});
    const first=machine.saveSnapshot();const proof=inspect(first);
    const compressed=gzipSync(first,{level:1});const name='original.snap.gz';fs.writeFileSync(path.join(out,name),compressed);
    note('saved',{...proof,snapshotBytes:first.length,snapshotSha256:sha(first),
      original:{path:name,bytes:compressed.length,sha256:sha(compressed)},linearBytes:wasm.memory.buffer.byteLength});
    assert.deepEqual(machine.guestClockState(),clock);assert.equal(machine.stateDigest(),digest);
    assert.equal(machine.restoreDecisionCode(first,machine.overlayGeneration()),'resume');
    machine.loadSnapshotBlob(first);
    assert.deepEqual(machine.guestClockState(),clock);assert.equal(machine.stateDigest(),digest);
    const second=machine.saveSnapshot();assert.deepEqual(inspect(second),proof);
    assert.deepEqual(machine.guestClockState(),clock);assert.equal(machine.stateDigest(),digest);
    assert.equal(machine.jitStats().guestRetired,retired,'save and restore do not retire guest instructions');
    note('restored-and-resaved',{...proof,clock,digest,input:machine.inputDeviceStats(),linearBytes:wasm.memory.buffer.byteLength});
    report.status='passed';
  }catch(error){report.status='failed';report.error={name:error.name,message:error.message,stack:error.stack};process.exitCode=1;}
  finally{report.finished=new Date().toISOString();save();if(report.status==='passed')machine?.free();}
}

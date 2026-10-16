// Lossless release packaging: keep every native/disk/renderer byte and binding.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {decodeGpuCheckpointPair,GPU_PAIR_MAX_BYTES} from '../../web/gpu-checkpoint.js';
import {decodeCheckpointData,encodeCheckpointData} from '../../web/renderer/virgl-command/checkpoint-codec.mjs';

const args=process.argv.slice(2),options={};
assert.ok(args.length===10||args.length===14,'--input FILE --sha256 DIGEST --identity FILE --output FILE --max-bytes INTEGER [--gzip-command FILE --gzip-sha256 DIGEST]');
for(let n=0;n<args.length;n+=2){assert.ok(['--input','--sha256','--identity','--output','--max-bytes','--gzip-command','--gzip-sha256'].includes(args[n]));assert.equal(options[args[n]],undefined);options[args[n]]=args[n+1];}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const maximum=Number(options['--max-bytes']);
assert.ok(Number.isSafeInteger(maximum)&&maximum>0&&maximum<=GPU_PAIR_MAX_BYTES);
assert.match(options['--sha256'],/^[a-f0-9]{64}$/);
assert.equal(Boolean(options['--gzip-command']),Boolean(options['--gzip-sha256']));
let compressor={implementation:'Node gzip',level:9,zlib:process.versions.zlib};
if(options['--gzip-command']){
  assert.match(options['--gzip-sha256'],/^[a-f0-9]{64}$/);
  const executable=path.resolve(options['--gzip-command']);
  assert.equal(hash(await fs.readFile(executable)),options['--gzip-sha256']);
  compressor={implementation:'authenticated host gzip executable',executable,sha256:options['--gzip-sha256'],arguments:['-12','-c','-']};
}
const original=await fs.readFile(options['--input']);
assert.equal(hash(original),options['--sha256'],'original captured factory pin');
const expected=JSON.parse(await fs.readFile(options['--identity']));
const before=await decodeGpuCheckpointPair(original,expected.identity);
const payload=decodeCheckpointData(original.subarray(16,-32)),parts=[];
for(const name of ['native','disk','renderer']){
  const old=payload.parts[name],raw=before[name];
  let bytes;
  if(compressor.executable){
    const result=spawnSync(compressor.executable,compressor.arguments,{input:Buffer.from(raw),maxBuffer:GPU_PAIR_MAX_BYTES,timeout:600000});
    assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr?.toString());
    bytes=result.stdout;
  }else bytes=await promisify(gzip)(raw,{level:9});
  assert.equal(hash(raw),old.sha256);assert.equal(raw.length,old.length);
  payload.parts[name]={...old,bytes:new Uint8Array(bytes),compressedSha256:hash(bytes)};
  parts.push({name,rawBytes:raw.length,rawSha256:hash(raw),
    originalGzipBytes:old.bytes.length,originalGzipSha256:old.compressedSha256,
    gzipBytes:bytes.length,gzipSha256:hash(bytes)});
}
const body=encodeCheckpointData(payload),packed=Buffer.alloc(body.length+48);
assert.ok(packed.length<=GPU_PAIR_MAX_BYTES);
original.copy(packed,0,0,8);packed.writeUInt32LE(1,8);packed.writeUInt32LE(body.length,12);
packed.set(body,16);packed.set(Buffer.from(hash(packed.subarray(0,-32)),'hex'),packed.length-32);
const after=await decodeGpuCheckpointPair(packed,expected.identity);
for(const name of ['identity','profile','epoch','clockState','witness','rendererSha256'])assert.deepEqual(after[name],before[name],name+' unchanged');
for(const name of ['native','disk','renderer'])assert.ok(Buffer.from(after[name]).equals(Buffer.from(before[name])),name+' full raw bytes unchanged');
assert.equal(hash(await fs.readFile(options['--input'])),options['--sha256'],'original capture remains unchanged');
if(compressor.executable)assert.equal(hash(await fs.readFile(compressor.executable)),compressor.sha256,'compressor remains unchanged');
await fs.writeFile(options['--output'],packed,{flag:'wx'});
await fs.copyFile(fileURLToPath(import.meta.url),options['--output']+'.source.mjs',fs.constants.COPYFILE_EXCL);
const report={status:packed.length<=maximum?'passed':'exceeds-upload-budget',
  scope:'Only gzip encoding changes; full original and repacked public decoding preserves every native/disk/renderer byte, identity, profile, epoch, guest clock and native GPU witness. Fresh browser restoration is still required.',
  input:{path:options['--input'],bytes:original.length,sha256:hash(original)},
  output:{path:options['--output'],bytes:packed.length,sha256:hash(packed)},maximumBytes:maximum,compressor,
  identity:after.identity,profile:after.profile,epoch:after.epoch,clockState:after.clockState,witness:after.witness,parts};
await fs.writeFile(options['--output']+'.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:report.status,input:report.input,output:report.output}));
if(report.status!=='passed')process.exitCode=1;

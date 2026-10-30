import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function authenticateOfflineBase(reportFile,manifestFile){
  const reportBytes=await fs.readFile(reportFile),report=JSON.parse(reportBytes);
  assert.equal(report.task,'E9-T22o');
  assert.equal(report.status,'authenticated-complete');
  assert.equal(report.manifestSha256,
    '8a793846f109a08242688fa32d531f230d7a3e2a7bdb3c694dbfc1abb70367a8');
  assert.equal(report.uniqueChunks,34687);
  const indexBytes=await fs.readFile(path.join(path.dirname(reportFile),'index.json'));
  assert.equal(sha(indexBytes),report.indexSha256,'offline base cache index changed');
  const cache=await fs.realpath(report.cache);
  const manifestBytes=await fs.readFile(manifestFile);
  assert.equal(sha(manifestBytes),report.manifestSha256,
    'frozen original base manifest changed');
  const image=JSON.parse(manifestBytes);
  assert.equal(image.image_len,12884901888);
  assert.equal(image.chunk_size,262144);
  const ids=[...new Set(image.chunks)].sort();
  assert.equal(ids.length,34687);
  const index=JSON.parse(indexBytes);
  assert.equal(index.length,ids.length);
  assert.deepEqual(index.map(row=>row.sha256).sort(),ids,
    'offline cache does not cover original manifest');
  assert.deepEqual((await fs.readdir(cache)).sort(),ids.map(id=>id+'.bin').sort(),
    'offline cache has missing or extra members');
  const files=new Map();
  for(const row of index){
    assert.equal(row.bytes,262144);
    const file=path.join(cache,row.sha256+'.bin'),stat=await fs.lstat(file);
    assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===262144,
      'offline base member shape '+row.sha256);
    assert.equal(sha(await fs.readFile(file)),row.sha256,
      'offline base member differs from original image '+row.sha256);
    files.set(row.sha256,file);
  }
  return {files,image,reportSha256:sha(reportBytes),indexSha256:report.indexSha256,
    manifestSha256:report.manifestSha256,cache,uniqueChunks:ids.length,
    bytes:String(ids.length*262144)};
}

// Shared by the real offline-base IPC path and its negative input probes.
export async function verifiedBaseRequest(files,ref){
  assert(/^[0-9a-f]{64}$/.test(ref?.sha256)&&ref?.length==='262144',
    'offline base request shape');
  const file=files.get(ref.sha256);
  assert(file,'offline base request is outside the authenticated original image');
  const bytes=await fs.readFile(file);
  assert.equal(bytes.length,262144,'offline base length changed');
  assert.equal(sha(bytes),ref.sha256,'offline base bytes changed since preflight');
  return bytes;
}

// The first authenticated original gears depth create/surface, with no output image.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {repo,sha256} from './fixtures.mjs';

export async function loadDepthFixtures(){
  const sources=[];
  async function bound(file,expected){const b=await fs.readFile(path.join(repo,file));if(expected)assert.equal(sha256(b),expected,file);sources.push({path:file,bytes:b.length,sha256:sha256(b)});return b;}
  const capture='evidence/virgl-workload-inventory/captures/es2gears';
  const inventory=JSON.parse(await bound('evidence/virgl-workload-inventory/es2gears-inventory.json','fb91301b9e14b098e0d8a590ddb7fa33ead15972195211741a5efcc3d58e9a3c'));
  const manifest=JSON.parse(await bound(capture+'/manifest.json','202500d87a7e31a5c04f192852bb9a23dedce8681fb3ee4850e0738aee30e8a8'));
  const events=(await bound(capture+'/events.jsonl',manifest.events.sha256)).toString().trim().split('\n').map(JSON.parse);
  const surface=inventory.clientObjects.find(o=>o.kind==='SURFACE'&&o.fields.format===16);assert.ok(surface);
  const resource=inventory.resources.find(r=>r.key===surface.resource),event=events[resource.createEvent-1];assert.equal(event.seq,resource.createEvent);assert.equal(event.type,'resource_create');assert.equal(event.phase,'enter');
  const metadata={id:event.resourceId};
  for(const key of ['target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags']){assert.equal(event[key],resource[key]);metadata[key]=event[key];}
  assert.equal(metadata.format,16);assert.equal(metadata.bind,1);
  const citation=surface.citation,submit=events[citation.event-1];assert.equal(submit.seq,citation.event);assert.equal(submit.type,'submit_cmd');assert.equal(submit.phase,'enter');assert.equal(submit.ctxId,citation.contextId);
  const ref=submit.blobs.find(b=>b.role==='command');assert.equal(ref.sha256,citation.blobSha256);
  let file=capture+'/blobs/'+ref.sha256+'.bin',bytes;
  try{bytes=await bound(file);}catch(error){if(error.code!=='ENOENT')throw error;file+='.gz';bytes=gunzipSync(await bound(file),{maxOutputLength:ref.bytes});}
  assert.equal(bytes.length,ref.bytes);assert.equal(sha256(bytes),ref.sha256);
  const packet=bytes.subarray(citation.byteOffset,citation.byteOffset+citation.byteLength);assert.equal(sha256(packet),citation.packetSha256);assert.equal(packet.readUInt32LE(0),0x00050801);assert.equal(packet.readUInt32LE(8),metadata.id);assert.equal(packet.readUInt32LE(12),16);
  return{fixtures:{original:{metadata,contextId:citation.contextId,resourceKey:resource.key,createEvent:event.seq,handle:surface.handle,packet:[...packet],citation},boundary:'Original selected depth create/surface only; no full client draw or guest execution.'},sources};
}

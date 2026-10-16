// Original normal uploads stay distinct from synthetic inline-write evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {repo,sha256} from './fixtures.mjs';
import {decodeSubmission} from '../../renderer/virgl-command/decoder.mjs';

export async function loadInlineFixtures(){
  const sources=[],original=[];
  async function bound(file,expected){const raw=await fs.readFile(path.join(repo,file));if(expected)assert.equal(sha256(raw),expected,file);if(!sources.some(x=>x.path===file))sources.push({path:file,bytes:raw.length,sha256:sha256(raw)});return raw;}
  async function blob(capture,ref){let raw;try{raw=await bound(capture+'/blobs/'+ref.sha256+'.bin');}catch(error){if(error.code!=='ENOENT')throw error;raw=gunzipSync(await bound(capture+'/blobs/'+ref.sha256+'.bin.gz'),{maxOutputLength:ref.bytes});}assert.equal(raw.length,ref.bytes);assert.equal(sha256(raw),ref.sha256);return raw;}
  for(const[workload,capture,digest]of [
    ['kmscube','evidence/virgl-corpus/captures/kmscube','8a1fb71fdd3f4d4c3696104690e11af480e5f1b95634bd077a1fcef1636b7b8c'],
    ['es2gears','evidence/virgl-workload-inventory/captures/es2gears','fb91301b9e14b098e0d8a590ddb7fa33ead15972195211741a5efcc3d58e9a3c'],
  ]){
    const inv=JSON.parse(await bound('evidence/virgl-workload-inventory/'+workload+'-inventory.json',digest));
    assert.equal(inv.clientInlineWriteCount,0);
    const manifest=JSON.parse(await bound(capture+'/manifest.json',inv.captureManifestSha256));
    const events=(await bound(capture+'/events.jsonl',manifest.events.sha256)).toString().trim().split('\n').map(JSON.parse);
    for(const transfer of inv.clientTransfers){
      const citation=transfer.citation,resource=inv.resources.find(r=>r.key===transfer.resource),event=events[resource.createEvent-1];
      assert.equal(event.seq,resource.createEvent);assert.equal(event.phase,'enter');assert.equal(event.type,'resource_create');
      const metadata={id:event.resourceId};for(const key of ['target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags']){assert.equal(event[key],resource[key]);metadata[key]=event[key];}
      const submit=events[citation.event-1];assert.equal(submit.type,'submit_cmd');assert.equal(submit.ctxId,citation.contextId);
      const command=submit.blobs.find(b=>b.role==='command');assert.equal(command.sha256,citation.blobSha256);
      const raw=await blob(capture,command),packet=raw.subarray(citation.byteOffset,citation.byteOffset+citation.byteLength);assert.equal(sha256(packet),citation.packetSha256);
      const decoded=decodeSubmission(packet);assert.equal(decoded.ok,true);assert.equal(decoded.commands.length,1);assert.equal(decoded.commands[0].opcode,43);
      const snapshot=events.slice(0,citation.event-1).findLast(e=>e.type==='backing_snapshot'&&e.resourceId===metadata.id&&e.reason==='submit');
      assert.ok(snapshot);assert.equal(snapshot.blobs.length,1);assert.equal(snapshot.blobs[0].role,'backing');
      const backing=await blob(capture,snapshot.blobs[0]);assert.equal(snapshot.iovLengths.reduce((a,b)=>a+b,0),backing.length);
      const f=decoded.commands[0].fields;assert.equal(f.direction,1);assert.equal(f.stride,0);assert.equal(f.layerStride,0);assert.equal(f.dataOffset,0);
      const used=f.box.width*f.box.height*(metadata.target===2?4:1);
      original.push({workload,metadata,contextId:citation.contextId,citation,packet:[...packet],snapshotEvent:snapshot.seq,
        backingSha256:sha256(backing),iovLengths:snapshot.iovLengths,backingBase64:backing.toString('base64'),usedBytes:used,denseSha256:sha256(backing.subarray(0,used))});
    }
  }
  assert.deepEqual(original.map(x=>x.metadata.id),[5,4,36,37,38]);
  return{fixtures:{original,clientInlineWriteCounts:{kmscube:0,es2gears:0},boundary:'Five original CPU-input TRANSFER3D packets; all inline writes are synthetic, never captured output.'},sources};
}

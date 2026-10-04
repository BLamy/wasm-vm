// G1's authenticated originals, selected by lifetime and packet/backing citation.
// No reference-rendered image is an upload input.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { repo, sha256 } from './fixtures.mjs';
import { loadDrawFixtures } from './draw-fixtures.mjs';

export async function loadColorFixtures() {
  const sources = [], colors = [];
  async function bound(relative, expected) {
    const bytes = await fs.readFile(path.join(repo,relative));
    if (expected) assert.equal(sha256(bytes),expected,relative);
    if (!sources.some(s=>s.path===relative)) sources.push({path:relative,bytes:bytes.length,sha256:sha256(bytes)});
    return bytes;
  }
  let upload;
  for (const [workload, inventoryDigest, capture, manifestDigest] of [
    ['kmscube','8a1fb71fdd3f4d4c3696104690e11af480e5f1b95634bd077a1fcef1636b7b8c',
      'evidence/virgl-corpus/captures/kmscube','f336ce65bbf4827ab6b7f43d76b6be9badbc8c81a3576116095d09615dfbb77f'],
    ['es2gears','fb91301b9e14b098e0d8a590ddb7fa33ead15972195211741a5efcc3d58e9a3c',
      'evidence/virgl-workload-inventory/captures/es2gears','202500d87a7e31a5c04f192852bb9a23dedce8681fb3ee4850e0738aee30e8a8'],
  ]) {
    const inventory = JSON.parse(await bound(`evidence/virgl-workload-inventory/${workload}-inventory.json`,inventoryDigest));
    const manifest = JSON.parse(await bound(`${capture}/manifest.json`,manifestDigest));
    const events = JSON.parse('['+(await bound(`${capture}/events.jsonl`,manifest.events.sha256)).toString().trim().split('\n').join(',')+']');
    const event = seq => { const e=events[seq-1]; assert.equal(e.seq,seq); return e; };
    async function blob(ref) {
      let file=`${capture}/blobs/${ref.sha256}.bin`, encoded, raw;
      try { raw=encoded=await bound(file); }
      catch (error) {
        if (error.code!=='ENOENT') throw error;
        file+='.gz'; encoded=await bound(file); raw=gunzipSync(encoded,{maxOutputLength:ref.bytes});
      }
      assert.equal(raw.length,ref.bytes); assert.equal(sha256(raw),ref.sha256);
      return raw;
    }
    function metadata(key) {
      const r=inventory.resources.find(r=>r.key===key), e=event(r.createEvent);
      assert.equal(e.type,'resource_create'); assert.equal(e.phase,'enter'); assert.equal(e.resourceId,r.resourceId);
      const meta={id:e.resourceId};
      for (const field of ['target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags']) {
        assert.equal(e[field],r[field]); meta[field]=e[field];
      }
      return {metadata:meta,resourceKey:key,resourceCreateEvent:e.seq};
    }
    async function packet(citation) {
      const e=event(citation.event);
      assert.equal(e.type,'submit_cmd'); assert.equal(e.phase,'enter'); assert.equal(e.ctxId,citation.contextId);
      assert.equal(e.blobs[0].role,'command'); assert.equal(e.blobs[0].sha256,citation.blobSha256);
      const bytes=(await blob(e.blobs[0])).subarray(citation.byteOffset,citation.byteOffset+citation.byteLength);
      assert.equal(bytes.length,citation.byteLength); assert.equal(sha256(bytes),citation.packetSha256);
      assert.equal(((bytes.readUInt32LE(0)>>>16)+1)*4,bytes.length);
      return [...bytes];
    }
    const fmt=workload==='kmscube'?2:233;
    const surface=inventory.clientObjects.find(o=>o.kind==='SURFACE'&&o.fields.format===fmt);
    assert.ok(surface); assert.ok(surface.context.startsWith(surface.citation.contextId+'@'));
    const selected=await packet(surface.citation);
    const words=Buffer.from(selected);
    assert.equal(words.readUInt32LE(0),0x00050801);
    assert.equal(words.readUInt32LE(8),metadata(surface.resource).metadata.id);
    assert.equal(words.readUInt32LE(12),fmt);
    colors.push({workload,...metadata(surface.resource),contextId:surface.citation.contextId,
      handle:words.readUInt32LE(4),packet:selected,citation:surface.citation,
      boundary:'Original resource create and color-surface packet only; full client draw/depth/shader closure is later.'});
    if (workload==='kmscube') {
      const t=inventory.clientTransfers.find(t=>t.opcode==='TRANSFER3D'&&inventory.resources.find(r=>r.key===t.resource).format===67);
      assert.equal(t.direction,1); assert.equal(t.dataOffset,0);
      const snapshot=event(t.backingAtSubmit.event);
      assert.equal(snapshot.type,'backing_snapshot'); assert.equal(snapshot.reason,'submit');
      assert.equal(snapshot.resourceId,metadata(t.resource).metadata.id);
      const bytes=await blob(snapshot.blobs[0]);
      assert.equal(bytes.length,512*512*4); assert.equal(snapshot.iovLengths.reduce((a,b)=>a+b,0),bytes.length);
      upload={...metadata(t.resource),contextId:t.citation.contextId,packet:await packet(t.citation),
        citation:t.citation,backingEvent:snapshot.seq,backingSha256:snapshot.blobs[0].sha256,
        iovLengths:snapshot.iovLengths,bytes:[...bytes],boundary:'Original CPU upload, never reference-rendered output.'};
    }
  }
  const tiny=await loadDrawFixtures();
  for (const source of tiny.sources) if (!sources.some(s=>s.path===source.path)) sources.push(source);
  return {fixtures:{colors,upload,tiny:tiny.fixtures},sources};
}

// Select complete original first client submissions and CPU inputs, never GPU output.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {repo,sha256} from './fixtures.mjs';
import {loadInlineFixtures} from './inline-fixtures.mjs';

export async function loadRasterFixtures(){
  const loaded=await loadInlineFixtures(),sources=new Map(loaded.sources.map(x=>[x.path,x])),clients=[];
  async function bound(file,digest){const b=await fs.readFile(path.join(repo,file));if(digest)assert.equal(sha256(b),digest,file);sources.set(file,{path:file,bytes:b.length,sha256:sha256(b)});return b;}
  async function blob(capture,ref){let b;try{b=await bound(capture+'/blobs/'+ref.sha256+'.bin');}catch(e){if(e.code!=='ENOENT')throw e;b=gunzipSync(await bound(capture+'/blobs/'+ref.sha256+'.bin.gz'),{maxOutputLength:ref.bytes});}assert.equal(b.length,ref.bytes);assert.equal(sha256(b),ref.sha256);return b;}
  for(const[workload,capture,digest,selected,ids]of[
    ['kmscube','evidence/virgl-corpus/captures/kmscube','8a1fb71fdd3f4d4c3696104690e11af480e5f1b95634bd077a1fcef1636b7b8c',[140,154,176],[4,5,6]],
    ['es2gears','evidence/virgl-workload-inventory/captures/es2gears','fb91301b9e14b098e0d8a590ddb7fa33ead15972195211741a5efcc3d58e9a3c',[5115],[34,35,36,37,38]],
  ]){
    const inv=JSON.parse(await bound('evidence/virgl-workload-inventory/'+workload+'-inventory.json',digest));
    const manifest=JSON.parse(await bound(capture+'/manifest.json',inv.captureManifestSha256));
    const events=(await bound(capture+'/events.jsonl',manifest.events.sha256)).toString().trim().split('\n').map(JSON.parse);
    const contextId=inv.clientDraws[0].citation.contextId,resources=[];
    for(const id of ids){
      const r=inv.resources.find(r=>r.resourceId===id),e=events[r.createEvent-1];
      assert.equal(e.type,'resource_create');assert.equal(e.phase,'enter');assert.equal(e.resourceId,id);
      const metadata={id};for(const key of ['target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags']){assert.equal(e[key],r[key]);metadata[key]=e[key];}
      const upload=loaded.fixtures.original.find(x=>x.workload===workload&&x.metadata.id===id);
      resources.push({metadata,resourceKey:r.key,createEvent:e.seq,upload:upload??null});
    }
    const submissions=[];
    for(const seq of selected){const e=events[seq-1];assert.equal(e.seq,seq);assert.equal(e.type,'submit_cmd');assert.equal(e.phase,'enter');assert.equal(e.ctxId,contextId);
      assert.equal(events.find(x=>x.callSeq===seq&&x.phase==='return').result,0);
      const ref=e.blobs.find(x=>x.role==='command'),raw=await blob(capture,ref),packets=[];
      for(let at=0;at<raw.length;){const header=raw.readUInt32LE(at),bytes=((header>>>16)+1)*4;assert.ok(bytes<=raw.length-at);
        const packet=raw.subarray(at,at+bytes),citation=inv.clientPackets.find(p=>p.citation.event===seq&&p.citation.byteOffset===at)?.citation;
        assert.ok(citation,'every packet must join the immutable client inventory');assert.equal(citation.packetSha256,sha256(packet));assert.equal(citation.byteLength,bytes);
        packets.push({citation,opcode:header&255,objectType:(header>>>8)&255,words:Array.from({length:bytes/4-1},(_,i)=>packet.readUInt32LE(4+i*4))});at+=bytes;}
      submissions.push({event:seq,sourceSha256:ref.sha256,data:[...raw],packets});
    }
    clients.push({workload,contextId,resources,submissions,draws:inv.clientDraws.filter(d=>selected.includes(d.citation.event)),
      inventorySha256:digest,eventsSha256:manifest.events.sha256});
  }
  assert.deepEqual(clients.map(x=>[x.workload,x.draws.length]),[['kmscube',6],['es2gears',3]]);
  return{fixtures:{clients,boundary:'Complete first client submissions and original CPU inputs; isolated rendering, no live guest or performance claim.'},sources:[...sources.values()]};
}

// Authenticated original client view/sampler packets; synthetic variants are separate.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {repo,sha256} from './fixtures.mjs';
import {loadDrawFixtures} from './draw-fixtures.mjs';

export async function loadViewFixtures(){
  const {fixtures:tiny,sources}=await loadDrawFixtures();
  async function bound(file,expected){const b=await fs.readFile(path.join(repo,file));if(expected)assert.equal(sha256(b),expected,file);if(!sources.some(s=>s.path===file))sources.push({path:file,bytes:b.length,sha256:sha256(b)});return b;}
  const capture='evidence/virgl-corpus/captures/kmscube',inventory=JSON.parse(await bound('evidence/virgl-workload-inventory/kmscube-inventory.json','8a1fb71fdd3f4d4c3696104690e11af480e5f1b95634bd077a1fcef1636b7b8c'));
  const manifest=JSON.parse(await bound(capture+'/manifest.json','f336ce65bbf4827ab6b7f43d76b6be9badbc8c81a3576116095d09615dfbb77f'));
  const events=(await bound(capture+'/events.jsonl',manifest.events.sha256)).toString().trim().split('\n').map(JSON.parse);
  const view=inventory.clientObjects.find(o=>o.kind==='SAMPLER_VIEW'),sampler=inventory.clientObjects.find(o=>o.kind==='SAMPLER_STATE'),resource=inventory.resources.find(r=>r.key===view.resource),event=events[resource.createEvent-1];
  assert.equal(event.seq,resource.createEvent);assert.equal(event.type,'resource_create');assert.equal(event.phase,'enter');
  const metadata={id:event.resourceId};for(const key of ['target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags']){assert.equal(event[key],resource[key]);metadata[key]=event[key];}
  async function packet(object){const c=object.citation,e=events[c.event-1];assert.equal(e.seq,c.event);assert.equal(e.ctxId,c.contextId);assert.equal(e.type,'submit_cmd');const ref=e.blobs.find(b=>b.role==='command');assert.equal(ref.sha256,c.blobSha256);let raw;
    try{raw=await bound(capture+'/blobs/'+ref.sha256+'.bin');}catch(error){if(error.code!=='ENOENT')throw error;raw=gunzipSync(await bound(capture+'/blobs/'+ref.sha256+'.bin.gz'),{maxOutputLength:ref.bytes});}assert.equal(raw.length,ref.bytes);assert.equal(sha256(raw),ref.sha256);const b=raw.subarray(c.byteOffset,c.byteOffset+c.byteLength);assert.equal(sha256(b),c.packetSha256);return[...b];}
  const retainedPairs={};
  for(const[key,file,expected]of [
    ['vertex','renderer/virgl-shader/tests/passthrough.vert.tgsi'],['smooth','renderer/virgl-shader/tests/linkage.frag.tgsi'],
    ['flat','evidence/virgl-corpus/captures/compositor/shaders/67c701faf0ee06bcefdc246cd8b73f7b8d6278cc2403aa99c18d1912fbb9a0aa.tgsi','67c701faf0ee06bcefdc246cd8b73f7b8d6278cc2403aa99c18d1912fbb9a0aa'],
    ['missingVertex','evidence/virgl-corpus/captures/compositor/shaders/0ec6a7a8741638e5a62cbf4a1f6896dd91bb2d60182e8e01f60866adf40fbed6.tgsi','0ec6a7a8741638e5a62cbf4a1f6896dd91bb2d60182e8e01f60866adf40fbed6'],
    ['partialVertex','evidence/virgl-corpus/captures/glmark2-es2/shaders/23b5f8a83172e68c9365028d2f3fedbb4d0a12d3b02a39b694388e89304910d3.tgsi','23b5f8a83172e68c9365028d2f3fedbb4d0a12d3b02a39b694388e89304910d3'],
  ]){const raw=await bound(file,expected);retainedPairs[key]={path:file,text:raw.toString(),sha256:sha256(raw),bytes:raw.length};}
  return{fixtures:{tiny,retainedPairs,original:{metadata,contextId:view.citation.contextId,subcontext:view.citation.subcontext,resourceKey:resource.key,view:{handle:view.handle,packet:await packet(view),citation:view.citation},sampler:{handle:sampler.handle,packet:await packet(sampler),citation:sampler.citation}},boundary:'Original selected kmscube VIEW/SAMPLER packets; other view and shader variants are synthetic.'},sources};
}

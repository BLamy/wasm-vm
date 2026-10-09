// Join immutable client requirements to the bounded, independently measured profile.
// The native backend below proves metadata/role guards, never GPU pixels.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {repo, sha256} from '../virgl-command/fixtures.mjs';
import {loadInlineFixtures} from '../virgl-command/inline-fixtures.mjs';
import {loadViewFixtures} from '../virgl-command/view-fixtures.mjs';
import {createResourceStore, RESOURCE_LIMITS} from '../../renderer/virgl-command/resources.mjs';
import {decodeSubmission} from '../../renderer/virgl-command/decoder.mjs';

const output = process.argv[2];
assert.ok(output, 'output JSON path required');
const inputs = new Map(), assertions = [];
const equal = (actual, expected, prediction) => {
  assert.deepEqual(actual, expected, prediction);
  assertions.push({prediction, actual, expected, held:true});
};
async function bound(file, digest) {
  const raw = await fs.readFile(path.join(repo, file));
  if (digest) assert.equal(sha256(raw), digest, file);
  inputs.set(file, {path:file, bytes:raw.length, sha256:sha256(raw)});
  return raw;
}
const index = JSON.parse(await bound('evidence/virgl-workload-inventory/index.json'));
equal(index.schema, 'virgl-required-workload-evidence-v1', 'original inventory schema');
const expected = {
  kmscube:[[2,2,'color-surface'],[64,0,'vertex-buffer'],[67,2,'sampler-view']],
  es2gears:[[16,2,'depth-stencil-surface'],[64,0,'vertex-buffer'],[233,2,'color-surface']],
};
const roleNames = {'color-surface':'surface','depth-stencil-surface':'depth-surface',
  'vertex-buffer':'vertex','sampler-view':'view'};
const metadataKeys = ['target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags'];
const roleMatrix = [], originalPackets = [], unavailable = [], topology = [];
for (const workload of ['kmscube','es2gears']) {
  const pin = index[workload === 'kmscube' ? 'kmscubeInventory':'gearsInventory'];
  const inv = JSON.parse(await bound('evidence/virgl-workload-inventory/'+pin.path,pin.sha256));
  equal(inv.clientResourceFormats.map(r=>[r.format,r.targets[0],r.roles[0]]),expected[workload],workload+' literal client role matrix');
  equal(inv.clientInlineWriteCount,0,workload+' original inline-write requirement count');
  const capture = workload === 'kmscube' ? 'evidence/virgl-corpus/captures/kmscube':'evidence/virgl-workload-inventory/captures/es2gears';
  const manifest = JSON.parse(await bound(capture+'/manifest.json',inv.captureManifestSha256));
  const events = (await bound(capture+'/events.jsonl',manifest.events.sha256)).toString().trim().split('\n').map(JSON.parse);
  const blobs = new Map();
  async function blob(ref) {
    if (!blobs.has(ref.sha256)) {
      let raw;
      try { raw=await bound(capture+'/blobs/'+ref.sha256+'.bin'); }
      catch(error) {
        if(error.code!=='ENOENT') throw error;
        raw=gunzipSync(await bound(capture+'/blobs/'+ref.sha256+'.bin.gz'),{maxOutputLength:ref.bytes});
      }
      assert.equal(raw.length,ref.bytes); assert.equal(sha256(raw),ref.sha256);
      blobs.set(ref.sha256,raw);
    }
    return blobs.get(ref.sha256);
  }
  for (const object of inv.clientObjects.filter(o=>['SURFACE','SAMPLER_VIEW','SAMPLER_STATE'].includes(o.kind))) {
    const citation=object.citation, event=events[citation.event-1];
    equal([event.seq,event.type,event.phase,event.ctxId],[citation.event,'submit_cmd','enter',citation.contextId],workload+' original object event '+object.key);
    const ref=event.blobs.find(b=>b.role==='command'); assert.equal(ref.sha256,citation.blobSha256);
    const packet=(await blob(ref)).subarray(citation.byteOffset,citation.byteOffset+citation.byteLength);
    assert.equal(packet.length,citation.byteLength);assert.equal(sha256(packet),citation.packetSha256);
    const decoded=decodeSubmission(packet);
    equal(decoded.ok,true,workload+' exact original '+object.kind+' packet admits');
    equal(decoded.commands.length,1,'one original object packet');
    originalPackets.push({workload,kind:object.kind,resource:object.resource,citation,decoded:decoded.commands[0]});
    if(object.kind==='SURFACE') equal([object.fields.level,object.fields.firstLayer,object.fields.lastLayer],[0,0,0],'original surface has no mip/layer requirement');
    if(object.kind==='SAMPLER_VIEW') equal([object.fields.target,object.fields.firstLevel,object.fields.lastLevel,object.fields.firstLayer,object.fields.lastLayer,object.fields.swizzle],[2,0,0,0,0,[0,1,2,3]],'original view is level-zero 2D identity');
    if(object.kind==='SAMPLER_STATE') equal([object.fields.wrapS,object.fields.wrapT,object.fields.minImageFilter,object.fields.magImageFilter,object.fields.minMipFilter,object.fields.compareMode,object.fields.maxAnisotropy],[2,2,1,1,2,0,0],'original sampler is clamp-edge linear without mip/compare/aniso');
  }
  for (const requirement of inv.clientResourceFormats) {
    equal(requirement.flags,[0],'client format uses lower-left flags zero');
    for (const key of requirement.resources) {
      const resource=inv.resources.find(r=>r.key===key), event=events[resource.createEvent-1];
      equal([event.type,event.phase,event.seq,event.resourceId],['resource_create','enter',resource.createEvent,resource.resourceId],'original resource lifetime '+key);
      const metadata={id:event.resourceId};
      for(const field of metadataKeys) { assert.equal(event[field],resource[field]);metadata[field]=event[field]; }
      equal([metadata.depth,metadata.arraySize,metadata.lastLevel,metadata.nrSamples,metadata.flags],[1,1,0,0,0],'original client resource is one layer/level/sample');
      const backend={maxTextureSize:16384,allocate:m=>({metadata:m}),destroy(){},upload(){},readback(){throw new Error('native role proof may not claim pixels');},dispose(){}};
      const rig=createResourceStore({backend});assert.equal(rig.ok,true);
      assert.equal(rig.store.createContext(1).ok,true);assert.equal(rig.store.createResource(metadata).ok,true);
      assert.equal(rig.store.attachContext(1,metadata.id).ok,true);
      const roles=requirement.roles.map(r=>roleNames[r]);
      // A resource may carry additional render/sampler bind roles. Admit exactly
      // those explicit binds, independently of the observed client's selected role.
      if(metadata.target===2&&metadata.format!==16) {
        if(metadata.bind&2&&!roles.includes('surface')) roles.push('surface');
        if(metadata.bind&8&&!roles.includes('view')) roles.push('view');
      }
      roles.push('readback');
      for(const role of ['view','surface','depth-surface','vertex','index','readback']) {
        const retained=rig.store.retainStorage(1,metadata.id,role);
        equal(retained.ok,roles.includes(role),'original '+key+' role '+role);
        if(retained.ok) assert.equal(rig.store.releaseStorage(retained.lease).ok,true);
      }
      assert.equal(rig.store.dispose().ok,true);
      equal(Object.values(rig.store.inspect().budgets).every(v=>v===0),true,'all original metadata role charges released');
      roleMatrix.push({workload,key,metadata,requiredRoles:requirement.roles,admittedRoles:roles,createEvent:resource.createEvent});
    }
  }
  topology.push({workload,clientInlineWrites:0,requiredMips:0,requiredCubeFaces:0,requiredArrayLayers:0,
    proof:'Every original client resource and surface/view packet above is authenticated and bounded to level/layer zero; cube targets are absent.'});
  for(const resource of inv.resources.filter(r=>![2,16,64,67,233].includes(r.format))) {
    const metadata={id:resource.resourceId};for(const field of metadataKeys) metadata[field]=resource[field];
    const rig=createResourceStore({backend:{maxTextureSize:16384,allocate(){throw new Error('unsupported format allocated');},destroy(){},upload(){},readback(){},dispose(){}}});
    assert.equal(rig.ok,true);
    equal(rig.store.createResource(metadata).ok,false,'supporting-only '+resource.key+' unmeasured format stays closed');
    assert.equal(rig.store.dispose().ok,true);
    unavailable.push({workload,key:resource.key,metadata,gate:'E6-T11d requires a separately verified S boundary if live bring-up needs this supporting format.'});
  }
}
const uploads=await loadInlineFixtures(),views=await loadViewFixtures();
for(const source of [...uploads.sources,...views.sources]) inputs.set(source.path,source);
equal(uploads.fixtures.original.map(t=>[t.workload,t.metadata.id,t.citation.event,t.citation.byteOffset,t.snapshotEvent,t.usedBytes]),
  [['kmscube',5,140,0,139,1048576],['kmscube',4,154,0,152,1056],['es2gears',36,5115,0,5112,22992],['es2gears',37,5115,56,5113,11472],['es2gears',38,5115,112,5114,11472]],'all original CPU uploads, never rendered output');
equal([views.fixtures.original.view.citation.event,views.fixtures.original.view.citation.byteOffset,views.fixtures.original.sampler.citation.byteOffset],[176,4400,4444],'exact original view/sampler packet positions');
const profile={id:1,target:2,format:67,bind:10,width:3,height:2,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0};
const forbidden=[];
for(const change of [{format:1},{format:20},{format:177},{target:3},{target:4},{target:5},{target:6},{target:7},{target:8},{lastLevel:1},{arraySize:2},{depth:2},{nrSamples:4},{flags:1}]) {
  const rig=createResourceStore({backend:{maxTextureSize:16384,allocate(){throw new Error('closed topology allocated');},destroy(){},upload(){},readback(){},dispose(){}}});
  assert.equal(rig.ok,true);
  equal(rig.store.createResource({...profile,...change}).ok,false,'closed format/topology '+JSON.stringify(change));
  assert.equal(rig.store.dispose().ok,true);forbidden.push(change);
}
const result={schema:'virgl-required-format-closure-v1',task:'E6-T12g6',status:'passed',
  gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),
  guestExecution:false,productionNegotiation:false,roles:roleMatrix,originalPackets,topology,unavailable,
  shaderBodies:[...index.additionalClientShaders,...index.additionalSupportingShaders],
  uploads:uploads.fixtures.original.map(({backingBase64,packet,...entry})=>entry),
  view:views.fixtures.original,limits:RESOURCE_LIMITS,forbidden,inputs:[...inputs.values()],assertions};
await fs.mkdir(path.dirname(path.resolve(output)),{recursive:true});
await fs.writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(`Client format closure: ${roleMatrix.length} resource lifetimes, ${originalPackets.length} original packets, ${assertions.length} guards`);

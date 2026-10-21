// Independent byte-level inputs for the archive rejection proof; no production codec imports.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const reference = bytes => ({sha256: hash(bytes), length: String(bytes.length)});
export function readArchive(bytes) {
  assert.equal(bytes.subarray(0, 8).toString(), 'WVBUND01'); assert.equal(bytes.readUInt32LE(8), 1);
  const header = JSON.parse(bytes.subarray(16, 16 + bytes.readUInt32LE(12))), objects = new Map(); let at = 16 + bytes.readUInt32LE(12);
  for (const ref of header.objects) {
    const body = bytes.subarray(at, at + Number(ref.length)); assert.equal(body.length, Number(ref.length)); assert.equal(hash(body), ref.sha256);
    assert(!objects.has(ref.sha256)); objects.set(ref.sha256, Buffer.from(body)); at += body.length;
  }
  assert.equal(at, bytes.length); return {header, objects};
}
function pack(header, parts, text = JSON.stringify(header)) {
  const json = Buffer.from(text), prefix = Buffer.alloc(16); prefix.write('WVBUND01'); prefix.writeUInt32LE(1, 8); prefix.writeUInt32LE(json.length, 12);
  return Buffer.concat([prefix, json, ...parts]);
}
function rebuild(archive) {
  archive.header.objects = [...archive.objects].map(([sha256, bytes]) => ({sha256, length: String(bytes.length)})).sort((a, b) => a.sha256 < b.sha256 ? -1 : 1);
  archive.header.uncompressedBytes = String(archive.header.objects.reduce((sum, ref) => sum + Number(ref.length), 0));
  return pack(archive.header, archive.header.objects.map(ref => archive.objects.get(ref.sha256)));
}
export function changeManifest(bytes, update) {
  const archive = readArchive(bytes), prior = archive.header.manifest, manifest = JSON.parse(archive.objects.get(prior.sha256));
  update(manifest, archive);
  const body = Buffer.from(JSON.stringify(manifest)); archive.objects.delete(prior.sha256); archive.header.manifest = reference(body); archive.objects.set(hash(body), body);
  return rebuild(archive);
}
export function renamedArchive(bytes, id) {return changeManifest(bytes, manifest => {manifest.id = id;});}
function rebindParents(manifest, archive, replacements) {
  for(const point of manifest.checkpoints){
    const old=point.machine,bytes=archive.objects.get(old.sha256);
    if(bytes.subarray(0,8).toString()!=='WVKEYF01')continue;
    const descriptor=JSON.parse(bytes.subarray(8)),parent=replacements.get(descriptor.parent.sha256);if(!parent)continue;
    descriptor.parent=parent;const body=Buffer.concat([Buffer.from('WVKEYF01'),Buffer.from(JSON.stringify(descriptor))]);
    const ref=reference(body);archive.objects.delete(old.sha256);archive.objects.set(ref.sha256,body);point.machine=ref;replacements.set(old.sha256,ref);
  }
}
export function archiveMutants(bytes, kind) {
  const rawHeader = edit => {
    const {header, objects} = readArchive(bytes), parts = header.objects.map(ref => objects.get(ref.sha256)); edit(header); return pack(header, parts);
  };
  const nativeEdit = update => changeManifest(bytes, (manifest, archive) => {
    const point = manifest.checkpoints[0], old = point.machine.sha256, frame = Buffer.from(archive.objects.get(old));
    assert.equal(frame.subarray(0, 8).toString(), 'WVEXACT1'); update(frame);
    archive.objects.delete(old); point.machine = reference(frame); archive.objects.set(hash(frame), frame);
  });
  const result = [
    {name: 'truncated-prefix', make: () => bytes.subarray(0, 15)},
    {name: 'truncated-body', make: () => bytes.subarray(0, -1)},
    {name: 'trailing-data', make: () => Buffer.concat([bytes, Buffer.from([0])])},
    {name: 'foreign-archive-version', make: () => {const body = Buffer.from(bytes); body.writeUInt32LE(2, 8); return body;}},
    {name: 'foreign-wasm-build', make: () => rawHeader(header => {header.runtime.wasm = '0'.repeat(64);})},
    {name: 'duplicate-entry', make: () => rawHeader(header => {header.objects.splice(1, 0, {...header.objects[0]});})},
    {name: 'path-traversal-entry', make: () => rawHeader(header => {header.objects[0].path = '../../../../outside';})},
    {name: 'compressed-expansion-bomb', make: () => rawHeader(header => {header.encoding = 'gzip'; header.uncompressedBytes = '18446744073709551615';})},
    {name: 'zip-archive', make: () => Buffer.concat([Buffer.from([80, 75, 3, 4]), Buffer.alloc(64)])},
    {name: 'oversized-object', make: () => rawHeader(header => {header.objects[0].length = '68719476736'; header.uncompressedBytes = '68719476736';})},
    {name: 'oversized-header', make: () => {const body = Buffer.from(bytes); body.writeUInt32LE(0xffffffff, 12); return body;}},
    {name: 'payload-digest', make: () => {const body = Buffer.from(bytes), at = 16 + body.readUInt32LE(12); body[at] ^= 1; return body;}},
    {name: 'foreign-manifest-version-rehashed', make: () => changeManifest(bytes, manifest => {manifest.version.major = 2;})},
    {name: 'unknown-required-extension-rehashed', make: () => changeManifest(bytes, manifest => {manifest.extensions.push({kind: 'future-required-reference-format', required: true, bytes: [123, 125]});})},
    {name: 'missing-historical-disk-root-with-valid-framing', make: () => {
      const archive = readArchive(bytes), manifest = JSON.parse(archive.objects.get(archive.header.manifest.sha256));
      // Exact guest writes are also present in the native owned-device snapshot;
      // the separately referenced base root can legitimately have no legacy pages.
      assert(archive.objects.delete(manifest.checkpoints[0].disk_root)); return rebuild(archive);
    }},
    {name:'foreign-legacy-overlay-with-valid-digests',make:()=>changeManifest(bytes,(manifest,archive)=>{
      const old=manifest.checkpoints[0].disk_root,root=JSON.parse(archive.objects.get(old)),page=Buffer.alloc(4096,0xd3),pageHash=hash(page);
      assert.equal(root.blocks.length,0);root.blocks=[{index:'0',sha256:pageHash}];
      const raw=Buffer.from(JSON.stringify(root)),rootHash=hash(raw);archive.objects.delete(old);archive.objects.set(rootHash,raw);archive.objects.set(pageHash,page);
      for(const point of manifest.checkpoints)if(point.disk_root===old)point.disk_root=rootHash;
    })},
  ];
  if (kind === 'software') result.push(
    {name: 'foreign-native-version-rehashed', make: () => nativeEdit(frame => {frame.writeUInt32LE(2, 28 + 8);})},
    {name: 'unsupported-native-section-rehashed', make: () => nativeEdit(frame => {frame.writeUInt32LE(17, 28 + 84);})},
  );
  else result.push(
    {name: 'foreign-renderer-build', make: () => rawHeader(header => {header.runtime.gpu = '0'.repeat(64);})},
    {name: 'missing-GPU-delta-with-valid-framing', make: () => {
      const archive = readArchive(bytes), manifest = JSON.parse(archive.objects.get(archive.header.manifest.sha256));
      const point = manifest.checkpoints.find(point => archive.objects.get(point.machine.sha256).subarray(0, 8).toString() === 'WVKEYF01'); assert(point, 'real GPU RAM delta required');
      const descriptor = JSON.parse(archive.objects.get(point.machine.sha256).subarray(8)); assert(descriptor.chunks.length > 0);
      assert(archive.objects.delete(descriptor.chunks[0].sha256)); return rebuild(archive);
    }},
  );
  const original=readArchive(bytes),manifest=JSON.parse(original.objects.get(original.header.manifest.sha256));
  if(manifest.checkpoints.some(point=>original.objects.get(point.machine.sha256).subarray(0,8).toString()==='WVKEYF01'))result.push({
    name:'rehashed-RAM-delta-with-stale-full-digest',make:()=>changeManifest(bytes,(manifest,archive)=>{
      const first=manifest.checkpoints.find(point=>archive.objects.get(point.machine.sha256).subarray(0,8).toString()==='WVKEYF01');
      const descriptor=JSON.parse(archive.objects.get(first.machine.sha256).subarray(8)),old=descriptor.chunks[0];assert(old);
      const page=Buffer.from(archive.objects.get(old.sha256));assert.equal(page.subarray(0,8).toString(),'WVRAMD01');assert(page.length>30);page[30]^=1;
      const replacement=reference(page);archive.objects.delete(old.sha256);archive.objects.set(replacement.sha256,page);
      const parents=new Map();
      for(const point of manifest.checkpoints){
        const prior=point.machine,data=archive.objects.get(prior.sha256);if(data.subarray(0,8).toString()!=='WVKEYF01')continue;
        const delta=JSON.parse(data.subarray(8));let changed=false;
        delta.chunks=delta.chunks.map(ref=>{if(ref.sha256!==old.sha256)return ref;changed=true;return replacement;});
        if(parents.has(delta.parent.sha256)){delta.parent=parents.get(delta.parent.sha256);changed=true;}
        if(changed){const body=Buffer.concat([Buffer.from('WVKEYF01'),Buffer.from(JSON.stringify(delta))]),ref=reference(body);archive.objects.delete(prior.sha256);archive.objects.set(ref.sha256,body);point.machine=ref;parents.set(prior.sha256,ref);}
      }
    }),
  });
  const laterFull=manifest.checkpoints.findIndex((point,index)=>index>0&&original.objects.get(point.machine.sha256).subarray(0,8).toString()==='WVKEYB01');
  if(laterFull>=0)result.push({name:'later-native-CPU-truncation-rehashed',make:()=>changeManifest(bytes,(manifest,archive)=>{
    const point=manifest.checkpoints[laterFull],old=point.machine,frame=Buffer.from(archive.objects.get(old.sha256));
    const contextBytes=Number(frame.readBigUInt64LE(12)),nativeBytes=Number(frame.readBigUInt64LE(52)),nativeAt=212+contextBytes;
    const native=Buffer.from(frame.subarray(nativeAt,nativeAt+nativeBytes));assert.equal(native.readUInt32LE(84),1);
    const cpuBytes=native.readUInt32LE(88);assert(cpuBytes>0);native.writeUInt32LE(cpuBytes-1,88);
    const shortened=Buffer.concat([native.subarray(0,92+cpuBytes-1),native.subarray(92+cpuBytes)]);
    const changed=Buffer.concat([frame.subarray(0,nativeAt),shortened,frame.subarray(nativeAt+nativeBytes)]);
    changed.writeBigUInt64LE(BigInt(shortened.length),52);Buffer.from(hash(shortened),'hex').copy(changed,60);
    // Keep the state witness coherent too, so only the actual component decoder
    // can reject this malformed later CPU; this is not merely a stale outer hash.
    for(const extension of manifest.extensions){
      if(!['e9-exact-initial-witness-v1','e9-exact-state-witnesses-v1'].includes(extension.kind))continue;
      const rows=JSON.parse(Buffer.from(extension.bytes));
      for(const row of rows)if(['transition','retired','phase','ordinal','sequence'].every(key=>row[key]===point.position[key]))row.digest=[...Buffer.from(hash(shortened),'hex')];
      extension.bytes=[...Buffer.from(JSON.stringify(rows))];
    }
    const ref=reference(changed);archive.objects.delete(old.sha256);archive.objects.set(ref.sha256,changed);point.machine=ref;
    rebindParents(manifest,archive,new Map([[old.sha256,ref]]));
  })});
  return result;
}

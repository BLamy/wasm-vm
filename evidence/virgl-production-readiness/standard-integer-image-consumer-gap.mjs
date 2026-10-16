import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {decodeStandardSharedExponentImageSubmission} from '../../renderer/virgl-command/decoder.mjs';
import {parseStandardTextureShaderMetadata,normalizeStandardTextureShaderResult,
 normalizeStandardTextureShaderPair,deriveStandardTextureShaderInterface} from '../../renderer/virgl-command/constant-domain.mjs';
import {imageView,surface} from '../../tools/virgl-command/standard-image-fixtures.mjs';
const root=path.resolve(import.meta.dirname,'../..'),expected='c64c3325c15d8978f455d57fc103559eec1b9d20';
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert.equal(head,expected,'record the original refusal at its verified dependency');
assert.match(fs.readFileSync(root+'/tasks/epic-6-transcendence/E6-T11d32-standard-integer-image-shaders.md','utf8'),/^status: verified$/m);
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const seals=[];
for(const role of ['worker','verifier']){
 const base=root+'/evidence/virgl-integer-image-shader/'+role,manifest=JSON.parse(fs.readFileSync(base+'/manifest.json'));
 assert.equal(sha(fs.readFileSync(base+'/records.json')),manifest.recordIndexSha256);
 assert.equal(sha(fs.readFileSync(base+'/recording.tar.gz')),manifest.archiveSha256);
 for(const name of ['manifest.json','records.json','recording.tar.gz']){
  const file='evidence/virgl-integer-image-shader/'+role+'/'+name,raw=fs.readFileSync(root+'/'+file);
  assert.deepEqual(raw,execFileSync('git',['show',expected+':'+file],{cwd:root,maxBuffer:32*1024*1024}));
  seals.push({path:file,bytes:raw.length,sha256:sha(raw)});
 }
}
// Reopen every original sealed member; use the actual generated compiler.
const extraction=execFileSync('python3',['-c',`
import hashlib,json,sys,tarfile
from pathlib import Path
root=Path(sys.argv[1])
out=root/'renderer/virgl-shader/build/wasm';out.mkdir(parents=True,exist_ok=True)
opened=[]
for role in ['worker','verifier']:
 base=root/'evidence/virgl-integer-image-shader'/role
 rows=json.loads((base/'records.json').read_text())['records'];wanted={r['path']:r for r in rows};seen=set()
 with tarfile.open(base/'recording.tar.gz','r:gz') as tar:
  for member in tar:
   assert member.isfile() and member.name in wanted and member.name not in seen
   raw=tar.extractfile(member).read();r=wanted[member.name]
   assert len(raw)==r['bytes'] and hashlib.sha256(raw).hexdigest()==r['sha256'];seen.add(member.name)
   prefix='hot-generated/renderer/virgl-shader/build/wasm/'
   if role=='worker' and member.name in [prefix+'virgl-shader.mjs',prefix+'virgl-shader.wasm']:
    (out/Path(member.name).name).write_bytes(raw)
 assert seen==set(wanted);opened.append({'role':role,'reopenedMembers':len(seen)})
print(json.dumps(opened))
`,root],{cwd:root,encoding:'utf8',maxBuffer:1024*1024});
const {createVirglStandardIntegerImageShaderBridge}=await import(pathToFileURL(root+'/renderer/virgl-shader/standard.mjs'));
const bridge=await createVirglStandardIntegerImageShaderBridge(),shaderRows=[],wireRows=[];
const original=JSON.parse(fs.readFileSync(import.meta.dirname+'/standard-integer-image-shader-gap.json')).records;
for(const input of original){
 const colors={signedColorMask:input.stage==='fragment'&&input.type==='SINT'?1:0,
  unsignedColorMask:input.stage==='fragment'&&input.type==='UINT'?1:0};
 const result=bridge.translateImages({stage:input.stage,text:input.text,...colors});
 assert.equal(result.ok,true);
 const oldMetadata=parseStandardTextureShaderMetadata(result.metadata,input.stage),oldResult=normalizeStandardTextureShaderResult(result,input.stage);
 assert.equal(oldMetadata.ok,false);assert.equal(oldResult.ok,false);
 shaderRows.push({...input,colors,selectedResult:result,oldMetadata,oldResult});
}
for(const type of ['SINT','UINT']){
 const vertexText=original.find(row=>row.stage==='vertex'&&row.type===type&&row.op==='TXF').text;
 const fragmentText=original.find(row=>row.stage==='fragment'&&row.type===type&&row.op==='TXF').text;
 const selectors={signedMask:0,unsignedMask:0,packedSignedMask:0,packedNormalizedMask:0,bufferZeroMask:0,
  signedColorMask:type==='SINT'?1:0,unsignedColorMask:type==='UINT'?1:0};
 const selected=bridge.translatePairImages({vertexText,fragmentText,...selectors});assert.equal(selected.ok,true);
 const oldPair=normalizeStandardTextureShaderPair(selected),oldInterface=deriveStandardTextureShaderInterface(selected.vertex.metadata,selected.fragment.metadata);
 assert.equal(oldPair.ok,false);assert.equal(oldInterface.ok,false);
 shaderRows.push({kind:'pair',type,vertexText,fragmentText,selectors,selectedResult:selected,oldPair,oldInterface});
}
for(let format=177;format<=200;format++){
 for(const [kind,wire] of [['sampler-view',imageView(9,6,format,1,3,[2,4,0,5])],['surface',surface(10,6,format,2)]]){
  const result=decodeStandardSharedExponentImageSubmission(wire);
  assert.equal(result.ok,false);assert.equal(result.error.code,'unsupported-feature');
  wireRows.push({kind,format,hex:Buffer.from(wire).toString('hex'),result});
 }
}
const names=['renderer/virgl-command/constant-domain.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs',
 'renderer/virgl-command/resources.mjs','renderer/virgl-command/integer-images.mjs','renderer/virgl-shader/standard.mjs',
 'renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm',
 'renderer/virgl-shader/vendor/src/virgl_hw.h','tools/virgl-command/standard-image-fixtures.mjs'];
const sources=names.map(name=>{const raw=fs.readFileSync(root+'/'+name);return{path:name,bytes:raw.length,sha256:sha(raw)};});
const result={schema:'original-integer-image-consumer-gap-v1',task:'E6-T11d33',gitHead:head,verifiedDependency:'E6-T11d32',
 authority:'actual-compiler-and-original-wire-refusal-only',nativeExecuted:false,guestExecution:false,
 productionNegotiation:false,productionDrawAuthority:false,seals,reopened:JSON.parse(extraction),sources,shaderRows,wireRows};
fs.writeFileSync(import.meta.dirname+'/standard-integer-image-consumer-gap.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({head,selectedCompilerSuccesses:shaderRows.length,originalWireRefusals:wireRows.length}));

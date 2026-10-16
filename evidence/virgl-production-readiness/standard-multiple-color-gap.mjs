import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const task=await fs.readFile(path.join(root,'tasks/epic-6-transcendence/E6-T11d33-standard-integer-image-consumer.md'),'utf8');
assert.match(task,/^status: verified$/m);
const seals=JSON.parse(execFileSync('python3',['-c',String.raw`
import hashlib,json,sys,tarfile
from pathlib import Path
root=Path(sys.argv[1]);rows=[]
for role in ('worker','verifier'):
 base=root/'evidence/virgl-integer-image-consumer'/role
 manifest_raw=(base/'manifest.json').read_bytes();manifest=json.loads(manifest_raw)
 index_raw=(base/'records.json').read_bytes();index=json.loads(index_raw)
 assert hashlib.sha256(index_raw).hexdigest()==manifest['recordIndexSha256']
 archive=base/'recording.tar.gz';digest=hashlib.sha256(archive.read_bytes()).hexdigest()
 assert digest==manifest['archiveSha256']
 records=index['records'];wanted={r['path']:r for r in records};assert len(wanted)==len(records)==manifest['records'];seen=set();generated=[]
 with tarfile.open(archive,'r:gz') as tar:
  for member in tar:
   assert member.isfile() and member.name in wanted and member.name not in seen
   raw=tar.extractfile(member).read();record=wanted[member.name]
   assert len(raw)==record['bytes'] and hashlib.sha256(raw).hexdigest()==record['sha256'];seen.add(member.name)
   if member.name.endswith('/renderer/virgl-shader/build/wasm/virgl-shader.wasm') or member.name.endswith('/renderer/virgl-shader/build/wasm/virgl-shader.mjs'):generated.append(record)
 assert seen==set(wanted)
 rows.append(dict(role=role,members=len(seen),archiveSha256=digest,recordIndexSha256=hashlib.sha256(index_raw).hexdigest(),manifestSha256=hashlib.sha256(manifest_raw).hexdigest(),generated=generated))
print(json.dumps(rows))
`,root],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024}));
const names=[...new Set([
 ...execFileSync('git',['ls-files','renderer/virgl-shader'],{cwd:root,encoding:'utf8'}).trim().split('\n'),
 'renderer/virgl-command/constant-domain.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs',
 'renderer/virgl-command/resources.mjs','renderer/virgl-command/integer-images.mjs',
 'renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm'
])];
const sources=[];for(const name of names){const raw=await fs.readFile(path.join(root,name));sources.push({path:name,bytes:raw.length,sha256:sha(raw)});}
for(const extension of ['mjs','wasm']){
 const name='renderer/virgl-shader/build/wasm/virgl-shader.'+extension;
 const expected=seals.find(s=>s.role==='worker').generated.filter(r=>r.path.endsWith('/'+name));
 assert.ok(expected.length);for(const row of expected)assert.equal(row.sha256,sources.find(s=>s.path===name).sha256);
}
const {createVirglStandardIntegerImageShaderBridge}=await import(pathToFileURL(path.join(root,'renderer/virgl-shader/standard.mjs')));
const {decodeStandardIntegerImageSubmission}=await import(pathToFileURL(path.join(root,'renderer/virgl-command/decoder.mjs')));
const {parseStandardIntegerImageShaderMetadata,normalizeStandardIntegerImageShaderPair}=await import(pathToFileURL(path.join(root,'renderer/virgl-command/constant-domain.mjs')));
const bridge=await createVirglStandardIntegerImageShaderBridge();
const packet=(opcode,words)=>{const bytes=new Uint8Array((words.length+1)*4),view=new DataView(bytes.buffer);view.setUint32(0,(words.length<<16)|opcode,true);words.forEach((n,i)=>view.setUint32(4+i*4,n,true));return bytes;};
const wire=[];
for(const count of [2,3,4]){
 const bytes=packet(5,[count,0,...Array.from({length:count},(_,i)=>i+4)]),result=decodeStandardIntegerImageSubmission(bytes);
 assert.equal(result.ok,false);assert.equal(result.error.code,'unsupported-feature');wire.push({kind:'framebuffer',count,packetHex:Buffer.from(bytes).toString('hex'),result});
}
for(const slot of [1,2,3]){
 const bytes=packet(7,[4<<slot,0,0,0,0,0,0,0]);new DataView(bytes.buffer).setFloat64(24,1,true);
 const result=decodeStandardIntegerImageSubmission(bytes);assert.equal(result.ok,false);assert.equal(result.error.code,'unsupported-feature');
 wire.push({kind:'clear',slot,packetHex:Buffer.from(bytes).toString('hex'),result});
}
const vertexText='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
const programs=[
 {name:'original-four-colors-reordered-physical-OUT',fragmentText:'FRAG\nDCL OUT[1], COLOR[3]\nDCL OUT[5], COLOR[0]\nDCL OUT[7], COLOR[2]\nDCL OUT[13], COLOR[1]\nIMM[0] UINT32 {1048576000,1056964608,1061158912,1065353216}\nIMM[1] UINT32 {4294967295,2147483648,1,2147483647}\nIMM[2] UINT32 {1065353216,1056964608,1048576000,1061158912}\nIMM[3] UINT32 {4294967295,2147483648,1,0}\n0: MOV OUT[5], IMM[0]\n1: MOV OUT[13], IMM[1]\n2: MOV OUT[7], IMM[2]\n3: MOV OUT[1], IMM[3]\n4: END\n',signedColorMask:2,unsignedColorMask:8},
 {name:'original-sparse-COLOR3-physical-OUT5',fragmentText:'FRAG\nDCL OUT[5], COLOR[3]\nIMM[0] UINT32 {4294967295,2147483648,1,0}\n0: MOV OUT[5], IMM[0]\n1: END\n',signedColorMask:0,unsignedColorMask:8},
 {name:'original-COLOR0-broadcast-physical-OUT5-mixed-types',fragmentText:'FRAG\nPROPERTY FS_COLOR0_WRITES_ALL_CBUFS 1\nDCL OUT[5], COLOR\nIMM[0] UINT32 {1048576000,1075838976,3196059648,1065353216}\n0: MOV OUT[5], IMM[0]\n1: END\n',signedColorMask:2,unsignedColorMask:8}
];
const compiler=[];
for(const program of programs)for(const typed of [false,true]){
 const colors={signedColorMask:typed?program.signedColorMask:0,unsignedColorMask:typed?program.unsignedColorMask:0};
 const stage=bridge.translateImages({stage:'fragment',text:program.fragmentText,...colors});assert.equal(stage.ok,true,program.name+': '+JSON.stringify(stage));
 const metadataResult=parseStandardIntegerImageShaderMetadata(stage.metadata,'fragment',colors);assert.equal(metadataResult.ok,false);
 const selectors={signedMask:0,unsignedMask:0,packedSignedMask:0,packedNormalizedMask:0,bufferZeroMask:0,...colors};
 const pair=bridge.translatePairImages({vertexText,fragmentText:program.fragmentText,...selectors});assert.equal(pair.ok,true);
 const pairResult=normalizeStandardIntegerImageShaderPair(pair,selectors);assert.equal(pairResult.ok,false);
 compiler.push({name:program.name,typed,vertexText,fragmentText:program.fragmentText,selectors,stage,metadataResult,pair,pairResult});
}
const result={schema:'original-multiple-color-readiness-v1',status:'negative-recorded',gitHead:head,
 sources,seals,wire,compiler,scriptSha256:sha(await fs.readFile(fileURLToPath(import.meta.url))),guestExecution:false,
 productionNegotiation:false,productionDrawAuthority:false,authority:'original wire and actual sealed compiler readiness; no native or guest draw'};
const output=path.resolve(process.argv[2]??path.join(path.dirname(fileURLToPath(import.meta.url)),'standard-multiple-color-gap.json'));
await fs.writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,gitHead:head,members:seals.reduce((n,s)=>n+s.members,0),wireRefusals:wire.length,compilerAdmissions:compiler.length,ownedContractRefusals:compiler.length*2,output}));

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export function direct(module,c,oldUniform=false) {
 const pointers=[];
 try {
  for(const text of [c.a,c.b]){const p=module._malloc(Buffer.byteLength(text)+1);assert.ok(p);module.HEAPU8.set(Buffer.from(text),p);module.HEAPU8[p+Buffer.byteLength(text)]=0;pointers.push(p);}
  const [a,b]=pointers,m=['signedMask','unsignedMask','packedSignedMask','packedNormalizedMask','bufferZeroMask'].map(k=>c.selectors[k]);let output;
  const stage=oldUniform?module._bridge_translate_standard_uniform:module._bridge_translate_standard_texture,
    pair=oldUniform?module._bridge_translate_standard_uniform_pair:module._bridge_translate_standard_texture_pair;
  if(c.kind<2)output=stage(c.kind,a,c.a.length);
  else if(c.kind<5)output=pair(c.kind===3?0:a,c.a.length,c.kind===4?0:b,c.b.length,...m);
  else if(c.kind===5)output=stage(0,0,c.a.length);
  else if(c.kind===6)output=stage(-1,a,c.a.length);
  else if(c.kind<9)output=module._bridge_translate_standard(c.kind-7,a,c.a.length);
  else if(c.kind===9)output=module._bridge_translate_standard_pair(a,c.a.length,b,c.b.length);
  else if(c.kind===10)output=module._bridge_translate_standard_pair_typed(a,c.a.length,b,c.b.length,...m.slice(0,2));
  else if(c.kind===11)output=module._bridge_translate_standard_pair_vertex_formats(a,c.a.length,b,c.b.length,...m.slice(0,4));
  else if(c.kind<14)output=module._bridge_translate_standard_uniform(c.kind-12,a,c.a.length);
  else output=module._bridge_translate_standard_uniform_pair(a,c.a.length,b,c.b.length,...m);
  return module.UTF8ToString(output);
 }finally{pointers.reverse().forEach(p=>module._free(p));}
}
export async function oldAbiAudit(directory,cases,current) {
 const base=path.resolve(directory,'predecessor'),authentication=JSON.parse(fs.readFileSync(base+'/authentication.json'));
 assert.equal(authentication.status,'passed');
 const {default:createOld}=await import(pathToFileURL(base+'/virgl-shader.mjs')),old=await createOld(),records=[];
 for(const [index,c]of cases.entries()){
  const before=direct(old,c,true),after=direct(current,c,true);assert.equal(after,before,c.name+' complete old ABI bytes');
  records.push({case:index,name:c.name,originalResponse:before,currentResponse:after});
 }
 assert.equal(old.HEAPU8.byteLength,16777216);
 fs.writeFileSync(directory+'/historical-abi.jsonl',records.map(row=>JSON.stringify(row)).join('\n')+'\n');
 return {status:'passed',cases:records.length,predecessor:authentication.predecessor,allResponseBytesIdentical:true,oldMemoryBytes:old.HEAPU8.byteLength};
}

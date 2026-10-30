import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const shippedRoot='/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905/web/dist/pkg';
const coldRoot='/private/tmp/e5-5-t07-pristine-0144c662b/crates/wasm-web/pkg';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function inspect(root) {
  const bytes=await readFile(`${root}/wasm_vm_wasm_bg.wasm`), module=await WebAssembly.compile(bytes);
  const js=await import(`${pathToFileURL(`${root}/wasm_vm_wasm.js`).href}?audit=${Date.now()}-${root.length}`);
  const api={};
  for (const [name,value] of Object.entries(js)) {
    if (typeof value==='function') api[name]=value.prototype ? Object.getOwnPropertyNames(value.prototype).sort() : [];
  }
  return {bytes:bytes.length,sha256:sha(bytes),imports:WebAssembly.Module.imports(module).map(x=>`${x.module}\0${x.name}\0${x.kind}`).sort(),
    exports:WebAssembly.Module.exports(module).map(x=>`${x.name}\0${x.kind}`).sort(),api,
    producers:WebAssembly.Module.customSections(module,'producers').map(b=>({bytes:b.byteLength,sha256:sha(new Uint8Array(b))})),
    targetFeatures:WebAssembly.Module.customSections(module,'target_features').map(b=>({bytes:b.byteLength,sha256:sha(new Uint8Array(b))}))};
}
const [shipped,cold]=await Promise.all([inspect(shippedRoot),inspect(coldRoot)]);
const delta=(a,b)=>({onlyShipped:a.filter(x=>!b.includes(x)),onlyCold:b.filter(x=>!a.includes(x))});
const apiNames=x=>Object.entries(x).flatMap(([k,v])=>v.map(m=>`${k}.${m}`)).sort();
console.log(JSON.stringify({shipped:{bytes:shipped.bytes,sha256:shipped.sha256,imports:shipped.imports.length,exports:shipped.exports.length,producers:shipped.producers,targetFeatures:shipped.targetFeatures},
  cold:{bytes:cold.bytes,sha256:cold.sha256,imports:cold.imports.length,exports:cold.exports.length,producers:cold.producers,targetFeatures:cold.targetFeatures},
  importDelta:delta(shipped.imports,cold.imports),exportDelta:delta(shipped.exports,cold.exports),publicApiDelta:delta(apiNames(shipped.api),apiNames(cold.api))},null,2));

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const wasmPath = resolve(root, 'web/dist/pkg/wasm_vm_wasm_bg.wasm');
const jsPath = resolve(root, 'web/dist/pkg/wasm_vm_wasm.js');
const testPath = resolve(root, 'crates/wasm/tests/jit_fp_direct_imports_verifier.rs');
const bytes = await readFile(wasmPath);
const source = await readFile(testPath, 'utf8');
const inline = source.split('#[wasm_bindgen(inline_js = r#"')[1].split('"#)]')[0];
assert(inline.includes('function callGoldens('));
const probe = await import('data:text/javascript;base64,' + Buffer.from(
  inline + '\nexport { callGoldens, signatureModule, signatures, names };\n'
).toString('base64'));
const module = await import(pathToFileURL(jsPath).href);
const exports = await module.default({ module_or_path: bytes });
const functions = Object.fromEntries(probe.names.map(name => [name, exports['__jit_' + name]]));
const literal = probe.callGoldens(functions);
let correctTypes = 0, rejectedTypes = 0;
for (let index = 0; index < probe.names.length; index++) {
  const name = probe.names[index], params = probe.signatures[index], fn = functions[name];
  const reexport = new WebAssembly.Instance(probe.signatureModule(params, 0x7e), { e: { f: fn } });
  assert.equal(reexport.exports.f, fn, name);
  correctTypes++;
  for (let at = 0; at <= params.length; at++) {
    const bad = params.map((value, i) => i === at ? (value === 0x7f ? 0x7e : 0x7f) : value);
    const result = at === params.length ? 0x7f : 0x7e;
    assert.throws(
      () => new WebAssembly.Instance(probe.signatureModule(bad, result), { e: { f: fn } }),
      WebAssembly.LinkError,
      'raw function must reject wrong scalar signature: ' + name
    );
    rejectedTypes++;
  }
}
const receipt = {
  wasm: { path: wasmPath, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
  verifierSourceSha256: createHash('sha256').update(source).digest('hex'),
  literal, correctTypes, rejectedTypes,
  actualProductionRawExports: true, noGuestContext: true,
};
const out = process.argv[2];
if (out) await writeFile(out, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));

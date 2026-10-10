import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const root = process.cwd(), out = path.resolve(process.argv[2]);
const built = path.join(root, 'renderer/virgl-shader/build/wasm');
const sha = bytes => createHash('sha256').update(bytes).digest('hex'), sources = {};
for (const name of ['virgl-shader.mjs', 'virgl-shader.wasm']) {
  sources[name] = sha(await fs.readFile(path.join(built, name)));
}
const {default: createModule} = await import(pathToFileURL(path.join(built, 'virgl-shader.mjs')).href);
const raw = await createModule();
assert.equal(raw.HEAPU8.byteLength, 16777216);
const rows = (await fs.readFile(path.join(out, 'original-offsets.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
assert.equal(rows.length, 128);
const results = [];
for (const [index, row] of rows.entries()) {
  const bytes = Buffer.from(row.text), pointer = raw._malloc(bytes.length + 1);
  assert.ok(pointer);
  try {
    raw.HEAPU8.set(bytes, pointer);
    raw.HEAPU8[pointer + bytes.length] = 0;
    const result = JSON.parse(raw.UTF8ToString(raw._bridge_translate_standard_uniform(
      row.stage === 'vertex' ? 0 : 1, pointer, bytes.length)));
    assert.deepEqual(result, row.result);
    assert.equal(result.ok, row.expectedOk);
    if (row.kind === 'signed-offset' && row.validSigned16) {
      const name = (row.stage === 'vertex' ? 'vs' : 'fs') + 'const' + row.slot;
      const expression = row.offset === 0 ? 'addr0' : `addr0 + (${row.offset})`;
      assert.ok(result.glsl.includes(`${name}[${expression}]`), 'original signed offset remains on GPU');
      assert.equal(row.tokenIndex, row.offset);
      assert.equal(row.predictedBase + row.offset, 0);
    } else {
      assert.equal(result.error.code, 'unsupported-feature');
    }
    results.push({...row, index, exactNativeWasm: true});
  } finally {
    raw._free(pointer);
  }
}
for (const name of Object.keys(sources)) {
  assert.equal(sha(await fs.readFile(path.join(built, name))), sources[name]);
}
assert.equal(raw.HEAPU8.byteLength, 16777216);
await fs.writeFile(path.join(out, 'offsets-wasm-recheck.jsonl'), results.map(row => JSON.stringify(row)).join('\n') + '\n');
await fs.writeFile(path.join(out, 'wasm-custody.json'), JSON.stringify({sources, cases: rows.length, fixedMemoryBytes: raw.HEAPU8.byteLength}, null, 2) + '\n');
console.log('104 original signed16 admits, 16 pre-truncation rejects and 8 direct-plain limits agree in native/Wasm.');

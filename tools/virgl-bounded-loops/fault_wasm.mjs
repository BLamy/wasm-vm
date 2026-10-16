/** Execute the actual isolated fault module's public Wasm ABI, never a result wrapper. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const args = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, i) =>
  [process.argv[2 + i * 2], process.argv[3 + i * 2]]));
const output = path.resolve(args['--output']), directory = path.resolve(args['--directory']);
const mode = args['--mode'];
assert.ok(['early-break', 'recurrence-guard'].includes(mode), 'one declared compiler source fault');
const fixturePath = path.resolve(args['--fixture']);
assert.equal(fixturePath, path.join(ROOT, 'renderer/virgl-command/tests/bounded-loops-shaders.json'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function binding(filename, base = directory) {
  const bytes = await fs.readFile(filename);
  return { path: path.relative(base, filename), bytes: bytes.length, sha256: sha(bytes) };
}
const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
const inputs = [...fixture.shaders, ...fixture.negativeCases];
const nativePath = path.join(directory, mode, 'native.json');
const records = JSON.parse(await fs.readFile(nativePath, 'utf8'));
assert.equal(records.length, inputs.length);
const modulePath = path.join(directory, mode, 'wasm/virgl-shader.mjs');
const wasmPath = path.join(directory, mode, 'wasm/virgl-shader.wasm');
const { default: createModule } = await import(pathToFileURL(modulePath).href);
const module = await createModule({ wasmBinary: await fs.readFile(wasmPath) });
const memory = module.HEAPU8.buffer;
assert.equal(memory.byteLength, 16777216);
const calls = [];
for (const [index, input] of inputs.entries()) {
  const bytes = Buffer.from(input.text, 'ascii'), native = records[index];
  assert.ok(!/[^\x09\x0a\x0d\x20-\x7e]/.test(input.text) && bytes.length <= 16384);
  assert.equal(input.name, native.name); assert.equal(input.stage, native.stage);
  assert.equal(sha(bytes), native.inputSha256); assert.equal(bytes.length, native.inputBytes);
  const pointer = module._malloc(bytes.length + 1);
  assert.ok(pointer, 'actual Wasm input allocation');
  let result;
  try {
    module.HEAPU8.set(bytes, pointer); module.HEAPU8[pointer + bytes.length] = 0;
    const response = module._bridge_translate(input.stage === 'vertex' ? 0 : 1, pointer, bytes.length);
    result = JSON.parse(module.UTF8ToString(response));
  } finally { module._free(pointer); }
  assert.equal(module.HEAPU8.buffer, memory); assert.deepEqual(result, native.result);
  calls.push({ name: input.name, stage: input.stage, inputSha256: sha(bytes), inputBytes: bytes.length, result });
}
const report = { schema: 'wasm-vm-bounded-loop-fault-wasm-v1', mode, status: 'passed',
  command: process.argv, node: process.version,
  fixture: await binding(fixturePath, ROOT), harness: await binding(fileURLToPath(import.meta.url), ROOT),
  artifacts: { module: await binding(modulePath), wasm: await binding(wasmPath),
    native: await binding(path.join(directory, mode, 'native/virgl-shader')) },
  nativeTranslations: await binding(nativePath), calls,
  memory: { initialBytes: memory.byteLength, finalBytes: module.HEAPU8.byteLength, bufferIdentityStable: true } };
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(`${mode}: ${calls.length} actual Wasm fault results match native.\n`);

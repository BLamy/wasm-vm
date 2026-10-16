#!/usr/bin/env node
// Record narrow original-binary/source coverage without replacing earlier evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {parseConstantDomain} from '../../renderer/virgl-command/constant-domain.mjs';

const script = fileURLToPath(import.meta.url), root = path.resolve(path.dirname(script), '../..');
const sha = raw => createHash('sha256').update(raw).digest('hex');
const read = name => JSON.parse(fs.readFileSync(name));
const write = (name, value) => fs.writeFileSync(name, JSON.stringify(value, null, 2) + '\n');
const binding = name => ({path: name, bytes: fs.statSync(name).size, sha256: sha(fs.readFileSync(name))});
const sources = ['renderer/virgl-shader/bridge.c', 'renderer/virgl-shader/raw_bits.c', 'renderer/virgl-shader/raw_bits.h',
  'renderer/virgl-shader/raw_known_arithmetic.h', 'renderer/virgl-command/constant-domain.mjs'];

function consumer(nativePath, output) {
  const native = read(nativePath), results = [], attacks = []; let getterInvocations = 0;
  for (const c of native.cases) {
    const result = parseConstantDomain(c.result.metadata, c.stage); assert.equal(result.ok, true, c.name);
    assert.ok(Object.isFrozen(result.knownArithmetic.operations));
    if (c.name === 'both-operation-wrapper') assert.deepEqual(result.knownArithmetic.operations, ['ADD', 'MUL']);
    if (c.name === 'supplemental-coordinate-wrapper') {
      assert.equal(c.result.metadata.knownArithmeticBaseProfile, 'virgl-webgl2-raw-bits-v38');
      assert.deepEqual(result.coordinates, c.result.metadata.coordinateContract);
      assert.equal(result.coordinates.origin, 'lower-left'); assert.equal(result.coordinates.pixelCenter, 'half-integer');
    }
    results.push({name: c.name, metadata: c.result.metadata, result});
  }
  const sine = native.cases.find(c => c.name === 'ADD/SIN OUT[0], TEMP[0]').result.metadata;
  assert.equal(sine.knownArithmeticBaseProfile, 'virgl-webgl2-raw-bits-v36');
  const invalid = structuredClone(sine); delete invalid.sineContract;
  const rejected = parseConstantDomain(invalid, 'fragment'); assert.equal(rejected.ok, false, 'inherited base rejection');
  attacks.push({name: 'missing-inherited-sine-contract', metadata: invalid, result: rejected});
  for (const [name, original, field, index] of [
    ['second-operation-accessor', native.cases.find(c => c.name === 'both-operation-wrapper').result.metadata, 'knownArithmeticContract', 1],
    ['coordinate-accessor', native.cases.find(c => c.name === 'supplemental-coordinate-wrapper').result.metadata, 'coordinateContract', 'origin'],
    ['inherited-sine-accessor', sine, null, 'sineContract'],
  ]) {
    const metadata = structuredClone(original), target = field === 'knownArithmeticContract' ? metadata[field].operations : field ? metadata[field] : metadata;
    Object.defineProperty(target, index, {enumerable: true, get() { getterInvocations++; return null; }});
    const result = parseConstantDomain(metadata, 'fragment'); assert.equal(result.ok, false, name); attacks.push({name, result});
  }
  assert.equal(getterInvocations, 0);
  write(output, {schema: 'virgl-known-arithmetic-supplement-consumer-v1', status: 'passed', nativeSha256: sha(fs.readFileSync(nativePath)),
    results, attacks, getterInvocations, source: binding(path.join(root, 'renderer/virgl-command/constant-domain.mjs'))});
  console.log('Four original-source policies and inherited rejection; zero getter calls.');
}

async function record(binaryPath, wasmPath, output) {
  output = path.resolve(output); assert.ok(!fs.existsSync(output), 'record into a new directory');
  fs.mkdirSync(path.join(output, 'original'), {recursive: true});
  const binary = path.join(output, 'original/known-test'); fs.copyFileSync(binaryPath, binary); fs.chmodSync(binary, 0o755);
  const wasmModule = path.join(output, 'original/virgl-shader.mjs'), wasmBinary = path.join(output, 'original/virgl-shader.wasm');
  fs.copyFileSync(wasmPath, wasmModule); fs.copyFileSync(path.join(path.dirname(wasmPath), 'virgl-shader.wasm'), wasmBinary);
  const predictionsPath = path.join(root, 'tools/virgl-known-arithmetic/supplement-cases.json'), predictions = read(predictionsPath), {words, cases} = predictions;
  fs.copyFileSync(predictionsPath, path.join(output, 'predictions.json')); assert.equal(words.length, 2); assert.equal(cases.length, 4);
  for (const c of cases) assert.equal(sha(c.text), c.textSha256, c.name + ' literal source');
  const u = w => {const b = Buffer.alloc(4); b.writeUInt32LE(w); return b;};
  const fixture = Buffer.concat([Buffer.from('VKA1'), u(words.length), ...words.flatMap(w => [u(w.op === 'MUL' ? 1 : 0), u(w.a), u(w.b), u(w.expected)]), u(cases.length),
    ...cases.flatMap(c => {const text = Buffer.from(c.text), partner = Buffer.from(c.partner);
      return [u(c.stage === 'vertex' ? 0 : 1), u(+c.ok), u(text.length), u(partner.length), u(+c.pairOk), text, partner];})]);
  fs.writeFileSync(path.join(output, 'cases.bin'), fixture);
  const profile = path.join(output, 'native.profraw'), env = {...process.env, LLVM_PROFILE_FILE: profile, UBSAN_OPTIONS: 'halt_on_error=1', ASAN_OPTIONS: 'abort_on_error=1'};
  const run = spawnSync(binary, [], {input: fixture, env, maxBuffer: 128e6});
  fs.writeFileSync(path.join(output, 'native.log'), run.stdout ?? ''); fs.writeFileSync(path.join(output, 'native.stderr'), run.stderr ?? '');
  assert.equal(run.status, 0, run.stderr?.toString()); assert.equal(run.signal, null); assert.equal(run.stderr.length, 0);
  const records = cases.map(c => ({...c})); let wordCount = 0, layout, finished = false;
  for (const line of run.stdout.toString().trim().split('\n')) {
    const m = /^(CASE|PAIR) (\d+) (.*)$/.exec(line);
    if (m) {const c = records[Number(m[2])], result = JSON.parse(m[3]); assert.equal(result.ok, m[1] === 'CASE' ? c.ok : c.pairOk, c.name); c[m[1] === 'CASE' ? 'result' : 'pairResult'] = result;}
    else if (line.startsWith('WORD ')) {const [, i, wanted] = line.split(' '); assert.equal(Number(i), wordCount); assert.equal(Number(wanted), words[wordCount++].expected);}
    else if (line.startsWith('LAYOUT ')) {layout = line.split(' ').slice(1).map(Number); assert.deepEqual(layout.slice(0, 2), [111744, 112]);}
    else {assert.equal(line, 'STATUS passed'); finished = true;}
  }
  assert.equal(wordCount, 2); assert.ok(finished && layout);
  for (const c of records) {
    assert.ok(c.result && c.pairResult); assert.equal(c.result.metadata.profile, 'virgl-webgl2-raw-bits-v40'); assert.deepEqual(c.pairResult[c.stage].metadata, c.result.metadata);
    if (c.expectedWords) for (const [i, word] of c.expectedWords.entries()) {
      assert.ok(c.result.glsl.includes(`/* known:word */ raw_rhs.${'xyzw'[i]} = ${word}u;`));
      assert.ok(c.result.glsl.includes(`/* known:shadow */ uintBitsToFloat(${word}u)`));
    }
  }
  const nativePath = path.join(output, 'native.json'); write(nativePath, {cases: records, words, layout});
  const profdata = path.join(output, 'native.profdata'); execFileSync('xcrun', ['llvm-profdata', 'merge', '-sparse', profile, '-o', profdata]);
  const coverageRaw = execFileSync('xcrun', ['llvm-cov', 'export', binary, `-instr-profile=${profdata}`], {maxBuffer: 128e6}); fs.writeFileSync(path.join(output, 'coverage.json'), coverageRaw);
  const functions = JSON.parse(coverageRaw).data.flatMap(d => d.functions), nativeRegions = [];
  const point = (name, anchor, token, length = token.length) => {
    const text = fs.readFileSync(path.join(root, name), 'utf8'), start = text.indexOf(anchor); assert.ok(start >= 0 && text.indexOf(anchor, start + 1) < 0, 'unique original-source anchor');
    const offset = text.indexOf(token, start); assert.ok(offset >= start && offset < start + anchor.length); const prefix = text.slice(0, offset), line = prefix.split('\n').length, column = offset - prefix.lastIndexOf('\n');
    return [line, column, line, column + length];
  };
  const returnPoints = ['b', 'a'].map(letter => point('renderer/virgl-shader/raw_known_arithmetic.h', `if (!m${letter === 'b' ? 'a' : 'b'}) return ${letter};`, `return ${letter}`));
  const coordinatePoint = point('renderer/virgl-shader/bridge.c', 'if (known_arithmetic) known_arithmetic_contract(profile, discard ? "virgl-webgl2-raw-bits-v39" : coordinates ? "virgl-webgl2-raw-bits-v38" : base_profile);', '"virgl-webgl2-raw-bits-v38"');
  for (const [name, points] of [
    ['raw_bits.c:known_add', returnPoints], ['known_arithmetic.c:known_add', returnPoints],
    ['bridge.c:stage_result', [coordinatePoint]],
  ]) {
    const f = functions.find(f => f.name === name); assert.ok(f, name + ' original instance');
    for (const point of points) {
      const r = f.regions.find(r => r.slice(0, 4).every((value, i) => value === point[i]) && r[7] === 0);
      assert.ok(r && r[4] > 0, name + ' specific return/coordinate region ' + point.join(':')); nativeRegions.push({function: name, file: f.filenames[r[5]], region: r});
    }
  }
  const {default: create} = await import(pathToFileURL(wasmModule)), module = await create({wasmBinary: fs.readFileSync(wasmBinary)});
  function request(strings, fn) {
    const ps = [];
    try {for (const text of strings) {const bytes = Buffer.from(text), p = module._malloc(bytes.length + 1); assert.ok(p); ps.push(p); module.HEAPU8.set(bytes, p); module.HEAPU8[p + bytes.length] = 0;}
      return JSON.parse(module.UTF8ToString(fn(ps)));
    } finally {for (const p of ps) module._free(p);}
  }
  const wasmResults = records.map(c => {
    const result = request([c.text], ps => module._bridge_translate(c.stage === 'vertex' ? 0 : 1, ps[0], Buffer.byteLength(c.text)));
    const pair = request([c.partner, c.text], ps => module._bridge_translate_pair(ps[0], Buffer.byteLength(c.partner), ps[1], Buffer.byteLength(c.text)));
    assert.deepEqual(result, c.result, c.name + ' complete original Wasm single'); assert.deepEqual(pair, c.pairResult, c.name + ' complete original Wasm pair'); return {name: c.name, result, pair};
  });
  write(path.join(output, 'wasm.json'), {status: 'passed', cases: wasmResults});
  const consumerPath = path.join(output, 'consumer.json'), v8Directory = path.join(output, 'node-v8');
  const child = spawnSync(process.execPath, [script, '--consumer', nativePath, consumerPath], {env: {...process.env, NODE_V8_COVERAGE: v8Directory}, maxBuffer: 16e6});
  fs.writeFileSync(path.join(output, 'consumer.log'), child.stdout ?? ''); fs.writeFileSync(path.join(output, 'consumer.stderr'), child.stderr ?? '');
  assert.equal(child.status, 0, child.stderr?.toString()); assert.equal(child.signal, null); assert.equal(child.stderr.length, 0);
  const consumerReport = read(consumerPath); assert.equal(consumerReport.status, 'passed'); assert.equal(consumerReport.getterInvocations, 0);
  const sourcePath = path.join(root, 'renderer/virgl-command/constant-domain.mjs'), sourceUrl = pathToFileURL(sourcePath).href;
  const v8Files = fs.readdirSync(v8Directory).filter(name => name.endsWith('.json')); assert.equal(v8Files.length, 1, 'one actual original-source child profile');
  const v8 = read(path.join(v8Directory, v8Files[0])).result.find(s => s.url === sourceUrl); assert.ok(v8, 'original-source module URL');
  const consumerSource = fs.readFileSync(sourcePath, 'utf8'), knownStart = consumerSource.indexOf('    const knownArithmetic ='), knownEnd = consumerSource.indexOf('    const discard =', knownStart);
  assert.ok(knownStart >= 0 && knownEnd > knownStart, 'bounded known wrapper source');
  const sourceRanges = ['|| operations[i - 1] === "ADD" && op === "MUL"', ': checked'].map(needle => {
    const startOffset = consumerSource.indexOf(needle, knownStart); assert.ok(startOffset >= knownStart && startOffset < knownEnd && (consumerSource.indexOf(needle, startOffset + 1) === -1 || consumerSource.indexOf(needle, startOffset + 1) >= knownEnd), 'unique nested known policy anchor'); return [startOffset, startOffset + needle.length];
  });
  const v8Regions = sourceRanges.map(([startOffset, endOffset]) => {
    const r = v8.functions.flatMap(f => f.ranges).find(r => r.startOffset === startOffset && r.endOffset === endOffset);
    assert.ok(r && r.count > 0, `specific V8 region ${startOffset}-${endOffset}`); return r;
  });
  write(path.join(output, 'report.json'), {schema: 'virgl-known-arithmetic-supplement-v1', task: 'E6-T12g6m1', status: 'passed', gitHead: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
    commands: [{executable: binary, argv: [], input: 'cases.bin', env: {LLVM_PROFILE_FILE: profile, UBSAN_OPTIONS: env.UBSAN_OPTIONS, ASAN_OPTIONS: env.ASAN_OPTIONS}},
      {executable: 'xcrun', argv: ['llvm-profdata', 'merge', '-sparse', profile, '-o', profdata]}, {executable: 'xcrun', argv: ['llvm-cov', 'export', binary, `-instr-profile=${profdata}`]},
      {executable: process.execPath, argv: [script, '--consumer', nativePath, consumerPath], env: {NODE_V8_COVERAGE: v8Directory}}],
    binary: binding(binary), wasm: [binding(wasmModule), binding(wasmBinary)], arithmeticPredictions: 2, hostRoundingModes: 4, publicSinglesPairs: records.length, layout,
    nativeRegions, v8Source: binding(sourcePath), v8Url: v8.url, v8Regions, runtimeSources: sources.map(name => binding(path.join(root, name))), productionNegotiation: false, guestExecution: false});
  console.log('Two zero identities, four exact native/Wasm singles/pairs, five native and two V8 coverage regions passed.');
}

if (process.argv[2] === '--consumer') consumer(process.argv[3], process.argv[4]);
else await record(process.argv[2], process.argv[3], process.argv[4]);

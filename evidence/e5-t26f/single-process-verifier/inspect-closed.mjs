// Read-only frozen-source/build/image inspection plus the registered accepted-byte control.
// No compiler, Docker, browser, gates, snapshot reads, or old acceptance probes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateElf } from '../../../tools/verify/e5-t26f-observer-build.mjs';
import { residentSourceInputs, assertResidentImage, OBSERVER_KIND } from '../../../tools/verify/e5-t26f-resident-proof.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const out = path.join(here, 'closed-inspection-v1');
await mkdir(out);
const sha = b => createHash('sha256').update(b).digest('hex');
const read = f => readFile(path.resolve(repo, f));
const json = async f => JSON.parse(await read(f));
const git = args => execFileSync('git', args, { cwd: repo });
const write = (f, b) => writeFile(path.join(out, f), b, { flag: 'wx' });
const hashFile = async f => { const h = createHash('sha256'); for await (const b of createReadStream(path.resolve(repo, f))) h.update(b); return h.digest('hex'); };
const record = { acceptance: false, scope: 'frozen source, closed build/image evidence and controlled accepted output only', files: {}, checks: {} };
try {
  record.head = git(['rev-parse', 'HEAD']).toString().trim();
  assert.equal(record.head, '05b82bc688a34e6a1abef7b6c761c01bf4a3f7c6');
  const changed = git(['diff', '--name-only', 'a7d1556a..' + record.head, '--', 'Makefile', 'tools']).toString().trim().split('\n');
  for (const f of changed) {
    const bytes = await read(f); assert.deepEqual(bytes, git(['show', `${record.head}:${f}`]));
    record.files[f] = { sha256: sha(bytes), size: bytes.length, frozenHeadMatch: true };
  }
  for (const f of ['tools/guest/e5-t26f-resident-aplay.sh', 'tools/verify/e5-t26f-resident-aplay.test.mjs']) {
    const bytes = await read(f); assert.deepEqual(bytes, git(['show', `a7d1556a:${f}`]));
    record.files[f] = { sha256: sha(bytes), size: bytes.length, heldBaseMatch: true };
  }
  const old = (await read('tools/guest/e5-t26f-resident-aplay.sh')).toString();
  const helper = (await read('tools/guest/e5-t26f-resident-observer.sh')).toString();
  const tail = s => s.slice(s.indexOf('e5_print_observation()'));
  assert.equal(tail(helper), tail(old)); record.checks.unchangedContractTailSha256 = sha(tail(helper));

  const buildPath = 'target/e5-t26f/observer-build-v1/build-info.json', build = await json(buildPath);
  const binary = await read(build.binary.path);
  assert.equal(sha(binary), build.binary.sha256); assert.equal(binary.length, build.binary.size);
  assert.equal(await hashFile(build.compiler.path), build.compiler.sha256);
  assert.equal(await hashFile(build.source.path), build.source.sha256);
  record.checks.build = { infoSha256: await hashFile(buildPath), ...build };
  record.checks.elf = validateElf(binary);
  assert.deepEqual(record.checks.elf, build.elf);
  // Independent byte decoding of the same header/segments, not the stored ELF summary.
  const phoff = Number(binary.readBigUInt64LE(32)), phsize = binary.readUInt16LE(54), count = binary.readUInt16LE(56);
  const types = [], loads = [];
  for (let i = 0; i < count; ++i) {
    const at = phoff + i * phsize, type = binary.readUInt32LE(at); types.push(type);
    if (type === 1) loads.push({ offset: Number(binary.readBigUInt64LE(at + 8)), vaddr: binary.readBigUInt64LE(at + 16).toString(),
      filesz: Number(binary.readBigUInt64LE(at + 32)), memsz: Number(binary.readBigUInt64LE(at + 40)), flags: binary.readUInt32LE(at + 4) });
  }
  assert.equal(binary.readUInt16LE(18), 243); assert.equal(binary.readUInt32LE(48), 5);
  assert.ok(!types.includes(2) && !types.includes(3));
  record.checks.independentElf = { phoff, phsize, count, types, loads,
    archStrings: binary.toString('latin1').match(/rv64[\x20-\x7e]+/g) };

  const imageDir = 'target/e5-t26f/resident-image-single-process-observer-v1';
  const infoPath = `${imageDir}/desktop-info.json`, info = await json(infoPath);
  const inputs = {};
  for (const [key, f] of Object.entries(residentSourceInputs(OBSERVER_KIND, info))) inputs[key] = await hashFile(f);
  record.checks.fixtureBinding = assertResidentImage(info, inputs.helper, { kind: OBSERVER_KIND, inputs });
  assert.equal(await hashFile(`${imageDir}/resident-readback.sh`), inputs.helper);
  assert.equal(await hashFile(`${imageDir}/observer-readback`), inputs.observerBinary);
  assert.deepEqual(await read(`${imageDir}/observer-build-info.json`), await read(buildPath));
  assert.equal(await hashFile(info.image.path), info.image.sha256);
  assert.equal((await stat(path.join(repo, info.image.path))).size, info.image.size);
  record.checks.image = { ...info.image, independentBytesHashed: true, infoSha256: await hashFile(infoPath) };
  for (const f of [infoPath, `${imageDir}/resident-readback.sh`, `${imageDir}/observer-readback`, `${imageDir}/resident-stat.txt`,
    `${imageDir}/observer-stat.txt`, `${imageDir}/fsck.log`, `${imageDir}/install.debugfs`, `${imageDir}/FILE-MANIFEST.txt`,
    buildPath, 'target/e5-t26f/native-observer-v1/result.json', 'target/e5-t26f/native-observer-v1/transport-helper.sh',
    'evidence/e5-t26f/single-process-final-gates.log', 'evidence/e5-t26f/single-process-cross-build.log',
    'evidence/e5-t26f/single-process-native.log', 'evidence/e5-t26f/single-process-image.log',
    'evidence/e5-t26f/single-process-chunks.log', 'target/e5-t26f/chunks/resident-single-process-observer-v1/manifest.json']) {
    const bytes = await read(f); record.files[f] = { sha256: sha(bytes), size: bytes.length };
  }
  const native = await json('target/e5-t26f/native-observer-v1/result.json');
  assert.equal(native.failure, undefined); assert.equal(native.immutabilityFailure, undefined);
  for (const r of native.runs) { assert.equal(r.status, 0); assert.equal(r.signal, null); assert.equal(r.error, null); }
  record.checks.native = { acceptance: native.acceptance, runs: native.runs.length, sourceBindings: native.sourceBindings, binaries: native.binaries };

  // Same canonical controlled proc bytes already consumed by the actual C original.
  // Only legacy paths, synthetic parent 222 and host cat command are remapped.
  const attempt = path.join(here, 'attack-0JMGjB'), tree = path.join(attempt, 'original-valid-tree');
  const cstdout = (await readFile(path.join(attempt, 'original-valid.stdout'))).toString();
  const cRecord = cstdout.slice(cstdout.indexOf('\n') + 1);
  await write('actual-c-record.txt', cRecord);
  const legacy = old.slice(0, old.indexOf('e5_prepare()')).replaceAll('$$', '222')
    .replaceAll('/bin/busybox cat', '/bin/cat')
    .replaceAll('/proc/', `${tree}/proc/`).replaceAll('/usr/bin/aplay', `${tree}/usr/bin/aplay`)
    .replaceAll('/dev/snd/pcmC0D0p', `${tree}/dev/snd/pcmC0D0p`).replaceAll('/tmp/e5t26f-resident.fifo', `${tree}/tmp/e5t26f-resident.fifo`);
  // Undo only the printer's path label so output remains the original protocol.
  await write('legacy-extracted.sh', legacy.replaceAll(`exe=${tree}/usr/bin/aplay(inode-match)`, 'exe=/usr/bin/aplay(inode-match)'));
  const adapter = helper.slice(0, helper.indexOf('e5_prepare()')).replaceAll('$$', '222')
    .replace('exec /usr/libexec/wasm-vm/e5t26f-observe "$e5_pid" "$e5_parent"', `/bin/cat '${path.join(out, 'actual-c-record.txt')}'`);
  await write('adapter-extracted.sh', adapter);
  const outputs = [];
  for (const name of ['legacy', 'adapter']) {
    const args = ['-c', `. "$1"\ne5_pid=111 e5_parent=222\ne5_observe || exit 91\nprintf '%s\\n' "$e5_seen"\ne5_print_observation post`, name, path.join(out, `${name}-extracted.sh`)];
    const r = spawnSync('/bin/sh', args, { encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin:/bin' } });
    await write(`${name}.stdout`, r.stdout ?? ''); await write(`${name}.stderr`, r.stderr ?? '');
    await write(`${name}.json`, JSON.stringify({ command: '/bin/sh', args, status: r.status, signal: r.signal, error: r.error?.message ?? null }, null, 2) + '\n');
    assert.equal(r.error, undefined); assert.equal(r.signal, null); assert.equal(r.status, 0, r.stderr);
    outputs.push(r.stdout);
  }
  assert.equal(outputs[0], outputs[1]);
  assert.equal(outputs[0].split('\n')[0], cRecord.trimEnd().slice('e5-observe-v1/'.length));
  record.checks.acceptedByteControl = { tree: path.relative(repo, tree), outputSha256: sha(outputs[0]), outputBytes: Buffer.byteLength(outputs[0]),
    note: 'Same retained proc bytes; source-extracted legacy with host cat, fixed 222 parent; candidate adapter replays the actual original C result. Not real topology/player proof.' };
  record.afterHead = git(['rev-parse', 'HEAD']).toString().trim(); assert.equal(record.afterHead, record.head);
  for (const f of changed) assert.equal(await hashFile(f), record.files[f].sha256);
  record.held = true;
} catch (error) { record.failure = String(error); process.exitCode = 1; }
await write('result.json', JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ out, held: record.held ?? false, failure: record.failure ?? null }));

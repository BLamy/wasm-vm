// Independent actual Mesa workload after a production GPU warm restore.
// This helper uses the public serial controller; it never supplies GL results.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const WARM_PIXEL_PROBE_SHA256 = 'a6e473f2f2b5f73aba2f1605b18912a981fe047a7c3ca501b1c177e24c60f79c';
export const WARM_PIXEL_SOURCE_SHA256 = '1af0439dc948a5f03486ff06bdbf5ee2f0145916b132bd536fa66268e51b0e34';
const directory = path.dirname(fileURLToPath(import.meta.url));
const digest = body => createHash('sha256').update(body).digest('hex');
const guestPath = /^\/tmp\/wvm-critic-warm-pixels\.[A-Za-z0-9]+\/probe$/;

export async function readWarmPixelProbe() {
  const binary = await fs.readFile(path.join(directory, 'fixtures/critic-warm-pixels-riscv64.elf'));
  const source = await fs.readFile(path.join(directory, 'probes/critic-warm-pixels.c'));
  const receipt = JSON.parse(await fs.readFile(path.join(directory, 'fixtures/critic-warm-pixels-riscv64.build.json'), 'utf8'));
  assert.equal(digest(binary), WARM_PIXEL_PROBE_SHA256, 'pinned independently compiled guest ELF');
  assert.equal(digest(source), WARM_PIXEL_SOURCE_SHA256, 'pinned independent probe source');
  assert.deepEqual([...binary.subarray(0, 7)], [0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  assert.equal(binary.readUInt16LE(18), 243, 'actual RISC-V ELF machine');
  for (const [suffix, body] of [['probes/critic-warm-pixels.c', source], ['fixtures/critic-warm-pixels-riscv64.elf', binary]]) {
    const identity = receipt.files.find(file => file.path.endsWith(suffix));
    assert.equal(identity?.bytes, body.length);
    assert.equal(identity?.sha256, digest(body));
  }
  return {binary, sourceSha256: digest(source), binarySha256: digest(binary), receipt};
}

export function warmPixelInstallCommand(binary) {
  assert.ok(binary instanceof Uint8Array && binary.length > 0);
  const lines = Buffer.from(binary).toString('base64').match(/.{1,2048}/g);
  // '_' is not a base64 character, so the quoted delimiter cannot occur in data.
  return 'wvm_pixel_dir=$(mktemp -d /tmp/wvm-critic-warm-pixels.XXXXXX) &&\n' +
    'base64 -d > "$wvm_pixel_dir/probe" <<\'WVM_CRITIC_PIXEL_ELF\'\n' +
    lines.join('\n') + '\nWVM_CRITIC_PIXEL_ELF\n' +
    'wvm_pixel_status=$?; if [ "$wvm_pixel_status" -eq 0 ]; then\n' +
    'chmod 700 "$wvm_pixel_dir/probe" && printf \'WARM_PIXELS_EXEC=%s\\n\' "$wvm_pixel_dir/probe" && sha256sum "$wvm_pixel_dir/probe"\n' +
    'else false; fi';
}

export function assertWarmPixelInstall(result) {
  assert.equal(result?.exit, 0, 'guest decoded and hashed the real ELF');
  const stdout = String(result.stdout).replaceAll('\r', '');
  const matches = [...stdout.matchAll(/^WARM_PIXELS_EXEC=(.+)$/gm)];
  assert.equal(matches.length, 1, 'one owned guest executable path');
  const executable = matches[0][1];
  assert.match(executable, guestPath);
  assert.ok(stdout.split('\n').includes(WARM_PIXEL_PROBE_SHA256 + '  ' + executable), 'guest SHA matches the actual installed ELF');
  return executable;
}

export function literalWarmPixels(seed) {
  // Literal RGBA palettes, in GL bottom-left, bottom-right, top-left, top-right order.
  // They are independent of the guest probe's mask/XOR implementation.
  const palettes = {
    5: [[0, 0, 255, 255], [255, 255, 255, 255], [255, 0, 0, 255], [0, 255, 255, 255]],
    2: [[255, 255, 0, 255], [0, 0, 0, 255], [0, 255, 255, 255], [255, 0, 0, 255]],
  };
  assert.ok(Object.hasOwn(palettes, seed), 'independently predicted challenge seed');
  const pixels = Buffer.alloc(256);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    pixels.set(palettes[seed][(y < 4 ? 0 : 2) + (x < 4 ? 0 : 1)], (y * 8 + x) * 4);
  }
  return pixels;
}

export function assertWarmPixelResult(result, seed) {
  assert.equal(result?.exit, 0, 'actual guest GLES challenge exits successfully');
  const stdout = String(result.stdout).replaceAll('\r', '');
  assert.equal((stdout.match(/^WARM_PIXELS_RENDERER=virgl \(wasm-vm WebGL2 VirGL\)$/gm) || []).length, 1);
  assert.equal((stdout.match(/^WARM_PIXELS_VERSION=OpenGL ES 3\.0 Mesa 26\.2\.2$/gm) || []).length, 1);
  assert.doesNotMatch(stdout, /llvmpipe|softpipe|swrast|WARM_PIXELS_(?:FAIL|TIMEOUT|GL_ERROR|SHADER_FAIL|DIFFERENT)/i);
  const rows = [...stdout.matchAll(/^WARM_PIXELS_BYTES=([0-9a-f]{512})$/gm)];
  assert.equal(rows.length, 1, 'all 64 actual RGBA pixels are recorded exactly once');
  const pixels = Buffer.from(rows[0][1], 'hex');
  assert.deepEqual(pixels, literalWarmPixels(seed), 'actual readPixels equals the independent literal 64-pixel prediction');
  const expected = `WARM_PIXELS_RESULT seed=${seed} pixels=64 bytes=256 draws=4 different=0`;
  assert.equal(stdout.split('\n').filter(line => line === expected).length, 1);
  assert.equal(stdout.split('\n').filter(line => line === 'WARM_PIXELS_PASS failures=0').length, 1);
  return {seed, pixels: 64, bytes: pixels.length, rgbaSha256: digest(pixels)};
}

function assertGpuState(state) {
  assert.equal(state.restored, true, 'original controller confirms GPU warm restoration');
  const gpu = state.gpu;
  assert.equal(gpu?.qualified, true);
  assert.equal(gpu.lost, false);
  assert.equal(gpu.poisoned, false);
  assert.equal(gpu.disposed, false);
  assert.equal(gpu.counters.failed, 0);
  assert.equal(gpu.counters.cancelled, 0);
  assert.equal(gpu.guestCommands?.dropped, 0);
  for (const command of gpu.guestCommands.records) assert.ok(command.response < 0x1200, 'original GPU response was not a device refusal');
}

export async function verifyWarmGpuPixels(page, {outputDir, label = 'warm-gpu-literal-pixels'} = {}) {
  assert.match(label, /^[a-z0-9-]+$/);
  assert.ok(outputDir);
  await fs.mkdir(outputDir, {recursive: true});
  const report = {status: 'running', scope: 'new literal GLES pixels through the original restored production worker', runs: [], errors: []};
  const save = async () => fs.writeFile(path.join(outputDir, label + '.json'), JSON.stringify(report, null, 2) + '\n');
  const originalRun = command => page.evaluate(async command => globalThis.wvmDemo.run(command, 300000), command);
  const snapshot = () => page.evaluate(async () => ({
    time: performance.now(), restored: await globalThis.wvmDemo.restoredFromBootSnapshot(),
    clock: await globalThis.__linuxCtl.guestClockState(), gpu: await globalThis.wvmDemo.gpuStats(),
  }));
  const onPageError = error => report.errors.push({type: 'pageerror', message: String(error)});
  const onConsole = message => { if (message.type() === 'error') report.errors.push({type: 'console', message: message.text()}); };
  page.on('pageerror', onPageError); page.on('console', onConsole);
  let executable;
  let failure;
  try {
    const probe = await readWarmPixelProbe();
    report.probe = {binaryBytes: probe.binary.length, binarySha256: probe.binarySha256, sourceSha256: probe.sourceSha256, build: probe.receipt};
    report.before = await snapshot(); await save(); assertGpuState(report.before);
    report.install = await originalRun(warmPixelInstallCommand(probe.binary)); await save();
    executable = assertWarmPixelInstall(report.install);
    for (const seed of [5, 2]) {
      const row = {seed, before: await snapshot()}; report.runs.push(row); await save();
      assertGpuState(row.before);
      row.result = await originalRun(executable + ' ' + seed);
      row.after = await snapshot(); await save();
      row.pixels = assertWarmPixelResult(row.result, seed);
      assertGpuState(row.after);
      assert.equal(row.after.gpu.epoch, row.before.gpu.epoch, 'same fresh restored owner executed the challenge');
      row.gpuDelta = Object.fromEntries(['begun', 'completed', 'draws', 'outputBytes'].map(key => [key, row.after.gpu.counters[key] - row.before.gpu.counters[key]]));
      assert.ok(row.gpuDelta.draws >= 4, 'four new original raster draws reached the renderer');
      assert.ok(row.gpuDelta.completed > 0, 'new original jobs physically completed');
      assert.ok(row.gpuDelta.outputBytes >= 256, 'new readback reached original GPU scatter');
      await save();
    }
    report.after = await snapshot(); await save(); assertGpuState(report.after);
    assert.deepEqual(report.errors, [], 'no browser error during the independent actual GPU workload');
    report.status = 'passed';
  } catch (error) {
    failure = error; report.status = 'failed'; report.error = error.stack || String(error);
  } finally {
    if (executable) {
      try {
        assert.match(executable, guestPath);
        report.cleanup = await originalRun('rm -- ' + executable + ' && rmdir -- ' + path.posix.dirname(executable));
        assert.equal(report.cleanup.exit, 0, 'remove only the probe-owned guest directory');
      } catch (error) {
        report.cleanupError = error.stack || String(error);
        if (!failure) { failure = error; report.status = 'failed'; }
      }
    }
    page.off('pageerror', onPageError); page.off('console', onConsole);
    await save();
  }
  if (failure) throw failure;
  return report;
}

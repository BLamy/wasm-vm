import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {formatRpcCommand} from '../../web/guest-rpc.js';
import {assertWarmPixelInstall, assertWarmPixelResult, literalWarmPixels, readWarmPixelProbe,
  warmPixelInstallCommand, WARM_PIXEL_PROBE_SHA256} from './critic-warm-pixels.mjs';

const response = (seed, bytes = literalWarmPixels(seed)) => ({exit: 0, stdout: [
  'WARM_PIXELS_RENDERER=virgl (wasm-vm WebGL2 VirGL)',
  'WARM_PIXELS_VERSION=OpenGL ES 3.0 Mesa 26.2.2',
  'WARM_PIXELS_BYTES=' + bytes.toString('hex'),
  `WARM_PIXELS_RESULT seed=${seed} pixels=64 bytes=256 draws=4 different=0`,
  'WARM_PIXELS_PASS failures=0', '',
].join('\n')});

test('pinned RISC-V executable installs through a complete <=2KiB-line quoted heredoc', async () => {
  const {binary} = await readWarmPixelProbe();
  const command = warmPixelInstallCommand(binary);
  const encoded = command.split("<<'WVM_CRITIC_PIXEL_ELF'\n")[1].split('\nWVM_CRITIC_PIXEL_ELF\n')[0];
  assert.ok(encoded.split('\n').every(line => line.length <= 2048 && /^[A-Za-z0-9+/=]+$/.test(line)));
  assert.deepEqual(Buffer.from(encoded.replaceAll('\n', ''), 'base64'), binary);
  // The actual public wrapper appends a separator. A delimiter at its end would
  // otherwise cause the earlier background/heredoc diagnostic timeout pattern.
  execFileSync('/bin/bash', ['-n'], {input: formatRpcCommand(command, 'criticPixels').replaceAll('\r', '\n')});
});

test('guest installation requires the original owned path and exact installed bytes', () => {
  const executable = '/tmp/wvm-critic-warm-pixels.H4i5J6/probe';
  const installed = {exit: 0, stdout: `WARM_PIXELS_EXEC=${executable}\n${WARM_PIXEL_PROBE_SHA256}  ${executable}\n`};
  assert.equal(assertWarmPixelInstall(installed), executable);
  assert.throws(() => assertWarmPixelInstall({...installed, exit: 1}));
  assert.throws(() => assertWarmPixelInstall({...installed, stdout: installed.stdout.replace('H4i5J6', 'x;true')}));
  assert.throws(() => assertWarmPixelInstall({...installed, stdout: installed.stdout.replace(WARM_PIXEL_PROBE_SHA256, '0'.repeat(64))}));
});

test('two asymmetric literal predictions check every actual pixel and GL row order', () => {
  for (const seed of [5, 2]) {
    const expected = literalWarmPixels(seed);
    const verified = assertWarmPixelResult(response(seed), seed);
    assert.equal(verified.rgbaSha256, createHash('sha256').update(expected).digest('hex'));
    for (let byte = 0; byte < 256; byte++) {
      const wrong = Buffer.from(expected); wrong[byte] ^= 1;
      assert.throws(() => assertWarmPixelResult(response(seed, wrong), seed), 'changed byte ' + byte);
    }
    const reversed = Buffer.concat(Array.from({length: 8}, (_, row) => expected.subarray((7-row)*32, (8-row)*32)));
    assert.throws(() => assertWarmPixelResult(response(seed, reversed), seed), 'upside-down readback');
  }
});

test('printed success cannot replace actual raw pixels, current challenge or real Mesa identity', () => {
  const valid = response(5);
  assert.throws(() => assertWarmPixelResult({...valid, exit: 8}, 5));
  assert.throws(() => assertWarmPixelResult({...valid, stdout: valid.stdout.replace(/WARM_PIXELS_BYTES=.*\n/, '')}, 5));
  assert.throws(() => assertWarmPixelResult({...valid, stdout: valid.stdout.replace('virgl (wasm-vm WebGL2 VirGL)', 'llvmpipe (LLVM)')}, 5));
  assert.throws(() => assertWarmPixelResult({...valid, stdout: valid.stdout.replace('OpenGL ES 3.0 Mesa 26.2.2', 'OpenGL ES 3.0 mock')}, 5));
  assert.throws(() => assertWarmPixelResult(valid, 2), 'stale seed5 result does not satisfy seed2');
  assert.throws(() => assertWarmPixelResult({...valid, stdout: valid.stdout + 'WARM_PIXELS_GL_ERROR where=readback error=0x502\n'}, 5));
  assert.throws(() => assertWarmPixelResult({...valid, stdout: valid.stdout + valid.stdout}, 5), 'ambiguous double result');
});

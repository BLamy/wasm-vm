import { decodeSubmission } from '../../../renderer/virgl-command/decoder.mjs';

export function runIndependent() {
  let checks = 0;
  const check = (condition, label) => { checks++; if (!condition) throw new Error(label); };
  const equal = (a, b, label) => check(JSON.stringify(a) === JSON.stringify(b), label);
  const packet = (op, type, words) => {
    const a = new Uint8Array((words.length + 1) * 4), v = new DataView(a.buffer);
    v.setUint32(0, op + type * 256 + words.length * 65536, true);
    words.forEach((w, i) => v.setUint32(4 + 4 * i, w, true)); return a;
  };
  const decode = (bytes) => {
    const r = decodeSubmission(bytes);
    check(Object.isFrozen(r), 'result frozen');
    if (!r.ok) equal(Object.keys(r).sort(), ['error', 'ok'], 'failure no partial commands');
    return r;
  };
  const good = packet(28, 0, [0xa1b2c3d4]);
  for (let len = 0; len < 65536; len++) {
    const a = good.slice(); a[2] = len % 256; a[3] = Math.floor(len / 256);
    const r = decode(a); check(r.ok === (len === 1), `fixed payload length ${len}`);
    if (!r.ok) check(r.error.byteOffset === 0 && r.error.opcode === 28, 'fixed payload error location');
  }
  for (let op = 0; op < 256; op++) {
    check(decode(packet(op, 0, [])).ok === (op === 6 || op === 44), `zero payload opcode ${op}`);
  }
  for (let type = 0; type < 256; type++) {
    check(decode(packet(1, type, [9])).ok === (type === 5), `create type ${type}`);
    check(decode(packet(2, type, [0])).ok === [1, 2, 3, 5].includes(type), `bind type ${type}`);
    check(decode(packet(3, type, [9])).ok === (type >= 1 && type <= 8), `destroy type ${type}`);
  }
  for (let byte = 0; byte < 256; byte++) {
    const a = packet(1, 4, [9, 0, 2, 1, 0, byte]);
    const r = decode(a), allowed = [9, 10, 13].includes(byte) || (byte >= 32 && byte <= 126);
    check(r.ok === allowed, `shader alphabet ${byte}`);
    if (allowed) check(r.commands[0].fields.text.charCodeAt(0) === byte, 'shader raw ASCII extraction');
  }
  for (const length of [1, 2, 3, 4, 5, 7, 15, 16384]) {
    const a = packet(1, 4, [9, 1, length + 1, 8192, 0, ...Array(Math.ceil((length + 1) / 4)).fill(0)]);
    a.fill(65, 24, 24 + length);
    check(decode(a).ok, `shader size ${length}`);
    for (let i = 24 + length; i < a.length; i++) {
      const changed = a.slice(); changed[i] = 255; check(!decode(changed).ok, `shader NUL/padding ${length}:${i}`);
    }
  }
  const maximum = packet(44, 0, Array(65535).fill(0));
  let state = 0x7f4a7c15;
  for (let i = 4; i < maximum.length; i++) { state = Math.imul(state, 1664525) + 1013904223; maximum[i] = state >>> 24; }
  equal(decode(maximum).commands.map(x => [x.opcode, x.byteOffset, x.payloadDwords, x.byteLength]),
    [[44, 0, 65535, 262144]], 'maximum opaque random padding');
  const tail = new Uint8Array(good.length + 4); tail.set(good); tail[good.length] = 255;
  const failed = decode(tail); check(!failed.ok && failed.error.byteOffset === 8 && failed.error.opcode === 255, 'tail location');
  check(decode(good).commands[0].fields.subContextId === 0xa1b2c3d4, 'invalid-to-valid recovery');

  let callbacks = 0;
  class Hostile extends Uint8Array {}
  for (const key of ['buffer', 'byteOffset', 'byteLength', 'length', 'slice', 'subarray', Symbol.toStringTag]) {
    Object.defineProperty(Hostile.prototype, key, { get() { callbacks++; throw new Error('input accessor executed'); } });
  }
  const hostile = new Hostile(good);
  const stable = decode(hostile); check(stable.ok, 'typed subclass accepted'); check(callbacks === 0, 'typed subclass accessors bypassed');
  hostile.fill(0); check(stable.commands[0].fields.subContextId === 0xa1b2c3d4, 'typed subclass snapshot');
  const backing = new Uint8Array(32); backing.set(good, 7);
  const alias = backing.subarray(7, 15), result = decode(alias);
  structuredClone(backing.buffer, { transfer: [backing.buffer] });
  check(result.commands[0].fields.subContextId === 0xa1b2c3d4, 'post-call backing detach leaves output stable');
  check(!decode(alias).ok, 'detached alias rejected');
  for (const name of ['sourceSha256', 'event', 'contextId']) {
    const labels = Object.defineProperty({}, name, { get() { callbacks++; return 0; } });
    const r = decodeSubmission(good, labels); check(!r.ok && r.error.code === 'invalid-provenance', 'plain metadata accessor rejected');
  }
  check(callbacks === 0, 'no input or plain metadata getter callback');
  const clear = packet(7, 0, [4, 0x80000000, 0x3e800000, 0xbf000000, 0x7f7fffff, 0, 0x3fd00000, 255]);
  const color = decode(clear).commands[0].fields;
  check(Object.is(color.color[0], -0), 'f32 negative zero retained');
  equal([color.color[1], color.color[2], color.depth, color.stencil], [0.25, -0.5, 0.25, 255], 'f32/f64 typed extraction');
  equal(color.colorWords, [0x80000000, 0x3e800000, 0xbf000000, 0x7f7fffff], 'raw float bits retained');
  for (const width of [0, 1, 32768, 65535]) for (const height of [0, 1, 32768, 65535]) {
    equal(decode(packet(38, 0, [width + height * 65536, 0])).commands[0].fields,
      { width, height, layers: 0, samples: 0 }, 'packed framebuffer dimensions');
  }
  return { status: 'passed', checks, payloadLengthCases: 65536, opcodeCases: 256,
    objectCases: 768, shaderAlphabetCases: 256, novel: 'typed-array accessor and lifetime attacks' };
}

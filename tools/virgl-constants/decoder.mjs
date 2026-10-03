/** Authored raw constant packets. This runner has no graphics or shader semantics. */
import { decodeSubmission } from '../../renderer/virgl-command/decoder.mjs';

const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const check = (value, message) => { if (!value) throw new Error(message); };
function frozen(value) {
  return value === null || typeof value !== 'object' ||
    (Object.isFrozen(value) && Object.values(value).every(frozen));
}
function packet(header, stage, slot, words) {
  const bytes = new Uint8Array(12 + words.length * 4), view = new DataView(bytes.buffer);
  [header, stage, slot, ...words].forEach((word, index) => view.setUint32(index * 4, word, true));
  return bytes;
}
function join(a, b) { const bytes = new Uint8Array(a.length + b.length); bytes.set(a); bytes.set(b, a.length); return bytes; }

export function runDecoderAcceptance() {
  const cases = [];
  const bits = [0x3f800000, 0xbf000000, 0x80000000, 1, 0x3f000000, 0];
  const words = Array.from({ length: 184 }, (_, index) => bits[index % bits.length]);
  function record(name, bytes, expected) {
    const result = decodeSubmission(bytes);
    check(frozen(result), `${name}: deeply frozen result`);
    check(result.ok === expected.ok, `${name}: literal acceptance`);
    if (expected.ok) {
      const command = result.commands[0];
      check(result.commands.length === 1 && command.opcode === 12, `${name}: one constant packet`);
      check(command.byteLength === expected.byteLength && command.payloadDwords === expected.byteLength / 4 - 1,
        `${name}: exact framing`);
      check(command.fields.stage === expected.stage && command.fields.index === expected.slot, `${name}: stage and slot`);
      check(JSON.stringify(command.fields.words) === JSON.stringify(expected.words), `${name}: exact bit words`);
      check(command.fields.values.every(Number.isFinite), `${name}: finite floats`);
    } else {
      check(!Object.hasOwn(result, 'commands'), `${name}: no partial commands`);
      check(result.error.code === expected.code && result.error.byteOffset === (expected.byteOffset ?? 0), `${name}: exact rejection`);
    }
    cases.push({ name, requestHex: hex(bytes), expected, result });
    return result;
  }
  for (const stage of [0, 1]) {
    record(`stage-${stage}-184-words`, packet(0x00ba000c, stage, 0, words),
      { ok: true, stage, slot: 0, byteLength: 748, words });
    record(`stage-${stage}-180-words`, packet(0x00b6000c, stage, 0, words.slice(0, 180)),
      { ok: true, stage, slot: 0, byteLength: 732, words: words.slice(0, 180) });
    record(`stage-${stage}-empty-reset`, packet(0x0002000c, stage, 0, []),
      { ok: true, stage, slot: 0, byteLength: 12, words: [] });
    record(`stage-${stage}-188-words`, packet(0x00be000c, stage, 0, [...words, 0, 0, 0, 0]),
      { ok: false, code: 'limit-exceeded' });
    record(`stage-${stage}-183-words`, packet(0x00b9000c, stage, 0, words.slice(0, 183)),
      { ok: false, code: 'payload-length' });
    record(`stage-${stage}-active-slot-one`, packet(0x00ba000c, stage, 1, words),
      { ok: false, code: 'unsupported-feature' });
  }
  record('legacy-inactive-stage-slot', packet(0x0002000c, 2, 14, []),
    { ok: true, stage: 2, slot: 14, byteLength: 12, words: [] });
  record('unsupported-active-stage', packet(0x00ba000c, 2, 0, words), { ok: false, code: 'unsupported-feature' });
  record('unknown-stage', packet(0x00ba000c, 6, 0, words), { ok: false, code: 'invalid-enum' });
  record('slot-limit', packet(0x0002000c, 0, 15, []), { ok: false, code: 'limit-exceeded' });
  for (const [name, word] of [['nan', 0x7fc00000], ['infinity', 0x7f800000]]) {
    record(`last-word-${name}`, packet(0x00ba000c, 1, 0, [...words.slice(0, 183), word]),
      { ok: false, code: 'invalid-value' });
  }
  record('truncated-184-payload', packet(0x00ba000c, 0, 0, words).slice(0, -4), { ok: false, code: 'truncated-payload' });
  record('nonzero-object-type', packet(0x00ba010c, 0, 0, words), { ok: false, code: 'invalid-object-type' });
  const endTransfers = new Uint8Array([44, 0, 0, 0]);
  record('invalid-tail-over-limit', join(endTransfers, packet(0x00be000c, 0, 0, [...words, 0, 0, 0, 0])),
    { ok: false, code: 'limit-exceeded', byteOffset: 4 });
  record('invalid-tail-non-vec4', join(endTransfers, packet(0x00b9000c, 0, 0, words.slice(0, 183))),
    { ok: false, code: 'payload-length', byteOffset: 4 });
  const input = packet(0x00ba000c, 0, 0, words), host = new Uint8Array(input.length + 3);
  host.set(input, 3);
  const owned = record('unaligned-host-view-owned-copy', host.subarray(3),
    { ok: true, stage: 0, slot: 0, byteLength: 748, words });
  host.fill(0);
  check(JSON.stringify(owned.commands[0].fields.words) === JSON.stringify(words), 'decoded constant words survive guest mutation');
  check(Object.is(owned.commands[0].fields.values[2], -0), 'negative-zero bits preserve signed float value');
  return { schema: 'wasm-vm-constants-decoder-v1', status: 'passed',
    boundary: 'authored raw packets; decoded180-word prefixes do not establish draw completeness',
    cases, stats: { cases: cases.length, accepted: cases.filter((entry) => entry.result.ok).length,
      rejected: cases.filter((entry) => !entry.result.ok).length },
    ownership: { deeplyFrozen: true, sourceMutationPreserved: true, signedZeroPreserved: true } };
}

if (typeof process !== 'undefined' && process.argv[1]) {
  const { pathToFileURL } = await import('node:url');
  if (pathToFileURL(process.argv[1]).href === import.meta.url) {
    const { default: fs } = await import('node:fs/promises');
    const { default: path } = await import('node:path');
    check(process.argv.length === 4 && process.argv[2] === '--output', 'usage: decoder.mjs --output DIR');
    const output = path.resolve(process.argv[3]); await fs.mkdir(output, { recursive: true });
    const result = runDecoderAcceptance();
    await fs.writeFile(path.join(output, 'decoder-report.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ status: result.status, ...result.stats, output }));
  }
}

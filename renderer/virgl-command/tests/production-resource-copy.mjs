// Original device submissions, physical GPU copies and complete independent pixels.
import {checker, makeRig, context, idCommand, header, backing, transfer, submission} from './submit-acceptance.mjs';
import {packet, join} from '../../../tools/virgl-command/standard-image-fixtures.mjs';
import {createVirglProductionBridge} from '../control-bridge.mjs';
import {qualifyVirglHost, createWorkerScanoutPresenter} from '../production.mjs';
import {createVirglStandardStreamOutputShaderBridge} from '../../virgl-shader/standard.mjs';
import {runResourceCopyWire} from './production-resource-copy-wire.mjs';

const copy = value => JSON.parse(JSON.stringify(value, (_, v) => ArrayBuffer.isView(v) ? [...v] : typeof v === 'bigint' ? v.toString() : v));
const put = (bytes, offset, value) => new DataView(bytes.buffer).setUint32(offset, value, true);
const hex = bytes => [...bytes].map(v => v.toString(16).padStart(2, '0')).join('');
const unhex = text => Uint8Array.from(text.match(/../g), v => parseInt(v, 16));
const sha = async bytes => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
const allocation = (id, width, height, lastLevel = 0, format = 1) => {
  const bytes = header(0x204, 0, 72);
  [id, 2, format, 10, width, height, 1, 1, lastLevel, 0, 0, 0].forEach((v, i) => put(bytes, 24 + i * 4, v));
  return bytes;
};
const region = (source, destination, sx, sy, dx, dy, width, height, sourceLevel = 0, destinationLevel = 0) =>
  packet(17, 0, [destination, destinationLevel, dx, dy, 0, source, sourceLevel, sx, sy, 0, width, height, 1]);

// Independent CPU bilinear reference at destination pixel centers. Native UNORM
// interpolation may round a channel by one byte; no spatial or alpha tolerance.
function downsample(bytes, width, height, nextWidth, nextHeight) {
  const out = new Uint8Array(nextWidth * nextHeight * 4);
  for (let y = 0; y < nextHeight; y++) for (let x = 0; x < nextWidth; x++) {
    const px = (x + .5) * width / nextWidth - .5, py = (y + .5) * height / nextHeight - .5;
    const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
    for (let channel = 0; channel < 4; channel++) {
      let value = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const at = (Math.max(0, Math.min(height - 1, iy + dy)) * width + Math.max(0, Math.min(width - 1, ix + dx))) * 4 + channel;
        value += bytes[at] * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
      }
      out[(y * nextWidth + x) * 4 + channel] = Math.round(value);
    }
  }
  return out;
}

async function one(Wasm, profile, native, compiler, fixture, schedule) {
  const c = checker(), row = {name: 'original-wallpaper-copy/schedule' + schedule, predictions: {
    base: 'Every copied base byte equals the original literal nonuniform image',
    mips: 'Every native mip byte agrees with independent bilinear pixel-center interpolation within one UNORM byte',
    bounds: 'Out-of-range, format reinterpretation and same-level aliases issue no native copy and preserve destination pixels',
    lifetime: 'Queued unref retires after the real fenced copy; all native owners are released'}, nativeCopies: []};
  const gl = new Proxy(native, {get(target, name) {
    const method = Reflect.get(target, name, target); if (typeof method !== 'function') return method;
    return (...args) => { if (name === 'blitFramebuffer') row.nativeCopies.push(args); return method.apply(target, args); };
  }});
  const selected = class {constructor(callback) {return Wasm.qualified(callback, profile.hostWords, profile.formatRoles, profile.renderer);}};
  const rig = makeRig(selected, options => createVirglProductionBridge({...options,
    presenter: createWorkerScanoutPresenter(() => {})}), gl, compiler, c, schedule, true, false, true);
  const address = rig.q.base + 0x210000n, windowBytes = 1024 * 1024;
  window.__productionCriticActive = () => ({row, guest: copy(rig.q.vm.inspect()), host: copy(rig.host.bridge.inspect())});
  const add = async (id, width, height, lastLevel = 0, format = 1) => {
    await rig.expect('native image ' + id, allocation(id, width, height, lastLevel, format));
    await rig.expect('owned membership ' + id, idCommand(0x202, 1, id));
    await rig.expect('bounded reusable DMA window ' + id, backing(id, [[address, windowBytes]]));
  };
  const upload = async (id, bytes, width, height) => {
    for (let y = 0; y < height; y += 64) {
      const rows = Math.min(64, height - y), stripe = bytes.subarray(y * width * 4, (y + rows) * width * 4);
      rig.q.write(address, stripe);
      await rig.expect('fresh source stripe ' + y, transfer(1, id, 1, [0, y, 0, width, rows, 1]));
    }
  };
  const read = async (id, width, height, level = 0) => {
    const bytes = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 64) {
      const rows = Math.min(64, height - y), start = rig.exchanges.length;
      const request = transfer(1, id, 2, [0, y, 0, width, rows, 1], 0n, 0, 0, BigInt(101 + level)); put(request, 60, level);
      await rig.expect('complete native stripe ' + id + '/' + level + '/' + y, request);
      c.equal(rig.exchanges.length, start + 1, 'one original readback exchange per stripe');
      const stripe = unhex(rig.exchanges[start].bytes);
      c.equal(stripe.length, width * rows * 4, 'exact full stripe bytes'); bytes.set(stripe, y * width * 4);
    }
    return bytes;
  };
  try {
    await rig.expect('original context', context(1));
    const [a, b] = fixture.resources;
    c.equal(a.id, 495, 'literal original source identity'); c.equal(b.id, 496, 'literal original mip identity');
    await add(a.id, a.width, a.height, a.lastLevel); await add(b.id, b.width, b.height, b.lastLevel);
    let expected = new Uint8Array(a.width * a.height * 4);
    for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
      const at = (y * a.width + x) * 4;
      expected.set([(Math.floor(x / 32) * 17 + Math.floor(y / 32) * 3) & 255,
        (Math.floor(y / 32) * 29 + 11) & 255, (Math.floor(x / 32) * 7 + 41) & 255, 255], at);
    }
    row.original = {width: a.width, height: a.height, bytes: expected.length, sha256: await sha(expected)};
    await upload(a.id, expected, a.width, a.height);
    // Retain the actual original RCR and ten BLIT packet bytes; unrelated UI
    // state from its complete job is tested separately by the wire regression.
    const original = unhex(fixture.commandsHex), view = new DataView(original.buffer), copies = [];
    for (let offset = 0; offset < original.length;) {
      const h = view.getUint32(offset, true), length = (1 + (h >>> 16)) * 4;
      if ([16, 17].includes(h & 255)) copies.push(original.slice(offset, offset + length)); offset += length;
    }
    c.equal(copies.length, 11, 'actual copy plus all ten native mip BLITs');
    await rig.expect('original fenced copy and full mip chain', submission(1, join(...copies), 0x40000000000017n));
    row.levels = [];
    let width = a.width, height = a.height;
    for (let level = 0; level <= b.lastLevel; level++) {
      const actual = await read(b.id, width, height, level);
      let maxDelta = 0, wrongAlpha = 0;
      for (let i = 0; i < actual.length; i++) {
        maxDelta = Math.max(maxDelta, Math.abs(actual[i] - expected[i]));
        if (i % 4 === 3 && actual[i] !== 255) wrongAlpha++;
      }
      c.truth(maxDelta <= (level ? 1 : 0) && wrongAlpha === 0, 'every byte of mip ' + level + ' (delta ' + maxDelta + ')');
      row.levels.push({level, width, height, bytes: actual.length, sha256: await sha(actual), expectedSha256: await sha(expected), maxDelta});
      const nextWidth = Math.max(1, Math.floor(width / 2)), nextHeight = Math.max(1, Math.floor(height / 2));
      expected = downsample(actual, width, height, nextWidth, nextHeight); width = nextWidth; height = nextHeight;
    }
    await add(600, 7, 5); await add(601, 8, 6); await add(602, 8, 6, 0, 67); await add(603, 8, 6, 0, 67);
    const source = Uint8Array.from({length: 7 * 5 * 4}, (_, i) => (i * 37 + 19) & 255);
    const destination = Uint8Array.from({length: 8 * 6 * 4}, (_, i) => i % 4 === 3 ? 0x9c : 0x6d);
    await upload(600, source, 7, 5); await upload(601, destination, 8, 6);
    await rig.expect('nonzero source and destination region', submission(1, region(600, 601, 1, 1, 2, 2, 3, 2), 19n));
    for (let y = 0; y < 2; y++) destination.set(source.subarray(((y + 1) * 7 + 1) * 4, ((y + 1) * 7 + 4) * 4), ((y + 2) * 8 + 2) * 4);
    c.same([...await read(601, 8, 6)], [...destination], 'every copied and untouched region byte');
    row.region = {sourceHex: hex(source), expectedHex: hex(destination)};
    const rgba = Uint8Array.from({length: 8 * 6 * 4}, (_, i) => (i * 71 + 131) & 255);
    await upload(603, rgba, 8, 6);
    await rig.expect('matching RGBA8 copy', submission(1, region(603, 602, 0, 0, 0, 0, 8, 6), 21n));
    c.same([...await read(602, 8, 6)], [...rgba], 'complete RGBA8 colors and varying alpha');
    row.refusals = [];
    for (const [label, bytes] of [
      ['source outside', region(600, 601, 6, 0, 0, 0, 3, 1)],
      ['destination outside', region(600, 601, 0, 0, 7, 0, 2, 1)],
      ['unsigned origin overflow', region(600, 601, 0, 0, 0xffffffff, 0, 1, 1)],
      ['source invalid level', region(600, 601, 0, 0, 0, 0, 1, 1, 1)],
      ['same image same level', region(601, 601, 0, 0, 1, 0, 1, 1)],
      ['format reinterpretation', region(600, 602, 0, 0, 0, 0, 1, 1)],
    ]) {
      const before = copy(rig.host.bridge.inspect().store.budgets), nativeCount = row.nativeCopies.length;
      await rig.expect(label, submission(1, bytes, 23n), 0x1205);
      c.equal(row.nativeCopies.length, nativeCount, label + ' issues no native copy');
      c.same(rig.host.bridge.inspect().store.budgets, before, label + ' releases all temporary ownership');
      c.same([...await read(601, 8, 6)], [...destination], label + ' preserves every destination byte');
      row.refusals.push(label);
    }
    const operation = rig.q.enqueue('fenced copy before original unref', submission(1, region(600, 601, 0, 0, 0, 0, 1, 1), 29n));
    const unref = rig.q.enqueue('unref behind native fence', idCommand(0x102, 0, 600));
    rig.q.kick(); rig.q.run(); c.equal(rig.q.usedIndex(), operation.number, 'real copy waits for native completion');
    await rig.drain(); rig.q.collect(operation); rig.q.collect(unref);
    destination.set(source.subarray(0, 4));
    c.same([...await read(601, 8, 6)], [...destination], 'fenced native copy survived source retirement');
    c.equal(native.getError(), native.NO_ERROR, 'zero native GPU errors'); row.status = 'passed';
  } catch (error) {row.status = 'failed'; row.failure = {message: error.message, stack: error.stack};}
  finally {
    row.records = copy(rig.q.records); row.events = copy(rig.events); row.exchanges = copy(rig.exchanges);
    row.completions = copy(rig.completions); row.beforeDispose = copy(rig.host.bridge.inspect());
    row.guestTrace = rig.q.vm.commandTrace(); row.machineDigest = rig.q.vm.machineDigest();
    row.disposed = copy(rig.host.bridge.dispose()); rig.q.vm.free(); row.cleaned = rig.trace.snapshot();
    row.assertions = c.assertions;
    if (row.cleaned.liveObjects || row.cleaned.liveSyncs) {row.status = 'failed'; row.cleanupFailure = 'Native owners leaked';}
    window.__productionCriticActive = null;
  }
  return row;
}

export async function runProductionResourceCopy({WasmVirglSubmitProof, fixtures, schedules = [0, 1, 7]}) {
  const native = document.querySelector('#gpu').getContext('webgl2', {antialias: false, failIfMajorPerformanceCaveat: true});
  const qualification = await qualifyVirglHost(native), compiler = await createVirglStandardStreamOutputShaderBridge();
  const report = {status: 'running', qualification: copy(qualification), wire: runResourceCopyWire(fixtures), rows: []};
  window.__productionCriticReport = report;
  for (const schedule of schedules) {
    const row = await one(WasmVirglSubmitProof, qualification, native, compiler, fixtures.jobs[0], schedule);
    report.rows.push({...await window.__recordProductionCriticRun(report.rows.length, JSON.stringify(row)),
      name: row.name, status: row.status, ...(row.failure ? {failure: row.failure} : {})});
  }
  report.status = report.rows.every(row => row.status === 'passed') ? 'passed' : 'failed';
  report.summary = {status: report.status, runs: report.rows.length, wire: report.wire,
    failed: report.rows.filter(row => row.status !== 'passed'), hardware: qualification.identity};
  return report;
}

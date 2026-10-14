// Independent final-entry validation across an original readable DMA boundary.
import {checker, makeRig, context, idCommand, header, backing, transfer}
  from '../../renderer/virgl-command/tests/submit-acceptance.mjs';
import {createVirglProductionBridge} from '../../renderer/virgl-command/control-bridge.mjs';
import {qualifyVirglHost, createWorkerScanoutPresenter} from '../../renderer/virgl-command/production.mjs';
import {createVirglStandardStreamOutputShaderBridge} from '../../renderer/virgl-shader/standard.mjs';

const copy = value => JSON.parse(JSON.stringify(value, (_, v) =>
  ArrayBuffer.isView(v) ? [...v] : typeof v === 'bigint' ? v.toString() : v));
const put = (bytes, offset, value) => new DataView(bytes.buffer).setUint32(offset, value, true);

function resource(id, width) {
  const bytes = header(0x204, 0, 72);
  [id, 0, 64, 16, width, 1, 1, 1, 0, 0, 0, 0].forEach((v, i) => put(bytes, 24 + i * 4, v));
  return bytes;
}

async function one(Wasm, profile, native, compiler, schedule) {
  const c = checker(), count = 16384;
  const row = {name: 'final-padding-byte-in-separate-descriptor/schedule' + schedule,
    predictions: {count, bytes: count * 4,
      invalid: 'Nonzero final reserved padding byte returns0x1205 with unchanged generations and no host attachment.',
      valid: 'The exact corrected final descriptor attaches and physically roundtrips all65536 literal bytes.',
      transport: 'Both requests traverse the original virtqueue, with the final byte in a separate readable DMA descriptor.'},
    dma: []};
  const Selected = class {
    constructor(callback) { return Wasm.qualified(callback, profile.hostWords, profile.formatRoles, profile.renderer); }
  };
  const rig = makeRig(Selected,
    options => createVirglProductionBridge({...options, presenter: createWorkerScanoutPresenter(() => {})}),
    native, compiler, c, schedule, true, false, true);
  const segments = [], expected = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const start = rig.q.base + 0x220000n + BigInt(i) * 16n, address = start + 4n;
    rig.q.write(start, new Uint8Array(16).fill(0xc7));
    const bytes = new Uint8Array([i & 255, (i >>> 8) & 255, 0x3f, 0x7b]);
    rig.q.write(address, bytes); expected.set(bytes, i * 4); segments.push([address, 4]);
  }
  const splitAttach = async (label, lastByte, expectedResponse) => {
    const wire = backing(1, segments); wire[wire.length - 1] = lastByte;
    const entry = rig.q.enqueue(label, wire, expectedResponse), tailAt = rig.q.base + 0x260000n;
    rig.q.write(tailAt, Uint8Array.of(lastByte));
    rig.q.descriptor(entry.head, entry.requestAddress, wire.length - 1, 1, entry.head + 2);
    rig.q.descriptor(entry.head + 2, tailAt, 1, 1, entry.head + 1);
    const before = {request: new Uint8Array(wire.length),
      firstDescriptor: [...rig.q.read(rig.q.desc + BigInt(entry.head * 16), 16)],
      tailDescriptor: [...rig.q.read(rig.q.desc + BigInt((entry.head + 2) * 16), 16)],
      responseDescriptor: [...rig.q.read(rig.q.desc + BigInt((entry.head + 1) * 16), 16)]};
    before.request.set(rig.q.read(entry.requestAddress, wire.length - 1));
    before.request[wire.length - 1] = rig.q.read(tailAt, 1)[0];
    c.same([...before.request], [...wire], 'actual split readable DMA contains the independent literal packet');
    row.dma.push({label, expectedResponse, request: [...before.request],
      firstDescriptor: before.firstDescriptor, tailDescriptor: before.tailDescriptor,
      responseDescriptor: before.responseDescriptor});
    rig.q.kick(); await rig.drain();
    const observed = {response: [...rig.q.read(entry.responseAddress, 24)],
      usedSlot: [...rig.q.read(rig.q.used + 4n + BigInt(entry.number * 8), 8)],
      commandTrace: copy(rig.q.vm.commandTrace()), machineDigest: rig.q.vm.machineDigest()};
    Object.assign(row.dma.at(-1), observed);
    const result = rig.q.collect(entry); rig.q.vm.writeMmio(0x64, 1); return result;
  };
  try {
    await rig.expect('original context', context(1));
    await rig.expect('original tiny full-list vertex buffer', resource(1, expected.length));
    const before = copy(rig.q.vm.inspect()), beforeHost = copy(rig.host.bridge.inspect());
    c.truth(typeof before.digest === 'string' && /^[0-9a-f]{64}$/.test(before.digest),
      'the original transport exposes its actual canonical state digest');
    const attachments = rig.events.filter(event => event.type === 'attachBacking').length;
    await splitAttach('nonzero final reserved byte across DMA boundary', 1, 0x1205);
    const rejected = copy(rig.q.vm.inspect()), rejectedHost = copy(rig.host.bridge.inspect());
    c.equal(rejected.digest, before.digest, 'rejected last entry preserves transport generations and allocation state');
    c.same(rejected.canonicalBytes, before.canonicalBytes,
      'rejected last entry leaves every original canonical transport byte unchanged');
    c.same(rejectedHost, beforeHost, 'rejected last entry leaves the original retained host state unchanged');
    c.equal(rig.events.filter(event => event.type === 'attachBacking').length, attachments,
      'all16384 entries validate before any host backing attachment');
    row.invalidState = {before, rejected, beforeHost, rejectedHost};
    await splitAttach('valid corrected final reserved byte across DMA boundary', 0, 0x1100);
    c.equal(rig.events.filter(event => event.type === 'attachBacking').length, attachments + 1,
      'corrected request produces exactly one host attachment');
    await rig.expect('original context member', idCommand(0x202, 1, 1));
    await rig.expect('original full fragmented GPU upload', transfer(1, 1, 1, [0, 0, 0, expected.length, 1, 1]));
    for (const [address, length] of segments) rig.q.write(address, new Uint8Array(length).fill(0xee));
    await rig.expect('original full fragmented GPU readback', transfer(1, 1, 2, [0, 0, 0, expected.length, 1, 1]));
    const actual = new Uint8Array(expected.length); let offset = 0;
    for (const [address, length] of segments) {
      actual.set(rig.q.read(address, length), offset); offset += length;
      c.same([...rig.q.read(address - 4n, 4)], Array(4).fill(0xc7), 'every segment prefix guard');
      c.same([...rig.q.read(address + BigInt(length), 8)], Array(8).fill(0xc7), 'every segment suffix guard');
    }
    c.same([...actual], [...expected], 'all literal native GPU bytes roundtrip through original16384 SG entries');
    c.equal(native.getError(), native.NO_ERROR, 'original native GPU path has no GL errors');
    row.roundtrip = {actual: [...actual], expected: [...expected]};
    row.status = 'passed';
  } catch (error) { row.status = 'failed'; row.failure = {message: error.message, stack: error.stack}; }
  finally {
    row.records = copy(rig.q.records); row.events = copy(rig.events);
    row.exchanges = copy(rig.exchanges); row.completions = copy(rig.completions);
    row.guestTrace = rig.q.vm.commandTrace(); row.machineDigest = rig.q.vm.machineDigest();
    row.beforeDispose = copy(rig.host.bridge.inspect());
    row.disposed = copy(rig.host.bridge.dispose()); rig.q.vm.free();
    row.cleaned = copy(rig.trace.snapshot()); row.assertions = c.assertions;
    if (row.cleaned.liveObjects || row.cleaned.liveSyncs) {
      row.status = 'failed'; row.cleanupFailure = 'Native owners leaked';
    }
  }
  return row;
}

export async function runProductionFragmentedBackingNovel({WasmVirglSubmitProof, schedules = [271828, 314159]}) {
  if (!schedules.length || schedules.some(value => !Number.isInteger(value) || value < 0 || value > 0xffffffff))
    throw Error('The independent fragmented backing probe requires valid schedules.');
  const native = document.querySelector('#gpu').getContext('webgl2',
    {antialias: false, failIfMajorPerformanceCaveat: true});
  const profile = await qualifyVirglHost(native), compiler = await createVirglStandardStreamOutputShaderBridge();
  const report = {status: 'running', rows: [], hardware: profile.identity}; window.__productionCriticReport = report;
  for (const schedule of schedules) {
    const row = await one(WasmVirglSubmitProof, profile, native, compiler, schedule);
    const pin = await window.__recordProductionCriticRun(report.rows.length, JSON.stringify(row));
    report.rows.push({...pin, name: row.name, status: row.status,
      ...(row.failure ? {failure: row.failure} : {})});
  }
  report.status = report.rows.every(row => row.status === 'passed') ? 'passed' : 'failed';
  report.summary = {status: report.status, runs: report.rows.length,
    failed: report.rows.filter(row => row.status !== 'passed'), hardware: profile.identity};
  return report;
}

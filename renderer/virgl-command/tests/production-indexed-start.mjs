import {checker, makeRig, context, idCommand, header, backing, transfer, submission} from './submit-acceptance.mjs';
import {packet, join, shader, word} from '../../../tools/virgl-command/standard-image-fixtures.mjs';
import {createVirglProductionBridge} from '../control-bridge.mjs';
import {qualifyVirglHost, createWorkerScanoutPresenter} from '../production.mjs';
import {createVirglStandardStreamOutputShaderBridge} from '../../virgl-shader/standard.mjs';

const copy = value => JSON.parse(JSON.stringify(value, (_, v) => ArrayBuffer.isView(v) ? [...v] : typeof v === 'bigint' ? v.toString() : v));
const hex = bytes => [...bytes].map(v => v.toString(16).padStart(2, '0')).join('');
const put = (bytes, offset, value) => new DataView(bytes.buffer).setUint32(offset, value, true);
const vertex = 'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
const fragment = 'FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {0,1,0,1}\n0: MOV OUT[0], IMM[0]\n1: END\n';
const originalQtDraw = Object.freeze([786440, 1, 62, 5, 1, 1, 0, 0, 1, 65535, 0, 0xffffffff, 0]);

function allocation(id, target, format, bind, width, height = 1) {
  const bytes = header(0x204, 0, 72);
  [id, target, format, bind, width, height, 1, 1, 0, 0, 0, 0].forEach((v, i) => put(bytes, 24 + 4 * i, v));
  return bytes;
}

async function one(Wasm, profile, native, compiler, schedule, indexSize) {
  const c = checker(), row = {name: `index${indexSize}/schedule${schedule}`, native: [], outputs: [],
    predictions: {pixels: 'Every pixel of the four-by-four quad is literal green RGBA.',
      span: 'The draw selects exactly62 indices at the retained eight-byte binding offset.',
      hints: 'Indexed starts0,1 and u32MAX produce identical pixels; prefix/suffix poison is never fetched.',
      bounds: 'Count/span or actual vertex-fetch violations issue no native draw.'}};
  const gl = new Proxy(native, {get(target, name) {
    const method = Reflect.get(target, name, target);
    if (typeof method !== 'function') return method;
    return (...args) => {
      row.native.push({name, args: args.map(v => ArrayBuffer.isView(v) ? [...v] : typeof v === 'object' ? v?.constructor.name : v)});
      return method.apply(target, args);
    };
  }});
  const Selected = class {constructor(callback) {return Wasm.qualified(callback, profile.hostWords, profile.formatRoles, profile.renderer);}};
  const rig = makeRig(Selected, options => createVirglProductionBridge({...options,
    presenter: createWorkerScanoutPresenter(() => {})}), gl, compiler, c, schedule, true, false, true);
  const colorAddress = rig.q.base + 0x210000n, vertexAddress = rig.q.base + 0x220000n,
    indexAddress = rig.q.base + 0x230000n, bindingOffset = 8, count = 62;
  const restart = 2 ** (indexSize * 8) - 1;
  const indices = new Uint8Array(bindingOffset + count * indexSize + 4).fill(0xee);
  const indexView = new DataView(indices.buffer);
  for (let i = 0; i < count; i++) {
    const value = i < 4 ? i : restart, offset = bindingOffset + i * indexSize;
    if (indexSize === 1) indexView.setUint8(offset, value);
    else if (indexSize === 2) indexView.setUint16(offset, value, true);
    else indexView.setUint32(offset, value, true);
  }
  const draws = () => row.native.filter(r => /^draw(?:Arrays|Elements)(?:Instanced)?$/.test(r.name)).length;
  const draw = (start, selectedCount = count, indexed = 1) => packet(8, 0,
    [start, selectedCount, 5, indexed, 1, 0, 0, indexed, indexed ? restart : 0, 0, 0xffffffff, 0]);
  const bind = offset => packet(11, 0, [3, indexSize, offset]);
  window.__productionCriticActive = () => ({row, host: copy(rig.host.bridge.inspect()), guest: copy(rig.q.vm.inspect())});
  try {
    await rig.expect('original context', context(1));
    for (const [id, target, format, role, width, height, address, length] of [
      [1, 2, 67, 2, 4, 4, colorAddress, 128],
      [2, 0, 64, 16, 64, 1, vertexAddress, 64],
      [3, 0, 64, 32, indices.length, 1, indexAddress, indices.length],
    ]) {
      await rig.expect('original allocation' + id, allocation(id, target, format, role, width, height));
      await rig.expect('original backing' + id, backing(id, [[address, length]]));
      await rig.expect('original membership' + id, idCommand(0x202, 1, id));
    }
    rig.q.write(vertexAddress, new Uint8Array(new Float32Array([-1,-1,0,1, 1,-1,0,1, -1,1,0,1, 1,1,0,1]).buffer));
    rig.q.write(indexAddress, indices);
    await rig.expect('original vertex upload', transfer(1, 2, 1, [0,0,0,64,1,1]));
    await rig.expect('original index upload with poison', transfer(1, 3, 1, [0,0,0,indices.length,1,1]));
    await rig.expect('original shaders and state', submission(1, join(
      shader(10, 0, vertex), shader(11, 1, fragment), packet(31, 0, [10,0]), packet(31, 0, [11,1]),
      packet(1, 5, [12,0,0,0,31]), packet(2, 5, [12]), packet(6, 0, [16,0,2]),
      packet(1, 8, [20,1,67,0,0]), packet(5, 0, [1,0,20]),
      packet(4, 0, [0,...[2,2,.5,2,2,.5].map(word)]), bind(bindingOffset),
      packet(1, 2, [40,2 | 1<<29,word(1),0,0xffff,word(1),0,0,0]), packet(2, 2, [40]),
    )));
    const read = async start => {
      const before = draws();
      const wire = draw(start);
      if (indexSize === 2 && start === 1) c.same([...new Uint32Array(wire.buffer)], originalQtDraw, 'literal original captured Quickshell draw words');
      const record = await rig.expect('original indexed start' + start, submission(1, wire, BigInt(start) + 7n));
      c.equal(draws() - before, 1, 'one physical indexed draw');
      const renderer = rig.host.bridge.inspect().lastRendererResult, selected = renderer.draws[0];
      c.equal(selected.indexOffset, bindingOffset, 'original binding offset without start arithmetic');
      c.equal(selected.indexByteLength, count * indexSize, 'exact retained index span');
      c.equal(selected.actualMinIndex, 0, 'actual minimum excludes prefix poison');
      c.equal(selected.actualMaxIndex, 3, 'actual maximum excludes suffix poison');
      c.equal(selected.restartCount, 58, 'the retained strip has58 restart sentinels');
      rig.q.write(colorAddress, new Uint8Array(128).fill(0x6f));
      await rig.expect('original color readback', transfer(1, 1, 2, [0,0,0,4,4,1], 5n, 19, 0, BigInt(start) + 9n));
      const actual = rig.q.read(colorAddress, 128), expected = new Uint8Array(128).fill(0x6f);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) expected.set([0,255,0,255], 5 + y * 19 + x * 4);
      c.equal(hex(actual), hex(expected), 'literal green pixels and untouched complete RAM padding');
      row.outputs.push({start, wire: [...wire], record, actual: hex(actual), expected: hex(expected), renderer});
    };
    for (const start of [0,1,0xffffffff]) await read(start);
    const beforeBad = draws();
    await rig.expect('zero count remains refused', submission(1, draw(1, 0)), 0x1205);
    await rig.expect('binding near end accepted', submission(1, bind(indices.length - indexSize)));
    await rig.expect('bound span refuses before draw', submission(1, draw(0xffffffff)), 0x1205);
    await rig.expect('repair original binding', submission(1, bind(bindingOffset)));
    await rig.expect('suffix poison refuses actual vertex fetch', submission(1, draw(1, count + 1)), 0x1205);
    await rig.expect('array signed range stays refused', submission(1, draw(0x7fffffff, count, 0)), 0x1205);
    c.equal(draws(), beforeBad, 'negative draws have no physical draw effects');
    await read(1);
    const queued = rig.q.enqueue('fenced nonzero indexed draw', submission(1, draw(0xffffffff), 0x123n));
    const destroy = rig.q.enqueue('immediate original context destroy', header(0x201, 1, 24));
    rig.q.kick(); rig.q.run();
    c.equal(rig.q.usedIndex(), queued.number, 'original draw remains pending ahead of destroy');
    await rig.drain(); rig.q.collect(queued); rig.q.collect(destroy);
    c.equal(native.getError(), native.NO_ERROR, 'zero native errors');
    row.status = 'passed';
  } catch (error) {row.status = 'failed'; row.failure = {message: error.message, stack: error.stack};}
  finally {
    row.records = copy(rig.q.records); row.events = copy(rig.events); row.exchanges = copy(rig.exchanges);
    row.completions = copy(rig.completions); row.beforeDispose = copy(rig.host.bridge.inspect());
    row.guestTrace = rig.q.vm.commandTrace(); row.machineDigest = rig.q.vm.machineDigest();
    row.disposed = copy(rig.host.bridge.dispose()); rig.q.vm.free(); row.cleaned = copy(rig.trace.snapshot());
    row.assertions = c.assertions;
    if (row.cleaned.liveObjects || row.cleaned.liveSyncs) {row.status = 'failed'; row.cleanupFailure = 'Native owners leaked';}
    window.__productionCriticActive = null;
  }
  return row;
}

export async function runProductionIndexedStart({WasmVirglSubmitProof, schedules = [0,1,2]}) {
  const native = document.querySelector('#gpu').getContext('webgl2', {antialias: false, failIfMajorPerformanceCaveat: true});
  const qualification = await qualifyVirglHost(native), compiler = await createVirglStandardStreamOutputShaderBridge();
  const report = {status: 'running', qualification: copy(qualification), rows: []};
  window.__productionCriticReport = report;
  for (const schedule of schedules) for (const indexSize of [1,2,4]) {
    const row = await one(WasmVirglSubmitProof, qualification, native, compiler, schedule, indexSize);
    const pin = await window.__recordProductionCriticRun(report.rows.length, JSON.stringify(row));
    report.rows.push({...pin, name: row.name, status: row.status, ...(row.failure ? {failure: row.failure} : {})});
  }
  report.status = report.rows.every(r => r.status === 'passed') ? 'passed' : 'failed';
  report.summary = {status: report.status, runs: report.rows.length,
    failed: report.rows.filter(r => r.status !== 'passed').map(r => ({name: r.name, failure: r.failure})), hardware: qualification.identity};
  return report;
}

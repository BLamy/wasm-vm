import {createStandardDimensionalTransferBackend, createStandardDimensionalResourceStore} from '../resources.mjs';
import {decodeStandardDimensionalSubmission} from '../decoder.mjs';

// Independent native source and literal op43 writer: no product layout/oracle imports.
export async function runDimensionalStorageCritic({seeds = [38197, 115937, 219173]} = {}) {
  const gl = document.querySelector('#gpu').getContext('webgl2', {antialias: false, failIfMajorPerformanceCaveat: true});
  if (!gl) throw new Error('Actual WebGL2 required');
  const points = [], nativeCalls = [], ids = new WeakMap(), live = new Set(); let nextId = 1, assertions = 0;
  const check = (value, label) => { assertions++; if (!value) throw new Error(label); };
  const ok = (value, label) => { check(value.ok, label + ': ' + JSON.stringify(value)); return value; };
  const hex = bytes => Array.from(bytes, v => v.toString(16).padStart(2, '0')).join('');
  const same = (a, b, label) => check(JSON.stringify(a) === JSON.stringify(b), label);
  const describe = value => {
    if (value === null || typeof value !== 'object') return value === undefined ? {undefined: true} : value;
    if (ArrayBuffer.isView(value)) return {type: value.constructor.name, bytes: hex(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))};
    if (!ids.has(value)) ids.set(value, nextId++);
    return {object: ids.get(value), type: value.constructor.name};
  };
  const gpu = new Proxy(gl, {get(target, name) {
    const value = Reflect.get(target, name, target);
    if (typeof value !== 'function') return value;
    return (...args) => {
      const before = args.map(describe), result = value.apply(target, args);
      if ((name.startsWith('create') || name === 'fenceSync') && result) live.add(result);
      if (name.startsWith('delete') && args[0]) { check(live.has(args[0]), 'Native object deleted exactly once'); live.delete(args[0]); }
      nativeCalls.push({sequence: nativeCalls.length, name, before, after: args.map(describe), result: describe(result)});
      return result;
    };
  }});
  const shapes = [
    {target: 3, width: 7, height: 5, depth: 9, arraySize: 1, lastLevel: 3, levels: [[7,5,9],[3,2,4],[1,1,2],[1,1,1]], cost: 1368},
    {target: 4, width: 7, height: 7, depth: 1, arraySize: 6, lastLevel: 2, levels: [[7,7,6],[3,3,6],[1,1,6]], cost: 1416},
    {target: 7, width: 7, height: 5, depth: 1, arraySize: 9, lastLevel: 2, levels: [[7,5,9],[3,2,9],[1,1,9]], cost: 1512},
  ];
  const wire = (id, level, box, offset, stride, layerStride) => {
    const words = [43 + (13 << 16), id, level, 0, stride, layerStride,
      box.x, box.y, box.z, box.width, box.height, box.depth, offset, 2];
    const raw = new Uint8Array(56), view = new DataView(raw.buffer);
    words.forEach((word, i) => view.setUint32(i * 4, word, true)); return raw;
  };
  for (const seed of seeds) for (const shape of shapes) {
    const backend = ok(createStandardDimensionalTransferBackend(gpu), 'Selected hardware backend').backend;
    const owner = ok(createStandardDimensionalResourceStore({backend}), 'Selected owner'), {store, bindings, asyncAccess} = owner;
    const {levels, cost, ...original} = shape, metadata = {id: 711, format: 67, bind: 10, flags: 0, nrSamples: 0, ...original};
    ok(store.createContext(73), 'Context');
    const created = ok(store.createResource(metadata), 'Independent NPOT allocation').resource;
    same(created.levels.map(l => [l.width, l.height, l.layers]), levels, 'Independent immutable levels');
    check(created.byteLength === cost && created.gpuByteLength === cost, 'Independent whole-chain cost');
    ok(store.attachContext(73, 711), 'Attachment');
    const lease = ok(store.retainStorage(73, 711, 'readback'), 'Trusted native lease').lease;
    const storage = ok(bindings.resolve(lease), 'Exact native storage').storage;
    for (const target of [5, 6, 8, 9, 0xffffffff]) {
      const before = JSON.stringify(store.inspect()), begin = nativeCalls.length;
      const refusal = store.createResource({...metadata, id: 712, target});
      check(!refusal.ok && JSON.stringify(store.inspect()) === before && nativeCalls.length === begin, 'Unsupported original target refused before native work');
      points.push({kind: 'unsupported-target', seed, metadata: {...metadata, id: 712, target}, result: refusal, nativeCallsEnd: begin});
    }
    for (let level = 0; level < levels.length; level++) {
      const [width, height, layers] = levels[level], begin = nativeCalls.length;
      const nativeSource = new Uint8Array(width * height * layers * 4);
      for (let z = 0; z < layers; z++) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let lane = 0; lane < 4; lane++)
        nativeSource[((z * height + y) * width + x) * 4 + lane] = (seed + shape.target * 37 + level * 41 + z * 47 + y * 23 + x * 19 + lane * 61) & 255;
      gpu.bindTexture(storage.target, storage.texture); gpu.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      if (shape.target === 4) for (let face = 0; face < 6; face++)
        gpu.texSubImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, level, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE,
          nativeSource.subarray(face * width * height * 4, (face + 1) * width * height * 4));
      else gpu.texSubImage3D(storage.target, level, 0, 0, 0, width, height, layers, gl.RGBA, gl.UNSIGNED_BYTE, nativeSource);
      check(gpu.getError() === gl.NO_ERROR, 'Independent physical source upload');
      const box = {x: width > 1 ? 1 : 0, y: height > 1 ? 1 : 0, z: layers - Math.min(2, layers),
        width: Math.min(2, width - (width > 1 ? 1 : 0)), height: Math.min(2, height - (height > 1 ? 1 : 0)), depth: Math.min(2, layers)};
      const rowBytes = box.width * 4, stride = level === levels.length - 1 ? 0 : 21;
      const rowStride = stride || width * 4, layerStride = level === levels.length - 1 ? 0 : 65;
      const layerPitch = layerStride || rowStride * height, offset = 3;
      const end = offset + (box.depth - 1) * layerPitch + (box.height - 1) * rowStride + rowBytes;
      const expected = new Uint8Array(rowBytes * box.height * box.depth);
      for (let z = 0; z < box.depth; z++) for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) for (let lane = 0; lane < 4; lane++)
        expected[((z * box.height + y) * box.width + x) * 4 + lane] =
          (seed + shape.target * 37 + level * 41 + (z + box.z) * 47 + (y + box.y) * 23 + (x + box.x) * 19 + lane * 61) & 255;
      const publicExpected = new Uint8Array(end).fill(0xd9);
      for (let z = 0; z < box.depth; z++) for (let y = 0; y < box.height; y++) publicExpected.set(
        expected.subarray((z * box.height + y) * rowBytes, (z * box.height + y + 1) * rowBytes), offset + z * layerPitch + y * rowStride);
      const raw = wire(711, level, box, offset, stride, layerStride), command = ok(decodeStandardDimensionalSubmission(raw), 'Literal partial op43').commands[0];
      ok(store.attachBacking(711, [new Uint8Array(end - 1)]), 'One-byte-short backing');
      const beforeShort = JSON.stringify(store.inspect()), callsBeforeShort = nativeCalls.length, short = store.prepareTransfer(73, command);
      check(!short.ok && JSON.stringify(store.inspect()) === beforeShort && nativeCalls.length === callsBeforeShort, 'One-short endpoint refuses before native/ticket publication');
      ok(store.detachBacking(711), 'Remove short backing');
      const split = 5, first = new Uint8Array(split + 9).fill(0xa7), second = new Uint8Array(end - split + 13).fill(0xa7);
      const guards = [hex(first), hex(second)];
      ok(store.attachBacking(711, [first.subarray(4, 4 + split), second.subarray(7, 7 + end - split)]), 'Exact odd split SG endpoint');
      ok(store.writeBacking(711, 0, new Uint8Array(end).fill(0xd9)), 'Public destination poison');
      const prepared = ok(store.prepareTransfer(73, command), 'Exact padded final layer partial inverse');
      check(prepared.layout.requiredEnd === end && prepared.layout.tightBytes === expected.length, 'Independent public/native span');
      ok(store.executeTransfer(prepared.ticket), 'Physical synchronous partial inverse');
      const inverse = ok(store.readBacking(711, 0, end), 'Complete padded public inverse').bytes;
      same(hex(inverse), hex(publicExpected), 'Selected final rows/layers and every public padding byte');
      ok(store.writeBacking(711, 0, new Uint8Array(end).fill(0xd9)), 'Poison before fenced partial inverse');
      const pending = ok(asyncAccess.prepareTransfer(73, command), 'Fenced partial inverse ticket');
      ok(asyncAccess.beginTransferRead(pending.ticket), 'Physical partial native PBO');
      let ready, polls = 0;
      for (; polls < 1000; polls++) {
        for (let turn = 0; turn <= (seed + polls) % 3; turn++) await new Promise(resolve => setTimeout(resolve, 0));
        ready = ok(asyncAccess.poll(pending.ticket), 'Physical partial fence poll'); if (ready.status === 'ready') break;
      }
      check(ready.status === 'ready', 'Bounded partial fence completion');
      same(hex(ready.bytes), hex(expected), 'Every dense physical byte from final original layer/face');
      const untouched = ok(store.readBacking(711, 0, end), 'Guest backing remains separate').bytes;
      same(hex(untouched), hex(new Uint8Array(end).fill(0xd9)), 'Fenced read never publishes guest bytes');
      ok(asyncAccess.release(pending.ticket), 'Retire PBO/fence');
      same([hex(first), hex(second)], guards, 'External SG guards unchanged');
      points.push({kind: 'partial-final-layer', seed, metadata, level, dimensions: [width, height, layers], box, wire: hex(raw),
        nativeSource: hex(nativeSource), expected: hex(expected), inverse: hex(inverse), publicExpected: hex(publicExpected),
        asyncOutput: hex(ready.bytes), untouched: hex(untouched), end, split, rowStride, layerPitch, short,
        layout: prepared.layout, guards, polls: polls + 1, nativeTexture: describe(storage.texture), nativeCallsStart: begin, nativeCallsEnd: nativeCalls.length});
      ok(store.detachBacking(711), 'Retire exact partial backing');
    }
    ok(store.releaseStorage(lease), 'Release exact lease'); ok(store.unref(711), 'Retire dimensional owner');
    ok(store.destroyContext(73), 'Retire context'); ok(store.dispose(), 'Retire native helpers');
    const terminal = store.inspect();
    check(Object.values(terminal.budgets).every(value => value === 0), 'Every terminal ownership budget zero');
    check(live.size === 0 && gpu.getError() === gl.NO_ERROR, 'Every native object retired and GPU error zero');
    points.push({kind: 'terminal', seed, metadata, state: terminal, nativeCallsEnd: nativeCalls.length});
  }
  return {status: 'passed', seeds, points, nativeCalls, assertions, productionAuthority: false, guestExecution: false};
}

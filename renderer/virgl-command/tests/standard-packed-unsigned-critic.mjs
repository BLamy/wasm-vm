// Independent critic attack: opposite alias reuse with retained partial reads.
import {checks, rig, add, finish, blob, nativeRead, physicalFence, poll} from './standard-packed-unsigned-rig.mjs';
import {command} from './standard-integer-images.mjs';

const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
const fields = format => format === 225 ? [20, 10, 0, 30] : [0, 10, 20, 30];
function packet(opcode, words) {
  const bytes = new Uint8Array((words.length + 1) * 4), view = new DataView(bytes.buffer);
  view.setUint32(0, opcode | words.length << 16, true);
  words.forEach((word, index) => view.setUint32((index + 1) * 4, word >>> 0, true));
  return bytes;
}
function input(format, width, height, salt, level) {
  const bytes = new Uint8Array(width * height * 4), view = new DataView(bytes.buffer), offsets = fields(format);
  for (let i = 0; i < width * height; i++) {
    const lanes = [(salt + i * 67 + level * 31) & 1023,
      ((salt >>> 7) + i * 149 + level * 11) & 1023,
      (1023 - ((salt >>> 13) + i * 37 + level * 59)) & 1023,
      ((salt >>> 29) + i + level) & 3];
    view.setUint32(i * 4, lanes.reduce((word, value, lane) => word | value << offsets[lane], 0) >>> 0, true);
  }
  return bytes;
}
function fixture(format, salt) {
  const metadata = {id: 6, target: 2, format, bind: 10, width: 11, height: 7,
    depth: 1, arraySize: 1, lastLevel: 3, nrSamples: 0, flags: 0}, planes = [];
  let offset = 3;
  for (let level = 0; level <= 3; level++) {
    const width = Math.max(1, 11 >> level), height = Math.max(1, 7 >> level), stride = width * 4 + 9;
    planes.push({level, width, height, stride, offset, input: input(format, width, height, salt, level)});
    offset += (height - 1) * stride + width * 4 + 13;
  }
  const backing = new Uint8Array(offset + 17).fill(0xcd);
  for (const p of planes) for (let y = 0; y < p.height; y++)
    backing.set(p.input.subarray(y * p.width * 4, (y + 1) * p.width * 4), p.offset + y * p.stride);
  return {metadata, planes, backing, salt};
}
function transfer(p, direction = 1) {
  return packet(43, [6, p.level, 0, p.stride, 0, p.x ?? 0, p.y ?? 0, 0, p.width, p.height, 1, p.offset, direction]);
}
function inline(p) {
  const row = p.width * 4, span = (p.height - 1) * p.stride + row;
  const bytes = new Uint8Array(Math.ceil(span / 4) * 4).fill(0x97);
  for (let y = 0; y < p.height; y++) bytes.set(p.input.subarray(y * row, (y + 1) * row), y * p.stride);
  const view = new DataView(bytes.buffer);
  return packet(9, [6, p.level, 0, p.stride, 0, p.x, p.y, 0, p.width, p.height, 1,
    ...Array.from({length: bytes.length / 4}, (_, i) => view.getUint32(i * 4, true))]);
}
async function upload(r, src, label, row) {
  for (const p of src.planes) {
    const wire = transfer(p), prepared = r.c.ok(r.store.prepareTransfer(2, command(wire)), 'critic original attached upload');
    r.setLabel(label + '-' + p.level);
    r.c.ok(r.store.executeTransfer(prepared.ticket), 'critic original native upload');
    row.uploadPackets.push({label: r.label, wire: hex(wire), layout: prepared.layout});
  }
  return physicalFence(r, label + '-completion');
}
async function saveSource(report, src) {
  const backing = await blob(report, src.backing), planes = [];
  for (const p of src.planes) planes.push({...p, input: await blob(report, p.input)});
  return {...src, backing, planes};
}
export async function runCritic({seed = 0x62e31a97} = {}) {
  const c = checks(), gl = document.querySelector('#gpu').getContext('webgl2',
    {antialias: false, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true});
  if (!gl) throw Error('critic requires actual native WebGL2');
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const report = {schema: 'packed-unsigned-opposite-alias-partial-generation-critic-v1', status: 'running', seed,
    guestExecution: false, productionNegotiation: false, productionDrawAuthority: false,
    gpu: gl.getParameter(debug.UNMASKED_RENDERER_WEBGL), runs: [], blobs: [], predictions: c.rows};
  window.__packedUnsignedCritic = report;
  for (const format of [225, 253]) {
    const src = fixture(format, (seed ^ format) >>> 0), replacement = fixture(format === 225 ? 253 : 225, (seed ^ 0xc379de4b) >>> 0);
    const r = rig(gl, c, {delay: format === 225 ? 1 : 3}), row = {format, original: await saveSource(report, src),
      replacement: await saveSource(report, replacement), uploadPackets: [], patches: [], privateBefore: [],
      privateAfterRefresh: [], heldBeforeCorruption: [], corrupted: [], replacementNative: []};
    report.runs.push(row);
    try {
      const original = add(r, src.metadata, src.backing), sourceTexture = r.allocations[0].storage.texture;
      row.sourceIdentity = {generation: original.generation, texture: r.trace.id(sourceTexture)};
      row.uploadFence = await upload(r, src, 'critic-old-upload', row);
      const lease = c.ok(r.store.retainStorage(1, 6, 'view'), 'critic old source lease').lease;
      const view = c.ok(r.imageAccess.capture(lease, 1, 2), 'critic restricted private levels');
      const resolved = c.ok(r.imageAccess.resolve(view.token), 'critic original private identity');
      row.privateIdentity = {generation: resolved.generation, metadata: resolved.metadata, texture: r.trace.id(resolved.storage.texture)};
      r.setLabel('critic-private-copy'); c.ok(r.imageAccess.refresh(view.token), 'critic first native private copy');
      row.copyFence = await physicalFence(r, 'critic-first-private-copy-completion');
      for (let local = 0; local < 2; local++) {
        const p = src.planes[local + 1]; row.privateBefore.push({local, original: p.level,
          native: await blob(report, nativeRead(r, resolved.storage.texture, p.width, p.height, local))});
      }
      for (const [level, x, y, width, height, salt] of [[0, 2, 2, 3, 2, seed ^ 0x194cd5], [1, 1, 1, 2, 1, seed ^ 0xb305ac]]) {
        const patch = {level, x, y, width, height, stride: width * 4 + 5, salt: salt >>> 0,
          input: input(format, width, height, salt >>> 0, level)}, wire = inline(patch);
        const prepared = c.ok(r.store.prepareTransfer(2, command(wire)), 'critic original partial-box packet');
        r.setLabel('critic-old-patch-' + level); c.ok(r.store.executeTransfer(prepared.ticket), 'critic physical partial-box write');
        row.patches.push({...patch, input: await blob(report, patch.input), wire: hex(wire), layout: prepared.layout,
          fence: await physicalFence(r, 'critic-partial-box-' + level + '-completion')});
      }
      r.setLabel('critic-private-refresh'); c.ok(r.imageAccess.refresh(view.token), 'critic private range refresh');
      row.refreshFence = await physicalFence(r, 'critic-private-refresh-completion');
      for (let local = 0; local < 2; local++) {
        const p = src.planes[local + 1]; row.privateAfterRefresh.push({local, original: p.level,
          native: await blob(report, nativeRead(r, resolved.storage.texture, p.width, p.height, local))});
      }
      const hold = c.ok(r.imageAccess.hold(view.token), 'critic completion hold').token;
      row.oldBackingBeforeReuse = await blob(report, c.ok(r.store.readBacking(6, 0, src.backing.length), 'critic unchanged old SG backing').bytes);
      row.readBox = {x: 1, y: 1, z: 0, width: 4, height: 3, depth: 1};
      r.setLabel('critic-retained-old-partial-read');
      const retained = c.ok(r.asyncAccess.beginStorageRead(lease, row.readBox), 'critic issued old partial storage read');
      row.retainedLayout = retained.layout;
      row.retainedAfterIssue = r.store.inspect().budgets;
      const p = {...src.planes[1], x: 1, y: 1, width: 2, height: 1, stride: 17}, wire = transfer(p, 2);
      const stale = c.ok(r.asyncAccess.prepareTransfer(2, command(wire)), 'critic old public partial transfer');
      r.setLabel('critic-stale-old-partial-read'); c.ok(r.asyncAccess.beginTransferRead(stale.ticket), 'critic issued stale candidate');
      row.stalePacket = {wire: hex(wire), layout: stale.layout}; row.beforeReuse = r.store.inspect();
      c.ok(r.store.unref(6), 'critic retire old public identity');
      const newResource = add(r, replacement.metadata, replacement.backing), newTexture = r.allocations.at(-1).storage.texture;
      row.replacementIdentity = {generation: newResource.generation, texture: r.trace.id(newTexture), format: newResource.format};
      c.ok(r.store.destroyContext(1), 'critic retire old context'); c.ok(r.store.createContext(1), 'critic reuse original context ID');
      c.ok(r.store.attachContext(1, 6), 'critic attach opposite alias to replacement context');
      row.afterReuse = r.store.inspect().budgets;
      row.refusals = {staleValidation: r.asyncAccess.validate(stale.ticket), stalePublication: r.asyncAccess.poll(stale.ticket),
        staleView: r.imageAccess.resolve(view.token)};
      for (const value of Object.values(row.refusals)) c.same(value.ok, false, 'critic stale generation never publishes');
      const discarded = await poll(r, stale.ticket, {discard: true});
      row.staleCompletion = {status: discarded.status, fence: r.trace.events.filter(e => e.name === 'clientWaitSync').at(-1)};
      c.ok(r.asyncAccess.release(stale.ticket), 'critic retire completed stale partial read');
      row.afterStaleRelease = r.store.inspect().budgets;
      r.setLabel('critic-retained-old-partial-read'); const oldReady = await poll(r, retained.ticket);
      row.oldPartialOutput = await blob(report, oldReady.bytes);
      row.oldReadFence = r.trace.events.filter(e => e.name === 'clientWaitSync').at(-1);
      row.oldReadyBudgets = r.store.inspect().budgets;
      c.ok(r.asyncAccess.release(retained.ticket), 'critic old partial read retirement');
      row.afterOldReadRelease = r.store.inspect().budgets;
      row.replacementUploadFence = await upload(r, replacement, 'critic-opposite-alias-upload', row);
      for (const p of replacement.planes) row.replacementNative.push({level: p.level,
        native: await blob(report, nativeRead(r, newTexture, p.width, p.height, p.level))});
      for (const p of replacement.planes) {
        const prepared = c.ok(r.store.prepareTransfer(1, command(transfer(p, 2))), 'critic opposite alias sync packet');
        r.setLabel('critic-opposite-alias-sync-' + p.level); c.ok(r.store.executeTransfer(prepared.ticket), 'critic native opposite alias compact read');
      }
      row.replacementFinalBacking = await blob(report, c.ok(r.store.readBacking(6, 0, replacement.backing.length), 'critic entire replacement SG').bytes);
      const newLease = c.ok(r.store.retainStorage(1, 6, 'view'), 'critic opposite alias partial lease').lease;
      r.setLabel('critic-opposite-alias-partial-read'); const newRead = c.ok(r.asyncAccess.beginStorageRead(newLease, row.readBox), 'critic opposite alias issued partial read');
      row.newPartialLayout = newRead.layout; row.newReadIssueBudgets = r.store.inspect().budgets;
      const newReady = await poll(r, newRead.ticket);
      row.newPartialOutput = await blob(report, newReady.bytes); row.newReadFence = r.trace.events.filter(e => e.name === 'clientWaitSync').at(-1);
      row.newReadReadyBudgets = r.store.inspect().budgets;
      c.ok(r.asyncAccess.release(newRead.ticket), 'critic opposite alias partial read retirement');
      row.newReadReleaseBudgets = r.store.inspect().budgets;
      c.ok(r.store.releaseStorage(newLease), 'critic replacement lease retirement');
      c.ok(r.imageAccess.release(view.token), 'critic stale view release'); c.ok(r.store.releaseStorage(lease), 'critic old source lease release');
      row.completedWorkFence = await physicalFence(r, 'critic-entire-opposite-alias-work-completion');
      for (let local = 0; local < 2; local++) {
        const p = src.planes[local + 1]; row.heldBeforeCorruption.push({local, original: p.level,
          native: await blob(report, nativeRead(r, resolved.storage.texture, p.width, p.height, local))});
      }
      // Physical native mutation follows completed work; no product source or oracle mutation.
      const word = new DataView(src.planes[1].input.buffer).getUint32(0, true), offsets = fields(format);
      const nativeWord = offsets.reduce((value, offset, lane) => value | ((word >>> offset) & (lane === 3 ? 3 : 1023)) << [0, 10, 20, 30][lane], 0) >>> 0;
      const binding = gl.getParameter(gl.TEXTURE_BINDING_2D), unpack = gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING);
      r.setLabel('critic-actual-completed-private-packed-word-corruption');
      r.traced.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null); r.traced.bindTexture(gl.TEXTURE_2D, resolved.storage.texture);
      r.traced.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT_2_10_10_10_REV, new Uint32Array([(nativeWord ^ 1) >>> 0]));
      r.traced.bindTexture(gl.TEXTURE_2D, binding); r.traced.bindBuffer(gl.PIXEL_UNPACK_BUFFER, unpack);
      c.same(gl.getError(), gl.NO_ERROR, 'critic actual private native bit mutation');
      row.corruption = {texture: r.trace.id(resolved.storage.texture), localLevel: 0, originalLevel: 1, nativeWord, delivered: (nativeWord ^ 1) >>> 0};
      row.corruptionFence = await physicalFence(r, 'critic-distinct-post-completion-corruption-fence');
      c.same(row.corruptionFence.sync === row.completedWorkFence.sync, false, 'critic physical second fence identity is distinct');
      for (let local = 0; local < 2; local++) {
        const p = src.planes[local + 1]; row.corrupted.push({local, original: p.level,
          native: await blob(report, nativeRead(r, resolved.storage.texture, p.width, p.height, local))});
      }
      c.ok(r.imageAccess.release(hold), 'critic private completion hold retirement');
      c.same(r.imageAccess.release(hold).ok, false, 'critic private hold is consumed once');
    } finally { await finish(r, report, row); }
  }
  report.status = 'passed'; return report;
}

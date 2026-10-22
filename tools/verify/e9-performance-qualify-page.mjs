// Development qualification of the complete pinned guest. No performance verdict.
import init, {WasmLinux} from '/pkg/wasm_vm_wasm.js';
import {SessionStore} from '/session-store.js';
import {SessionInputJournal} from '/session-inputs.js';
import {checkpointHash, checkpointReference, checkpointChunks} from '/session-checkpoints.js';
import {sessionCanonicalImage} from '/session-pkg/wasm_vm_session.js';
import {createFencedRpc, formatRpcCommand, stripConsole} from '/guest-rpc.js';
const enc = new TextEncoder(), dec = new TextDecoder();
const need = (ok, why) => { if (!ok) throw Error(why); };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const coordinate = p => Object.fromEntries(['transition', 'retired', 'sequence', 'phase', 'ordinal'].map(k => [k, p[k]]));
export async function qualifySoftware(contract) {
  await init();
  const fixture = contract.fixtures.find(f => f.id === 'software-alpine-v1');
  const [kernel, wasm, imageManifest] = await Promise.all([
    fetch('/' + fixture.artifacts.kernel.url).then(r => {need(r.ok, 'kernel fetch'); return r.arrayBuffer();}).then(b => new Uint8Array(b)),
    fetch('/pkg/wasm_vm_wasm_bg.wasm').then(r => {need(r.ok, 'wasm fetch'); return r.arrayBuffer();}).then(b => new Uint8Array(b)),
    fetch('/session-alpine-image.json').then(r => {need(r.ok, 'image fetch'); return r.text();}),
  ]);
  const image = JSON.parse(imageManifest), base = checkpointHash(sessionCanonicalImage(imageManifest));
  need(checkpointHash(kernel) === fixture.artifacts.kernel.sha256, 'pinned kernel identity');
  const softwareFixture = await (await fetch('/session-software-fixture.json')).json();
  need(base === softwareFixture.image_manifest_sha256 && image.image_len === fixture.artifacts.rootfs.size, 'pinned base identity');
  const bootargs = softwareFixture.bootargs;
  const state = {scope: 'offline software setup prefix only; live networking/full workload/performance remain unqualified', console: '', receipts: 0,
    channels: {}, sourceObservations: [], blocks: [], checkpoints: [], inputs: [], progress: null, status: 'running', base,
    wasm: checkpointHash(wasm), kernel: checkpointHash(kernel), database: 'wasm-vm-sessions-v1-perf-qualify'};
  globalThis.qualification = state;
  let rpc, rpcResult;
  const machine = WasmLinux.newExactSession(kernel, imageManifest, bootargs, bytes => {
    const text = dec.decode(bytes, {stream: true}); need(state.console.length + text.length <= 1048576, 'qualification total console ceiling'); state.console += text;
    if (rpc) {const result = rpc.feed(text); if (result) rpcResult = result;}
  }, false);
  const store = await SessionStore.open(state.database);
  const writer = await store.writer('full-alpine-qualification');
  const disk = new Uint8Array(61), header = new DataView(disk.buffer);
  disk.set(enc.encode('WVOD1')); header.setUint32(5, 4096, true); header.setBigUint64(9, BigInt(image.image_len), true);
  disk.set(Uint8Array.from(base.match(/../g), x => parseInt(x, 16)), 17);
  let journal, lastProgress = 0;
  const begun = performance.now();
  const retain = async (name, bytes) => {
    const response = await fetch('/__proof__/' + name, {method: 'POST', body: bytes});
    need(response.ok, 'raw evidence retention: ' + name); return response.json();
  };
  const collect = async () => {
    const rows = machine.takeExactSessionDeliveries();
    state.receipts += rows.length; need(state.receipts <= 4096, 'qualification exceeds supported event bound');
    for (const row of rows) {
      state.channels[row.channel] = (state.channels[row.channel] ?? 0) + 1;
      if ([17, 18].includes(row.channel)) state.sourceObservations.push({...coordinate(row), channel: row.channel, outcome: row.outcome, bytes: [...row.bytes]});
    }
    for (let at = 0; at < rows.length; at += 64) {
      if (journal.pending >= 128) await journal.flush();
      journal.stage(rows.slice(at, at + 64));
    }
  };
  const step = async () => {
    need(performance.now() - begun < 900000, 'qualification boot/command deadline');
    need(BigInt(machine.inputPosition().transition) < 3000000000n, 'qualification actual transition bound');
    for (const request of machine.exactDeviceRequests()) {
      need(request.intent.kind === 'block', 'unsupported live device: ' + request.intent.kind);
      const {sha256, length} = request.intent.content;
      const response = await fetch('/__base__/' + sha256 + '.bin'); need(response.ok, 'immutable block fetch ' + sha256);
      const bytes = new Uint8Array(await response.arrayBuffer()), ref = checkpointReference(bytes);
      need(ref.sha256 === sha256 && bytes.length === Number(length), 'immutable block identity');
      await writer.put(ref, checkpointChunks(bytes));
      const lease = machine.exactLeaseDeviceRequest(request.id);
      try {machine.exactCompleteDeviceRequest(lease, 0, 0, bytes);} finally {lease.free();}
      state.blocks.push({id: request.id, sha256, length: bytes.length, position: coordinate(machine.inputPosition())});
      await collect();
    }
    // This qualification does not pretend that an absent live Ethernet service proves HTTP.
    need(machine.exactNetworkRequests().length === 0, 'live networking reached: qualify a real provider before the campaign');
    const result = machine.runChunk(1048576); need(!result.done, 'guest stopped: ' + JSON.stringify(result));
    await collect();
    state.progress = {position: coordinate(machine.inputPosition()), tail: stripConsole(state.console).slice(-350), receipts: state.receipts, blocks: state.blocks.length};
    if (performance.now() - lastProgress > 15000) {lastProgress = performance.now(); await globalThis.qualificationProgress(state.progress);}
    await tick();
  };
  const until = async predicate => {while (!predicate()) await step();};
  const input = async text => {state.inputs.push({position: coordinate(machine.inputPosition()), text}); machine.sendInput(enc.encode(text)); await collect();};
  try {
    machine.enableJit(2);
    const initial = machine.exactSessionWitness(true);
    state.initial = {...coordinate(initial), digest: [...initial.digest].map(x => x.toString(16).padStart(2, '0')).join(''), native: await retain('initial.resume', initial.resume)};
    // providersComplete is the exact codec's capture-adapter declaration. No live
    // network provider is installed: this artifact qualifies an offline prefix only.
    state.networkQualification = 'offline-no-live-provider; HTTP not exercised';
    const configuration = {version: 1, exactSession: 1, providersComplete: true, runtime: 'rv64-linux-exact-session-v1', ramMib: 256, bootargs,
      clock: {mode: 'icount', divider: 10, timebase_hz: '10000000', interactive: null},
      kernel: {url: new URL('/' + fixture.artifacts.kernel.url, location.href).href, sha256: checkpointHash(kernel), length: String(kernel.length)},
      wasm: {url: new URL('/pkg/wasm_vm_wasm_bg.wasm', location.href).href, sha256: checkpointHash(wasm), length: String(wasm.length)},
      devices: JSON.parse(machine.softwareCheckpointTopology()), imageManifest, baseUrl: new URL('/__base__/', location.href).href,
      timeEntropyPolicy: machine.sessionSourcePolicy(),
      deviceCompletionPolicy: {version: 1, block: 'immutable-base-cow-v1', agent: 'owned-agent-receive-v1', capture: 'owned-s16-capture-v1'},
      networkPolicy: {version: 1, transport: 'owned-ethernet-v1', replay: 'zero-egress'}};
    state.configuration = configuration;
    journal = await SessionInputJournal.createLiveExact(store, writer, configuration, initial.resume, disk, initial);
    delete initial.resume;
    await until(() => stripConsole(state.console).includes("can't access tty; job control turned off"));
    const setupId = 't22setup'; rpc = createFencedRpc(setupId);
    await input(formatRpcCommand(contract.workload.setup, setupId));
    await until(() => /(?:^|\n)E9_BEFORE\n/.test(stripConsole(state.console)));
    await journal.flush();
    const before = machine.exactSessionWitness(true);
    state.before = {...coordinate(before), digest: [...before.digest].map(x => x.toString(16).padStart(2, '0')).join(''), native: await retain('before.resume', before.resume)};
    delete before.resume;
    state.checkpoints.push({id: 'before-file', result: await journal.captureKeyframe(store, machine, configuration, 'before-file'), position: coordinate(machine.inputPosition())});
    await input(contract.workload.serial_advance);
    await until(() => !!rpcResult);
    need(rpcResult.exit === 0 && /(?:^|\n)E9_AFTER\n/.test(rpcResult.stdout), 'fenced setup failed: ' + JSON.stringify(rpcResult));
    state.setup = rpcResult;
    need(rpcResult.stdout.includes(contract.workload.after_sha256 + '  ' + contract.workload.guest_path), 'real guest after file hash');
    rpc = createFencedRpc('t22bytes'); rpcResult = null;
    await input(formatRpcCommand("od -An -v -tx1 /root/e9-session/state; od -An -v -tx1 /root/e9-session/entropy; sha256sum /root/e9-session/state /root/e9-session/entropy", 't22bytes'));
    await until(() => !!rpcResult); need(rpcResult.exit === 0, 'literal guest byte witness'); state.files = rpcResult;
    const lines = rpcResult.stdout.trim().split('\n');
    need(lines[0].replace(/\s/g, '') === contract.workload.after_hex, 'literal after bytes differ');
    await journal.flush();
    const end = machine.exactSessionWitness(true);
    state.final = {...coordinate(end), digest: [...end.digest].map(x => x.toString(16).padStart(2, '0')).join(''), native: await retain('final.resume', end.resume)};
    await journal.completeExact(end, [initial, end]);
    const reopened = await SessionInputJournal.readExact(store, writer.id, {configuration});
    const observations = reopened.receipts.filter(row => [17, 18].includes(row.channel)).map(row => ({...coordinate(row), channel: row.channel, outcome: row.outcome, bytes: [...row.bytes]}));
    need(JSON.stringify(observations) === JSON.stringify(state.sourceObservations), 'reopened source receipts differ');
    need(observations.some(row => row.channel === 17 && row.outcome[0] === '0' && row.bytes.length === 8), 'recorded RTC observation absent');
    need(observations.some(row => row.channel === 18 && row.outcome[0] === '0' && row.outcome[1] === '6' && row.bytes.length === Number(row.outcome[2])), 'recorded entropy observation absent');
    state.reopenedSourcesIdentical = true;
    state.jit = machine.jitStats(); state.hostQueues = machine.exactSessionHostQueues();
    state.session = await store.openSession(writer.id); delete state.session.manifest;
    state.status = 'offline-software-setup-prefix-only';
  } catch (error) {
    state.status = 'failed'; state.error = error.stack ?? String(error);
    try {const end = machine.exactSessionWitness(true); state.failure = {...coordinate(end), native: await retain('failure.resume', end.resume)};} catch (capture) {state.captureError = String(capture);}
  } finally {
    try {await collect(); await journal?.flush();} catch (error) {state.finalFlushError = String(error);}
    machine.free(); await writer.release(); store.close();
  }
  document.querySelector('pre').textContent = state.status + '\n' + state.console;
  return state;
}

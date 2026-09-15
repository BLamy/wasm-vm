// Read-only audit of the actual built-page RPC/worker recording, not a second
// protocol or an input injector. Synthetic tests are not desktop evidence.
import assert from 'node:assert/strict';
import { createFencedRpc, formatRpcCommand } from '../../web/guest-rpc.js';

const at = row => Date.parse(row.timestamp);
const key = row => `${row.context}:${row.epoch}:${row.worker}`;
const readiness = 'XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers';
const mutatingMethods = new Set(['pause', 'resume', 'saveDesktopSnapshot', 'restoreDesktopSnapshot',
  'sendAgentInput', 'beginFileUpload', 'pushFileUpload', 'snapshotSave', 'snapshotImport',
  'snapshotRestore', 'snapshotAdvanceGen', 'snapshotDecision', 'closeStorage', 'tailscaleCommand']);

export function allowedReadCommands(renderer, guestFile) {
  const { pid, instance } = renderer.instance;
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  assert.match(instance, /^[A-Za-z0-9_.-]+$/u);
  assert.match(guestFile, /^\/tmp\/desktop-keys-[a-f0-9]{16}$/u);
  return new Set([
    readiness,
    'XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j clients',
    'XDG_RUNTIME_DIR=/run/user/1000 hyprctl -j instances',
    'XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j activewindow',
    `tr '\\000' '\\n' < /proc/${pid}/environ | sed -n '/^GALLIUM_DRIVER=/p;/^LIBGL_ALWAYS_SOFTWARE=/p;/^LP_NUM_THREADS=/p'`,
    `ps -T -p ${pid} -o comm=`,
    `sed -n '/DEBUG ]: Renderer:/p;/DEBUG ]: Vendor:/p' /run/user/1000/hypr/${instance}/hyprland.log`,
    `if [ -f '${guestFile}' ]; then cat '${guestFile}'; else (exit 75); fi`,
  ]);
}

// Group by the real worker and navigation epoch. Keep recorded order: sorting
// timestamps would hide reordered or duplicated evidence. CR/CPR are the only
// allowed unframed console inputs; all commands must be exact built RPCs.
export function auditSerialWire(report, renderer) {
  const { keyboard, workerTraffic, serialCommands, observations } = report;
  assert.ok(Array.isArray(workerTraffic) && Array.isArray(serialCommands));
  assert.match(keyboard.nonce, /^[a-f0-9]{16}$/u);
  const allowed = allowedReadCommands(renderer, keyboard.guestFile);
  const stop = Date.parse(keyboard.completedAt || keyboard.failedAt);
  assert.ok(Number.isFinite(stop));
  for (const row of workerTraffic) assert.ok(Number.isFinite(at(row)), 'wire timestamp missing');
  const traffic = workerTraffic.filter(row => row.context === 'primary' && at(row) <= stop);
  for (const row of traffic) {
    assert.ok(!['fatal', 'error'].includes(row.type), 'worker failed during the measured arm');
    if (row.type === 'worker-call') {
      assert.equal(row.sent, true, 'worker call was not sent');
      assert.equal(mutatingMethods.has(row.method), false, `observer mutated guest via ${row.method}`);
    }
  }
  const groups = new Map();
  for (const row of traffic) {
    assert.ok(Number.isFinite(at(row)), 'wire timestamp missing');
    const group = groups.get(key(row)) || [];
    assert.ok(!group.length || at(row) >= at(group.at(-1)), 'wire evidence was reordered');
    group.push(row); groups.set(key(row), group);
  }
  const records = [];
  for (const [binding, rows] of groups) {
    const inputRows = rows.filter(row => row.type === 'serial-input');
    let input = '', spans = [];
    for (const row of inputRows) {
      assert.equal(row.sent, true, 'serial input was not sent');
      assert.ok(Array.isArray(row.bytes) && row.bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255));
      // Shell templates are ASCII. Reject replacement-decoded/encoded controls.
      assert.ok(row.bytes.every(byte => byte < 128), 'non-ASCII serial input');
      const start = input.length;
      input += Buffer.from(row.bytes).toString('ascii');
      spans.push({ start, end: input.length, row });
    }
    assert.ok(!input.includes(keyboard.nonce), 'physical nonce appears in concatenated serial input');
    let offset = 0;
    const ids = new Set();
    while (offset < input.length) {
      const rest = input.slice(offset);
      const control = rest.match(/^(?:\r|\x1b\[\d+;\d+R)/u);
      if (control) { offset += control[0].length; continue; }
      const prefix = rest.match(/^printf '\\n__WVBEGIN_([a-z0-9]+)\\n'; /u);
      assert.ok(prefix, `unframed serial input at byte ${offset}`);
      const rid = prefix[1];
      assert.equal(ids.has(rid), false, 'duplicate RPC id'); ids.add(rid);
      const end = rest.indexOf('\r');
      assert.ok(end >= 0, 'incomplete outgoing RPC');
      const frame = rest.slice(0, end + 1);
      const command = [...allowed].find(cmd => formatRpcCommand(cmd, rid) === frame);
      assert.ok(command, `unapproved serial RPC ${rid}`);
      const first = spans.find(span => span.start <= offset && span.end > offset).row;
      const last = spans.find(span => span.start <= offset + end && span.end > offset + end).row;
      const rpc = createFencedRpc(rid);
      let response = null, completedAt = null;
      for (const row of rows) {
        if (row.type !== 'serial-output' || at(row) < at(last)) continue;
        const result = rpc.feed(row.text);
        if (result) { response = result; completedAt = at(row); break; }
      }
      records.push({ binding, context: first.context, epoch: first.epoch, worker: first.worker,
        rid, command, sentAt: at(last), firstSentAt: at(first), response, completedAt });
      offset += frame.length;
    }
    // A worker restart during the measured epoch cannot count as the same arm.
    assert.equal(rows.filter(row => row.type === 'worker-boot').length, 1, 'worker boot is absent or repeated');
  }
  assert.equal(groups.size, 1, 'measurement spans multiple primary workers/epochs');
  assert.ok(records.length, 'actual outgoing RPC evidence is missing');
  records.sort((a, b) => a.sentAt - b.sentAt);
  const declared = serialCommands.filter(row => row.context === 'primary' && at(row) <= stop);
  for (const row of declared) {
    assert.ok(allowed.has(row.command), 'declared observer command is not read-only');
    assert.ok(Number.isSafeInteger(row.timeoutMs) && row.timeoutMs > 0, 'RPC timeout missing');
    const match = records.find(record => !record.declared && record.command === row.command && record.sentAt >= at(row));
    assert.ok(match, 'declared RPC was not sent over the worker');
    match.declared = row;
  }
  for (const record of records) {
    assert.ok(record.declared || record.command === readiness, 'unaccounted observer RPC');
    if (record.declared) {
      const next = declared.find(row => at(row) > at(record.declared));
      if (next) assert.ok(record.sentAt <= at(next), 'RPC associated with a later declaration');
    }
  }
  const completed = observations.filter(row => row.exec?.context === 'primary' && at(row.exec) <= stop).map(row => row.exec);
  for (const row of completed) {
    const record = records.find(record => !record.observed && record.declared && record.command === row.command &&
      record.response && record.completedAt <= at(row));
    assert.ok(record, 'reported RPC result has no completed wire fence');
    assert.equal(record.response.stdout, row.stdout, 'reported RPC stdout differs from wire');
    assert.equal(record.response.exit, row.exit, 'reported RPC exit differs from wire');
    record.observed = row;
  }
  for (const record of records.filter(row => row.declared && row.response))
    assert.ok(record.observed, 'completed observer RPC is missing its report result');
  return records;
}

export function validateReadbackWire(report, renderer) {
  const records = auditSerialWire(report, renderer);
  const { keyboard } = report;
  const start = Date.parse(keyboard.readbackStartedAt), deadline = Date.parse(keyboard.deadlineAt);
  const command = `if [ -f '${keyboard.guestFile}' ]; then cat '${keyboard.guestFile}'; else (exit 75); fi`;
  const readbacks = records.filter(row => row.command === command);
  assert.ok(readbacks.length > 0, 'nonce readback command trace is missing');
  for (const row of readbacks) {
    assert.equal(row.declared.stage, 'physical keyboard:nonce-readback');
    assert.ok(at(row.declared) >= start && row.sentAt <= deadline, 'readback was outside its deadline');
    // The harness samples remaining just before recording exec's timestamp.
    assert.ok(row.declared.timeoutMs <= deadline - at(row.declared) + 5, 'readback timeout exceeds remaining budget');
    if (row.response) {
      assert.ok(row.completedAt <= deadline, 'readback completed after deadline');
      if (row.response.exit === 0) assert.equal(row.response.stdout.trim(), keyboard.nonce, 'wrong physical nonce');
      else { assert.equal(row.response.exit, 75, 'readback was not a missing-file result'); assert.equal(row.response.stdout.trim(), ''); }
    }
  }
  if (keyboard.verified) {
    assert.equal(readbacks.at(-1).response?.exit, 0, 'success has no completed nonce response');
    assert.ok(readbacks.slice(0, -1).every(row => row.response?.exit === 75), 'unproven pre-success readback');
  } else {
    assert.ok(readbacks.some(row => row.response?.exit === 75), 'no completed missing-file readback');
    assert.ok(readbacks.every(row => !row.response || row.response.exit === 75), 'negative arm contains a successful nonce');
    const tail = readbacks.at(-1);
    assert.ok(readbacks.slice(0, -1).every(row => row.response), 'non-final readback was incomplete');
    // A missing final fence is expected if the real remaining-deadline RPC
    // times out. It cannot hide an early shell exit or a fabricated 120s wait.
    const coveredUntil = tail.response ? tail.completedAt : at(tail.declared) + tail.declared.timeoutMs;
    assert.ok(coveredUntil >= deadline - (tail.response ? 1100 : 5), 'readback coverage stopped before the deadline');
    if (!tail.response) assert.ok(Date.parse(keyboard.failedAt) >= coveredUntil, 'incomplete RPC did not exhaust its budget');
  }
  return records;
}

export function bindRendererWire(renderer, records) {
  const pid = renderer.instance.pid, instance = renderer.instance.instance;
  const get = command => {
    const rows = records.filter(row => row.command === command && row.response);
    assert.equal(rows.length, 1, `renderer command is missing or ambiguous: ${command}`);
    assert.equal(rows[0].response.exit, 0, 'renderer probe failed');
    return rows[0].response;
  };
  const actualInstances = JSON.parse(get('XDG_RUNTIME_DIR=/run/user/1000 hyprctl -j instances').stdout);
  assert.deepEqual(actualInstances, [renderer.instance], 'renderer instance differs from wire');
  for (const [field, command] of [
    ['environment', `tr '\\000' '\\n' < /proc/${pid}/environ | sed -n '/^GALLIUM_DRIVER=/p;/^LIBGL_ALWAYS_SOFTWARE=/p;/^LP_NUM_THREADS=/p'`],
    ['threads', `ps -T -p ${pid} -o comm=`],
    ['log', `sed -n '/DEBUG ]: Renderer:/p;/DEBUG ]: Vendor:/p' /run/user/1000/hypr/${instance}/hyprland.log`],
  ]) assert.deepEqual(renderer[field], get(command), `renderer ${field} differs from wire`);
  const clients = JSON.parse(get('XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j clients').stdout);
  const active = JSON.parse(get('XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j activewindow').stdout);
  assert.ok(clients.some(client => client.class === 'foot' && client.mapped && !client.hidden &&
    client.size.every(size => size > 0) && client.address === active.address), 'physical keyboard was not aimed at mapped active Foot');
}

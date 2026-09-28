// Synthetic protocol fixture ONLY. This never boots a guest or writes evidence.
import { formatRpcCommand } from '../../web/guest-rpc.js';
import { evdevForCode } from '../../web/src/input/keymap.js';
import { allowedReadCommands } from './omarchy-thread-wire.mjs';
export const timestamp = seconds => new Date(Date.parse('2026-01-01T00:00:00Z') + seconds * 1000).toISOString();
export const instance = { instance: 'test_1789053307_123', pid: 123, time: 1789053307, wl_socket: 'wayland-1' };
export function wireFixture({ positive = false } = {}) {
  const nonce = '0123456789abcdef', guestFile = '/tmp/desktop-keys-fedcba9876543210';
  const report = { mode: 'verify', restored: true, errors: [], observations: [], inputEvents: [], workerTraffic: [], serialCommands: [],
    keyboard: { verified: positive, nonce, guestFile, startedAt: timestamp(10), typedAt: timestamp(15),
      readbackStartedAt: timestamp(20), readbackTimeoutMs: 120000, deadlineMs: 120000, deadlineAt: timestamp(140),
      ...(positive ? { completedAt: timestamp(22.501) } : { failedAt: timestamp(140.002), error: 'timed out waiting for physical keyboard nonce file' }) } };
  const renderer = { label: 'initial desktop', expectedRenderer: 'llvmpipe', expectedLpNumThreads: '0', instance,
    environment: { stdout: 'GALLIUM_DRIVER=llvmpipe\nLIBGL_ALWAYS_SOFTWARE=1\nLP_NUM_THREADS=0\n\n', exit: 0 },
    threads: { stdout: 'Hyprland\nwayland-wm\n\n', exit: 0 }, log: { stdout: '\n', exit: 0 },
    parsedLog: { kind: 'lp0-configuration-observed', glLabelAvailable: false, activeRendererValidated: false }, activeRendererValidated: false };
  const push = (type, seconds, values) => report.workerTraffic.push({ type, timestamp: timestamp(seconds), ms: seconds * 1000,
    context: 'primary', epoch: 'final', worker: 1, ...values });
  push('worker-boot', 0, { sent: true });
  push('serial-input', 0.1, { bytes: [13, 27, 91, 49, 59, 49, 82], sent: true });
  let rid = 0;
  function rpc(command, seconds, response, stage = 'initial desktop:probe', timeoutMs = 300000, declared = true) {
    const id = `test${++rid}`;
    if (declared) report.serialCommands.push({ command, timestamp: timestamp(seconds), context: 'primary', stage, timeoutMs });
    const frame = Buffer.from(formatRpcCommand(command, id));
    // Intentionally split the outgoing/incoming fences across worker frames.
    push('serial-input', seconds + 0.001, { bytes: [...frame.subarray(0, 11)], sent: true });
    push('serial-input', seconds + 0.002, { bytes: [...frame.subarray(11)], sent: true });
    push('serial-output', seconds + 0.01, { text: `\r\n__WVBE` });
    push('serial-output', seconds + 0.02, { text: `GIN_${id}\r\n` });
    if (response) {
      push('serial-output', seconds + 0.5, { text: `${response.stdout.replaceAll('\n', '\r\n')}__WVEND_${id}_${response.exit}\r\n` });
      if (declared) report.observations.push({ exec: { timestamp: timestamp(seconds + 0.501), context: 'primary',
        url: 'http://localhost:1234/app?guest=omarchy&desktop=1#ide', command, ...response } });
    }
  }
  const commands = [...allowedReadCommands(renderer, guestFile)];
  const foot = { class: 'foot', address: '0x1', pid: 490, mapped: true, hidden: false, size: [800, 600] };
  rpc(commands[0], 0.2, { stdout: '{}\n', exit: 0 }, '', 300000, false);
  rpc(commands[1], 1, { stdout: JSON.stringify([foot]) + '\n', exit: 0 });
  rpc(commands[2], 2, { stdout: JSON.stringify([instance]) + '\n', exit: 0 });
  rpc(commands[4], 3, renderer.environment);
  rpc(commands[5], 4, renderer.threads);
  rpc(commands[6], 5, renderer.log);
  rpc(commands[3], 6, { stdout: JSON.stringify(foot) + '\n', exit: 0 });
  report.observations.push({ renderer });
  const transitions = [];
  const add = (key, code, up = false) => transitions.push({ key, code, type: up ? 'keyup' : 'keydown' });
  for (const char of `printf '${nonce}' > ${guestFile}`) {
    if (char === '>') { add('Shift', 'ShiftLeft'); add('>', 'Period'); add('>', 'Period', true); add('Shift', 'ShiftLeft', true); }
    else {
      const code = ({ ' ': 'Space', "'": 'Quote', '-': 'Minus', '/': 'Slash' })[char] ||
        (/\d/u.test(char) ? `Digit${char}` : `Key${char.toUpperCase()}`);
      add(char, code); add(char, code, true);
    }
  }
  add('Enter', 'Enter'); add('Enter', 'Enter', true);
  let callId = 0;
  for (const [index, event] of transitions.entries()) {
    const seconds = 10.01 + index * 0.02;
    report.inputEvents.push({ ...event, context: 'primary', epoch: 'final', timestamp: timestamp(seconds),
      trusted: true, repeat: false, target: 'ide-display-canvas', activeElement: 'ide-display-canvas' });
    for (const method of ['sendKeyboardEvent', 'syncKeyboard']) {
      const id = ++callId;
      push('worker-call', seconds, { method, id, sent: true,
        args: method === 'syncKeyboard' ? [] : [1, evdevForCode(event.code), event.type === 'keydown' ? 1 : 0] });
      push('input-result', seconds + 0.001, { method, id, result: true, error: null });
    }
  }
  rpc(commands[7], 20.001, { stdout: '\n', exit: 75 }, 'physical keyboard:nonce-readback', 119999);
  rpc(commands[7], 22, positive ? { stdout: nonce + '\n', exit: 0 } : null, 'physical keyboard:nonce-readback', 118000);
  for (const [label, seconds] of [['physical-keyboard-before', 9], ['physical-keyboard-after-readback', 141]]) {
    report.observations.push({ runtime: { label, context: 'primary', timestamp: timestamp(seconds), inputDevice: {
      pendingEventBudget: 256, pendingEvents: 0, pendingFrames: 0, droppedFrames: 0, droppedEvents: 0, statusEventsServed: 1, rejectedEvents: 0 } } });
  }
  report.observations.push({ screenshot: '/original/workspace/desktop.png', timestamp: timestamp(0.9), sha256: '1'.repeat(64) },
    { screenshot: `/original/workspace/${positive ? 'desktop-keyboard' : 'failure'}.png`, timestamp: timestamp(142), sha256: '2'.repeat(64) });
  report.workerTraffic.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  report.observations.sort((a, b) => Date.parse(a.exec?.timestamp || a.timestamp || 0) - Date.parse(b.exec?.timestamp || b.timestamp || 0));
  report.result = positive ? 'desktop-rendered-keyboard-resize-reload-and-second-tab-verified' : 'failed';
  return { report, renderer, rpc };
}

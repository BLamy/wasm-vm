// One bounded T03j run. Delegates all browser interaction/evidence to the frozen recorder.
// No keys, pointer input, serial commands, policy changes or profiling are requested.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const args = ['tools/verify/omarchy-input-diagnostic.mjs',
  'evidence/omarchy-profile/admission-witness-r1', '64', '1',
  '--pair-directory', 'target/omarchy-sdr-r3-snapshot',
  '--chunk-dir', 'target/omarchy-profile-chunks-sdr-r3-256k', '--headed', '--admission-probe'];
console.log(JSON.stringify({ event: 'launch', at: new Date().toISOString(), executable: process.execPath, args }));
const child = spawn(process.execPath, args, { cwd: repo, stdio: ['pipe', 'pipe', 'inherit'] });
const send = request => child.stdin.write(`${JSON.stringify(request)}\n`);
const timers = [];
let observed = false, finished = false;
const abort = () => { console.error('bounded recording deadline exceeded'); child.kill('SIGTERM'); };
const startupDeadline = setTimeout(abort, 180_000);
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  let entry;
  try { entry = JSON.parse(line); } catch { console.log(line); return; }
  console.log(JSON.stringify({ at: new Date().toISOString(), ready: entry.ready,
    request: entry.request, time: entry.time, error: entry.error,
    generation: entry.result?.jit?.admissionProbe?.generation,
    records: entry.result?.jit?.admissionProbe?.records?.length,
    fullMapRefusals: entry.result?.jit?.admissionProbe?.fullMapRefusals }));
  if (entry.ready === 'INPUT_DIAGNOSTIC_READY') send({ op: 'stats', phase: 'initial' });
  if (entry.error) { child.stdin.end(`${JSON.stringify({ op: 'quit' })}\n`); return; }
  if (entry.request?.phase === 'initial' && !observed) {
    observed = true; clearTimeout(startupDeadline);
    send({ op: 'screenshot', name: 'initial.png' });
    timers.push(setTimeout(() => send({ op: 'stats', phase: 'middle' }), 60_000));
    timers.push(setTimeout(() => send({ op: 'stats', phase: 'final' }), 120_000));
    timers.push(setTimeout(abort, 180_000));
  }
  if (entry.request?.phase === 'final') send({ op: 'screenshot', name: 'final.png' });
  if (entry.request?.name === 'final.png') {
    finished = true; child.stdin.end(`${JSON.stringify({ op: 'quit' })}\n`);
  }
});
child.on('exit', (code, signal) => {
  clearTimeout(startupDeadline); for (const timer of timers) clearTimeout(timer);
  lines.close(); console.log(JSON.stringify({ event: 'exit', code, signal, finished }));
  process.exitCode = code === 0 && finished ? 0 : 1;
});
child.on('error', error => { console.error(error); clearTimeout(startupDeadline); process.exitCode = 1; });

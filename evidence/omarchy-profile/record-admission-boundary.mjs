// T03j R2: same frozen observer/policies; begin the window at an actual refusal.
// Warm-up is bounded to five minutes; no input or guest commands are sent.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const args = ['tools/verify/omarchy-input-diagnostic.mjs',
  'evidence/omarchy-profile/admission-witness-r2', '64', '1',
  '--pair-directory', 'target/omarchy-sdr-r3-snapshot',
  '--chunk-dir', 'target/omarchy-profile-chunks-sdr-r3-256k', '--headed', '--admission-probe'];
console.log(JSON.stringify({ event: 'launch', at: new Date().toISOString(), executable: process.execPath, args }));
const child = spawn(process.execPath, args, { cwd: repo, stdio: ['pipe', 'pipe', 'inherit'] });
const send = request => child.stdin.write(`${JSON.stringify(request)}\n`);
const timers = [];
let state = 'boot', outcome = null, warmDeadline, warmEnd, finished = false;
const abort = () => { console.error('bounded recording deadline exceeded'); child.kill('SIGTERM'); };
const startupDeadline = setTimeout(abort, 180_000);
const later = (ms, fn) => { const timer = setTimeout(fn, ms); timers.push(timer); return timer; };
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  let entry;
  try { entry = JSON.parse(line); } catch { console.log(line); return; }
  const probe = entry.result?.jit?.admissionProbe;
  console.log(JSON.stringify({ at: new Date().toISOString(), ready: entry.ready,
    request: entry.request, time: entry.time, error: entry.error,
    generation: probe?.generation, records: probe?.records?.length,
    fullMapRefusals: probe?.fullMapRefusals, countsLen: probe?.countsLen }));
  if (entry.error) { state = 'closing'; child.stdin.end(`${JSON.stringify({ op: 'quit' })}\n`); return; }
  if (entry.ready === 'INPUT_DIAGNOSTIC_READY') {
    clearTimeout(startupDeadline); state = 'warming'; warmEnd = Date.now() + 300_000;
    warmDeadline = later(300_000, () => {
      if (state !== 'warming') return;
      state = 'closing'; outcome = 'inconclusive-no-refusal';
      send({ op: 'screenshot', name: 'no-refusal.png' }); later(30_000, abort);
    });
    send({ op: 'stats', phase: 'warmup' });
  }
  if (entry.request?.phase === 'warmup' && state === 'warming') {
    if (probe?.enabled !== true) { abort(); return; }
    if (BigInt(probe.fullMapRefusals) > 0n && Date.now() < warmEnd) {
      state = 'measuring'; outcome = 'refusal-boundary-observed'; clearTimeout(warmDeadline);
      console.log(JSON.stringify({ event: 'measurement-start', reportTime: entry.time, warmEnd }));
      send({ op: 'screenshot', name: 'initial.png' });
      later(60_000, () => send({ op: 'stats', phase: 'middle' }));
      later(120_000, () => send({ op: 'stats', phase: 'final' })); later(180_000, abort);
    } else if (Date.now() < warmEnd) {
      later(Math.min(10_000, warmEnd - Date.now()), () => {
        if (state === 'warming') send({ op: 'stats', phase: 'warmup' });
      });
    }
  }
  if (entry.request?.phase === 'final' && state === 'measuring') {
    state = 'closing'; send({ op: 'screenshot', name: 'final.png' });
  }
  if (['final.png', 'no-refusal.png'].includes(entry.request?.name)) {
    finished = true; child.stdin.end(`${JSON.stringify({ op: 'quit' })}\n`);
  }
});
child.on('exit', (code, signal) => {
  clearTimeout(startupDeadline); for (const timer of timers) clearTimeout(timer);
  lines.close(); console.log(JSON.stringify({ event: 'exit', code, signal, finished, outcome }));
  process.exitCode = code === 0 && finished ? 0 : 1;
});
child.on('error', error => { console.error(error); clearTimeout(startupDeadline); process.exitCode = 1; });

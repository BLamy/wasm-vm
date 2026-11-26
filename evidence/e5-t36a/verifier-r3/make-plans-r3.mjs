// E5-T36a verifier round 3: writes the browser plans (seeded, so they can be regenerated).
//   node make-plans-r3.mjs
import { writeFileSync } from "node:fs";
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0x100000000; }; }
const R = rng(0x36a3);
const int = (a, b) => Math.round(a + (b - a) * R());
const LOAD = {
  bursts: "(while :; do seq 1 30; sleep 0.15; done > /dev/pts/0 2>/dev/null & echo $! > /tmp/v-load.pid); sleep 1; cat /proc/loadavg",
  flood: "(while :; do seq 1 2000; done > /dev/pts/0 2>/dev/null & echo $! > /tmp/v-load.pid); sleep 1; cat /proc/loadavg",
  cpu2: "(while :; do :; done & echo $! > /tmp/v-load2.pid); (while :; do :; done & echo $! > /tmp/v-load3.pid); sleep 1; cat /proc/loadavg",
  stop: "kill $(cat /tmp/v-load.pid /tmp/v-load2.pid /tmp/v-load3.pid 2>/dev/null) 2>/dev/null; rm -f /tmp/v-load*.pid; sleep 1; cat /proc/loadavg",
};
const rate = (label) => [{ op: "stats", label: `${label} a` }, { op: "wait", ms: 3000 }, { op: "stats", label: `${label} b (3 s later)` }];
// One first-time approach: body (arrow) -> button (hand) -> terminal (caret), every read at rest.
function approach(phase, i, { settle = false, plane = false } = {}) {
  const name = `${phase}.${i}`;
  const body = [int(330, 560), int(585, 740)]; const body2 = [body[0] + int(-60, 60), body[1] + int(-40, 40)];
  const button = [int(66, 140), int(506, 531)]; const term = [int(900, 1150), int(300, 430)];
  const ms1 = int(300, 650); const pause = int(150, 500); const nudge = R() < 0.5 ? [int(-3, 3), int(-3, 3)] : null;
  const noPlane = !plane;
  const steps = [{ op: "reset", note: name }];
  if (settle) steps.push({ op: "settle", ms: 5000 });
  steps.push({ op: "jump", to: body, restMs: int(600, 900) }, { op: "glide", to: body2, ms: int(300, 400), restMs: 500 },
    { op: "read", phase, name: `${name} arrow in the page body`, settleMs: 300, noPlane },
    { op: "glide", to: button, ms: ms1, restMs: 0 }, { op: "wait", ms: pause });
  if (nudge) steps.push({ op: "jump", to: [button[0] + nudge[0], button[1] + nudge[1]], restMs: 0 });
  steps.push({ op: "read", phase, name: `${name} hand: ${ms1} ms glide to ${button}, ${pause} ms pause${nudge ? `, nudge ${nudge}` : ""} — early`, settleMs: 450, noPlane },
    { op: "read", phase, name: `${name} hand — late`, settleMs: 1500, noPlane },
    { op: "glide", to: term, ms: int(500, 1100), restMs: 0 },
    { op: "read", phase, name: `${name} caret: glide to ${term} — early`, settleMs: 450, noPlane },
    { op: "read", phase, name: `${name} caret — late`, settleMs: 1500, noPlane });
  return steps;
}
const many = (phase, n, o) => Array.from({ length: n }, (_, i) => approach(phase, i + 1, o)).flat();

// The main run: no idle wait first ("early"), then idle, then three kinds of guest load.
const premise = { steps: [
  ...rate("early (session just restarted, no idle wait)"), ...many("early", 3),
  { op: "idle", seconds: 20 }, ...rate("idle"), ...many("idle", 4, { settle: true, plane: true }),
  { op: "sh", cmd: LOAD.bursts }, ...rate("bursts"), ...many("bursts", 12), ...rate("bursts end"),
  { op: "sh", cmd: LOAD.stop }, { op: "sh", cmd: LOAD.flood }, ...rate("flood"), ...many("flood", 6),
  { op: "sh", cmd: LOAD.cpu2 }, ...rate("flood+cpu2"), ...many("flood+cpu2", 4),
  { op: "sh", cmd: LOAD.stop }, ...many("recovering", 3), ...rate("after"),
] };
writeFileSync(new URL("./plan-r3-premise.json", import.meta.url), `${JSON.stringify(premise, null, 1)}\n`);

// The slowed host: idle, bursts, flood.
const slow = { steps: [
  { op: "idle", seconds: 10, maxMs: 180000 }, ...rate("idle"), ...many("idle", 3, { settle: true }),
  { op: "sh", cmd: LOAD.bursts }, ...rate("bursts"), ...many("bursts", 10), ...rate("bursts end"),
  { op: "sh", cmd: LOAD.stop }, { op: "sh", cmd: LOAD.flood }, ...rate("flood"), ...many("flood", 4),
  { op: "sh", cmd: LOAD.stop }, ...many("recovering", 3),
] };
writeFileSync(new URL("./plan-r3-slow-host.json", import.meta.url), `${JSON.stringify(slow, null, 1)}\n`);

// P3 in a browser: the proof script's hook at rest, then an even run that starts at the rest
// position, while the guest commits frames for another reason (terminal output in bursts).
function stale(phase, i, step, everyMs, n = 10) {
  const from = [int(340, 480), int(590, 690)];
  return [{ op: "jump", to: from, restMs: 1200 }, { op: "reset", note: `${phase}.${i}` }, { op: "settle", ms: 8000 },
    { op: "wait", ms: int(0, 120) },
    { op: "evenrun", step, n, everyMs }, 
    { op: "read", phase, name: `${phase}.${i} arrow after an even run of ${step} x${n} every ${everyMs} ms from the rest position ${from} — early`, settleMs: 400, noPlane: true },
    { op: "read", phase, name: `${phase}.${i} arrow — late`, settleMs: 1500, noPlane: true }];
}
const STEPS = [[5, 3], [6, 0], [4, 4], [8, 2], [3, 5], [10, 0], [7, 7], [12, 4]];
const staleRuns = (phase, n) => Array.from({ length: n }, (_, i) => stale(phase, i + 1, STEPS[i % STEPS.length], [16, 16, 33, 24][i % 4])).flat();
const light = "(while :; do echo tick; sleep 0.05; done > /dev/pts/0 2>/dev/null & echo $! > /tmp/v-load.pid); sleep 1; cat /proc/loadavg";
const stalePlan = { steps: [
  { op: "idle", seconds: 20 }, ...staleRuns("stale-idle", 6),
  { op: "sh", cmd: light }, ...rate("ticks"), ...staleRuns("stale-ticks", 16),
  { op: "sh", cmd: LOAD.stop }, { op: "sh", cmd: LOAD.bursts }, ...rate("bursts"), ...staleRuns("stale-bursts", 16),
  { op: "sh", cmd: LOAD.stop },
] };
writeFileSync(new URL("./plan-r3-stale.json", import.meta.url), `${JSON.stringify(stalePlan, null, 1)}\n`);
// The fallback without an idle counter (?pace=0): no rest answers; a restart trusts moves after 1 s.
const pace0 = { steps: [...rate("pace=0"), { op: "wait", ms: 8000 },
  { op: "jump", to: [400, 650], restMs: 1500 }, { op: "reset", note: "pace0.settle" }, { op: "settle", ms: 5000 },
  ...many("pace0", 4, { settle: true }),
  // scattered jumps: the moves alone settle each shape
  { op: "jump", to: [300, 620], restMs: 700 }, { op: "jump", to: [380, 700], restMs: 700 }, { op: "jump", to: [520, 650], restMs: 700 },
  { op: "read", phase: "pace0-jumps", name: "arrow after scattered jumps", settleMs: 800, noPlane: true },
  { op: "jump", to: [60, 510], restMs: 700 }, { op: "jump", to: [100, 520], restMs: 700 }, { op: "jump", to: [140, 505], restMs: 700 },
  { op: "read", phase: "pace0-jumps", name: "hand after scattered jumps", settleMs: 800, noPlane: true },
  ...rate("pace=0 end") ] };
writeFileSync(new URL("./plan-r3-pace0.json", import.meta.url), `${JSON.stringify(pace0, null, 1)}\n`);
// P3-short (added after stale-1; see the addendum in predictions.txt): the same, with runs of
// 2-4 positions, so that fewer than three contradicting moves follow before the pointer rests.
{
  const R2 = rng(0x51a7e); const i2 = (a, b) => Math.round(a + (b - a) * R2());
  const steps = [];
  const trial = (i) => {
    const from = [i2(340, 480), i2(590, 690)]; const step = STEPS[i % STEPS.length]; const n = [3, 2, 4][i % 3];
    return [{ op: "jump", to: from, restMs: 1000 }, { op: "reset", note: `short-bursts.${i + 1}` }, { op: "settle", ms: 8000 }, { op: "wait", ms: i2(0, 150) },
      { op: "evenrun", step, n, everyMs: 16 },
      { op: "read", phase: "short-bursts", name: `short-bursts.${i + 1} arrow after ${n} positions of ${step} from ${from} — early`, settleMs: 400, noPlane: true },
      { op: "read", phase: "short-bursts", name: `short-bursts.${i + 1} arrow — late (1.5 s more)`, settleMs: 1500, noPlane: true },
      { op: "read", phase: "short-bursts", name: `short-bursts.${i + 1} arrow — 4 s`, settleMs: 2100, noPlane: true }];
  };
  for (let i = 0; i < 48; i += 1) steps.push(...trial(i));
  const short = { steps: [{ op: "idle", seconds: 20 }, { op: "sh", cmd: LOAD.bursts }, ...rate("bursts"), ...steps, { op: "sh", cmd: LOAD.stop }] };
  writeFileSync(new URL("./plan-r3-stale-short.json", import.meta.url), `${JSON.stringify(short, null, 1)}\n`);
}
console.log("premise steps", premise.steps.length, "slow", slow.steps.length, "stale", stalePlan.steps.length);

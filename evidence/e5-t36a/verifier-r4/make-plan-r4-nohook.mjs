// E5-T36a verifier round 4, addendum to P9 (written after kernel-drop-1, before the runs it
// predicts): the same attack with NO hook. At the session's start nothing is inferred yet, so
// the arrow is "not settled" by itself: first position P, relative mode, relative motion,
// absolute mode, the mouse back on P — with the terminal printing in bursts from before the
// first position, so that the compositor commits (kernel-drop-1's T1 did this on an idle
// desktop: the page settled with the plane 4,3 off, and no commit re-reported the plane).
// PREDICTED: settling false after the return with the plane where relative motion left it; at
// the probes 0.7 s / 2.2 s after, the arrow is shown with "last sent - plane" (not (1,1)); it is
// kept through two more even positions (tip off the sent pixel by the relative displacement).
//   node make-plan-r4-nohook.mjs X Y DX DY > plan.json
const [X, Y, DX, DY] = process.argv.slice(2).map(Number);
const P = [X, Y]; const name = `H0 no hook, session start, bursts, P=${P} d=${[DX, DY]}`;
const steps = [{ op: "ui" }, { op: "idle", seconds: 20 },
  { op: "sh", cmd: "(while :; do seq 1 30; sleep 0.15; done > /dev/pts/0 2>/dev/null & echo $! > /tmp/v-load.pid); sleep 1; cat /proc/loadavg" }, { op: "wait", ms: 2000 },
  { op: "probe", label: "0: before any position was sent", trial: name },
  { op: "jump", to: P, note: "the session's first position" },
  { op: "mode", mode: "relative" }, { op: "mouse", to: [X + DX, Y + DY] }, { op: "wait", ms: 400 }, { op: "probe", label: "b: after relative motion", trial: name },
  { op: "mode", mode: "absolute" }, { op: "mouse", to: P }, { op: "wait", ms: 700 }, { op: "probe", label: "c: 0.7 s after the return", trial: name },
  { op: "wait", ms: 1500 }, { op: "probe", label: "d: 2.2 s after the return", trial: name },
  { op: "evenrun", step: [6, 2], n: 2, everyMs: 16 }, { op: "wait", ms: 1000 }, { op: "probe", label: "e: two more positions (+6,+2 each), at rest", trial: name },
  { op: "wait", ms: 4000 }, { op: "probe", label: "g: 5 s at rest after them", trial: name },
  { op: "jump", to: [X + 60, Y - 40], restMs: 700 }, { op: "jump", to: [X + 30, Y + 50], restMs: 900 }, { op: "probe", label: "f: after two jumps elsewhere", trial: name },
  { op: "sh", cmd: "kill $(cat /tmp/v-load.pid) 2>/dev/null; rm -f /tmp/v-load.pid; sleep 1; cat /proc/loadavg" }];
console.log(JSON.stringify({ name, screenshot: true, steps }, null, 1));

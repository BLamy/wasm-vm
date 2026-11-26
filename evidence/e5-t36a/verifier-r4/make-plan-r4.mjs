// E5-T36a verifier round 4: the plan for P9 (predictions.txt) — "idle after a position sent
// since" without the guest's pointer on it. Written before the run it predicts.
//   node make-plan-r4.mjs > plan-r4-kernel-drop.json
// A trial: the pointer rests on P (absolute); relative mode; the mouse moves by d (the page
// sends relative motion: another device); absolute mode; the mouse returns to the SAME page
// point, so the absolute frame carries the tablet's current axis values. Probes read the
// kernel's cursor plane before and after each step.
const steps = [{ op: "ui" }, { op: "idle", seconds: 20 }, { op: "stats", label: "start" },
  { op: "probe", label: "0: before any position was sent", trial: "T1" }];
const trial = (name, P, d, { hook = true, first = false, back = P, note } = {}) => {
  if (first) steps.push({ op: "jump", to: P, note: `${name}: the session's first position` });
  else {
    steps.push({ op: "jump", to: P, restMs: 1500, note: `${name}: rest on P` }, { op: "probe", label: "a: at rest on P", trial: name });
    if (hook) steps.push({ op: "reset", note: `${name} hook` });
  }
  steps.push({ op: "mode", mode: "relative" }, { op: "mouse", to: [P[0] + d[0], P[1] + d[1]], note: `${name}: relative motion ${d}` }, { op: "wait", ms: 400 },
    { op: "probe", label: "b: after relative motion", trial: name }, { op: "mode", mode: "absolute" });
  if (back === P) steps.push({ op: "mouse", to: P, note: `${name}: back to the same page point` });
  else steps.push({ op: "jump", to: back, note: `${name}: CONTROL back to a point one guest pixel away` });
  steps.push({ op: "wait", ms: 700 }, { op: "probe", label: "c: 0.7 s after the return", trial: name },
    { op: "wait", ms: 1500 }, { op: "probe", label: "d: 2.2 s after the return", trial: name });
  if (back !== P) steps.push({ op: "wait", ms: 10 });
  steps.push({ op: "evenrun", step: [6, 2], n: 2, everyMs: 16 }, { op: "wait", ms: 1000 }, { op: "probe", label: "e: two more positions (+6,+2 each), at rest", trial: name },
    { op: "jump", to: [back[0] + 60, back[1] - 40], restMs: 700 }, { op: "jump", to: [back[0] + 30, back[1] + 50], restMs: 900 }, { op: "probe", label: "f: after two jumps elsewhere", trial: name });
  void note;
};
// idle desktop
trial("T1 no hook, session start", [400, 640], [-7, -5], { first: true });
trial("T2 hook", [430, 610], [-7, -5]);
trial("T3 hook", [370, 660], [-12, -3]);
trial("C1 control: back one pixel away", [410, 620], [-7, -5], { back: [411, 620] });
trial("N1 no hook, arrow settled", [390, 650], [-7, -5], { hook: false });
// the terminal printing in bursts (round 3's load, the worker's too): the compositor commits often
steps.push({ op: "sh", cmd: "(while :; do seq 1 30; sleep 0.15; done > /dev/pts/0 2>/dev/null & echo $! > /tmp/v-load.pid); sleep 1; cat /proc/loadavg" }, { op: "wait", ms: 2000 });
trial("T4 hook, bursts", [440, 630], [-7, -5]);
trial("T5 hook, bursts", [360, 600], [-4, -9]);
trial("T6 hook, bursts", [420, 670], [-20, -10]);
trial("T7 hook, bursts, d positive (no offset inside the image)", [380, 620], [9, 6]);
trial("C2 control, bursts: back one pixel away", [450, 650], [-7, -5], { back: [451, 650] });
steps.push({ op: "sh", cmd: "kill $(cat /tmp/v-load.pid) 2>/dev/null; rm -f /tmp/v-load.pid; sleep 1; cat /proc/loadavg" }, { op: "stats", label: "end" });
console.log(JSON.stringify({ name: "r4 kernel drop", screenshot: true, steps }, null, 1));

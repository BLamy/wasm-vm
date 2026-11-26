// E5-T36a verifier round 5: the plan for P12 and P13 of predictions.txt (written before the
// runs it predicts).   node make-plan-r5.mjs > plan-r5-appear.json
//
// P12 — a compositor restarted under a running, settled page. The mouse is parked on (120,110),
// the arrow forgotten by the hook; the guest's session is ended and started again the way the
// proof script does it. A new compositor puts its pointer at (100,100): the plane at (99,99),
// 21,11 from the mouse — inside the 64x64 image. PREDICTED: the device reports the cursor gone
// as a cursor-UPDATE with resource 0; from the new compositor's first image on the page is
// settling and shows nothing for the arrow; one position that differs in ONE axis, (120,116),
// puts the kernel's plane on (119,115) and ends settling; (1,1) afterwards.
//
// P13 — a live compositor hides its cursor (`seat seat0 hide_cursor`), its pointer is put 7,5
// away while nothing is shown (`seat seat0 cursor set`), and the cursor comes back without any
// tablet position (the timeout switched off, or a wheel detent). PREDICTED: hide = UPDATE with
// resource 0; settling when it is shown again; nothing shown for the forgotten arrow at rest
// under terminal bursts; right after the next different position.
const SWAY = (cmd) => `su -s /bin/sh desktop -c 'SWAYSOCK=$(ls /run/user/1000/sway-ipc.*.sock | head -1) swaymsg ${cmd}' 2>&1 | tr '\\n' ' '; echo rc=$?`;
const steps = [{ op: "ui" }, { op: "idle", seconds: 20 },
  { op: "probe", label: "0: before any position was sent", trial: "P12" },
  { op: "jump", to: [632, 396], restMs: 1500 }, { op: "jump", to: [640, 400] }, { op: "settle", ms: 60000 },
  { op: "jump", to: [380, 640], restMs: 1500 }, { op: "read", name: "arrow over the page body, the page settled", phase: "P12 before" },
  { op: "jump", to: [300, 300], restMs: 700 }, { op: "jump", to: [120, 110], restMs: 1500 },
  { op: "probe", label: "a: parked on (120,110)", trial: "P12" },
  { op: "reset", note: "the hook: the arrow forgotten" }, { op: "probe", label: "b: after the hook", trial: "P12" },
  { op: "session-stop" }, { op: "probe", label: "c: the compositor is gone", trial: "P12" },
  { op: "session-start", trial: "P12", everyMs: 1500 },
  { op: "wait", ms: 3000 }, { op: "probe", label: "d: 3 s after READY", trial: "P12" },
  { op: "wait", ms: 5000 }, { op: "probe", label: "e: 8 s after READY", trial: "P12" },
  { op: "wait", ms: 10000 }, { op: "probe", label: "f: 18 s after READY", trial: "P12" },
  { op: "wait", ms: 15000 }, { op: "probe", label: "g: 33 s after READY", trial: "P12" },
  { op: "jump", to: [120, 116], note: "one axis only" }, { op: "wait", ms: 1500 }, { op: "probe", label: "h: 1.5 s after (120,116), one axis", trial: "P12" },
  { op: "wait", ms: 3000 }, { op: "probe", label: "i: 4.5 s after (120,116)", trial: "P12" },
  { op: "jump", to: [380, 640], restMs: 700 }, { op: "jump", to: [420, 600], restMs: 900 }, { op: "read", name: "arrow over the page body, after the restart", phase: "P12 after" },

  { op: "sh", cmd: "which swaymsg; ls /run/user/1000/ | tr '\\n' ' '" },
  { op: "jump", to: [400, 640], restMs: 1500 }, { op: "read", name: "arrow, before the hide", phase: "P13 before" },
  { op: "reset", note: "the hook: the arrow forgotten" },
  { op: "sh", cmd: SWAY("seat seat0 hide_cursor 1000") },
  { op: "wait", ms: 2500 }, { op: "probe", label: "a: 2.5 s after `hide_cursor 1000`, the mouse at rest", trial: "P13" },
  { op: "sh", cmd: SWAY("seat seat0 cursor set 393 635") },
  { op: "wait", ms: 500 }, { op: "probe", label: "b: after `cursor set 393 635`", trial: "P13" },
  { op: "sh", cmd: "(while :; do seq 1 30; sleep 0.15; done > /dev/pts/0 2>/dev/null & echo $! > /tmp/v-load.pid); sleep 1; cat /proc/loadavg" },
  { op: "wait", ms: 1500 }, { op: "probe", label: "c: bursts running", trial: "P13" },
  { op: "sh", cmd: SWAY("seat seat0 hide_cursor 0") },
  { op: "wait", ms: 700 }, { op: "probe", label: "d: 0.7 s after `hide_cursor 0`", trial: "P13" },
  { op: "wheel", dy: 120 }, { op: "wait", ms: 700 }, { op: "probe", label: "e: 0.7 s after one wheel detent", trial: "P13" },
  { op: "wait", ms: 1500 }, { op: "probe", label: "f: 2.2 s after the wheel", trial: "P13" },
  { op: "wait", ms: 3000 }, { op: "probe", label: "g: 5.2 s after the wheel", trial: "P13" },
  { op: "jump", to: [400, 646], note: "one axis only" }, { op: "wait", ms: 1500 }, { op: "probe", label: "h: 1.5 s after (400,646), one axis", trial: "P13" },
  { op: "jump", to: [440, 600], restMs: 900 }, { op: "jump", to: [470, 660], restMs: 900 }, { op: "read", name: "arrow, after hide and show", phase: "P13 after" },
  { op: "sh", cmd: "kill $(cat /tmp/v-load.pid) 2>/dev/null; rm -f /tmp/v-load.pid; sleep 1; cat /proc/loadavg" }];
console.log(JSON.stringify({ name: "r5: a cursor that appears where none was shown, on the real guest", screenshot: true, steps }, null, 1));

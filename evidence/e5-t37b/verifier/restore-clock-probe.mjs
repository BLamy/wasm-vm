// Verifier (E5-T37b): the lifecycle with a restoredClock argument and the "paced" policy.
// The worker's test file never passes one (mutant G5 survives), so guest-clock.js:68 is unexecuted there.
import path from "node:path"; import { pathToFileURL } from "node:url";
const { createGuestClockLifecycle } = await import(pathToFileURL(path.join(path.resolve(process.argv[2]), "guest-clock.js")).href);
function fixture(mode = "icount", clockDiv = 64) { const calls = []; let state = { mode, clockDiv, timebaseHz: 10_000_000, mtime: "123456789012345678" };
  return { calls, state: () => state, machine: { guestClockState: () => ({ ...state }), setICountDivider(d) { calls.push(["setICountDivider", d]); state = { ...state, clockDiv: d }; },
    setGuestClock(m) { calls.push(["setGuestClock", m]); state = { ...state, mode: m }; }, rebaseGuestClock() { calls.push(["rebaseGuestClock"]); },
    setPacedIdlePolicy(y, lag) { calls.push(["setPacedIdlePolicy", y, lag]); }, takeIdleWaitMs: () => 0 } }; }
const tryIt = (name, f, args) => { try { const l = createGuestClockLifecycle(f.machine, ...args); return { name, ok: true, idleYield: l.idleYield, calls: f.calls, finalMode: f.state().mode }; } catch (e) { return { name, ok: false, error: e.message, calls: f.calls, finalMode: f.state().mode }; } };
const base = { clockDiv: 64, timebaseHz: 10_000_000, mtime: "123456789012345678" };
const out = [
  tryIt("restored icount checkpoint + paced (no divider request)", fixture("icount"), ["icount", undefined, "paced", { mode: "icount", ...base }]),
  tryIt("restored icount checkpoint + paced + divider 64", fixture("icount"), ["icount", 64, "paced", { mode: "icount", ...base }]),
  tryIt("restored paced-icount checkpoint + paced (the clause the diff adds at guest-clock.js:68)", fixture("icount"), ["icount", undefined, "paced", { mode: "paced-icount", ...base }]),
  tryIt("restored wall checkpoint + paced (must be refused)", fixture("icount"), ["icount", undefined, "paced", { mode: "wall", ...base }]),
  tryIt("restored paced-icount checkpoint + no policy (must be refused)", fixture("icount"), ["icount", undefined, undefined, { mode: "paced-icount", ...base }]),
  tryIt("restored clock whose mtime differs from the machine + paced (must be refused)", fixture("icount"), ["icount", undefined, "paced", { mode: "icount", ...base, mtime: "1" }]),
];
console.log(JSON.stringify(out, null, 1));

// Verifier: OS-reported CPU seconds per Chrome process over the benchmark's 30 s idle window.
// usage: node cpu-summ.mjs <samples> <result.json>   (samples as reduced by trim-samples.mjs)
import { readFileSync } from "node:fs";
const [samplesPath, resultPath] = process.argv.slice(2);
const result = JSON.parse(readFileSync(resultPath, "utf8"));
const end = Date.parse(result.finishedAt) / 1000 - 1.0;         // idle is the last scenario; leave 1 s for the screenshot/close
const start = end - 28;                                          // inside the 30 s idle sample
const secs = (t) => { const p = t.split(":").map(Number); return p.reduce((a, b) => a * 60 + b, 0); };
const snaps = []; let cur = null;
for (const line of readFileSync(samplesPath, "utf8").split("\n")) {
  if (line.startsWith("T ")) { cur = { t: Number(line.slice(2)), procs: new Map() }; snaps.push(cur); continue; }
  const m = line.match(/^\s*(\d+)\s+(\d+)\s+([\d:.]+)\s+(.*)$/); if (!m || !cur) continue;
  cur.procs.set(m[1], { ppid: m[2], cpu: secs(m[3]), cmd: m[4] });
}
const near = (t) => snaps.reduce((best, s) => Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best, snaps[0]);
const a = near(start), b = near(end); const wall = b.t - a.t;
const rows = [];
for (const [pid, pb] of b.procs) { const pa = a.procs.get(pid); if (!pa) continue; rows.push({ pid, ppid: pb.ppid, cpuS: +(pb.cpu - pa.cpu).toFixed(2), pctOfCore: +(100 * (pb.cpu - pa.cpu) / wall).toFixed(1),
  kind: pb.cmd.slice(0, 60) }); }
rows.sort((x, y) => y.cpuS - x.cpuS);
console.log(JSON.stringify({ label: result.label, windowS: +wall.toFixed(1), from: new Date(a.t * 1000).toISOString(), to: new Date(b.t * 1000).toISOString(), top: rows.slice(0, 8) }, null, 1));

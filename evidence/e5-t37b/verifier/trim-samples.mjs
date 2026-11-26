// Verifier: reduce a ps sample file to the headless Chrome that Playwright launched (browser process and
// its helpers) plus, per sample, the CPU-seconds counters of the other heavy processes by short name only.
import { readFileSync, writeFileSync } from "node:fs";
for (const f of process.argv.slice(2)) {
  const lines = readFileSync(f, "utf8").split("\n"); const roots = new Set();
  for (const l of lines) { const m = l.match(/^\s*(\d+)\s+(\d+)\s+\S+\s+(.*)$/); if (m && /Google Chrome --disable-field-trial-config/.test(m[3])) roots.add(m[1]); }
  const out = [];
  for (const l of lines) {
    if (l.startsWith("T ")) { out.push(l); continue; }
    const m = l.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/); if (!m) continue; const [, pid, ppid, cpu, cmd] = m;
    if (roots.has(pid)) out.push(`${pid} ${ppid} ${cpu} chrome-browser(playwright headless)`);
    else if (roots.has(ppid)) out.push(`${pid} ${ppid} ${cpu} ${cmd.match(/Google Chrome Helper(?: \(([^)]*)\))?/)?.[0] ?? "chrome-child"}`);
    else if (/wasm-vm boot/.test(cmd)) out.push(`${pid} ${ppid} ${cpu} other: native wasm-vm boot (another session)`);
    else if (/mediaanalysisd/.test(cmd)) out.push(`${pid} ${ppid} ${cpu} other: mediaanalysisd`);
    else if (/Spotify Helper \(Renderer\)/.test(cmd)) out.push(`${pid} ${ppid} ${cpu} other: Spotify Helper (Renderer)`);
  }
  writeFileSync(f, out.join("\n") + "\n");
}

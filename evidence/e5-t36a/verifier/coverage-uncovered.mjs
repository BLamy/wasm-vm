// Merge V8 block coverage (node NODE_V8_COVERAGE dir, or a Playwright JSCoverage JSON) for the given
// source files and print the source text of every range with count 0.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const [,, input, ...files] = process.argv;
const entries = [];
if (input.endsWith(".json")) entries.push(...JSON.parse(readFileSync(input, "utf8")));
else for (const f of readdirSync(input)) entries.push(...(JSON.parse(readFileSync(path.join(input, f), "utf8")).result ?? []));
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const mine = entries.filter((e) => e.url.endsWith(file.split("/web/")[1]) || e.url.endsWith(file.split("/dist/").pop()));
  if (mine.length === 0) { console.log(`${file}: NOT LOADED`); continue; }
  // per character: max count over all processes, using innermost range semantics per script
  const best = new Int32Array(src.length).fill(-1);
  for (const e of mine) {
    const count = new Int32Array(src.length).fill(-1);
    const ranges = e.functions.flatMap((fn) => fn.ranges).sort((a, b) => (a.startOffset - b.startOffset) || (b.endOffset - a.endOffset));
    for (const r of ranges) for (let i = r.startOffset; i < Math.min(r.endOffset, src.length); i += 1) count[i] = r.count;
    for (let i = 0; i < src.length; i += 1) if (count[i] > best[i]) best[i] = count[i];
  }
  const lineOf = (off) => src.slice(0, off).split("\n").length;
  console.log(`${file}: loaded in ${mine.length} context(s)`);
  let i = 0; let any = false;
  while (i < src.length) {
    if (best[i] === 0) { let j = i; while (j < src.length && best[j] === 0) j += 1; const text = src.slice(i, j).trim(); if (text.length > 1) { any = true; console.log(`  L${lineOf(i)}-${lineOf(j - 1)}: ${text.replace(/\s+/g, " ").slice(0, 150)}`); } i = j; } else i += 1;
  }
  if (!any) console.log("  every block executed");
}

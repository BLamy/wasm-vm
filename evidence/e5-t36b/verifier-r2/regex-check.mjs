// R3: the acceptance's crtc-pos regex (copied verbatim from tools/verify/e5-t36b-hardware-cursor.mjs
// at HEAD, line 41, checked against the file below) vs round 1's, on kernel DRM_RECT_FMT strings.
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../../../tools/verify/e5-t36b-hardware-cursor.mjs", import.meta.url), "utf8");
const line = src.split("\n").find((l) => l.includes('field("crtc-pos")'));
const NEW = new RegExp(/\/(\^.*\$)\//.exec(line)[1]);
const OLD = /^(\d+)x(\d+)\+(-?\d+)\+(-?\d+)$/;
console.log("regex at HEAD:", NEW.source);
const p = (re, s) => { const m = re.exec(s); return m ? m.slice(1).map(Number) : null; };
for (const s of ["64x64-1-1", "64x64+1278-1", "64x64-1+797", "64x64+0+0", "64x64+1278+798", "1280x800+0+0", "64x64-63-63"])
  console.log(s.padEnd(16), "new", JSON.stringify(p(NEW, s)), " old", JSON.stringify(p(OLD, s)));

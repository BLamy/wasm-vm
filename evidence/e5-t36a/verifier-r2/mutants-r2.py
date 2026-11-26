#!/usr/bin/env python3
"""E5-T36a verifier (round 2): mutants of my own against the worker's tests, in a SCRATCH copy only.

  python3 mutants-r2.py SCRATCH
SCRATCH/web/src/sink is a copy of web/src/sink, SCRATCH/web/tests/e5-t36-cursor-hotspot.test.mjs a
copy of the test file. None of these is in evidence/e5-t36a/mutants.py (the worker's 38)."""
import subprocess, sys
S = sys.argv[1]
H = f'{S}/web/src/sink/cursor-hotspot.js'; C = f'{S}/web/src/sink/cursor-controller.js'
M = [
 ("V1 a cursor move does not restart the rest wait", C,
  "      this._diagnostic(\"cursor-hotspot-error\", error);\n    }\n    this._armHotspotRest();\n  }\n\n  /** Show `hot`",
  "      this._diagnostic(\"cursor-hotspot-error\", error);\n    }\n  }\n\n  /** Show `hot`"),
 ("V2 a rest answer keeps the other candidates", H, "    image.candidates = [rest];\n", ""),
 ("V3 a guest reset keeps the output size last seen", C, "    this._pointerOutput = null;\n    try { this._hotspots.reset();", "    try { this._hotspots.reset();"),
 ("V4 a dropped answer stays marked as a rest answer", H, "      image.restSends = -1;\n", ""),
 ("V5 after a drop, inference does not start from the contradicting move", H,
  "      image.candidates = seen.length === 0 ? null : seen;\n      image.moves = seen.length === 0 ? 0 : 1;", "      image.candidates = null;\n      image.moves = 0;"),
 ("V6 an update does not cancel the armed rest wait", C,
  "    this._cssHot = null;\n    this._cancelHotspotRest();\n    // Only a CSS cursor", "    this._cssHot = null;\n    // Only a CSS cursor"),
 ("V7 a known image is installed without its hotspot", C, "      this._cssHot = this._hotspots.hotspot(this._imageKey);\n", ""),
 ("V8 an update does not arm the rest wait", C,
  "      this._diagnostic(\"cursor-hotspot-error\", error);\n    }\n    this._armHotspotRest();\n  }\n\n  /**\n   * Take the estimator's answer",
  "      this._diagnostic(\"cursor-hotspot-error\", error);\n    }\n  }\n\n  /**\n   * Take the estimator's answer"),
 ("V9 starting over leaves the shown hotspot", C, "    this._hotspots.reset();\n    this._setCssHot(null);", "    this._hotspots.reset();"),
 ("V10 starting over leaves the rest wait armed", C, "  resetHotspotInference() {\n    this._cancelHotspotRest();\n", "  resetHotspotInference() {\n"),
 ("V11 rest reads the OLDEST sent position", H, "    const sent = this._sent[this._sent.length - 1];\n    if (!image.last", "    const sent = this._sent[0];\n    if (!image.last"),
 ("V12 an answer does not clear the miss count", H, "    image.misses = 0;\n    return image.resolved;\n  }", "    return image.resolved;\n  }"),
 ("V13 sends are not counted (every rest answer is 'still arriving')", H, "    this._sends += 1;\n", ""),
 ("V14 the rest callback does not re-check that an answer is still wanted", C,
  "      this._restTimer = null;\n      if (this._imageKey === null || this._cssHot !== null || this._mode !== CURSOR_MODES.ABSOLUTE) return;\n", "      this._restTimer = null;\n"),
 ("V15 a guest reset keeps the image being inferred", C, "    this._cancelHotspotRest();\n    this._imageKey = null;\n    this._cssHot = null;\n    this._pointerOutput = null;", "    this._cancelHotspotRest();\n    this._pointerOutput = null;"),
 ("V16 rest needs no move at all (candidates may be null)", H, "    if (!image.last || !sent || image.candidates === null) return null;", "    if (!image.last || !sent) return null;\n    if (image.candidates === null) image.candidates = [{ x: sent.x - image.last.x, y: sent.y - image.last.y }];"),
 ("V17 a move in relative mode is compared (no mode check needed?)", C, "    if (this._imageKey === null) return;\n    try {\n      this._setCssHot(evidence());", "    if (this._imageKey === null || this._mode !== CURSOR_MODES.ABSOLUTE) return;\n    try {\n      this._setCssHot(evidence());"),
 ("V18 the rest wait is 3 s", C, "export const HOTSPOT_REST_MS = 300;", "export const HOTSPOT_REST_MS = 3000;"),
 ("V19 a rest answer is not clamped into the image", H, "    return this._resolve(image, rest, width, height);", "    image.resolved = Object.freeze({ x: rest.x, y: rest.y }); image.misses = 0; return image.resolved;"),
 ("V20 the size passed by the page hook is ignored unless both given (always ignored)", C, "      if (outputWidth !== null && outputHeight !== null) {", "      if (false) {"),
]
killed = 0; survived = []
for name, path, old, new in M:
    src = open(path).read()
    if src.count(old) != 1:
        print(f"{name}: PATTERN x{src.count(old)}"); continue
    ts = path[:-3] + '.ts'; keep_ts = open(ts).read()
    open(path, 'w').write(src.replace(old, new)); open(ts, 'w').write(src.replace(old, new))
    try:
        out = subprocess.run(['node', '--test', '--test-timeout=60000', 'tests/e5-t36-cursor-hotspot.test.mjs'], cwd=f'{S}/web', capture_output=True, text=True)
        failed = sorted(set(l[2:].split(' (')[0] for l in out.stdout.splitlines() if l.startswith('✖ ') and 'failing tests' not in l))
        if failed: killed += 1; print(f"{name}: KILLED by {len(failed)}: {failed[0][:70]}")
        else: survived.append(name); print(f"{name}: SURVIVED")
    finally:
        open(path, 'w').write(src); open(ts, 'w').write(keep_ts)
print(f"TOTAL killed {killed}, survived {len(survived)}: {survived}")

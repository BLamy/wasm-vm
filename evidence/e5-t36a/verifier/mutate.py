# E5-T36a verifier — do the worker's tests notice a changed line? Never run against the checkout:
#   mkdir SCRATCH && git ls-files web/src web/tests/e5-t36-cursor-hotspot.test.mjs \
#       web/tests/e5-t15b-cursor-sink.test.mjs web/tests/e5-t15c-cursor-mode.test.mjs | (copy into SCRATCH)
#   python3 evidence/e5-t36a/verifier/mutate.py SCRATCH evidence/e5-t36a/verifier/mutants.json
# Each mutant is applied to the .js and the .ts copy alike (the projection test compares them).
import json, subprocess, sys, os, shutil
root = sys.argv[1]; sink = os.path.join(root, "web/src/sink")
H, C = "cursor-hotspot", "cursor-controller"
M = [
 (H, "tolerance 1 -> 0", "const DEFAULT_TOLERANCE = 1;", "const DEFAULT_TOLERANCE = 0;"),
 (H, "tolerance 1 -> 2", "const DEFAULT_TOLERANCE = 1;", "const DEFAULT_TOLERANCE = 2;"),
 (H, "confirmations 2 -> 3", "const DEFAULT_CONFIRMATIONS = 2;", "const DEFAULT_CONFIRMATIONS = 3;"),
 (H, "history 128 -> 8", "const DEFAULT_HISTORY = 128;", "const DEFAULT_HISTORY = 8;"),
 (H, "max images 64 -> 2", "const DEFAULT_MAX_IMAGES = 64;", "const DEFAULT_MAX_IMAGES = 2;"),
 (H, "no u32 wrap", "  return number | 0;", "  return number;"),
 (H, "keep repeated sent positions", "    if (last && last.x === point.x && last.y === point.y) return;", "    void last;"),
 (H, "history never trimmed", "    if (this._sent.length > this._history) this._sent.shift();", ""),
 (H, "same-place report counted again", "    if (image.last && image.last.x === plane.x && image.last.y === plane.y) return null;", ""),
 (H, "upper bound loosened (>= -> >)", "candidate.x >= width + slack || candidate.y >= height + slack", "candidate.x > width + slack || candidate.y > height + slack"),
 (H, "no upper bound on candidates", "candidate.x >= width + slack || candidate.y >= height + slack", "false"),
 (H, "no lower bound on candidates", "candidate.x < -slack || candidate.y < -slack ||", ""),
 (H, "lower bound without slack", "candidate.x < -slack || candidate.y < -slack ||", "candidate.x < 0 || candidate.y < 0 ||"),
 (H, "kept by exact match, not near", "image.candidates.filter((candidate) => seen.some((other) => near(candidate, other, this._tolerance)))", "image.candidates.filter((candidate) => seen.some((other) => candidate.x === other.x && candidate.y === other.y))"),
 (H, "no restart when nothing is kept", "      image.candidates = seen;\n      image.moves = 1;\n      return null;", "      return null;"),
 (H, "restart counts as two moves", "      image.moves = 1;\n      return null;", "      image.moves = 2;\n      return null;"),
 (H, "answer after one move", "    if (image.moves < this._confirmations) return null;", ""),
 (H, "answer with several clusters left", "    if (!kept.every((candidate) => near(candidate, first, this._tolerance))) return null;", ""),
 (H, "answer the last candidate, not the first", "    const first = kept[0];", "    const first = kept[kept.length - 1];"),
 (H, "no clamp into the image", "      x: Math.min(width - 1, Math.max(0, first.x)),\n      y: Math.min(height - 1, Math.max(0, first.y)),", "      x: first.x,\n      y: first.y,"),
 (H, "resolved image re-inferred", "    if (image.resolved) return image.resolved;", ""),
 (H, "eviction keeps one too few (> -> >=)", "while (this._images.size > this._maxImages)", "while (this._images.size >= this._maxImages)"),
 (H, "no eviction", "      while (this._images.size > this._maxImages) this._images.delete(this._images.keys().next().value);", ""),
 (H, "forget(key) does nothing", "      this._images.delete(key);", ""),
 (C, "inferred hotspot never used in the CSS cursor", "this._setHostCursor(this._cssHot\n        ? cssCursorDescriptor(descriptor.dataUrl, this._cssHot.x, this._cssHot.y, descriptor.width, descriptor.height)\n        : descriptor.css);", "this._setHostCursor(descriptor.css);"),
 (C, "a device-reported hotspot is second-guessed", "if (descriptor?.kind !== \"css\" || state.hotX !== 0 || state.hotY !== 0) return;", "if (descriptor?.kind !== \"css\") return;"),
 (C, "overlay cursors inferred too", "if (descriptor?.kind !== \"css\" || state.hotX !== 0 || state.hotY !== 0) return;", "if (state.hotX !== 0 || state.hotY !== 0) return;"),
 (C, "update does not reset the inferred hotspot", "    this._imageKey = null;\n    this._cssHot = null;\n    // Only a CSS cursor", "    this._imageKey = null;\n    // Only a CSS cursor"),
 (C, "known image not recognised at once", "    this._cssHot = this._hotspots.hotspot(this._imageKey);", "    this._cssHot = null;"),
 (C, "update's own position not fed", "    if (this._cssHot === null) this._inferHotspot(state);", ""),
 (C, "style applied on every move", "if (this._imageKey !== null && this._cssHot === null && this._inferHotspot(state)) {", "if (this._imageKey !== null && (this._cssHot !== null || this._inferHotspot(state))) {"),
 (C, "moves never infer", "if (this._imageKey !== null && this._cssHot === null && this._inferHotspot(state)) {", "if (false) {"),
 (C, "(0,0) answer treated as a hotspot", "if (hot === null || (hot.x === 0 && hot.y === 0)) return false;", "if (hot === null) return false;"),
 (C, "notePointer dropped", "try { this._hotspots.notePointer(x, y); }", "try { void x; void y; }"),
 (C, "snapshot does not report the inferred hotspot", "      inferredHotX: this._cssHot?.x ?? null,", "      inferredHotX: null,"),
]
tests = ["tests/e5-t36-cursor-hotspot.test.mjs", "tests/e5-t15b-cursor-sink.test.mjs", "tests/e5-t15c-cursor-mode.test.mjs"]
def run():
    p = subprocess.run(["node", "--test", *tests], cwd=os.path.join(root, "web"), capture_output=True, text=True, timeout=300)
    failing = [l[2:].rsplit(" (", 1)[0] for l in p.stdout.splitlines() if l.startswith("✖ ")]
    return p.returncode, sorted(set(failing))
orig = {n: {ext: open(os.path.join(sink, f"{n}.{ext}")).read() for ext in ("js", "ts")} for n in (H, C)}
rc, failing = run(); assert rc == 0, ("baseline must pass", failing)
out = []
for name, label, old, new in M:
    src = orig[name]["js"]; assert src.count(old) == 1, (label, src.count(old))
    for ext in ("js", "ts"): open(os.path.join(sink, f"{name}.{ext}"), "w").write(orig[name][ext].replace(old, new))
    try: rc, failing = run()
    except subprocess.TimeoutExpired: rc, failing = -1, ["TIMEOUT"]
    for ext in ("js", "ts"): open(os.path.join(sink, f"{name}.{ext}"), "w").write(orig[name][ext])
    out.append({"file": f"web/src/sink/{name}.js", "mutant": label, "noticed": rc != 0, "failing": failing[:3]})
    print(("NOTICED " if rc != 0 else "SURVIVED"), name, "|", label, "|", "; ".join(failing[:2]), flush=True)
rc, failing = run(); assert rc == 0
json.dump({"tests": tests, "mutants": len(out), "noticed": sum(o["noticed"] for o in out), "survived": [o for o in out if not o["noticed"]], "all": out}, open(sys.argv[2], "w"), indent=1)
print(f"{sum(o['noticed'] for o in out)}/{len(out)} noticed")

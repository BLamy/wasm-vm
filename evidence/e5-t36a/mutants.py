import subprocess, shutil, os, sys
S=sys.argv.pop(1)  # a scratch copy: DIR/web/src/sink (from web/src/sink) and DIR/web/tests/e5-t36-cursor-hotspot.test.mjs
H=f'{S}/web/src/sink/cursor-hotspot.js'; C=f'{S}/web/src/sink/cursor-controller.js'
M=[
 ("H1 history never trimmed", H, "    if (this._sent.length > this._history) this._sent.shift();\n", ""),
 ("H2 candidate upper bound off by one (x)", H, "x >= width + slack || y >= height + slack", "x > width + slack || y >= height + slack"),
 ("H3 candidate lower bound ignores slack", H, "if (x < -slack || y < -slack ||", "if (x < 0 || y < 0 ||"),
 ("H4 no restart when no candidate survives", H, "    if (kept.length === 0) {\n      // The history no longer reaches the moves these candidates came from: start again here.\n      image.candidates = seen;\n      image.moves = 1;\n      return null;\n    }\n", "    if (kept.length === 0) return null;\n"),
 ("H5 resolve without clamping", H, "      x: Math.min(width - 1, Math.max(0, candidate.x)),\n      y: Math.min(height - 1, Math.max(0, candidate.y)),", "      x: candidate.x,\n      y: candidate.y,"),
 ("H6 answers with one move", H, "    if (image.moves < this._confirmations) return null;\n", ""),
 ("H7 answers although several clusters remain", H, "    if (!kept.every((candidate) => near(candidate, first, this._tolerance))) return null;\n", ""),
 ("H8 contradiction never drops an answer", H, "        if (image.misses < this._contradictions) return image.resolved;", "        return image.resolved;"),
 ("H9 one contradiction drops an answer", H, "        if (image.misses < this._contradictions) return image.resolved;", "        if (image.misses < 1) return image.resolved;"),
 ("H10 explained move does not reset the miss count", H, "          image.misses = 0;\n          return image.resolved;\n        }\n        // Nothing recent", "          return image.resolved;\n        }\n        // Nothing recent"),
 ("H11 unexplainable position counts as a contradiction", H, "        if (seen.length === 0) return image.resolved;\n", ""),
 ("H12 a rest answer survives the plane moving again", H, "      const stillArriving = image.restSends === this._sends;", "      const stillArriving = false;"),
 ("H13 rest ignores the candidates", H, "    if (!image.candidates.some((candidate) => near(candidate, rest, this._tolerance))) return null;\n", ""),
 ("H14 rest without a move since install", H, "    if (image) image.last = null;", "    if (image) image.last = image.last;"),
 ("H16 images never evicted", H, "      while (this._images.size > this._maxImages) this._images.delete(this._images.keys().next().value);\n", ""),
 ("H17 reset keeps the sent positions", H, "    this._images.clear();\n    this._sent.length = 0;", "    this._images.clear();"),
 ("H18 reset keeps the images", H, "    this._images.clear();\n    this._sent.length = 0;", "    this._sent.length = 0;"),
 ("H19 duplicate sends are recorded", H, "    if (last && last.x === point.x && last.y === point.y) return;\n", ""),
 ("H20 a repeated plane position is evidence again", H, "    if (image.last && image.last.x === plane.x && image.last.y === plane.y) return image.resolved;\n", ""),
 ("H21 tolerance of near is doubled", H, "  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;", "  return Math.abs(a.x - b.x) <= 2 * tolerance + 1 && Math.abs(a.y - b.y) <= 2 * tolerance + 1;"),
 ("H22 plane positions not wrapped to int32", H, "  return number | 0;", "  return number;"),
 ("C1 the update's position is evidence again", C, "      this._cssHot = this._hotspots.hotspot(this._imageKey);\n    } catch (error) {\n      this._diagnostic(\"cursor-hotspot-error\", error);\n    }\n    this._armHotspotRest();\n  }", "      this._cssHot = this._hotspots.hotspot(this._imageKey);\n      if (this._cssHot === null) this._cssHot = this._hotspots.noteMove(this._imageKey, descriptor.width, descriptor.height, state.x, state.y);\n    } catch (error) {\n      this._diagnostic(\"cursor-hotspot-error\", error);\n    }\n    this._armHotspotRest();\n  }"),
 ("C2 a device-reported hotspot is second-guessed", C, "if (descriptor?.kind !== \"css\" || state.hotX !== 0 || state.hotY !== 0) return;", "if (descriptor?.kind !== \"css\") return;"),
 ("C3 positions are noted in relative mode", C, "    if (this._disposed || this._mode !== CURSOR_MODES.ABSOLUTE) return;\n    try {", "    if (this._disposed) return;\n    try {"),
 ("C3b rest is waited for in relative mode", C, "    if (this._imageKey === null || this._cssHot !== null || this._mode !== CURSOR_MODES.ABSOLUTE) return;\n    const timer", "    if (this._imageKey === null || this._cssHot !== null) return;\n    const timer"),
 ("C4 a mode change keeps what was inferred", C, "      this._mode = mode;\n      this.resetHotspotInference();", "      this._mode = mode;"),
 ("C5 an output size change keeps what was inferred", C, "        if (previous && (previous.width !== outputWidth || previous.height !== outputHeight)) this.resetHotspotInference();\n", ""),
 ("C6 every install forgets the plane position (same image too)", C, "      if (previousKey !== this._imageKey) this._hotspots.noteInstall(this._imageKey);", "      this._hotspots.noteInstall(this._imageKey);"),
 ("C7 no install note on an image change", C, "      if (previousKey !== this._imageKey) this._hotspots.noteInstall(this._imageKey);", ""),
 ("C8 the rest timer is never armed", C, "    const timer = this._setTimer(() => {", "    return; const timer = this._setTimer(() => {"),
 ("C9 a stale rest callback acts", C, "      if (this._restTimer !== timer || this._disposed) return;", "      if (this._disposed) return;"),
 ("C10 rest is waited for although the hotspot is known", C, "    if (this._imageKey === null || this._cssHot !== null || this._mode !== CURSOR_MODES.ABSOLUTE) return;\n    const timer", "    if (this._imageKey === null || this._mode !== CURSOR_MODES.ABSOLUTE) return;\n    const timer"),
 ("C11 a changed answer is not shown", C, "    this._cssHot = hot;\n    this._applySafely(\"cursor-hotspot-dom-error\");", "    this._cssHot = hot;"),
 ("C12 an unchanged answer writes the style again", C, "    if ((hot === null && now === null) || (hot !== null && now !== null && hot.x === now.x && hot.y === now.y)) return;\n", ""),
 ("C13 a guest reset keeps the estimator", C, "    try { this._hotspots.reset(); } catch (error) { this._diagnostic(\"cursor-hotspot-error\", error); }\n", ""),
 ("C14 dispose leaves the rest timer armed", C, "    // A reset guest starts with no cursor history; nothing inferred before applies to it.\n    this._cancelHotspotRest();\n", "    // A reset guest starts with no cursor history; nothing inferred before applies to it.\n"),
 ("C15 sends do not restart the rest wait", C, "      this._hotspots.notePointer(x, y);\n      this._armHotspotRest();", "      this._hotspots.notePointer(x, y);"),
 ("C16 the inferred hotspot is not used in the CSS cursor", C, "      this._setHostCursor(this._cssHot\n", "      this._setHostCursor(false\n"),
]
only=sys.argv[1:]; killed=0; survived=[]
for name,path,old,new in M:
    if only and not any(name.startswith(o+' ') for o in only): continue
    src=open(path).read()
    if src.count(old)!=1: print(f"{name}: PATTERN x{src.count(old)}"); continue
    ts=path[:-3]+'.ts'; keep_ts=open(ts).read()
    open(path,'w').write(src.replace(old,new)); open(ts,'w').write(src.replace(old,new))
    try:
        out=subprocess.run(['node','--test','--test-timeout=60000','tests/e5-t36-cursor-hotspot.test.mjs'],cwd=f'{S}/web',capture_output=True,text=True)
        failed=[l[2:].split(' (')[0] for l in out.stdout.splitlines() if l.startswith('✖ ') and 'failing tests' not in l]
        failed=sorted(set(failed))
        if failed: killed+=1; print(f"{name}: KILLED by {len(failed)}: {failed[0][:70]}")
        else: survived.append(name); print(f"{name}: SURVIVED")
    finally:
        open(path,'w').write(src); open(ts,'w').write(keep_ts)
print(f"TOTAL killed {killed}, survived {len(survived)}: {survived}")

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
 ("H8 contradiction never drops an answer", H, "      if (image.misses < this._contradictions) return image.resolved;", "      return image.resolved;"),
 ("H9 one contradiction drops an answer", H, "      if (image.misses < this._contradictions) return image.resolved;", "      if (image.misses < 1) return image.resolved;"),
 ("H10 explained move does not reset the miss count", H, "        image.misses = 0;\n        return image.resolved;\n      }\n      // Nothing recent", "        return image.resolved;\n      }\n      // Nothing recent"),
 ("H11 unexplainable position counts as a contradiction", H, "      if (seen.length === 0) return image.resolved;\n", ""),
 ("H12 after a drop, inference does not start from the contradicting move", H, "      image.candidates = seen;\n      image.moves = 1;\n      return null;\n    }\n\n    if (seen.length === 0) return null;", "      image.candidates = null;\n      image.moves = 0;\n      return null;\n    }\n\n    if (seen.length === 0) return null;"),
 ("H13 rest ignores the candidates", H, "    if (!image.candidates.some((candidate) => near(candidate, rest, this._tolerance))) return null;\n", ""),
 ("H14 rest without a move since install", H, "    if (image) image.last = null;", "    if (image) image.last = image.last;"),
 ("H15 rest with no candidates at all", H, "    if (!image.last || !sent || image.candidates === null) return null;", "    if (!image.last || !sent) return null;\n    image.candidates ??= [{ x: sent.x - image.last.x, y: sent.y - image.last.y }];"),
 ("H16 images never evicted", H, "      while (this._images.size > this._maxImages) this._images.delete(this._images.keys().next().value);\n", ""),
 ("H17 reset keeps the sent positions", H, "    this._images.clear();\n    this._sent.length = 0;", "    this._images.clear();"),
 ("H18 reset keeps the images", H, "    this._images.clear();\n    this._sent.length = 0;", "    this._sent.length = 0;"),
 ("H19 duplicate sends are counted", H, "    if (last && last.x === point.x && last.y === point.y) return;\n", ""),
 ("H20 a repeated plane position is evidence again", H, "    if (image.last && image.last.x === plane.x && image.last.y === plane.y) return image.resolved;\n", ""),
 ("H21 tolerance of near is doubled", H, "  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;", "  return Math.abs(a.x - b.x) <= 2 * tolerance + 1 && Math.abs(a.y - b.y) <= 2 * tolerance + 1;"),
 ("H22 plane positions not wrapped to int32", H, "  return number | 0;", "  return number;"),
 ("H23 rest reads the oldest sent position", H, "    const sent = this._sent[this._sent.length - 1];\n    if (!image.last", "    const sent = this._sent[0];\n    if (!image.last"),
 ("H24 a rest answer is not clamped", H, "    image.candidates = [rest];\n    return this._resolve(image, rest, width, height);", "    image.candidates = [rest];\n    image.resolved = Object.freeze({ x: rest.x, y: rest.y });\n    return image.resolved;"),
 ("H25 sends are not counted", H, "    this._sends += 1;\n", ""),
 ("C1 the update's position is evidence again", C, "      this._cssHot = this._hotspots.hotspot(this._imageKey);\n    } catch (error) {\n      this._diagnostic(\"cursor-hotspot-error\", error);\n    }\n    this._armHotspotRest();\n  }", "      this._cssHot = this._hotspots.hotspot(this._imageKey);\n      if (this._cssHot === null) this._cssHot = this._hotspots.noteMove(this._imageKey, descriptor.width, descriptor.height, state.x, state.y);\n    } catch (error) {\n      this._diagnostic(\"cursor-hotspot-error\", error);\n    }\n    this._armHotspotRest();\n  }"),
 ("C2 a device-reported hotspot is second-guessed", C, "if (descriptor?.kind !== \"css\" || state.hotX !== 0 || state.hotY !== 0) return;", "if (descriptor?.kind !== \"css\") return;"),
 ("C3 positions are noted in relative mode", C, "    if (this._disposed || this._mode !== CURSOR_MODES.ABSOLUTE) return;\n    try {", "    if (this._disposed) return;\n    try {"),
 ("C4 a mode change does not restart the evidence", C, "      this._mode = mode;\n      this._restartHotspotInference(false);", "      this._mode = mode;"),
 ("C5 an output size change does not restart the evidence", C, "        if (previous && (previous.width !== outputWidth || previous.height !== outputHeight)) this._restartHotspotInference(false);\n", ""),
 ("C4b a mode or size change forgets settled hotspots", C, "      if (forget) this._hotspots.reset(); else this._hotspots.restart();", "      this._hotspots.reset();"),
 ("C4c the explicit reset keeps settled hotspots", C, "      if (forget) this._hotspots.reset(); else this._hotspots.restart();", "      this._hotspots.restart();"),
 ("H26 restart keeps unsettled images", H, "      if (!image.resolved) { this._images.delete(key); continue; }", "      if (!image.resolved) continue;"),
 ("H27 restart keeps the sent positions", H, "  restart() {\n    this._sent.length = 0;", "  restart() {"),
 ("H28 restart keeps the miss count of a settled image", H, "      image.candidates = [image.resolved];\n      image.misses = 0;\n    }\n  }\n\n  /** Forget everything", "      image.candidates = [image.resolved];\n    }\n  }\n\n  /** Forget everything"),
 ("C6 every install forgets the plane position (same image too)", C, "      if (previousKey !== this._imageKey) this._hotspots.noteInstall(this._imageKey);", "      this._hotspots.noteInstall(this._imageKey);"),
 ("C7 no install note on an image change", C, "      if (previousKey !== this._imageKey) this._hotspots.noteInstall(this._imageKey);", ""),
 ("C8 the rest wait is never armed", C, "    const timer = this._setTimer(() => {\n      if (this._restTimer !== timer || this._disposed) return;", "    return; const timer = this._setTimer(() => {\n      if (this._restTimer !== timer || this._disposed) return;"),
 ("C9 a stale rest callback acts", C, "      if (this._restTimer !== timer || this._disposed) return;", "      if (this._disposed) return;"),
 ("C10 rest is waited for although the hotspot is known", C, "    if (this._imageKey === null || this._cssHot !== null || this._hotspotSettling ||", "    if (this._imageKey === null || this._hotspotSettling ||"),
 ("C11 a changed answer is not shown", C, "    this._cssHot = hot;\n    this._applySafely(\"cursor-hotspot-dom-error\");", "    this._cssHot = hot;"),
 ("C12 an unchanged answer writes the style again (the setter skips it: nothing observable)", C, "    if ((hot === null && now === null) || (hot !== null && now !== null && hot.x === now.x && hot.y === now.y)) return;\n", ""),
 ("C13 a guest reset keeps the estimator", C, "    this._pointerOutput = null;\n    try { this._hotspots.reset(); } catch (error) { this._diagnostic(\"cursor-hotspot-error\", error); }\n", "    this._pointerOutput = null;\n"),
 ("C14 a guest reset leaves waits in flight", C, "    // A reset guest starts with no cursor history and nothing of ours still on its way to it.\n    this._endHotspotWaits();\n", "    // A reset guest starts with no cursor history and nothing of ours still on its way to it.\n"),
 ("C15 sends do not restart the rest wait", C, "      this._hotspots.notePointer(x, y);\n      this._armHotspotRest();", "      this._hotspots.notePointer(x, y);"),
 ("C16 the inferred hotspot is not used in the CSS cursor", C, "      this._setHostCursor(this._cssHot\n", "      this._setHostCursor(false\n"),
 ("C17 rest answers on quiet alone (the guest is not asked)", C, "    if ((await this._guestCaughtUp(epoch)) !== true) return;", "    await null;"),
 ("C18 rest answers although a position was sent while the guest was asked", C, "      if (this._hotspots.sends !== sends) return;\n", ""),
 ("C19 caught up on the first reading (no later idle wait needed)", C, "      if (now > first) return true;", "      if (now >= first) return true;"),
 ("C20 a restart does not wait for the guest to catch up", C, "    this._hotspotSettling = true;\n    this._setCssHot(hot);", "    this._hotspotSettling = false;\n    this._setCssHot(hot);"),
 ("C21 moves are evidence while settling", C, "      if (!this._hotspotSettling) {\n        this._inferHotspot(", "      if (true) {\n        this._inferHotspot("),
 ("C22 settling never ends without an idle counter", C, "      if (caughtUp === null) break;", "      if (caughtUp === null) return;"),
 ("C23 no fallback wait without an idle counter", C, "      if (caughtUp === null && !(await this._hotspotWait(HOTSPOT_SETTLE_FALLBACK_MS))) return;\n", ""),
 ("C24 a guest never idle is asked only once after a restart", C, "      if (caughtUp === true) break;", "      if (caughtUp !== null) break;"),
 ("C25 a rest wait is armed without an idle counter", C, " ||\n        this._mode !== CURSOR_MODES.ABSOLUTE || typeof this._guestIdleCount !== \"function\") return;", " ||\n        this._mode !== CURSOR_MODES.ABSOLUTE) return;"),
 ("C26 a restart keeps the shown hotspot", C, "    this._hotspotSettling = true;\n    this._setCssHot(hot);", "    this._hotspotSettling = true;"),
 ("C27 a restart leaves the old epoch's waits running", C, "  _restartHotspotInference(forget) {\n    this._endHotspotWaits();", "  _restartHotspotInference(forget) {\n    this._cancelHotspotRest();"),
 ("C28 a guest reset stays in settling", C, "    this._endHotspotWaits();\n    this._hotspotSettling = false;\n    this._imageKey = null;", "    this._endHotspotWaits();\n    this._imageKey = null;"),
 ("C29 a known image is installed without its hotspot", C, "      this._cssHot = this._hotspots.hotspot(this._imageKey);\n    } catch (error) {", "    } catch (error) {"),
 ("C30 the guest is asked for one poll only", C, "    for (let waited = 0; waited < HOTSPOT_CAUGHT_UP_TIMEOUT_MS; waited += HOTSPOT_POLL_MS) {", "    for (let waited = 0; waited < HOTSPOT_POLL_MS; waited += HOTSPOT_POLL_MS) {"),
 ("C31 an update does not arm the rest wait", C, "      this._diagnostic(\"cursor-hotspot-error\", error);\n    }\n    this._armHotspotRest();\n  }\n\n  /**\n   * Take the estimator", "      this._diagnostic(\"cursor-hotspot-error\", error);\n    }\n  }\n\n  /**\n   * Take the estimator"),
]
only=sys.argv[1:]; killed=0; survived=[]
for name,path,old,new in M:
    if only and not any(name.startswith(o+' ') for o in only): continue
    src=open(path).read()
    if src.count(old)!=1: print(f"{name}: PATTERN x{src.count(old)}"); continue
    ts=path[:-3]+'.ts'; keep_ts=open(ts).read()
    open(path,'w').write(src.replace(old,new)); open(ts,'w').write(src.replace(old,new))
    try:
        out=subprocess.run(['node','--test','--test-timeout=120000','tests/e5-t36-cursor-hotspot.test.mjs'],cwd=f'{S}/web',capture_output=True,text=True)
        failed=[l[2:].split(' (')[0] for l in out.stdout.splitlines() if l.startswith('✖ ') and 'failing tests' not in l]
        failed=sorted(set(failed))
        if failed: killed+=1; print(f"{name}: KILLED by {len(failed)}: {failed[0][:70]}")
        else: survived.append(name); print(f"{name}: SURVIVED")
    finally:
        open(path,'w').write(src); open(ts,'w').write(keep_ts)
print(f"TOTAL killed {killed}, survived {len(survived)}: {survived}")

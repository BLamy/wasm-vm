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
 ("H17 reset keeps the sent positions", H, "  reset() {\n    this._images.clear();\n    this._sent.length = 0;", "  reset() {\n    this._images.clear();"),
 ("H18 reset keeps the images", H, "  reset() {\n    this._images.clear();\n    this._sent.length = 0;", "  reset() {\n    this._sent.length = 0;"),
 ("H29 forget forgets the sent positions too (round 3's hole, in the estimator)", H, "  forget() {\n    this._images.clear();", "  forget() {\n    this._images.clear();\n    this._sent.length = 0;"),
 ("H30 forget keeps settled images", H, "  forget() {\n    this._images.clear();", "  forget() {\n    for (const [key, image] of this._images) if (!image.resolved) this._images.delete(key);"),
 ("H19 duplicate sends are counted", H, "    if (last && last.x === point.x && last.y === point.y) return;\n", ""),
 ("H20 a repeated plane position is evidence again", H, "    if (image.last && image.last.x === plane.x && image.last.y === plane.y) return image.resolved;\n", ""),
 ("H21 tolerance of near is doubled", H, "  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;", "  return Math.abs(a.x - b.x) <= 2 * tolerance + 1 && Math.abs(a.y - b.y) <= 2 * tolerance + 1;"),
 ("H22 plane positions not wrapped to int32", H, "  return number | 0;", "  return number;"),
 ("H23 rest reads the oldest sent position", H, "    const sent = this._sent[this._sent.length - 1];\n    if (!image.last", "    const sent = this._sent[0];\n    if (!image.last"),
 ("H24 a rest answer is not clamped", H, "    return this._resolve(image, rest, width, height);", "    image.resolved = Object.freeze({ x: rest.x, y: rest.y });\n    return image.resolved;"),
 ("H25 sends are not counted", H, "    this._sends += 1;\n", ""),
 ("C1 the update's position is evidence again", C, "      this._cssHot = this._hotspots.hotspot(this._imageKey);\n    } catch (error) {\n      this._diagnostic(\"cursor-hotspot-error\", error);\n    }\n    this._armHotspotRest();\n  }", "      this._cssHot = this._hotspots.hotspot(this._imageKey);\n      if (this._cssHot === null) this._cssHot = this._hotspots.noteMove(this._imageKey, descriptor.width, descriptor.height, state.x, state.y);\n    } catch (error) {\n      this._diagnostic(\"cursor-hotspot-error\", error);\n    }\n    this._armHotspotRest();\n  }"),
 ("C2 a device-reported hotspot is second-guessed", C, "if (descriptor?.kind !== \"css\" || state.hotX !== 0 || state.hotY !== 0) return;", "if (descriptor?.kind !== \"css\") return;"),
 ("C3 positions are noted in relative mode", C, "    if (this._disposed || this._mode !== CURSOR_MODES.ABSOLUTE) return;\n    try {", "    if (this._disposed) return;\n    try {"),
 ("C4 a mode change does not restart the evidence", C, "      this._mode = mode;\n      this._restartHotspotInference();", "      this._mode = mode;"),
 ("C5 an output size change does not restart the evidence", C, "        if (previous && (previous.width !== outputWidth || previous.height !== outputHeight)) this._restartHotspotInference();\n", ""),
 ("C4b a mode or size change forgets settled hotspots", C, "      this._hotspots.restart();", "      this._hotspots.reset();"),
 ("C4c the hook keeps settled hotspots (and forgets the positions)", C, "      this._hotspots.forget();", "      this._hotspots.restart();"),
 ("C4d the hook forgets the positions too (round 3's hole)", C, "      this._hotspots.forget();", "      this._hotspots.reset();"),
 ("C4e the hook leaves the old answer on the page", C, "    // (Nothing is known about the image shown until its plane is reported again.)\n    this._setCssHot(null);", "    // (Nothing is known about the image shown until its plane is reported again.)"),
 ("H26 restart keeps unsettled images", H, "      if (!image.resolved) { this._images.delete(key); continue; }", "      if (!image.resolved) continue;"),
 ("H27 restart keeps the sent positions", H, "  restart() {\n    this._sent.length = 0;", "  restart() {"),
 ("H28 restart keeps the miss count of a settled image", H, "      if (!image.resolved) { this._images.delete(key); continue; }\n      image.misses = 0;", "      if (!image.resolved) { this._images.delete(key); continue; }"),
 ("C6 every install forgets the plane position (same image too)", C, "      if (previousKey !== this._imageKey) this._hotspots.noteInstall(this._imageKey);", "      this._hotspots.noteInstall(this._imageKey);"),
 ("C7 no install note on an image change", C, "      if (previousKey !== this._imageKey) this._hotspots.noteInstall(this._imageKey);", ""),
 ("C8 the rest wait is never armed", C, "    const timer = this._setTimer(() => {\n      if (this._restTimer !== timer) return;", "    return; const timer = this._setTimer(() => {\n      if (this._restTimer !== timer) return;"),
 ("C9 a stale rest callback acts", C, "      if (this._restTimer !== timer) return;\n", ""),
 ("C10 rest is waited for although the hotspot is known", C, "    if (this._imageKey === null || this._cssHot !== null || this._hotspotSettling) return;", "    if (this._imageKey === null || this._hotspotSettling) return;"),
 ("C10b a rest wait is armed while settling", C, "    if (this._imageKey === null || this._cssHot !== null || this._hotspotSettling) return;", "    if (this._imageKey === null || this._cssHot !== null) return;"),
 ("C11 a changed answer is not shown", C, "    this._cssHot = hot;\n    this._applySafely(\"cursor-hotspot-dom-error\");", "    this._cssHot = hot;"),
 ("C12 an unchanged answer writes the style again (the setter skips it: nothing observable)", C, "    if ((hot === null && now === null) || (hot !== null && now !== null && hot.x === now.x && hot.y === now.y)) return;\n", ""),
 ("C13 a guest reset keeps the estimator", C, "    this._lastPointer = null;\n    try { this._hotspots.reset(); } catch (error) { this._diagnostic(\"cursor-hotspot-error\", error); }\n", "    this._lastPointer = null;\n"),
 ("C14 a guest reset leaves waits in flight", C, "    // page has never sent it.\n    this._endHotspotWaits();\n", "    // page has never sent it.\n"),
 ("C15 sends do not restart the rest wait", C, "      if (!this._hotspotSettling) this._armHotspotRest();\n      // A remembered position the guest acts on is on its way to it: now it can be asked.\n      else if (acted) this._settleHotspots();", "      if (this._hotspotSettling && acted) this._settleHotspots();"),
 ("C15b a position sent while settling does not have the guest asked", C, "      else if (acted) this._settleHotspots();", ""),
 ("C43 a position that repeats the one before it counts as acted on (round 4's rule)", C, "      else if (acted) this._settleHotspots();", "      else this._settleHotspots();"),
 ("C44 the first position of a page or after a guest reset counts as acted on", C, "      const acted = last !== null && last.width === now.width && last.height === now.height &&\n        (last.x !== now.x || last.y !== now.y);", "      const acted = last === null || (last.width === now.width && last.height === now.height &&\n        (last.x !== now.x || last.y !== now.y));"),
 ("C45 a position at another output size is compared by its pixel all the same", C, "      const acted = last !== null && last.width === now.width && last.height === now.height &&\n        (last.x !== now.x || last.y !== now.y);", "      const acted = last !== null &&\n        (last.x !== now.x || last.y !== now.y);"),
 ("C46 a guest reset keeps the old guest's last position", C, "    this._pointerOutput = null;\n    this._lastPointer = null;\n    try { this._hotspots.reset(); }", "    this._pointerOutput = null;\n    try { this._hotspots.reset(); }"),
 ("C47 starting over forgets the last position sent (the first after it is never asked about)", C, "    this._hotspotSettling = true;\n  }\n\n  /**\n   * While settling, and with a position sent since it began that the guest acts on", "    this._hotspotSettling = true;\n    this._lastPointer = null;\n  }\n\n  /**\n   * While settling, and with a position sent since it began that the guest acts on"),
 ("C48 only x is compared: a position straight above or below the last one does not count", C, "        (last.x !== now.x || last.y !== now.y);", "        (last.x !== now.x);"),
 ("C49 the hook ends the page's settling (the verifier's M23)", C, "    // (Nothing is known about the image shown until its plane is reported again.)\n    this._setCssHot(null);", "    // (Nothing is known about the image shown until its plane is reported again.)\n    this._hotspotSettling = false;\n    this._setCssHot(null);"),
 ("C50 a count that changed at all, also downwards, is an idle wait (the verifier's M6)", C, "      if (now > first) return true;", "      if (now !== first) return true;"),
 ("C51 an output-size change restarts only when the height changed (the verifier's M17b)", C, "(previous.width !== outputWidth || previous.height !== outputHeight)) this._restartHotspotInference();", "(previous.height !== outputHeight)) this._restartHotspotInference();"),
 ("C52 the position that carries an output-size change is noted before the restart (the verifier's M1; no longer behaviour: that position never ends settling)", C, "        if (previous && (previous.width !== outputWidth || previous.height !== outputHeight)) this._restartHotspotInference();\n        this._pointerOutput = { width: outputWidth, height: outputHeight };\n      }\n      this._hotspots.notePointer(x, y);", "        if (previous && (previous.width !== outputWidth || previous.height !== outputHeight)) { this._hotspots.notePointer(x, y); this._restartHotspotInference(); }\n        this._pointerOutput = { width: outputWidth, height: outputHeight };\n      }\n      this._hotspots.notePointer(x, y);"),
 ("C16 the inferred hotspot is not used in the CSS cursor", C, "      this._setHostCursor(this._cssHot\n", "      this._setHostCursor(false\n"),
 ("C17 rest answers on quiet alone (the guest is not asked)", C, "    if ((await this._guestCaughtUp(epoch)) !== true) return;", "    await null;"),
 ("C18 rest answers although a position was sent while the guest was asked", C, "      if (this._hotspots.sends !== sends) return;\n", ""),
 ("C19 caught up on the first reading (no later idle wait needed)", C, "      if (now > first) return true;", "      if (now >= first) return true;"),
 ("C20 a restart does not wait for the guest to catch up", C, "      this._diagnostic(\"cursor-hotspot-error\", error);\n    }\n    this._hotspotSettling = true;\n  }", "      this._diagnostic(\"cursor-hotspot-error\", error);\n    }\n  }"),
 ("C21 moves are evidence while settling", C, "      if (!this._hotspotSettling) {\n        this._inferHotspot(", "      if (true) {\n        this._inferHotspot("),
 ("C22 settling ends when there is no counter to ask", C, "      if (caughtUp === true) break;", "      if (caughtUp !== false) break;"),
 ("C23 a counter that says nothing is asked again after one poll, not two seconds", C, "      if (caughtUp === null && !(await this._hotspotWait(HOTSPOT_CAUGHT_UP_TIMEOUT_MS))) return;", "      if (caughtUp === null && !(await this._hotspotWait(HOTSPOT_POLL_MS))) return;"),
 ("C24 a guest never idle within the timeout is asked only once", C, "      if (caughtUp === true) break;", "      if (caughtUp === false) return;\n      if (caughtUp === true) break;"),
 ("C25 without a counter function the guest is asked all the same", C, "    if (this._settleEpoch === epoch || typeof this._guestIdleCount !== \"function\") return;", "    if (this._settleEpoch === epoch) return;"),
 ("C32 the page starts settled", C, "    this._hotspotSettling = true;\n    // The epoch whose settling question", "    this._hotspotSettling = false;\n    // The epoch whose settling question"),
 ("C33 every position sent while settling starts a loop of questions", C, "    if (this._settleEpoch === epoch || typeof this._guestIdleCount !== \"function\") return;", "    if (typeof this._guestIdleCount !== \"function\") return;"),
 ("C34 a question of the epoch before ends settling", C, "      const caughtUp = await this._guestCaughtUp(epoch);\n      if (epoch !== this._hotspotEpoch) return;\n      if (caughtUp === true) break;", "      const caughtUp = await this._guestCaughtUp(epoch);\n      if (caughtUp === true) break;"),
 ("C35 a question of the epoch before goes on polling", C, "      if (epoch !== this._hotspotEpoch || !(await this._hotspotWait(HOTSPOT_POLL_MS))) return false;", "      if (!(await this._hotspotWait(HOTSPOT_POLL_MS))) return false;"),
 ("C36 the guest is asked at the restart, before a position was sent (round 3's rule)", C, "      this._diagnostic(\"cursor-hotspot-error\", error);\n    }\n    this._hotspotSettling = true;\n  }", "      this._diagnostic(\"cursor-hotspot-error\", error);\n    }\n    this._hotspotSettling = true;\n    this._settleHotspots();\n  }"),
 ("C37 a rest answer is given to whatever image is shown when the guest answers", C, "    if (key !== this._imageKey) return;\n", ""),
 ("C38 a wait that was ended counts as elapsed", C, "    for (const wait of this._waits) { this._clearTimer(wait.timer); wait.resolve(false); }", "    for (const wait of this._waits) { this._clearTimer(wait.timer); wait.resolve(true); }"),
 ("C42 a move that hides the cursor leaves the wait for the image it replaced", C, "        this._trackHotspot(state, null); // no image: nothing to infer for or to wait for\n", ""),
 ("C41 starting over does not start a new epoch", C, "    this._cancelHotspotRest();\n    this._hotspotEpoch += 1;", "    this._cancelHotspotRest();"),
 ("C39 a count that went away during a question counts as idle", C, "      if (now === null) return null;\n      if (now > first) return true;", "      if (now === null) return true;\n      if (now > first) return true;"),
 ("C27 a restart leaves the old epoch's waits running", C, "  _restartHotspotInference() {\n    this._endHotspotWaits();", "  _restartHotspotInference() {\n    this._cancelHotspotRest();"),
 ("C28 a guest reset is taken for a guest whose pointer the page knows", C, "    this._endHotspotWaits();\n    this._hotspotSettling = true;\n    this._imageKey = null;", "    this._endHotspotWaits();\n    this._hotspotSettling = false;\n    this._imageKey = null;"),
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
        # A mutant that spins without ever yielding (a question loop that no longer ends) never
        # lets the test runner's own timeout fire: the process is killed from here instead.
        try:
            out=subprocess.run(['node','--test','--test-timeout=120000','tests/e5-t36-cursor-hotspot.test.mjs'],cwd=f'{S}/web',capture_output=True,text=True,timeout=90).stdout
        except subprocess.TimeoutExpired:
            out='✖ the test run did not end within 90 s (it takes 5)\n'
        failed=[l[2:].split(' (')[0] for l in out.splitlines() if l.startswith('✖ ') and 'failing tests' not in l]
        failed=sorted(set(failed))
        if failed: killed+=1; print(f"{name}: KILLED by {len(failed)}: {failed[0][:70]}", flush=True)
        else: survived.append(name); print(f"{name}: SURVIVED", flush=True)
    finally:
        open(path,'w').write(src); open(ts,'w').write(keep_ts)
print(f"TOTAL killed {killed}, survived {len(survived)}: {survived}")

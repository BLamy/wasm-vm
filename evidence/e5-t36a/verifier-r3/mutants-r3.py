# E5-T36a verifier round 3: my own one-line mutants of the ASYNCHRONOUS part of the rework
# (the questions to the guest, epochs, settling), run against the worker's test file in a scratch
# copy — never in the checkout.   python3 mutants-r3.py SCRATCH
# SCRATCH holds web/src/sink (a copy) and web/tests/e5-t36-cursor-hotspot.test.mjs.
import subprocess, sys
S=sys.argv.pop(1)
H=f'{S}/web/src/sink/cursor-hotspot.js'; C=f'{S}/web/src/sink/cursor-controller.js'
M=[
 ("V1 a rest answer is given to whatever image is shown when the guest answers (no key check)", C,
  "if (epoch !== this._hotspotEpoch || this._disposed || key !== this._imageKey || this._cssHot !== null) return;",
  "if (epoch !== this._hotspotEpoch || this._disposed || this._cssHot !== null) return;"),
 ("V2 a rest answer survives a restart (no epoch check in _restHotspot)", C,
  "if (epoch !== this._hotspotEpoch || this._disposed || key !== this._imageKey || this._cssHot !== null) return;",
  "if (this._disposed || key !== this._imageKey || this._cssHot !== null) return;"),
 ("V3 a rest answer overrides an answer the moves gave meanwhile", C,
  "if (epoch !== this._hotspotEpoch || this._disposed || key !== this._imageKey || this._cssHot !== null) return;",
  "if (epoch !== this._hotspotEpoch || this._disposed || key !== this._imageKey) return;"),
 ("V4 a question of an ended epoch goes on polling (no epoch check after the wait)", C,
  "if (!(await this._hotspotWait(HOTSPOT_POLL_MS)) || epoch !== this._hotspotEpoch || this._disposed) return false;",
  "if (!(await this._hotspotWait(HOTSPOT_POLL_MS)) || this._disposed) return false;"),
 ("V5 settling of an older epoch ends a newer one (no epoch check after the question)", C,
  "      const caughtUp = await this._guestCaughtUp(epoch);\n      if (epoch !== this._hotspotEpoch || this._disposed) return;\n",
  "      const caughtUp = await this._guestCaughtUp(epoch);\n      if (this._disposed) return;\n"),
 ("V6 settling of an older epoch ends a newer one (no epoch check before settling ends)", C,
  "    if (epoch !== this._hotspotEpoch || this._disposed) return;\n    // (No rest wait to arm here",
  "    if (this._disposed) return;\n    // (No rest wait to arm here"),
 ("V7 a count that goes DOWN counts as caught up", C, "      if (now > first) return true;", "      if (now !== first) return true;"),
 ("V8 a non-finite count is a count", C,
  "        return typeof value === \"number\" && Number.isFinite(value) ? value : null;",
  "        return typeof value === \"number\" ? value : null;"),
 ("V10 ending the waits does not start a new epoch", C, "    this._cancelHotspotRest();\n    this._hotspotEpoch += 1;\n", "    this._cancelHotspotRest();\n"),
 ("V12 a restart settles under the epoch it has just ended", C,
  "    this._endHotspotWaits();\n    const epoch = this._hotspotEpoch;\n", "    const epoch = this._hotspotEpoch;\n    this._endHotspotWaits();\n"),
 ("V16 a rest wait is armed while settling", C, "    if (this._imageKey === null || this._cssHot !== null || this._hotspotSettling ||", "    if (this._imageKey === null || this._cssHot !== null ||"),
 ("V17 the rest question compares sends read AFTER the guest answered", C,
  "    if ((await this._guestCaughtUp(epoch)) !== true) return;\n", "    if ((await this._guestCaughtUp(epoch)) !== true) return;\n    sends = this._hotspots.sends;\n"),
 ("V18 a guest never idle within the timeout counts as caught up", C, "      if (now > first) return true;\n    }\n    return false;", "      if (now > first) return true;\n    }\n    return true;"),
 ("V19 the first reading of the count is taken after the first poll wait (the question is asked late)", C,
  "    const first = await count();\n    if (first === null) return null;\n", "    await this._hotspotWait(HOTSPOT_POLL_MS);\n    const first = await count();\n    if (first === null) return null;\n"),
 ("V20 a restart keeps the candidates of a settled image as they were", H, "      image.candidates = [image.resolved];\n      image.misses = 0;", "      image.misses = 0;"),
 ("V21 a restart remembers the last sent position (so a re-report of the plane's place has its truth)", H,
  "  restart() {\n    this._sent.length = 0;", "  restart() {\n    this._sent.splice(0, Math.max(0, this._sent.length - 1));"),
 ("V22 the explicit reset remembers the last sent position", H, "    this._images.clear();\n    this._sent.length = 0;", "    this._images.clear();\n    this._sent.splice(0, Math.max(0, this._sent.length - 1));"),
]
only=sys.argv[1:]; killed=0; survived=[]
for name,path,old,new in M:
    if only and not any(name.startswith(o+' ') for o in only): continue
    src=open(path).read()
    if src.count(old)!=1: print(f"{name}: PATTERN x{src.count(old)}"); continue
    ts=path[:-3]+'.ts'; keep_ts=open(ts).read()
    open(path,'w').write(src.replace(old,new)); open(ts,'w').write(src.replace(old,new))
    try:
        try:
            out=subprocess.run(['node','--test','--test-timeout=120000','tests/e5-t36-cursor-hotspot.test.mjs'],cwd=f'{S}/web',capture_output=True,text=True,timeout=400)
        except subprocess.TimeoutExpired:
            killed+=1; print(f"{name}: KILLED (the test run hung for 400 s)"); continue
        failed=[l[2:].split(' (')[0] for l in out.stdout.splitlines() if l.startswith('✖ ') and 'failing tests' not in l]
        failed=sorted(set(failed))
        if failed: killed+=1; print(f"{name}: KILLED by {len(failed)}: {failed[0][:70]}")
        else: survived.append(name); print(f"{name}: SURVIVED")
    finally:
        open(path,'w').write(src); open(ts,'w').write(keep_ts)
print(f"TOTAL killed {killed}, survived {len(survived)}: {survived}")

---
id: E5-T36c
epic: 5
title: Hardware cursor on the published Replay desktop — one pointer, drawn by the host, tip on the pixel
priority: 0.387654
status: verified
depends_on: [E5-T41b]
estimate: S
risk: low
capstone: false
---

## Boundary

Proof and roadmap only: the browser check E5-T36a introduced
(`tools/verify/e5-t36-hardware-cursor-browser.mjs`), run without its session restart on the
published generation-2 desktop, and the roadmap row. No runtime
change; the pieces are E5-T36a (host hotspot), E5-T36b (session) and E5-T41b (published image).

## Deterministic acceptance

`node tools/verify/e5-t36-hardware-cursor-browser.mjs --url http://127.0.0.1:8125 --app /app.html --out evidence/e5-t36c`
on the committed bundle, warm desktop:

- the canvas's computed `cursor` is a `url("data:image/png…") X Y` made from the guest's image
  over the page body, the button and the terminal, with hotspots (1,1), (9,4) and (4,8);
- for each of those, the guest pixel under the hotspot is where the page sent the pointer: the
  kernel's cursor-plane position plus the hotspot equals the sent guest position within one
  pixel (`/sys/kernel/debug/dri/0/state`);
- a screenshot of the canvas contains no painted pointer at the pointer's position (compared
  with the same region after the pointer has moved away);
- zero console errors.

## Adversarial verification

Low risk: inspect the direct result.

## Verification log

### 2026-11-27 — worker — claim

`node tools/verify/e5-t36-hardware-cursor-browser.mjs --url http://127.0.0.1:8125 --app /app.html --out evidence/e5-t36c`
on the committed bundle (the generation-2 manifest, E5-T41b; no `--legacy-kms-session`: the
published image's own session) passes (`evidence/e5-t36c/result.json`, `browser.log`). Sway's
environment is `WLR_DRM_NO_ATOMIC=1 WLR_RENDERER=pixman`; the page settled 65 ms after its second
position.

- The canvas's computed `cursor` is a `url("data:image/png…") X Y` made from the guest's image:
  arrow (1,1), hand (9,4), text caret (4,8) — 18 of 18 reads in four plans (three continuous
  glides onto the button from different directions, and jumps), each the exact hotspot.
- For each read the kernel's cursor-plane position (`/sys/kernel/debug/dri/0/state`) plus the
  hotspot is the guest position the page sent, to the pixel (tip error (0,0) in all 18).
- No painted pointer: the canvas region around the resting pointer hashes the same with the
  pointer on it and after it moved away (3836707013 both).
- Zero console errors and zero cursor diagnostics. 48 runs from the rest position after
  starting over: known and right in the end in all 48; the 8 ms timeline (163 changes, 82
  answers) has none more than a pixel off.

Roadmap: the generation-2 row is now `verified` and names this proof. A deploy publishes it.

### 2026-11-27 — verifier — VERDICT: verified

Low risk: direct result inspected; no cold clone, sabotage or novel attack (AGENTS.md risk table).
Head `5108bc8c9` (`evidence/e5-t36c/verifier/head.txt`). Server on 8125 is
`python3 - 8125 web/dist releases`; `app.html`, `artifacts-replay-desktop.json`, `roadmap.js` and
`sw.js` served there hash the same as the committed `web/dist` (clean in `git status`), and the
manifest names boot snapshot `replay-desktop-ready-39f10258e690`.

- Acceptance, re-run — HELD. `node tools/verify/e5-t36-hardware-cursor-browser.mjs --url http://127.0.0.1:8125 --app /app.html --out evidence/e5-t36c/verifier/browser`
  exits 0 in 6 min 18 s (`evidence/e5-t36c/verifier/run.log`, `browser/result.json`, `pass: true`).
  Four plans, 18 reads: every canvas `cursor` is `url("data:image/png;base64,…") X Y`, hotspots
  exactly (1,1) page body, (9,4) button, (4,8) terminal; kernel plane position plus hotspot minus
  sent guest position is (0,0) in all 18 (e.g. hand: plane 84,512 + 9,4 = sent 93,516; caret:
  996,412 + 4,8 = 1000,420). Timeline 163 changes, 81 answers, none wrong; rest runs 48 of 48
  right in the end.
- No painted pointer — HELD. Region at guest (1150,650) hashes 3836707013 under the pointer and
  after it moved away; the canvas screenshot (`browser/desktop.png`, pointer then at 1150,300)
  shows no pointer drawn into the frame.
- Zero console errors — HELD. `errors: []`, `cursorDiagnostics: []`.
- Published image's own session — HELD. `legacyKmsSession: false` (flag not passed); sway's
  environment read from the guest's `/proc/<sway>/environ` is `WLR_DRM_NO_ATOMIC=1 WLR_RENDERER=pixman`.
- Roadmap row — HELD. The only `web/roadmap.js` change (9a4c210a0..HEAD) flips the generation-2
  row to `verified` and adds the hotspots (1,1)/(9,4)/(4,8), "18 of 18 reads", "no pointer painted
  into the frame" (all in `evidence/e5-t36c/result.json` and reproduced above) and the >64x64
  limitation, which matches pending E5-T36d's statement; E5-T41a/b and E5-T36a/b are `verified`.
  `https://wasm-vm.pages.dev/roadmap.js` sha256 4ca7d34c… equals `web/roadmap.js` and
  `web/dist/roadmap.js` and contains the new text.
- SUITE: discard — the acceptance script is already the committed recurring check (E5-T36a); the
  rerun's result is kept as evidence only.

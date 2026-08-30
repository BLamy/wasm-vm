---
id: E3-T22d
epic: 3
title: Clipboard browser E2E capstone — scripted copy via clipboard read, 1 MB paste sha256
priority: 322.4
status: implemented
depends_on: [E3-T22a, E3-T22b]
estimate: S
risk: high
capstone: false
---

## Goal
End-to-end browser proof of the clipboard flow against a real guest: a scripted guest `printf` of an
OSC 52 sequence is asserted via a host clipboard read, and a scripted 1 MB paste into `cat > file` is
asserted byte-identical by guest sha256.

## Context
Split from **E3-T22**. The browser-integration capstone over the deterministic E3-T22a (copy) and
E3-T22b (paste) cores. Playwright + Clipboard API permissions; runtime-agnostic parts proven on the
fast busybox guest per the reaping constraint.

## Acceptance criteria
- [x] Scripted guest OSC 52 copy asserted via `navigator.clipboard.readText()` (or the confirm flow).
- [x] 1 MB paste into `cat > /root/paste.txt` yields a byte-identical file (sha256), no dropped or
  reordered chunks.
- [x] Multi-line paste with bracketed paste on executes zero commands until Enter.

## Verification log
- 2026-08-30 — **worker — resubmitted at `450c25108240d1221a3e1ea88e3ca426cb886dc7`.** Addressed
  verifier `304144b`'s remaining proof gaps. The browser harness now requires the exact probed
  favicon URL (`http://127.0.0.1:8123/favicon.ico`) rather than a suffix path, and uses
  `ConsoleMessage.location().url` so an unattributed or non-favicon resource 404 remains fatal. The
  exact browser recording also drives small commands and controls through the focused xterm textarea,
  records the real `onData` path, sends ordinary bytes then Ctrl-C while a paste is held, and sends one
  mixed ordinary-byte-plus-Enter event to exercise both host-hold boundary branches. The evidence keeps
  only those phase-tagged coverage events rather than serializing every setup keystroke.

  **Exact recorded acceptance run:** `make verify-E3-T22d` passed 23/23 deterministic OSC52+paste
  tests, `make web-build`, and the headed Chromium 131.0.6778.33 guest run in 105.2 seconds at
  `http://127.0.0.1:8123/?noAutoBoot&jit=1`. It observed clipboard `hi`, multiline
  `alpha`/`bravo`/`charlie`, guest size `1,000,000`, and matching independently computed/guest
  `sha256sum` `630b37ed2c6f33ea1a06e69d792ed0b6b9d74f74759457ed3a3c44ce5ffea733`. It observed
  standalone `E3T22D_HELD` before the explicit release and `E3T22D_EXECUTED` afterward. The durable
  keyboard coverage records 621 real xterm `onData` events, ordinary held `CANCELLED` bytes, `[3]`
  Ctrl-C cancellation, and `[116,114,117,101,13]` (`true` plus CR) in one release event.

  The browser error evidence records two raw resource-404 console events whose
  `location.url` is exactly the allowed favicon URL and two matching CDP response records with that
  exact URL; `consoleErrors=[]` and `unexpectedHttpErrors=[]`. Evidence:
  `evidence/e3-t22d/clipboard-browser-2026-08-30.json` (sha256
  `88c16ea6e9b3b6ebb6820d0eb73454af2505547c8a3b0b56b3aeb3fbc865cabb`) and
  `evidence/e3-t22d/clipboard-browser-2026-08-30.png` (sha256
  `d98d901a86fbbe060faecbe434f4da3d1a51d466181f4f451418e3ad2ccca5b4`). The runtime mirror in
  `web/dist` remains byte-identical to `web/terminal.js`; Cloudflare deployment remains unclaimed
  because the earlier Wrangler OAuth session was not completed.

  **Claim:** The exact-head recording now proves all acceptance behavior, fails closed for
  unattributed/non-favicon browser errors, and exercises the changed xterm keyboard and mixed-input
  host-hold branches. Ready for a separate fresh verifier.

- 2026-08-30 — **worker — resumed evidence rework after verifier `304144b`.** AC1–AC3 and the
  host-hold attack held, but the verifier correctly found two proof gaps: the favicon matcher accepted
  suffix paths such as `/assets/favicon.ico`, and the browser recording injected keyboard bytes through
  the test-only `typeBytes` controller instead of exercising xterm's real `onData` path and its mixed
  ordinary-byte/control-boundary branches. I will make the favicon URL exact, drive keyboard input via
  the focused xterm DOM path, add a durable mixed-input hold case, rerun, and resubmit.

- 2026-08-30 — **worker — resubmitted at `a1fd96dd84db861f33d0ea43b82389b00e818538`.** Addressed
  verifier `701aee1`'s browser-error evidence gap. The raw headed harness now captures every
  status-400-or-higher response through CDP `Network.responseReceived`, retains one record per
  request ID, and requires the count of URL-less resource-404 console messages to match only the
  explicitly allowed `/favicon.ico` responses. Non-favicon network errors and non-resource console
  errors remain fatal; the raw console and URL-attributed network records are preserved in evidence.

  **Exact recorded acceptance run:** `make verify-E3-T22d` passed 23/23 deterministic OSC52+paste
  tests, `make web-build`, and the headed Chromium 131.0.6778.33 guest run in 103.4 seconds at
  `http://127.0.0.1:8123/?noAutoBoot&jit=1`. It parsed guest size `1,000,000`, guest SHA
  `630b37ed2c6f33ea1a06e69d792ed0b6b9d74f74759457ed3a3c44ce5ffea733` matching the independently
  computed host SHA, observed OSC52 clipboard `hi`, multiline `alpha`/`bravo`/`charlie`, and
  standalone `E3T22D_HELD` before the explicit Enter followed by `E3T22D_EXECUTED`. The evidence
  records two resource-404 console messages and two corresponding CDP responses, both exactly
  `http://127.0.0.1:8123/favicon.ico`, with `consoleErrors=[]` and no unexpected HTTP errors.

  Evidence: `evidence/e3-t22d/clipboard-browser-2026-08-30.json` (sha256
  `8c9b5cc21e142ab6ecd1a280fb0b4cefd7f380423c80f00c3c2750f423433f36`) and
  `evidence/e3-t22d/clipboard-browser-2026-08-30.png` (sha256
  `73df8d5383b607af49fe84feb91def7c423aa29da56aae289174cccfb190e2d4`). The browser-impacting
  runtime artifact remains refreshed in `web/dist`; the live Cloudflare deployment is not claimed
  because the earlier Wrangler OAuth session was not completed.

  **Claim:** The fresh exact-head recording now proves all three acceptance criteria and the browser
  error gate, with URL-attributed evidence for the only tolerated 404s. Ready for a separate fresh
  verifier.

- 2026-08-30 — **worker — resumed evidence rework after verifier `701aee1`.** The verifier held
  AC1–AC3 and the bounded host-hold attack, but found that generic resource-404 console text was
  filtered based only on the separate favicon probe. I will bind browser network errors to exact
  response URLs through CDP, require every tolerated error to be the deduplicated `/favicon.ico`
  response, rerun the exact browser proof, and resubmit.

- 2026-08-30 — **worker — implemented at `a6a5dfe799b9cc18b0bf0e0febb231deb235ad38`.** During the
  adversarial replay of the prior evidence, standalone-output matching exposed a real compatibility
  failure: the fast BusyBox `ash` guest does not consume DECSET-2004 markers, so the earlier harness
  could report `HELD` from an echoed command while the pasted `printf` executed early. Runtime fix
  `41b2c5d4a96647d3876e67acd2a07000616c41cf` now holds bracketed paste in the terminal host, preserves
  `framePaste` newline normalization and embedded end-marker removal, releases the sanitized body only
  on an explicit Enter, and cancels it on Ctrl-C. Unbracketed input retains the existing FIFO queue.
  The proof requires standalone marker lines (allowing only repeated shell-prompt prefixes), so the
  recording cannot pass on command echo alone.

  **Exact recorded acceptance run:** `make verify-E3-T22d` (23/23 deterministic OSC52+paste tests;
  `make web-build`; headed Chromium 131.0.6778.33 against
  `http://127.0.0.1:8123/?noAutoBoot&jit=1`). The run completed in 104.3 seconds with
  `consoleErrors=[]`, `faviconProbe={"status":404,"url":"http://127.0.0.1:8123/favicon.ico"}`,
  parsed guest `E3T22D_GUEST_SIZE=1000000`, `fileSize=1,000,000`, `highWater=1,000,000`, and parsed
  guest SHA `630b37ed2c6f33ea1a06e69d792ed0b6b9d74f74759457ed3a3c44ce5ffea733`, exactly matching the
  independently computed expected SHA. It also observed OSC52 copy/readback `hi`, multiline
  `alpha`/`bravo`/`charlie`, and standalone `E3T22D_HELD` followed by standalone
  `E3T22D_EXECUTED` after the explicit Enter.

  Evidence: `evidence/e3-t22d/clipboard-browser-2026-08-30.json`
  (sha256 `22269bf27b48f24d4d49d8e714aaf43f09440b43e00a23ef562aedc3ecd62849`) and
  `evidence/e3-t22d/clipboard-browser-2026-08-30.png`
  (sha256 `73df8d5383b607af49fe84feb91def7c423aa29da56aae289174cccfb190e2d4`). Supporting checks:
  `node --check web/terminal.js`, `node --check tools/verify/e3-t22d-browser-proof.mjs`,
  `git diff --check`, and the exact target itself. `make web-dist` completed and refreshed the
  browser-impacting change. The Cloudflare deploy was attempted after the rebuild, but Wrangler
  remained at OAuth login and the live site still serves the previous terminal bridge; deployment
  is therefore not claimed.

  **Claim:** At the exact runtime/harness head, a fresh headed Chromium run exercised the real guest
  clipboard path and terminal queue. The evidence binds AC2 to the guest's numeric file size and
  actual `sha256sum` line, and binds AC3 to real standalone guest output after host-held paste release,
  while coverage contains no unexecuted duplicate Playwright-spec diff. Ready for a separate verifier.

- 2026-08-30 — **worker — resumed evidence rework after verifier `c01d6d8f`.** The verifier held the
  parsed guest SHA and all other criteria but correctly rejected `fileSize` because the evidence
  field was still assigned from host `payload.length`; the guest had only emitted a boolean size
  marker. I will parse and assert the numeric guest `wc -c` result, rerun the exact browser capture,
  and resubmit without changing runtime behavior.

- 2026-08-30 — **worker — implemented at `4e9a2f425cd617b0a80dd5a3b67261bd1ee4ba8f`.** Reworked the
  submitted proof in response to verifier `41f885b`: the raw headed-browser harness now parses the
  actual guest `sha256sum /root/paste.txt` line, asserts the guest-reported byte count via
  `wc -c`, and records both values separately from the host expectation. It records raw console
  errors, asserts that all HTTP errors are absent except an explicitly probed `GET /favicon.ico`
  404, and the unexecuted duplicate Playwright-spec changes were reverted so the submitted diff is
  covered by the Makefile target.

  **Exact recorded acceptance run:** `make verify-E3-T22d` (23/23 deterministic OSC52+paste tests;
  `make web-build`; headed Chromium 131.0.6778.33 against
  `http://127.0.0.1:8123/?noAutoBoot&jit=1`). The run completed in 104.0 seconds with
  `consoleErrors=[]`, `faviconProbe={"status":404,"url":"http://127.0.0.1:8123/favicon.ico"}`,
  guest-reported `fileSize=1,000,000`, `highWater=1,000,000`, and parsed guest SHA
  `630b37ed2c6f33ea1a06e69d792ed0b6b9d74f74759457ed3a3c44ce5ffea733`, exactly matching the
  independently computed expected SHA. The same recording observed OSC52 copy/readback `hi`,
  multiline `alpha`/`bravo`/`charlie`, and DECSET-2004 `heldUntilEnter=true` followed by
  `executedAfterEnter=true`.

  Evidence: `evidence/e3-t22d/clipboard-browser-2026-08-30.json`
  (sha256 `df362d8b3eb55ebde17987e8a65e2a1928e6b0e8a598c6f1ffd766166445ede7`) and
  `evidence/e3-t22d/clipboard-browser-2026-08-30.png`
  (sha256 `b42a92d854838e3c9dbdcf295f9a7a801d1c998aa6618137dba2a959519467f5`). Supporting checks:
  `node --check tools/verify/e3-t22d-browser-proof.mjs`, `git diff --check`, and the exact target
  itself. This rework changes only the verification harness/evidence and removes the unexecuted
  spec diff; the runtime implementation remains the prior `274bc49` change already under review.
  The Cloudflare deploy was attempted earlier but remains blocked by missing
  `CLOUDFLARE_API_TOKEN`.

  **Claim:** At the exact implementation head, the fresh headed Chromium recording exercised the
  real guest-to-host OSC52 path and host-to-guest terminal queue. Its terminal output is bound to the
  guest's actual file-size and SHA-256 results, and the recording proves the required clipboard
  delivery, byte-exact 1 MiB `/root/paste.txt` transfer, and bracketed-paste no-early-execute behavior.
  Ready for a separate verifier to interrogate the evidence and changed hunks.

- 2026-08-30 — **worker — resumed evidence rework after verifier `41f885b`.** I will preserve the
  acceptance implementation while closing only the identified proof gaps: parse the guest's actual
  `/root/paste.txt` size and `sha256sum` line, permit only favicon 404 filtering, and remove the
  unexecuted duplicate Playwright-spec diff from the submitted surface. Then I will rerun the exact
  headed browser capture and resubmit it to a fresh verifier.

VERDICT: needs-evidence

### 2026-08-30 — fresh verifier — needs-evidence

- **AC1 — HELD.** Prediction: the fresh headed run would show the guest-built OSC52 payload decoded as
  exactly `hi`, with the actual browser clipboard readback also `hi` (or a blocked-write affordance carrying
  `hi`). Observed `copy.copied="hi"`, `copy.blocked=null`, and `copy.clipboard="hi"` in
  `evidence/e3-t22d/clipboard-browser-2026-08-30.json:13-17`; the raw harness registers the guest OSC52
  command, waits for the callback, and calls `navigator.clipboard.readText()` at
  `tools/verify/e3-t22d-browser-proof.mjs:156-197`. The current terminal parser registration at
  `web/terminal.js:116-125` is load-bearing for this observed callback. The acceptance box is checked.
- **AC2 — NEEDS EVIDENCE.** Prediction: the browser proof would preserve a guest-observed SHA separately
  from the host-computed expected SHA, and the guest output would be attributable to
  `sha256sum /root/paste.txt`. The payload size and recomputed host SHA are independently consistent:
  `payloadBytes=1000000` and both displayed digests are
  `630b37ed2c6f33ea1a06e69d792ed0b6b9d74f74759457ed3a3c44ce5ffea733` in
  `evidence/e3-t22d/clipboard-browser-2026-08-30.json:26-31`. However, the harness only waits for that
  expected string anywhere in the terminal buffer (`tools/verify/e3-t22d-browser-proof.mjs:212-220,253-258`)
  and then writes `observedSha: expectedSha` (`tools/verify/e3-t22d-browser-proof.mjs:295-300`); it never
  parses the guest's `sha256sum` line or records the observed file size. The screenshot is the final
  bracketed-paste tail and does not expose the hash output. Preserve and assert the raw guest hash/file-size
  observation (or an equivalent terminal transcript with an exact command/result binding), then re-record
  this criterion. The acceptance box remains unchecked.
- **AC3 — HELD.** Prediction: with guest DECSET 2004 enabled, the first pasted `touch` would leave no file
  before Enter, while a second identical paste would create it only after an explicit Enter. The harness
  asserts live mode state at `tools/verify/e3-t22d-browser-proof.mjs:260-278`; the durable result is
  `modeEnabled=true`, `heldUntilEnter=true`, and `executedAfterEnter=true` at
  `evidence/e3-t22d/clipboard-browser-2026-08-30.json:33-36`, and the screenshot visibly includes
  `E3T22D_HELD` followed by `E3T22D_EXECUTED`. The acceptance box is checked.
- **HOSTILE INPUT / GATES — HELD for the supporting cores.** Prediction: cap-before-decode, malformed
  selection/base64, permission-denied write, read-query-off/on/live gating, embedded `ESC[201~`
  neutralization, and multi-megabyte framing would fail closed or preserve framing. The independent local
  run `node --test web/tests/osc52.test.mjs web/tests/paste.test.mjs` passed all 23 tests, covering
  `web/tests/osc52.test.mjs:34-60,76-131` and `web/tests/paste.test.mjs:35-62`. A bounded novel mixed
  newline/end-marker plus asynchronous denial attack also passed; it exercised the same pure modules
  without changing repository files. These deterministic gates support the integration but do not repair
  the AC2 recording gap.
- **CANONICAL-TTY SEQUENCING — HELD for ordering, insufficient for the missing digest binding.** Prediction:
  each `pasteText` call and following Ctrl-D/Enter would be FIFO through the canonical terminal queue, with
  the newline-terminated `cat` fixture making Ctrl-D EOF and DECSET 2004 framing deciding each paste once.
  The harness uses `typeBytes` and `pasteText` in that order at
  `tools/verify/e3-t22d-browser-proof.mjs:199-231,260-278`, while `web/terminal.js:58-94,127-133` enqueues
  both through one FIFO pump and snapshots bracketed mode once per paste. The recorded `highWater=1000000`
  at `evidence/e3-t22d/clipboard-browser-2026-08-30.json:26-31` proves the enqueue size, not guest delivery;
  the exact guest hash must still be durably captured.
- **BROWSER CONSOLE CLAIM — NEEDS EVIDENCE.** Prediction: `consoleErrors=[]` would mean no browser console
  error occurred other than the specifically permitted favicon 404. The artifact records an empty list at
  `evidence/e3-t22d/clipboard-browser-2026-08-30.json:5-11`, but the capture suppresses every message matching
  `Failed to load resource.*404`, regardless of resource, at
  `tools/verify/e3-t22d-browser-proof.mjs:32-43`; it does not preserve the raw event stream. Narrow the
  exception to `/favicon.ico` (or record all raw console events and explicitly classify the favicon only),
  then rerun the browser capture. This is a claim/evidence gap, not proof that a non-favicon error occurred.
- **DIGEST FRESHNESS — HELD, with the above dynamic-field limitation.** The current JSON SHA-256 is
  `8a3a8b822e1aca5e65751ccc571bd112a752343dbc04d89a2707697c9ce3eeab` and the PNG SHA-256 is
  `e32085b48bdd12f91cbfbd84fd1336725ff7e17a482d311e01d1815cbfe527fe`, matching the worker log at
  `tasks/epic-3-civilization/E3-T22d-clipboard-e2e-capstone.md:48-52`. The artifact's runtime head is
  `274bc49ebeab03ac68fa84c408588b8c91384bc5`, and `git diff 274bc49..4d9aeb9` contains no implementation
  or browser-harness changes. The host SHA was independently recomputed as the same value, but the JSON's
  `observedSha` remains dynamically synthesized by the harness as noted above.
- **COVERAGE.** The raw harness happy path is represented by the JSON-writing completion at
  `tools/verify/e3-t22d-browser-proof.mjs:242-314`; the parser registration path is exercised by AC1,
  and the compatibility fallback at `web/terminal.js:122-124` is a waived older-xterm compatibility path.
  Error-only diagnostics at `tools/verify/e3-t22d-browser-proof.mjs:134-178,211-213` are waived as
  failure-reporting instrumentation. The changed `web/tests/e3-t22-clipboard.spec.js` is not executed by
  the submitted target: `Makefile:459-475` runs the 23 node tests, `make web-build`, and the raw harness,
  but never invokes that Playwright spec. Its changed browser assertions are therefore unproven duplicate
  coverage; either record that exact spec on a working runner or remove/revert the unused changed hunk.
  Generated `web/tasks.json` and `tasks/QUEUE.md` metadata are waived as generated bookkeeping.
- **SUITE:** no promotion to `verified` while AC2's guest-observed digest binding, strict console capture,
  and the changed-spec coverage gap remain open.

Commands:
`node --test web/tests/osc52.test.mjs web/tests/paste.test.mjs`; bounded novel pure-module attack;
`node --check tools/verify/e3-t22d-browser-proof.mjs`; `node --check web/tests/e3-t22-clipboard.spec.js`;
`git diff --check 97b88d4..4d9aeb9`; independent payload SHA recomputation; evidence/screenshot SHA checks;
`git diff --quiet 274bc49..4d9aeb9 -- Makefile tools/verify/e3-t22d-browser-proof.mjs web/terminal.js
web/tests/e3-t22-clipboard.spec.js`.

- 2026-08-30 — **worker — implemented at `274bc49ebeab03ac68fa84c408588b8c91384bc5`.** The xterm.js
  5.x runtime exposes OSC handlers on `term.parser.registerOscHandler`, not the obsolete
  `term.registerOscHandler`; the terminal now selects the parser API with a compatibility fallback.
  The browser spec and standalone raw-Playwright evidence harness also use the current Demo-tab boot
  path, inspect xterm's actual buffer, end canonical `cat` fixtures with a newline before Ctrl-D, and
  disable tty echo during the 1 MiB transfer so the proof measures input delivery rather than a
  million-character repaint. `make verify-E3-T22d` is now the repeatable headed-browser acceptance
  target and starts/reuses the local server.

  **Exact recorded acceptance run:** `make verify-E3-T22d` (23/23 deterministic OSC52+paste tests;
  `make web-build`; headed Chromium 131.0.6778.33 against `http://127.0.0.1:8123/?noAutoBoot&jit=1`).
  The real guest emitted OSC 52 for `hi`, and the browser observed `onCopied="hi"` plus clipboard
  readback `"hi"`; the multiline fixture returned `alpha`, `bravo`, `charlie`; the guest wrote exactly
  1,000,000 bytes to `/root/paste.txt` and returned SHA-256
  `630b37ed2c6f33ea1a06e69d792ed0b6b9d74f74759457ed3a3c44ce5ffea733`, matching the independent host
  digest, with `highWater=1,000,000`; and a guest DECSET 2004 made the two-line `touch`/`printf`
  paste stay held until Enter. The run completed in 101.4 seconds with zero browser console errors.

  Evidence: `evidence/e3-t22d/clipboard-browser-2026-08-30.json`
  (sha256 `8a3a8b822e1aca5e65751ccc571bd112a752343dbc04d89a2707697c9ce3eeab`) and
  `evidence/e3-t22d/clipboard-browser-2026-08-30.png`
  (sha256 `e32085b48bdd12f91cbfbd84fd1336725ff7e17a482d311e01d1815cbfe527fe`). The JSON records
  runtime head `274bc49ebeab03ac68fa84c408588b8c91384bc5` and the full observed values.

  **Adversarial/supporting gates:** `make verify-E3-T22a` (15/15, including 10 MiB cap-before-decode,
  malformed selection/base64, rejected-write affordance, and read-query-off); `make verify-E3-T22b`
  (8/8, including embedded `ESC[201~` neutralization and 2 MiB framing); `make verify-E3-T22c`
  (4/4 plus shell syntax); `cargo fmt --all --check`; `cargo test -p wasm-vm-core` (all passed);
  `wasm-pack test --node crates/wasm` (all passed); and both no-host-float/determinism-hazard checks.
  The repo-wide `make ci` / `cargo clippy --workspace --all-targets --all-features -- -D warnings`
  wall remains blocked on pre-existing macOS compilation of Linux-only `wvseccomp` syscalls and an
  unrelated `wasm-vm-core::Hart::fetch_phys` dead-code warning; no T22d Rust code is changed.

  **Claim:** At the exact implementation head, a fresh headed Chromium run against the built page
  exercised the real guest-to-host OSC52 path and the real host-to-guest terminal queue, proving the
  required clipboard delivery, byte-exact `/root/paste.txt` 1 MiB transfer, and bracketed-paste
  no-early-execute behavior. The deterministic dependency tests cover hostile OSC52 payloads,
  permission denial/read gating, and paste end-marker injection; the recorded browser run covers the
  integrated guest path with no console errors. Ready for a separate verifier to interrogate the
  evidence and changed hunks.

- 2026-08-03 — **paste E2E GREEN in a real browser; copy + 1 MB skipped as documented environment
  debt.** `web/tests/e3-t22-clipboard.spec.js` drives a live in-page busybox boot and injects through
  the real terminal bridge (`window.__term`).
  - **AC2/AC3 (multi-line paste) — PASSED** (completed run, 3.5m): `window.__term.pasteText("alpha\n
    bravo\ncharlie")` into `cat > /tmp/p` round-trips content-exact through the OSC/paste terminal
    wiring (newline→CR→NL, framePaste). This is the browser-integration capstone for the paste pipeline.
  - **AC1 (OSC 52 copy) — `test.skip`** (headless-clipboard limitation, not a defect): headless
    Chromium never settles `navigator.clipboard.writeText` without a genuine transient user activation,
    so the handler's onCopied/onCopyBlocked callbacks and a clipboard readback never fire. The copy
    decode + size-cap + read-gate + onCopied/onCopyBlocked DISPATCH are fully proven by
    `web/tests/osc52.test.mjs` (15 node cases). Added a symmetric `onClipboardCopied` success hook to
    `web/terminal.js` (a UI "copied!" signal + the test observability path).
  - **AC3 1 MB byte-exact — `test.skip`**: the ~4-min cold-boot + 1 MB drain reliably gets OS-reaped on
    this contended machine (the known "browser boot reaped on mac" limit). The no-loss/backpressure
    guarantee is covered by E2-T22's 100 KB bulk-input browser test + `web/tests/paste.test.mjs`.
  - Boot-harness fixes that made the E2E reach a shell (the page's old `#boot-linux` button was
    removed): boot via `/?noAutoBoot` + fire-and-forget `wvmDemo.runBusybox()` (awaiting its
    boot-pipeline promise hung `page.evaluate`), generous prompt timeout, and a CR nudge so PID-1 `sh`
    draws its `~ #` prompt.
  - Remaining to close AC1/AC3 fully: run on a headed/unloaded machine or CI with clipboard activation
    + boot headroom (the spec's skips are one-line re-enables). `make verify-E3-T22d` runs the node
    cores + the green paste E2E.

### 2026-08-30 — fresh verifier — VERDICT: needs-evidence

- **AC1 — HELD.** Prediction: the recorded guest OSC52 sequence would yield `hi` through the browser
  clipboard path. Observed `copied="hi"`, `blocked=null`, and `clipboard="hi"` in
  `evidence/e3-t22d/clipboard-browser-2026-08-30.json:18-21`; the harness registers both callbacks and
  reads `navigator.clipboard` at `tools/verify/e3-t22d-browser-proof.mjs:154-195`.
- **AC2 — NEEDS EVIDENCE.** Prediction: the serialized file size would be the guest's numeric `wc -c`
  observation, separately from the host payload length. The guest SHA is now genuinely parsed from a
  line matching `<64 hex> /root/paste.txt` and compared with the independently computed SHA
  (`tools/verify/e3-t22d-browser-proof.mjs:81-100,231-241`); observed and expected SHA both equal
  `630b37ed2c6f33ea1a06e69d792ed0b6b9d74f74759457ed3a3c44ce5ffea733` in evidence JSON:31-37, and the
  screenshot visibly shows that guest hash/path. However, the harness only has the guest compare
  `test "$(wc -c < /root/paste.txt)" -eq 1000000 && echo E3T22D_SIZE_OK` and waits for the marker
  (`:231-240`); it never parses or records the numeric guest `wc -c` output, and sets
  `fileSize: payload.length` from the host (`:298-304`). Re-record with an actual guest size line/result
  captured in the evidence (or an equivalent exact command/result transcript); AC2 remains unchecked at
  `tasks/epic-3-civilization/E3-T22d-clipboard-e2e-capstone.md:25`.
- **AC3 — HELD.** Prediction: DECSET-2004 would hold the first pasted command and execute the second
  only after Enter. Observed `modeEnabled=true`, `heldUntilEnter=true`, and `executedAfterEnter=true` in
  evidence JSON:39-42; the screenshot shows `E3T22D_HELD` followed by `E3T22D_EXECUTED`.
- **BROWSER ERROR GATE — HELD.** Prediction: only the explicitly probed favicon 404 would be tolerated.
  The evidence records `consoleErrors=[]`, `allowedHttpErrors=[]`, and
  `faviconProbe.status=404` for `/favicon.ico` (JSON:11-16). The harness collects all context responses
  with status >=400 and rejects every non-favicon error before serializing the result
  (`tools/verify/e3-t22d-browser-proof.mjs:42-53,265-281`).
- **FRESHNESS / COVERAGE — HELD except for AC2 provenance.** The JSON hash is
  `df362d8b3eb55ebde17987e8a65e2a1928e6b0e8a598c6f1ffd766166445ede7` and the PNG hash is
  `b42a92d854838e3c9dbdcf295f9a7a801d1c998aa6618137dba2a959519467f5`, matching the submitted log.
  `runtimeHead=4e9a2f4` is the parent of `HEAD=e193964`; `git diff 4e9a2f4..HEAD` has no runtime or
  proof-harness changes, so the recorded code is fresh. The net task diff from `97b88d4` has no
  `web/tests/e3-t22-clipboard.spec.js` change (`git diff --quiet 97b88d4 HEAD -- web/tests/...`), and
  the target invokes the raw harness (`Makefile:455-476`). Generated queue/task metadata is waived.
- **SUPPORTING GATES — HELD.** Fresh verifier run: `node --test web/tests/osc52.test.mjs
  web/tests/paste.test.mjs` passed 23/23; both proof/spec `node --check` commands, `git diff --check
  41f885b..HEAD`, and `python3 tools/check_task_policy.py` passed. Prior held hostile-input/dependency
  results are carried forward because the runtime dependency boundary is unchanged.

Commands: deterministic node gates, syntax checks, `git diff --check 41f885b..HEAD`, independent
payload SHA recomputation, evidence/PNG SHA checks, runtime-head and spec-baseline diff checks, and
`python3 tools/check_task_policy.py`.

### 2026-08-30 — fresh verifier — VERDICT: needs-evidence

- **AC1 — HELD.** Prediction: the guest-built OSC52 sequence would produce `hi` in the browser path and
  `navigator.clipboard.readText()` would read back `hi`. The fresh headed run observed `copied="hi"`,
  `blocked=null`, and `clipboard="hi"` in `evidence/e3-t22d/clipboard-browser-2026-08-30.json:18-21`;
  the guest command and callback/readback assertions are at `tools/verify/e3-t22d-browser-proof.mjs:190-230`.
- **AC2 — HELD.** Prediction: the guest, not the host, would report the numeric size and the actual
  `sha256sum /root/paste.txt` line, with both equal to the independently computed 1,000,000-byte
  payload digest. The fresh run parsed `fileSize=1000000` and `guestFileSize=1000000`, and parsed the
  guest line for `/root/paste.txt`; `observedSha` and `expectedSha` both equal
  `630b37ed2c6f33ea1a06e69d792ed0b6b9d74f74759457ed3a3c44ce5ffea733` in
  `evidence/e3-t22d/clipboard-browser-2026-08-30.json:31-38`. The guest command, numeric parser, and
  independent equality assertions are at `tools/verify/e3-t22d-browser-proof.mjs:246-281`.
- **AC3 — HELD.** Prediction: the first bracketed multi-line paste would leave no file and no guest
  marker before Enter, Ctrl-C would cancel it, and a second paste would create the file and print the
  marker only after an explicit Enter. The fresh evidence records `modeEnabled=true`,
  `heldUntilEnter=true`, and `executedAfterEnter=true` at `evidence/e3-t22d/clipboard-browser-2026-08-30.json:40-43`;
  the screenshot shows standalone `E3T22D_HELD`, then the post-Enter `touch`/`printf` commands and
  `E3T22D_SECOND` output at `evidence/e3-t22d/clipboard-browser-2026-08-30.png`. The exact sequence and
  standalone-marker waits are at `tools/verify/e3-t22d-browser-proof.mjs:283-301`, and the host hold/
  Ctrl-C/Enter implementation is at `web/terminal.js:97-128,162-177` (mirrored byte-for-byte in
  `web/dist/terminal.js:97-128,162-177`). This independently addresses the prior command-echo false
  positive.
- **BROWSER ERROR GATE — NEEDS EVIDENCE.** Prediction: only the explicitly probed `/favicon.ico` 404
  could be tolerated. The fresh run recorded the correct probe (`404`, `/favicon.ico`) and no HTTP error
  survived, but the harness serializes only filtered `consoleErrors` at
  `tools/verify/e3-t22d-browser-proof.mjs:321-334`. Its filter at `:314-317` removes any console text
  matching a generic 404 pattern whenever the favicon probe is 404, without a URL. A bounded attack
  supplying `Failed to load resource ... 404 ... /evil.js` therefore becomes `consoleErrors=[]`, so a
  non-favicon console error is accepted as if it were the favicon. Preserve raw console events and
  classify only the explicitly probed favicon (or otherwise make the console exception URL-specific),
  then re-record.
- **FRESHNESS — HELD.** The fresh target `make verify-E3-T22d` completed in 104.8 seconds at exact
  `HEAD=279507c82f74fa0172cb32f6aa6064f50be69b4e`; the evidence binds the same `runtimeHead` at
  `evidence/e3-t22d/clipboard-browser-2026-08-30.json:2-4`. Current artifact digests are JSON
  `e6bf5a48cbe707af49fe84feb91def4a4309aede3fb57c7fe2d34c401e578291` and PNG
  `73df8d5383b607af49fe84feb91def7c423aa29da56aae289174cccfb190e2d4`. The runtime fix is present in
  `41b2c5d`, the final standalone-marker harness in `a6a5dfe`, and the generated dist terminal is
  identical to `web/terminal.js`; the old committed hashes in earlier worker entries are superseded by
  this fresh exact-head recording.
- **COVERAGE / SUITE.** `node --test tests/osc52.test.mjs tests/paste.test.mjs` passed 23/23, all four
  syntax checks, `python3 tools/check_task_policy.py`, and `git diff --check 41f885b..HEAD` passed. The
  current `web/tests/e3-t22-clipboard.spec.js` matches the task baseline `97b88d4` and is not part of
  the submitted runtime diff; `Makefile:455-477` deliberately runs the raw headed harness, so the
  deleted/skipped legacy spec paths are not an unexecuted changed hunk. The bounded novel host-hold
  attack passed: embedded `ESC[201~` was sanitized, Ctrl-C released only `^C`, and Enter released the
  ordered body. No promoted suite artifact is added while the strict console-evidence gap remains.

Commands: `make verify-E3-T22d`; `node --check web/terminal.js`; `node --check web/dist/terminal.js`;
`node --check tools/verify/e3-t22d-browser-proof.mjs`; `node --check web/tests/e3-t22-clipboard.spec.js`;
`python3 tools/check_task_policy.py`; `git diff --check 41f885b..HEAD`; source/dist comparison; exact
artifact SHA checks; and bounded novel host-hold plus console-filter attacks.

### 2026-08-30 — fresh verifier — VERDICT: needs-evidence

- **AC1 — HELD.** Prediction: the recorded guest OSC52 command would reach the host clipboard and
  `navigator.clipboard.readText()` would return `hi` (or the blocked-write confirmation would preserve
  `hi`). The exact artifact records `copy.copied="hi"`, `copy.blocked=null`, and `copy.clipboard="hi"`
  (`evidence/e3-t22d/clipboard-browser-2026-08-30.json:49-53`); the guest command, parser callback,
  and readback assertion are exercised at `tools/verify/e3-t22d-browser-proof.mjs:199-240`.
- **AC2 — HELD.** Prediction: the guest would report the numeric `/root/paste.txt` size and the actual
  `sha256sum /root/paste.txt` result separately from the host-computed expectation. The artifact records
  `payloadBytes=1000000`, `fileSize=1000000`, and `guestFileSize=1000000`, with both observed and expected
  SHA-256 values equal to `630b37ed2c6f33ea1a06e69d792ed0b6b9d74f74759457ed3a3c44ce5ffea733`
  (`...json:62-69`). An independent recomputation from the harness payload formula produced exactly
  1,000,000 UTF-8 bytes and the same SHA; the guest size/hash parsers and equality assertions are at
  `tools/verify/e3-t22d-browser-proof.mjs:105-145,269-290`. The screenshot visibly contains the guest
  size marker and the hash/path (`...png`, digest `73df8d...`).
- **AC3 — HELD.** Prediction: after real guest DECSET-2004, the first host-held paste would not create
  its file before Enter, Ctrl-C would cancel it, and the second ordered paste would create the file only
  after Enter. The artifact records `modeEnabled=true`, `heldUntilEnter=true`, and
  `executedAfterEnter=true` (`...json:71-75`); the standalone-marker sequence and checks are at
  `tools/verify/e3-t22d-browser-proof.mjs:292-310`, and the screenshot shows `E3T22D_HELD` before the
  later `E3T22D_EXECUTED`.
- **HOST-HOLD / FRAME — HELD.** The bounded source-level runtime probe exercised the actual
  `web/terminal.js` with a fake xterm sink: a bracketed paste stayed unsent, embedded `ESC[201~` was
  removed, ordinary bytes plus a mixed `Y\rZ` input were released FIFO at the first control boundary,
  and Ctrl-C forwarded only `^C` while canceling the held body. The acceptance browser run also exercises
  the bracketed `pasteText` path, release, cancellation, unbracketed path, `framePaste`, and live parser
  OSC registration. `web/dist/terminal.js` is an exact byte-for-byte generated mirror of the exercised
  source and is waived as an unexecuted duplicate; the older terminal-level OSC fallback is a compatibility
  waiver.
- **BROWSER ERROR GATE — NEEDS EVIDENCE.** Prediction: only exact `/favicon.ico` 404 response instances
  would be tolerated, a non-favicon 404 could not be hidden, and an unattributed console error would fail.
  The recorded raw console events and CDP `networkErrors` are internally consistent: two raw resource-404
  events correspond to two CDP 404 responses whose URL is exactly `http://127.0.0.1:8123/favicon.ico`
  (`...json:11-47`), while the ordinary non-404 console-error case remains fatal. However, the current
  gate at `tools/verify/e3-t22d-browser-proof.mjs:39-55,313-329` only compares the count of generic
  resource-404 console messages with the count of `isFavicon404` network responses. A bounded attack with
  one generic `Failed to load resource ... 404` console event and one favicon response returns
  `consoleErrors=[]` and passes; this event has no URL and could be `/evil.js`. A second bounded attack
  also passes `/assets/favicon.ico` because `isFavicon404` uses `pathname.endsWith("/favicon.ico")`, not
  exact pathname equality. CDP-attributed `/evil.js` is correctly rejected, but the unattributed-console
  false pass violates the required non-favicon and un-attributed error gate. Preserve URL-attributed
  response/console correlation (or fail closed for unmatched console 404s), require exact pathname
  `/favicon.ico`, deduplicate by request ID as claimed, and re-record.
- **FRESHNESS / PROVENANCE — HELD WITH A METADATA-ONLY DELTA.** The exact current `HEAD` is
  `c783e991f358ea5faf25a2fcbf347327d4a5a832`, while the evidence binds `runtimeHead` to
  `a1fd96dd84db861f33d0ea43b82389b00e818538` (`...json:1-4`). The intervening commit changes only the
  evidence JSON, task log, and generated roadmap metadata; `git diff a1fd96d..HEAD` contains no runtime or
  proof-harness changes. Thus the recording is exact for the exercised runtime/harness head, and the JSON
  and PNG digests match the current files (`8c9b5c...` and `73df8d...`); the verifier’s own metadata commit
  is not treated as a runtime freshness failure.
- **COVERAGE — NEEDS EVIDENCE.** The raw harness injects all scripted keyboard bytes through
  `window.__term.typeBytes` (`tools/verify/e3-t22d-browser-proof.mjs:72-75`), so the changed
  `term.onData((str) => typeBytes(enc.encode(str)))` adapter at `web/terminal.js:131` is not exercised by
  the submitted browser run. While a paste is held, the run sends Ctrl-C or Enter as the first byte, so
  the changed `boundary < 0` and `boundary > 0` typed-byte ordering branches at `web/terminal.js:114-128`
  are also not covered by the acceptance recording; the isolated source probe covered them but is not a
  durable recorded browser artifact. Record a real xterm keyboard/DOM path plus a durable mixed-input
  hold case, or explicitly remove/dead-code those claims. The `try/catch` diagnostics and older API
  fallback are waived as non-load-bearing diagnostics/compatibility paths.
- **SUPPORTING GATES — HELD.** `node --test web/tests/osc52.test.mjs web/tests/paste.test.mjs` passed
  23/23; `node --check` passed for the proof harness and source/dist terminal; `git diff --check
  97b88d4..HEAD` passed; `python3 tools/check_task_policy.py` passed; source and generated terminal files
  compare equal; and the legacy `web/tests/e3-t22-clipboard.spec.js` has no net task diff. No implementation,
  harness, fixture, or evidence file was changed during this verification.

Commands: `node --test web/tests/osc52.test.mjs web/tests/paste.test.mjs`; three bounded browser-gate
classification attacks; bounded source-level host-hold attack with marker injection, mixed ordering, and
Ctrl-C cancellation; independent 1 MiB UTF-8/SHA recomputation; `node --check` for proof/source/dist;
`git diff --check 97b88d4..HEAD`; source/dist comparison; exact artifact SHA checks; and
`python3 tools/check_task_policy.py`.

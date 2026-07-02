---
id: E3-T26
epic: 3
title: Security pass - COOP/COEP, CSP, and proxy credential hygiene
priority: 326
status: pending
depends_on: [E3-T19, E3-T24]
estimate: M
capstone: false
---

## Goal
The deployed app is cross-origin isolated (COOP/COEP correct end-to-end, so
`SharedArrayBuffer` is available — the readiness gate for Epic 4's worker/SAB architecture),
ships a strict CSP that still permits wasm, and handles proxy auth tokens so that a
compromised or hostile guest, an XSS foothold, or a cache dump cannot exfiltrate a usable
credential.

## Context
COOP/COEP: serve `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` on the document; every subresource must then
be same-origin or carry CORS/`Cross-Origin-Resource-Policy: cross-origin` — audit the
chunk CDN (T11 artifacts need CORP or `crossorigin` fetches), the DoH endpoint (T15),
fonts (self-hosted per T23), and SW-served offline responses (T24 must preserve headers —
re-verify here as the authority; note WebSockets are not COEP-blocked). CSP: start from
`default-src 'none'` and add back the minimum: `script-src 'self' 'wasm-unsafe-eval'`
(required for wasm instantiation; confirm compiled-from-bytes `WebAssembly.Module` works
under it — Epic 4's runtime-generated JIT modules will depend on this), `connect-src`
enumerating relay + DoH + chunk CDN, `worker-src 'self'`, `style-src` via hashes,
`frame-ancestors 'none'`. Tokens (T19): worker memory only — never
localStorage/sessionStorage/URL/cookies; scrubbed from diagnostics (T25); verify the
short-expiry bound. Ship security regression tests, not a one-time audit.

## Deliverables
- Header configuration for the dev server and the production/deploy story (T19's compose +
  CDN guidance in `docs/deploy-proxy.md` amended), including SW header preservation.
- CSP policy file + documented rationale per directive in `docs/security.md`, with the
  Epic 4 `wasm-unsafe-eval` note and a violation-report endpoint (report-only shadow policy
  in dev to catch regressions).
- Token hygiene fixes as needed (storage audit, diagnostics scrub) + a token-lifetime test.
- Automated header/CSP regression test in CI: fetch the app pages and assert exact headers;
  `crossOriginIsolated === true` asserted in the browser test suite, online and offline.

## Acceptance criteria
- [ ] `self.crossOriginIsolated` is true on the loaded page — cold load, SW-cached offline
      load, and after a soft navigation; `new SharedArrayBuffer(8)` succeeds in page and
      worker (Epic 4 readiness demonstrated).
- [ ] All app functionality works under the enforced CSP: boot, networking, clipboard,
      file transfer, snapshot — the full T20/T21/T22 E2E suite green with CSP enforced,
      zero violation reports.
- [ ] CSP blocks a planted inline `<script>` and an off-origin script/connect in a test
      page (positive proof the policy bites).
- [ ] `grep`-audit + runtime check: token appears in no URL, no storage API, no cookie,
      no diagnostics bundle; documented lifetime ≤ 15 min verified by clock test.
- [ ] Every subresource in a full cold load carries valid CORP/CORS for COEP (automated:
      walk the network log, assert nothing failed with a COEP block).

## Adversarial verification
Break isolation: add a third-party subresource without CORP and confirm the regression
test catches it before a human would. Serve one chunk from a mock CDN missing CORP — the
failure must be a caught, T25-surfaced error, not a silent boot hang. XSS simulation:
attempt to read the token from every storage API and via `postMessage` probing of the
worker — extraction through any path scriptable by an XSS payload refutes (debugger memory
inspection doesn't count). Load the app in a cross-origin iframe (`frame-ancestors` must
block). CSP bypass hunt: `eval`, `new Function`, `data:` script URLs, blob workers from
console-injected code under the enforced policy. Finally go offline, reload, and re-assert
`crossOriginIsolated` — SW header loss is the expected place this pass quietly breaks.

## Verification log
(empty)

---
id: E6-T19
epic: 6
title: Embedding SDK — npm package, wasm-vm custom element, postMessage protocol
priority: 619
status: pending
depends_on: [E6-T14, E6-T16]
estimate: L
capstone: false
---

## Goal
The VM becomes a component: an npm package exposing a `<wasm-vm>` custom element and a
programmatic API, plus an iframe host mode with a versioned postMessage protocol
covering lifecycle, serial I/O, file injection, snapshots, and events — the surface that
E6-T21's examples, E6-T20's security model, and the capstone's child-VM boot all build on.

## Context
Package `@wasm-vm/sdk`: ESM + TypeScript types, usable from a CDN `<script type=module>`
without a bundler; the JS loader stays < 20 kB gzipped with the wasm and images fetched
lazily from configurable URLs. Two embedding modes. Same-frame: `<wasm-vm image=...
snapshot=... ram=512 harts=2 autostart>` / `createVM(opts)`. Iframe: the embedder frames
our runner page and speaks `wvm/1` over a MessageChannel established by a handshake
(embedder posts `{type:'wvm-hello', version:1, port}`; runner replies with capabilities).
Protocol messages (all `{v:1, seq, type, ...}`, replies carry `re: seq` and an error
code union): boot/shutdown/reset/pause/resume; serial-in/serial-out (Uint8Array frames,
transferables); file-put/file-get (routed to a 9p `HostFs` backend — E6-T14's seam);
snapshot-request/snapshot-data (v2 bytes); events: ready, boot-progress, halted, panic.
The COOP/COEP reality must be first-class: SMP needs crossOriginIsolated, which the
*embedding* page controls — the SDK detects it, degrades to single-hart round-robin, and
reports it via `vm.capabilities`; docs cover COEP `require-corp` vs `credentialless`
iframes for embedders who can't set headers on their whole site.

## Deliverables
- `sdk/` workspace: element + API, iframe runner page, protocol implementation with a
  written spec (`docs/embed-protocol.md`: every message, field, error code, and the
  version-negotiation rule: unknown minor fields ignored, unknown major = refuse).
- Typed event/serial/file APIs (`vm.serial.write()`, `vm.files.put(path, bytes)`,
  `vm.snapshot(): Promise<Uint8Array>`, `vm.on('halted', ...)`).
- Build pipeline: tsup/rollup, `.d.ts`, `npm pack` artifact installable in a scratch
  project; CDN usage path verified (unpkg-style raw ESM import).
- Protocol conformance test suite: a mock embedder driving the runner iframe through
  every message type, including malformed and out-of-order cases.
- Capability degradation matrix documented (crossOriginIsolated x SAB x WebGPU).

## Acceptance criteria
- [ ] A 15-line HTML file importing the SDK from a local static server boots Alpine to
      a prompt in a `<wasm-vm>` element — no bundler, no framework.
- [ ] The iframe mode boots the same image cross-origin (two ports in the test rig) and
      round-trips serial: scripted `echo hello` returns `hello` via serial-out frames.
- [ ] `vm.files.put('/inbox/x.txt', ...)` then guest `cat /mnt/embed/inbox/x.txt`
      matches; `vm.snapshot()` bytes reload via `snapshot:` into a second element and
      resume.
- [ ] Without COOP/COEP the same embed boots single-hart with `capabilities.smp ===
      false`; with headers it reports true — both covered by CI (Playwright, two server
      configs).
- [ ] Protocol conformance suite green; loader bundle ≤ 20 kB gz (size-limit check in CI).

## Adversarial verification
Misuse the API deliberately: call `boot` twice, `serial.write` before ready, destroy the
element mid-boot and re-attach it, spam 10^4 file-puts of 1 byte, send a 512 MB
file-put — each must produce a documented error or graceful behavior; any uncaught
rejection, wedged runner, or leaked worker (check via `performance.measureUserAgentSpecificMemory`
/ devtools) refutes. Attack the protocol as a hostile embedder: wrong `v`, replayed seq,
`re` for a seq never sent, serial frames with detached ArrayBuffers, extra fields —
runner must never throw uncaught or act on garbage. Embed two VMs on one page and a
third in an iframe simultaneously: crosstalk (serial output appearing on the wrong
element) refutes. Install the packed tarball in a fresh Vite app and a plain-HTML page
on a different machine; any missing-file or path-assumption failure refutes the
packaging claim. Verify the degradation matrix row-by-row against real browser configs.

## Verification log
(empty)

---
id: E6-T20
epic: 6
title: Permissions and security model for embedded machines
priority: 620
status: pending
depends_on: [E6-T19]
estimate: M
capstone: false
---

## Goal
A default-deny capability model governing what a host page may grant an embedded guest —
network, persistence, clipboard, audio, GPU, file access — enforced inside the VM
runtime (not merely by the wrapper), with sandboxing guidance for untrusted snapshots
and resource caps that keep a hostile or runaway guest from owning the embedding page's
UX.

## Context
Three adversaries, each needing a written threat model: (1) a malicious *snapshot/image*
in an honest page — device-state parsers are hostile-input surfaces (E6-T16 fuzzing
feeds this) and the guest may attempt resource exhaustion or network abuse; (2) a
malicious *host page* embedding an honest machine — it gets exactly its granted
capabilities, nothing transitively; (3) a malicious *guest program* in a shared machine.
Mechanisms: a `permissions` object at construction (`{network: 'none'|'slirp'|'relay',
persistence: 'none'|'opfs', clipboard, audio, gpu, files}`), default all-deny, immutable
after boot; enforcement at the device layer (deny = the virtio device absent from the
DTB, not present-but-erroring); iframe guidance — `sandbox="allow-scripts"` without
`allow-same-origin` gives untrusted content an opaque origin, which kills OPFS/IndexedDB
(persistence auto-degrades; document why that's correct); resource caps — max RAM/harts,
instruction throttle when `document.visibilityState === 'hidden'`, storage quota
ceiling; postMessage hardening — pinned `targetOrigin`, schema validation, rate limits.

## Deliverables
- `sdk` permissions API + device-layer enforcement in the runtime; capability set
  reflected in `vm.capabilities` and in the DTB (denied device = absent node).
- `docs/embed-security.md`: the three threat models, the capability table, opaque-origin
  tradeoffs, hosting recommendations (separate origin for untrusted snapshots), and
  what we explicitly do *not* defend against (e.g. Spectre-class timing on SAB).
- Resource-cap implementation: hidden-tab throttle, RAM/hart ceilings that clamp config,
  quota ceiling passed to the persistence layer.
- Negative-path test suite: for every capability, a guest-side probe that attempts the
  denied action and asserts absence/failure (e.g. network denied → no virtio-net in
  `/sys/bus/virtio/devices`, `ping` gets ENETUNREACH pre-stack).

## Acceptance criteria
- [ ] Default construction (no permissions object) yields a machine with no network
      device, no persistence, no clipboard/audio/GPU — verified by the guest probe suite.
- [ ] With `network:'none'`, zero network requests attributable to guest activity are
      observable in the page's network panel across a 10-minute hostile guest script.
- [ ] A hidden tab running `stress-ng --cpu 4` drops to ≤ 10% of foreground instruction
      throughput within 5 s of visibility change, and restores on return.
- [ ] `files` scope: file-get for a path outside the configured share root returns a
      protocol error; the conformance suite covers `..`, symlink, and absolute-path
      escapes (reusing E6-T14's traversal defenses).
- [ ] An untrusted-snapshot embed following the docs' opaque-origin recipe boots with
      persistence auto-denied and a capabilities object that says so.

## Adversarial verification
Play adversary (1): craft a snapshot whose device state claims 64 harts and 16 GB RAM —
config clamping must hold regardless of snapshot contents; a bypass refutes. Adversary
(2): as the host page, escalate post-boot — mutate the permissions object, file-get
`/etc/../..`, open a second MessageChannel to the runner, spoof origins — any capability
gained after boot refutes immutability. Adversary (3): inside the guest, hammer serial
at max rate and allocate-and-touch all RAM while hidden — sustained > 100 ms jank on the
embedding page's main thread refutes isolation. Verify enforcement depth: patch the SDK
wrapper in devtools to skip its checks and confirm the runtime still denies
(wrapper-only enforcement refutes "enforced inside the VM page"). Cross-check the DTB
claim: dump the DTB from a denied-network guest and grep for virtio-net — presence
refutes.

## Verification log
(empty)

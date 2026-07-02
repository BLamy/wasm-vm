---
id: E3-T21
epic: 3
title: Host to guest file transfer - drag-and-drop upload and download
priority: 321
status: pending
depends_on: [E3-T08, E3-T14]
estimate: L
capstone: false
---

## Goal
Files cross the host/guest boundary in both directions: dragging a file onto the page lands
it in the guest at `~/uploads/`, and a guest-side command (`vm-download <path>`) triggers a
browser download of a guest file — built on an explicitly decided mechanism.

## Context
Decide the mechanism first, in-task, with a short decision doc comparing: (a) **virtio-9p /
virtio-fs shared filesystem** — most general, but a large new device + guest driver surface;
overkill for Epic 3 (note it as the Level 6 OPFS-sharing candidate); (b) **sideload block
device** — write files into a generated FAT image attached as `vdb`, guest mounts it; simple
but clunky for downloads and hot-adds; (c) **guest agent over slirp** — a small static
binary (Rust, cross-compiled riscv64-musl, baked into the image by T11) listening on a
guest port, plus a reserved host-side control endpoint in slirp (e.g. TCP 10.0.2.4:1); the
page streams files over the existing network stack with a trivial length-prefixed protocol.
Recommendation to evaluate first: (c) — it reuses tested infrastructure, handles both
directions, and needs no new device. Whatever wins: uploads must stream (a 500 MB file must
not be buffered whole in JS memory — use the File's stream reader), land with sane
names/permissions (sanitize hostile filenames: `../`, newlines, 255-byte limits), and
downloads must stream guest→browser via a Blob/StreamSaver-style sink. Durability: an
upload followed by tab kill must survive per T08 rules (agent fsyncs, or documents that it
doesn't and the UI says "syncing…" until flush).

## Deliverables
- `docs/design/file-transfer.md`: the three-way comparison, decision, protocol spec for
  the chosen mechanism.
- Implementation: drag-and-drop target + upload progress UI; `vm-download` guest command
  (and agent, if (c)) with download progress; filename sanitization.
- Agent build integrated into the T11 image pipeline (if (c)); or the sideload/9p
  equivalents if the decision goes differently.
- E2E browser test: round-trip a generated 100 MB random file host→guest→host, sha256
  equality asserted.

## Acceptance criteria
- [ ] Drag a 100 MB file onto the page: it appears at `~/uploads/<name>` with matching
      sha256; JS heap growth during upload stays under 32 MB (performance.memory or DevTools
      heap snapshot — proves streaming).
- [ ] `vm-download /etc/os-release` produces a browser download with identical content;
      same for a 100 MB binary file.
- [ ] A file named `../../etc/passwd<newline>x` uploads as a sanitized name inside
      `~/uploads/`, never outside it.
- [ ] Upload completes → `sync` → tab kill → reboot: file intact (T08 integration).
- [ ] Two simultaneous uploads both complete correctly (distinct contents verified).

## Adversarial verification
Kill the tab at 50% of a large upload, reboot, and check the guest: a truncated file must be
clearly partial (documented naming, e.g. `.part` suffix) — a file that looks complete but
isn't refutes. Upload a 0-byte file, a file with a 250-char unicode name, and 1000 tiny
files in one drop. Drop a *directory* (webkitGetAsEntry) — either it works or it's cleanly
refused with a message. Attempt path traversal through the download side: `vm-download
../../..//etc/shadow` style guest paths are fine (guest chooses its own files) but verify
the *host* side never writes outside the browser download sandbox. If mechanism (c): portscan
the control endpoint from the guest — any capability beyond the file protocol (arbitrary
host fetch, eval) reachable from guest code refutes the security posture. Fill the disk to
quota mid-upload (T10 interplay) and verify the error surfaces in the upload UI.

## Verification log
(empty)

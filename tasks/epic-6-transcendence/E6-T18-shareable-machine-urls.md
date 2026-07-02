---
id: E6-T18
epic: 6
title: Shareable machine URLs — a snapshot becomes a link anyone can boot
priority: 618
status: pending
depends_on: [E6-T17]
estimate: M
capstone: false
---

## Goal
One click turns a running machine into a URL; anyone opening that URL boots that exact
machine state — with streaming boot-before-fully-fetched, honest size budgets, and a
security flow that confronts the fact that a full-RAM snapshot is a memory dump full of
secrets.

## Context
Flow: share → E6-T17 upload of an immutable snapshot → URL of the form
`/m/{manifest-hash}#k={key}` — the manifest hash makes the link content-addressed and
tamper-evident; the decryption key (when encrypted) rides in the URL *fragment*, which
never reaches the server. Boot-from-link: fetch manifest, start fetching chunks with
priority ordering (hart state + device state + RAM chunks by first-touch order recorded
at snapshot time), and begin execution once critical sections land — lazy-fault
remaining RAM chunks on access (the E6-T16 chunk independence exists for this). The
security problem is real and must be treated as primary, not a footnote: RAM contains
shell history, ssh keys and agents, kernel entropy, env vars, page cache of *deleted*
files. Two share modes: (a) full-state (RAM+disk) with a mandatory interstitial listing
concrete risks and a best-effort `vmctl scrub` helper (clears histories, sshd host keys,
/tmp — documented as best-effort); (b) disk-only ("fresh boot of this disk"), the safe
default. Shared links are immutable and unrevocable once fetched — say so in the UI.

## Deliverables
- Share UI: mode picker (disk-only default), interstitial with risk list for full-state,
  progress, resulting URL with copy button; size shown before upload.
- Boot-from-link path: manifest fetch, prioritized chunk streaming, lazy RAM faulting
  with a visible "streaming" indicator, integrity failure = named refusal screen.
- `vmctl scrub` guest helper + documentation of exactly what it does and does not clean.
- RAM-snapshot size work needed to hit budget: zero-page elision verification, guest
  `fstrim`/page-cache drop hook before full-state share (documented `sync; echo 3 >
  drop_caches` step automated via the guest agent).
- `docs/sharing.md`: threat model, immutability/revocation reality, link anatomy.

## Acceptance criteria
- [ ] Full-state share of an idle 256 MB Alpine machine produces a link ≤ 60 MB of
      fetched bytes to reach an interactive prompt (network panel measurement).
- [ ] Opening the link in a different browser (fresh profile, never seen this origin)
      boots to the shared state: a marker process started before sharing is running,
      terminal scrollback intact.
- [ ] Time-to-interactive-prompt from link click < 20 s on a 50 Mbps connection
      (throttled devtools profile, documented).
- [ ] Disk-only mode shares boot fresh (no RAM residue: no marker process, empty
      scrollback) while preserving the disk contents.
- [ ] Encrypted share: the key appears only in the fragment; server access logs (MinIO
      CI rig) contain no `k=` parameter; wrong-key open fails with a clear error.

## Adversarial verification
Be the recipient attacker: fetch a full-state link and grep the raw chunk bytes for the
sharer's known secrets planted before sharing (a bash history line, a fake ssh key, an
exported env var) — for full-state mode they *will* be present; the refutation target is
the UX: if the interstitial did not explicitly warn about each planted category, or if
scrub claimed to remove something still present, that refutes. For disk-only mode the
same grep finding any planted RAM-only secret refutes hard. Attack the link: mutate one
byte of a chunk via a MITM proxy — boot must refuse (manifest-hash chain); swap the
entire manifest for another valid one — the URL's hash must not match (content
addressing test). Attack streaming: throttle to 2 Mbps and click around during lazy
faulting — a deadlock between a faulting hart and the fetch path refutes. Open the link
in Safari and Firefox — an engine-specific failure refutes "anyone boots it".

## Verification log
(empty)

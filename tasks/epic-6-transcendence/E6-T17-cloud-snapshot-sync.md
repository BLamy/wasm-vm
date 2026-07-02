---
id: E6-T17
epic: 6
title: Cloud snapshot sync — presigned-URL uploads, chunk dedupe, conflict handling
priority: 617
status: pending
depends_on: [E6-T16]
estimate: M
capstone: false
---

## Goal
Opt-in synchronization of snapshots (and disk overlays) to S3-compatible storage via
short-lived presigned URLs minted by a minimal broker — content-addressed chunks for
dedupe and resume, compare-and-swap manifests for conflict safety, and optional
client-side encryption so the server can be honest about seeing nothing.

## Context
Architecture: the browser never holds cloud credentials. A tiny broker service
(deployable to any S3-compatible target: AWS S3, Cloudflare R2, MinIO for CI) checks an
auth token and mints presigned PUT/GET/HEAD URLs. Objects: immutable chunks named by
BLAKE3 (`chunks/{hash}` — the v2 format's 2 MiB chunk design from E6-T16 is the unit),
uploaded with `If-None-Match: *` so re-upload of an existing chunk is a cheap no-op
(dedupe across snapshots of the same machine is the common case); and a small mutable
manifest per machine (`machines/{id}/head`) updated with ETag `If-Match` — a CAS. CAS
failure means another tab/device moved head: the client must fail-and-fork (new machine
id, user-visible choice), never merge silently. Resume = HEAD each chunk before PUT.
Optional client-side encryption: XChaCha20-Poly1305, key derived from a user passphrase
(argon2id), chunk hashes computed over ciphertext; the privacy posture doc states
exactly what the server learns either way (sizes, timing, machine id).

## Deliverables
- `sync/` client module: chunk inventory, presign requests, parallel resumable upload/
  download with backoff, CAS manifest update, encryption layer behind a feature flag.
- `broker/`: the presigning service (single small Rust binary or worker), token check,
  bucket policy documentation, MinIO-based integration test rig in CI.
- Conflict UX: on CAS failure, a dialog offering "fork this machine" vs "discard local";
  no third option; the outcome recorded in the manifest lineage field.
- `docs/privacy.md`: opt-in stance (zero network calls unless the user enables sync),
  data inventory, encryption caveats (passphrase loss = data loss).

## Acceptance criteria
- [ ] Push a 300 MB snapshot to MinIO, wipe local state, pull on a fresh profile, boot:
      the restored guest matches (in-guest marker file + RAM-resident job check).
- [ ] Second push after small guest changes uploads < 10% of total chunk bytes (dedupe
      measured and asserted by the integration test).
- [ ] Kill the network (devtools offline) mid-upload at 50%; retry completes without
      re-uploading finished chunks (byte counter assertion).
- [ ] Two tabs push divergent states: exactly one wins CAS; the other gets the fork
      dialog; both resulting machines boot; no manifest ever references a missing chunk.
- [ ] With encryption on, bucket-side objects are ciphertext (integration test greps a
      known plaintext RAM pattern across all stored objects and finds nothing).

## Adversarial verification
Attack the broker: request presigns for other machine ids/paths with a valid token
(authorization confusion), expired tokens, and path-traversal object keys
(`chunks/../machines/x/head`) — any cross-tenant or cross-path grant refutes. Attack
integrity end-to-end: corrupt one chunk directly in the bucket, pull — the E6-T16 hash
check must name the bad chunk; a booted-but-wrong machine refutes catastrophically.
Attack the CAS: script 20 concurrent manifest updates from parallel processes against
MinIO; more than one winner per generation, or a lost fork lineage, refutes. Attack
resume-with-lies: interrupt an upload, then modify the local snapshot, then resume — the
client must detect the changed chunk set rather than stitch a franken-manifest. Verify
the opt-in claim with the network panel: from fresh profile through boot, snapshot, and
normal use with sync disabled, zero requests to the broker origin — any request refutes
the privacy posture.

## Verification log
(empty)

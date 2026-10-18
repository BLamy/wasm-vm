VERDICT: verified

# E9-T04 publication-only audit

Prior P0–P9 remain HELD. No runtime, dependency or permanent-test boundary changes
are claimed. Before inspecting the public run's effect state, predict:

- H1: the report hashes to `5bca44684fdbf167c44c29bab5ec95d4b443f80ce1b5b81e76577c716d7a66b6`;
  all 751 originals and 37 compact files authenticate; all inventoried sources match
  deployed source 2bb4c953 and the prior held runtime/test boundary.
- H2: deployment log names the reported immutable preview and production; every one
  of the 15 reported public assets equals committed dist bytes, and fresh read-only
  HTTP fetches from preview and production preserve those exact digests.
- H3: the recorded public page has 127/0, no errors, verified disk pip, and all actual
  admission/owner/pending-read/pending-write/bounded-failure critic outcomes hold.
- H4: public before/after/live/fork raw captures and restores match, independently
  canonicalized roots and read-only ext4 reads yield the four exact expected files,
  the inode block maps agree, and raw durable live rows plus the old root remain stable.
- H5: the real retained factory boot succeeds and its current fresh epoch has a
  physical drawn receipt, positive actual retirements, qualification, and no loss or
  poisoning. No replay-qualification claim is inferred.

## Results

- **H1 HELD.** Authenticated all 751 originals and 37 compact files against the
  provenance packet; report SHA-256 matches the prediction. All 30 inventoried
  runtime/test/harness sources match deployed commit `2bb4c953` and the prior held
  final proof. Product/native/driver sources have no diff from the held boundary.
  The only shipped differences since verdict a08319e2 are E9-T04 catalog metadata
  (515→516 verified; E9-T04 criteria/status/log) and the service-worker version stamp.
  The worker packet generator was inspected; compressed coverage decompresses to
  the exact authenticated original.
- **H2 HELD.** The deploy log records Cloudflare success at
  `https://7a2f6b85.wasm-vm.pages.dev` and production. All 15 recorded public assets
  have HTTP 200/digests equal to committed dist. Fresh independent curl reads compare
  complete bytes for those 15 assets plus `sw.js` on **both** preview and production:
  32 HTTP-200 exact matches. Both task catalogs show E9-T04 verified/3 of 3 criteria,
  total verified=516. See `publication-http.json` for exact URLs, lengths and hashes.
- **H3 HELD.** The authenticated actual public run binds source `2bb4c953`, production
  URL and development=false. It has 127 passed/0 failed, no demo errors and verified
  disk pip. Six invalid descriptors, six incompatible options, zero-instruction
  running/concurrent/stopped-owner outcomes, original pending-read fetch, strict
  4096-byte WritePending drain, unchanged icount clocks, generation 0→1, unsupported
  capture and isolated 16-error bounded corruption refusal all hold.
- **H4 HELD.** Independently decoded all four WVOD captures and SHA-256/canonical
  roots; each capture equals restore. Read-only debugfs re-reads the owned original
  ext4 images and returns exact before/after/fork/live bytes. Actual inode maps for
  every file resolve to block 33281. Capture instruction counts do not advance,
  before-again equals before, and all 8471 bytes of live block/meta rows remain
  identical. The parent has all 37 surviving references inside the 60-reference
  parent+child union after child session-row deletion and reauthentication. See
  `publication-effects.json` for exact root hashes, generations and file hex.
- **H5 HELD.** The public factory boot returns `{ok:true}`, qualifies without loss or
  poisoning, retires **2,499,808** instructions and has a physical drawn receipt in
  current epoch `0000000000000004`. This is the same retained v2 compatibility
  boundary already held, and makes no accelerated replay qualification claim.

Prior **P0–P9 remain HELD**. No code, dependency, permanent test or recording harness
changed; no unrelated gate or cold clone was rerun. Task status remains verified.
Publication provenance SHA-256:
`db09cd0ed7c8fa3951ac23d6d40317478b0d8d1543ff103794147c6a27f943c5`.
Public run report SHA-256:
`5bca44684fdbf167c44c29bab5ec95d4b443f80ce1b5b81e76577c716d7a66b6`.


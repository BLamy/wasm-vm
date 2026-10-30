# E9-T12 fresh verifier predictions

Written after AGENTS.md, task/qualified contract and the entire task diff were oriented, before opening recorded evidence. Runtime 76b56b01f048306ca2bcbaa90d522bb6a08543cc; metadata audit 0d04ce9d6f0aa80aeaefefff37351861f2b7088f. Generated source/dist copies and the complete 3,842-word listing have been inspected through their producer and exact binary correspondence.

Each row starts PENDING. No final verdict or task mutation is authorized until the implemented worker claim arrives.

P1 — Ownership and origin. Every indexed artifact digest matches bytes; the retained native/build gates describe runtime 76b56b01f048, and the completed proof differs only in the two audited contract documents. The cold source has independent Git metadata without object alternates, scrubbed Rust/Cargo environment and an initially empty compiler target. No selected command is skipped or silently failed.

P2 — Pending guest boundary. At transition/retired 4096/4096, native section 20 contains precisely block-0 ID 1, block-1 ID 2, posted named-agent ID 3 and due capture ID 4. Cursor/sequence are zero; block, agent and capture used indices and capture DMA/status remain unpublished. The checkpoint retains actual descriptors and guest deadlines rather than reconstructing host queues.

P3 — Exactly one positioned completion. Accepted request IDs are 2,3,4,1 at 4096,4269,4442,4615, all before/ordinal 1, sequence/cursor 1..4. Duplicate, corrupt, unowned or wrong-position completions reject without advancing the frame or event cursor. Live callbacks are refused in replay.

P4 — Payload identity. Each durable immutable base object hashes to its frozen manifest reference and contains only the 512 guest bytes. Timing/request/delivery metadata is a distinct event object. Reopening the store preserves four exact completion envelopes and their order.

P5 — Architectural effects. At transition/retired 9096/9096 the block used index is 2 with head 3 before head 0, agent/capture used indices are 1, three device IRQ status bits are set, and real DMA holds the two prescribed base sectors, file-agent bytes and S16 bytes 34 12 cd ab. The guest's own six-word report is [2,1,1,1,1,1]. All replay frames match and retired traces equal the original suffix under independent budgets 1/7/4096.

P6 — Cancellation and failure. A cancelled block request accepts one empty completion, then publishes I/O error without writing payload. Reuse of its lease rejects as unknown; corrupt immutable bytes reject before any mutation. A saved pending checkpoint followed by restore revokes all old lease identities even when numeric request IDs recur.

P7 — Transactional checkpoint. Malformed device/sound metadata rejects before destination mutation or lease revocation. Pending requests, ready capture, COW bytes, cache residency and completion/request cursors round trip exactly. Cross-section descriptors and request intents must remain coherent at restore; a structurally parseable but mismatched capture/request frame must reject without changing the original frame or live lease.

P8 — Capture semantics. An awaiting owned capture result never changes DMA, PCM status or used ring. Short successful capture writes only real samples, preserves zero remainder and normal XRUN behavior; failure publishes I/O error. Guest STOP/reset revokes obsolete capture requests before a paused callback. S16 mono/stereo 48 kHz produces deterministic guest-clock deadlines across host budgets.

P9 — Bounds and cache. Completion-order eviction removes the oldest unpinned chunk, never a chunk held by a pending read. Over-budget/payload/malformed IDs reject before allocation or publication. The nonwrapping ID/cursor and 256-pending / 16 MiB cache / 256 MiB COW limits are enforced or have specifically justified invariant waivers.

P10 — Admission and regression. Existing unrecorded transport admission and active playback stop before guest execution continues; original legacy sound restore behavior remains intact. Built browser suite is 127/0 with zero errors; the touched pip is live and durable reopen works. The retained GPU factory regression still executes a retirement and physical draw.

P11 — Bounded novel attack. Tamper a valid checkpoint's owned capture request/descriptor cross-reference while retaining valid framing/checksums; predict refusal and unchanged machine/live lease. Expand only within the changed persistence boundary if needed. Independently vary callback schedule seeds beyond the worker's fixed 1..32 and use stereo/short/error/restore edges when coverage requires them.

P12 — Hunk coverage. Every runtime hunk executes in the authenticated worker recording or a cited fresh deterministic recording; types/config/generated duplication/private impossible states receive a specific written waiver. Missing meaningful branches remain NEEDS EVIDENCE, not assumed covered by a passing test count.

P13 — Sabotage. A scratch-only removal of stale-incarnation enforcement causes the selected stale-restore regression to fail; restoring the untouched runtime returns it to green. Preserve the red recording and source patch separately; do not modify implementation in the shared worktree.

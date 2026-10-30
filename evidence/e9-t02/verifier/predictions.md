# E9-T02 fresh verifier predictions

Written after reading AGENTS.md, the complete task, and the frozen diff, and BEFORE opening worker evidence.
Frozen code head: eb5a2484f1f7ff4d68ab2ccc7881b12fe65eae06
Base: 653b95b570d1c61facbcabcd3be2cfb07ae44f82
Boundary: metadata/event/checkpoint codecs and read-only compatibility; no guest execution or UI.

- P1 Immutable identity binding. At admission of the literal fixture, the identical runtime returns Ok. Independently changing VM, Wasm, base image, kernel, initramfs, RAM, harts, any device field, GPU renderer/profile, or replay policy returns a typed IdentityMismatch. Before/after canonical manifest bytes remain identical.
- P2 Exact positions. Decoding the fixture yields sequence 9007199254740993 at begin and 9007199254740994 at end; canonical serialization retains these decimal strings. u64::MAX round-trips in events, while JSON numbers, signs/leading zeroes, and u64::MAX+1 are Malformed.
- P3 Required versions and duplicate/oversized sections. Unknown manifest/event/checkpoint versions return Version; unknown required event/extension/asset/input returns UnsupportedRequired. Duplicate fields are Malformed; duplicate device/asset/checkpoint/extension/input labels are Duplicate. Metadata, vector counts, blob, event payload/intent, and chunk byte/count limits refuse at their boundary without mutation.
- P4 Integrity and ordering. At decode_records, one changed byte gives DigestMismatch; truncation gives LengthMismatch; count/endpoints inconsistent with authenticated bytes fail Invalid. Sequence gaps/duplicates/regressions, retired>transition, overlapping MMIO, checkpoint cursor mismatch, and counter overflow are refused.
- P5 Honest availability. Current foreign runtime yields UnavailableRuntime. Retained exact runtime plus byte-hashed assets gives Available with the corresponding index; one missing/changed/wrong-length asset yields UnavailableAsset. Old manifest bytes stay unchanged in every case.
- P6 Capture/GPU/checkpoint policy. Exact replay must include the required sources for every advertised device and clock mode, and runtime admission requires those sources installed. GPU topology/profile and machine/GPU checkpoint binding are all mandatory and round-trip intact; checkpoints-only has no event claim.
- P7 Evidence provenance. Warm report names the frozen head, every source and evidence SHA-256 matches the actual bytes, native/Wasm corpora each execute 9 cases with zero ignored tests, and all prescribed affected gates pass. The one worker cold clone has the same head/source digests and scrubbed-env passed gates. Production web/Wasm artifacts have no changed diff.
- P8 Bounded novel attack. Duplicate `storage` discriminants and foreign fields inside the internally tagged event payload must return Malformed, even when both discriminants agree; ordering tricks must not bypass authenticated chunk count/endpoints. The manifest/event/chunk input buffers remain byte-identical after refusal.
- P9 Sabotage sensitivity. In a scratch copy only, remove the GPU identity equality check. The existing GPU binding/admission test must fail (IdentityMismatch expected, Ok observed), proving the exercised test detects this trust-boundary sabotage.
- P10 Coverage. Every executable changed hunk must execute in the recorded corpus or a verifier attack; any uncovered refusal/policy branch must receive a specific additional test or a narrow, written non-runtime waiver. Dependencies/config/docs/types and impossible error branches need explicit justification.

Initial status: all predictions PENDING until evidence is inspected.

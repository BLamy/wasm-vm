# E9-T04 verifier predictions (recorded before opening worker evidence)

Scope: worker runtime/test head b5baad0a4b1cddcbd08299b438292258352b2c08;
submission 40113a6fb98d279905fba30de7219a3780f8747f; base 7918fbe0.
T03's unchanged storage/publication findings carry forward. T05 coherent machine
checkpoints and T07 atomic deletion/reclamation are outside this disk-root claim.

- P0 provenance: the original report hashes to
  1e2577042ba20e4ed3bd63fe0eb77efbd41371be85255689112ce40c39366efd;
  every authenticated file and inventoried runtime source matches its digest and frozen head.
- P1 real file roots: independent root/delta decoding and ext4 reads yield exactly
  `e9:before\n`, `e9:after\n`, `e9:fork\n`, `e9:live\n`. The captured/restored
  delta bytes match, and reverse-order guest boots read the after and before values.
- P2 stability: before publication spans the later live write; before/after/fork
  contain their distinct contents at the same physical block. Old root bytes stay
  identical after sibling writes; durable live block/meta rows are byte-identical
  before and after private boots. Capture does not increase retired instructions.
- P3 identity/authentication: foreign geometry/content/layout and exact-generation
  mismatches cause zero payload loads and no replacement overlay. Missing/corrupt
  descendants and malformed/mutated/detached producer views refuse complete restore.
- P4 shared retention: the surviving parent mark set contains its metadata and every
  referenced block, is a subset of the parent+child union, and still authenticates
  after deletion of the child session row. No atomic reclamation claim is inferred.
- P5 compatibility/browser: recorded built demo has 127 passed/0 failed, zero page or
  console errors, and a verified disk pip. Retained v2 factory bytes are unchanged;
  its v2 page client boots a qualified nonlost GPU that retires and physically draws.
- P6 coverage: every changed runtime hunk has a direct deterministic execution
  witness or an explicit narrow waiver; wrappers/config/generated declarations are
  checked against their source. New failure branches are attacked within scope.
- P7 bounded novel attack: independent seeds will use equal-generation sibling roots,
  a nonaligned image tail, duplicate block contents, divergent same-index writes,
  survivor mark union, and attempted wrong-identity loads. Restore must preserve each
  original full write set and refuse the bad identity before loader invocation.
- P8 sensitivity: an isolated test-only mutated fixture presented to the promoted
  attack must fail at its independent expected-byte assertion; baseline must pass.
- P9 final cold proof: the one pristine-clone run is on the final test-only candidate,
  with no alternates/target/node caches, scrubbed Rust/Cargo environment, independent
  source inputs and output outside the clone; the deterministic acceptance passes.

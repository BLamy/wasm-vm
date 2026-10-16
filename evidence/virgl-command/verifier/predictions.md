# E6-T12a independent verifier predictions

Prepared from task/source/pinned protocol before worker evidence inspection and sent
to the worker in the verifier session. Runtime freeze: b2636b5073b1e81f2172b6b0b268fea7ce381f0d.

- P1: Eight original streams yield 39/3/6/3/8/3/6/142 packets, 210 total,
  32 families, eight created types. Typed fields follow pinned protocol words.
  Event 173 outer headers remain at 0, 4096, 4104 regardless of padding content.
- P2: Every byte prefix accepts only at a whole-packet boundary; an invalid tail
  rejects the complete result with no commands or retained parsing state.
- P3: First excess byte/packet/text/array/slot budget fails; arithmetic cannot wrap
  to an accepted range, throw, hang or allocate outside documented bounds.
- P4: NaN/Inf/reserved bits and unsupported active stages reject; valid values,
  handles and all-zero inactive resets accept without capture-hash allowlisting.
- P5: Source bytes and shader framing are original. Provenance labels are separate
  from acceptance-loader-computed hashes. Clarification before freeze explicitly
  assigns authentication to the loader, not the synchronous runtime API.
- P6: Nonzero host offsets, caller mutation/detachment and hostile typed-array
  property accessors cannot change output or trigger input property callbacks.
  Plain provenance accessors reject without invocation. Arbitrary JavaScript
  Proxy traps and tampered platform intrinsics are outside the guest-byte API.
- P7: Native/browser canonical results and served source hashes match with zero
  browser errors; sabotage fails an independent oracle; scrubbed clone succeeds.

Novel bounded attack chosen before execution: exhaustive 16-bit payload-length
values for a fixed-size command; all opcode/object bytes; all shader text byte
values; typed-array subclass getters and foreign-realm byte views. Independent
mutation seeds: 0x13579bdf, 0x2468ace0, 0xdeadbeef, 0x10293847.

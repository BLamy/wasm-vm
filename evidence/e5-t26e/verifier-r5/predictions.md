# E5-T26e remediation 4 verifier predictions

Frozen before inspecting the fixture-remediation diff or rerunning its focused tests.

1. **P1 worker restore seam.** The exhaustive production-protocol test must dispatch both
   `confirmAgentHello` and `restoreDesktopSnapshot` through the real loader page client and worker
   runtime into the loader-controller fake. It must assert the restore bytes and returned
   `1024x768` host viewport, rather than merely adding methods that are never invoked.
2. **P2 byte ownership.** The restore request crossing the worker boundary must own a copied byte
   sequence. Mutating or transferring the caller's original buffer after dispatch must not alter
   the bytes observed by the controller fake.
3. **P3 incremental held results.** Because the response is claimed to change only a test fixture,
   the semantic implementation, T23d fresh-HELLO fence, real T22 `PresentationController` path,
   dirty-sink/missing-device cold fallback, and prior evidence digests must remain byte-identical
   to the boundaries already classified HELD by verifier r4.
4. **P4 evidence identity and gate.** The remediation JSON digest must match its task-log claim,
   name the real semantic and fixture commits, and the 43-test worker/Channel/restore command must
   pass at the submitted repository head. The metadata-only commit above the fixture must not
   change runtime or fixture behavior.
5. **Novel attack.** Dispatch restore with a non-zero-offset typed-array view, mutate its backing
   buffer immediately after the page-client call, and require the loader fake to observe exactly
   the original view bytes and no adjacent sentinel bytes. This attacks both aliasing and incorrect
   view-bound handling.

Scope waivers carried forward: WebKit, independent machines, browser CRC/reload, and host rr.

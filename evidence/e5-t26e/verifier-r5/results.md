# E5-T26e remediation 4 verifier results

Repository head reviewed: `42f6079505522749f1e1baa2cca463b23e5e058d`.
Semantic implementation: `ea14c48f12a323ff60fb21744a34c10e814cd68a`.
Fixture remediation: `fb6c2f0b00dc5f980d12180dfb7b0712bae2aaa1`.

## Commands and observations

1. `env -u NODE_OPTIONS node --test web/tests/e4-t32-worker-protocol.test.mjs
   web/tests/agent-channel.test.mjs web/tests/e5-t26e-desktop-restore.test.mjs`
   - Exit 0: 43 passed, 0 failed, 0 skipped.
   - The exhaustive all-method test invoked both restore RPCs through the actual page client and
     worker runtime into the controller fake and returned the asserted `1024x768` host viewport.
2. `env -u NODE_OPTIONS node --test
   evidence/e5-t26e/verifier-r5/worker-byte-ownership-attack.test.mjs`
   - Exit 0: 1 passed, 0 failed.
   - A non-zero-offset `[1,2,3]` view from a sentinel-backed buffer was dispatched, then its caller
     bytes were immediately overwritten with `9`. The fake observed only `[1,2,3]`, not the later
     mutation or adjacent sentinels; the caller buffer remained attached; the viewport remained
     `1024x768`.
3. Sabotage in an isolated detached worktree at reviewed HEAD: remove only the fixture's
   `restoreDesktopSnapshot` fake, then run `node --test
   web/tests/e4-t32-worker-protocol.test.mjs`.
   - Expected exit 1 observed: 25 passed, 1 failed at the all-method test with
     `fake must implement restoreDesktopSnapshot`. The temporary worktree was removed afterward.
4. `git diff --exit-code ea14c48f..HEAD --` over the semantic core, wasm, Channel,
   desktop-restore, worker-protocol, loader, page, package, and dist paths; and `git diff
   --exit-code fb6c2f0b..HEAD -- web/tests/e4-t32-worker-protocol.test.mjs`.
   - Both exited 0. No runtime/generated semantic path changed after the implementation, and the
     metadata commit above the fixture did not alter the fixture.
5. `shasum -a 256 evidence/e5-t26e/native-remediation3.json
   evidence/e5-t26e/native-remediation4.json`.
   - Remediation 3 remained
     `f2dcfeea18f12dcfd190ad0028e3a780b313cc80909405612bfe06101f3cffc8`.
   - Remediation 4 matched its task-log claim:
     `dd9244332dcdbb940c9b4facd83ed65e26f55f62acbc623e49c2637aaa5d291a`.

## Prediction classifications

- **P1 HELD.** The fixture fake defines both methods, the exact all-method ledger equals
  `LINUX_CONTROLLER_METHODS`, and the host viewport assertion survives the response path.
- **P2 HELD.** The bounded non-zero-offset/mutation attack proves exact private byte ownership at
  the page-to-worker seam.
- **P3 HELD incrementally.** Runtime paths and the remediation-3 evidence digest are unchanged.
  Verifier r4's HELD fresh-HELLO, real-presentation, cold-fallback, and identity results therefore
  carry forward under the repository's incremental re-verification rule.
- **P4 HELD.** Both named commits resolve, the metadata head is their direct successor chain, the
  remediation JSON digest matches, and the 43-test command passes at the reviewed head.
- **Novel attack HELD.** Caller mutation, non-zero offset, and sentinel exclusion all held.

The exact native gate was not rerun: remediation 4 changes only the directly affected test fixture
and evidence metadata, so AGENTS.md requires rerunning the missing proof and touched harness rather
than restarting unrelated workspace gates. WebKit, independent machines, browser CRC/reload, and
host rr remain waived.

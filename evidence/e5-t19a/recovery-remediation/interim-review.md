# E5-T19a recovery remediation — interim fresh-critic review

INTERIM RESULT: no native/runtime refutation found at final source head `1be872f25f2d836f3d56310db82875053b6c185b` and runtime commit `9e8e1c22423f935e2e918a687cc6633e1356869c`. Final verdict and task status remain deferred while the relevant Linux-browser playback diagnostic completes.

## Prediction results

- **P1 full OASIS table — HELD.** The runtime table contains the four corrected cells, and the independent test transcribes the matrix without deriving expected values from the implementation. Each cell also executes the real control handler and checks byte-exact non-mutation for rejected requests.
- **P2 never-configured distinction — HELD.** Power-on/reset output and disabled capture retain `params=None` and reject PREPARE; configured Released streams retain validated parameters and accept PREPARE. Reset and capture disable erase the retained configuration.
- **P3 Linux recovery — HELD.** Worker gate lines 356–361 record initial exact 960-frame PCM, XRUN, STOP/RELEASE, PREPARE `0x8000` with retained parameters, and a new exact 480-frame period completed once. Whole-machine and composite restore tests repeat fresh-sink recovery without old PCM replay.
- **P4 validation and repeated setup — HELD.** Minimum/maximum buffer-period combinations, repeated SET_PARAMS/PREPARE, unsupported host rates, malformed fields, truncations, and unknown IDs are covered with exact before/after snapshot comparisons. My scratch-only novel attack reconfigured a Prepared stream from a 480-frame to 240-frame period and produced exactly 240 fresh bit-exact frames under the replacement schedule.
- **P5 RELEASE ordering — HELD.** Playback and capture fixtures alias an I/O status with the RELEASE response, proving the I/O error completion is written before the final OK response. A following PREPARE in the same control drain succeeds only after pending I/O reaches zero. Capture tests cover source present/absent, disabled capture, and missing/unready RX; unusable RX requests NEEDS_RESET without fabricating control or I/O completions.
- **P6 codec — HELD.** Wire version remains 1. Released-without-params and valid configured Released-with-params decode; output/capture retained configurations round-trip; malformed retained parameters, disabled-capture state, and missing parameters in non-Released states reject before mutation.
- **P7 capture symmetry — HELD.** The final 423-line supplemental fixture executes both pending-capture flush branches and their refusal path. Four focused tests passed independently and in the worker/clean-clone gates.
- **P8 sabotage — EFFECTIVE.** In an exact-source scratch archive, restoring RELEASE parameter erasure recreated PREPARE `0x8001`, `params=None`, and failed the Linux recovery assertion at line 877. Shared runtime sources were untouched.
- **P9 submission — NATIVE PORTION HELD.** The authenticated worker recording passed format, clippy, 325 core tests, 69 integration tests, no-std wasm core build, and wasm wrapper check: 394/394 tests, none ignored. The sole scrubbed `--no-local` clone independently passed the same target at exact head and remained clean afterward.

## Evidence and coverage

- Worker report SHA-256: `4abc3b7aca2d75389f83d4a404d5e9c9bdc5c04f9d5af52dc80a14f075257d2a`; worker gate SHA-256: `a01dce36e9c6d6262322893b80735f6d0a64a9dd43d5f2980d654fef5b15142a`.
- Final scoped source/test/Makefile diff SHA-256 (`6a21a0be..1be872f2`): `31764b8a432b1a5634cdc692e9423178c93f6096ed401dbe02d48fbdf4bdd65f`.
- Predictions SHA-256: `e3ff813378f867ff42a8a3ee0e4ac35222c0cb86c33bff2a653f8ebd174ef585`.
- Independent focused tests: `focused-native-pre-final.log` SHA-256 `035fadabc266dbdeda8afffc2f648027b56ce87ab193cb3fa6a5b12efc954f88`; `capture-release-pre-final.log` SHA-256 `96e0beb4626b59fd9e702a002781a25e6b2752944c286e1e759ecfa2942369e3`.
- Novel attack: `novel-prepared-reconfigure.log` SHA-256 `d9cf7002a266a41fbf57292d96f1074177b78274803c95b7be3f4a0df116a685`.
- Sabotage: `release-params-sabotage.log` SHA-256 `53d8a0c34e194a9f23af2ae228c5a8c513f6bf7dc7dcac0f046afb920c2591d9`.
- Clean clone: `clean-clone-1be872f2.log` SHA-256 `3788be72cb00b08fd60a3713cf2d60a6f49ddb03a7f83364d45c6cda99ddf8f9`; identity SHA-256 `6a94d5021b2ab5fa6d4aba1769cac01161d359149c51ac997f5c37ff99df8b09`.
- Every changed runtime branch is exercised: transition/status and next-state cells; initial PREPARE guard; retained output/capture parameters; playback/capture RELEASE flushing and missing-queue failure; valid and invalid codec paths. The Make target includes every new fixture. No changed runtime hunk remains unclassified.

The built WASM independently hashes to `551206882e7e3ec605dfe04571e53046a81678ebd542fdccafc2c08d8188c229`. The demo smoke artifacts authenticate as JSON `86cd29f569ea592d1cfb1e28de61e63a4695e67abc21cb766f97f59140f26da1` and PNG `1257b0f560ecf9c82e477154d0798c2a1e98403024a754852f0d9cf18b972710`, showing 126/0 and the in-progress task. As the worker correctly states, this does not prove Linux playback or any E5-T26f timing/restore criterion. No F acceptance or timing conclusion is made here.

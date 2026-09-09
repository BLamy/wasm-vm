# E5-T19a PCM recovery remediation — final fresh-critic report

VERDICT: verified

Final task head `81a17da24774680902a9331ef70f2286ea0eec5d`; final source/gate head `1be872f25f2d836f3d56310db82875053b6c185b`; runtime commit `9e8e1c22423f935e2e918a687cc6633e1356869c`.

## Prediction results

- **P1 full OASIS transition table — HELD.** The independent matrix exercises all state/request cells, including the four repaired RELEASE/PREPARE and repeated SET_PARAMS/PREPARE cells, and asserts byte-exact non-mutation on rejection.
- **P2 never-configured distinction — HELD.** Initial/reset and disabled-capture streams reject PREPARE with no retained parameters; configured Released streams retain validated parameters and accept PREPARE. Reset and capture disable erase the retained configuration.
- **P3 Linux recovery and fresh PCM — HELD.** Native wire fixtures produce initial exact PCM, XRUN, STOP, RELEASE, PREPARE `0x8000`, then one fresh bit-exact period without SET_PARAMS. The real Linux-browser create/reuse pair independently produces 1,440 non-silent frames before and after restore with `maxAbs=0.082000732421875`, output attached, and AudioContext running.
- **P4 repeated setup and validation — HELD.** Boundary, malformed, truncation, unsupported-rate, pending-I/O, and repeated setup cases preserve state atomically where rejected. The bounded novel attack reconfigures a Prepared stream from 480 to 240 frames and observes exactly one fresh 240-frame period.
- **P5 RELEASE ordering — HELD.** Playback and capture alias fixtures prove pending I/O status is written before the RELEASE response; same-drain PREPARE sees zero pending I/O and retained parameters. Missing/unready capture RX requests NEEDS_RESET without fabricated completions.
- **P6 codec compatibility/atomicity — HELD.** Sound wire version remains 1; legacy Released/no-params and configured Released/params decode; invalid retained parameters, disabled-capture state, and missing non-Released parameters reject before mutation.
- **P7 capture symmetry — HELD.** The supplemental four-test fixture covers aliased RX/control ordering, fresh exact capture PCM, absent/disabled sources, and missing/unready RX refusal.
- **P8 sabotage — HELD.** Restoring RELEASE parameter erasure in an exact-source scratch copy deterministically recreates PREPARE `0x8001` with `params=None`; shared sources were not changed.
- **P9 submission boundary — HELD.** The authenticated worker gate passes format, clippy, 325 core plus 69 integration tests (394 total, none ignored), no-std wasm build, and wrapper check. The sole scrubbed `--no-local` clone passes the same target at exact `1be872f2` and remains clean.

## Final browser evidence

- Create/reuse record README SHA-256: `bb1a650ea3a6b27394b5dbe55d071e061faa6b7d8ef0dd9266449b8a1eb5bb5f`.
- Cold checkpoint JSON SHA-256: `e909778f7086cd9539fe2439762ea21d8828f0d86992f55eed34b870139287f8`; browser/HTTP error arrays are empty, the physical ALSA command completes conditionally, and fresh PCM is 1,440/1,440 non-silent frames.
- Restored canonical JSON SHA-256: `9a83b529652f0bd9d72271d66e3227d9c95e219b1da5508f1dc868671142c04a`; PNG SHA-256: `f50e85d164e63a0581edf9c705702991634c03e47b99563d4ba89cfae8cf11f3`; server log SHA-256: `b3693db94edbb7b48d54c4c4836b785a269d1bc49fc144645610bf89aaf0a360`.
- The restored record binds the same runtime (`75000f36186a075ede719bdd16f1fb953b36830bd23ff3ea7ac29c64bd97297c`), image, manifest, and snapshot (`5917353c7ce3a38f4ca8a2c197f9d2f09a8563d4d9838d050662fc9e00085641`); first-present CRC matches `94da90ee`, boot transitions directly to `restored`, the agent performs a fresh HELLO, and the terminal screenshot shows the conditional green playback marker and returned prompt with no XRUN/PREPARE error.

The restored diagnostic exits 1 only because E5-T26f's unchanged interaction measurement is `3842.595 ms`, above its 2-second cap. That is not waived and is not an E5-T19a control-contract refutation; no E5-T26f status or acceptance conclusion is made.

## Evidence identity and suite disposition

- Worker gate SHA-256: `a01dce36e9c6d6262322893b80735f6d0a64a9dd43d5f2980d654fef5b15142a`.
- Final scoped diff SHA-256: `31764b8a432b1a5634cdc692e9423178c93f6096ed401dbe02d48fbdf4bdd65f`.
- Independent focused/capture logs: `035fadabc266dbdeda8afffc2f648027b56ce87ab193cb3fa6a5b12efc954f88` and `96e0beb4626b59fd9e702a002781a25e6b2752944c286e1e759ecfa2942369e3`.
- Novel/sabotage logs: `d9cf7002a266a41fbf57292d96f1074177b78274803c95b7be3f4a0df116a685` and `53d8a0c34e194a9f23af2ae228c5a8c513f6bf7dc7dcac0f046afb920c2591d9`.
- Clean-clone log/identity: `3788be72cb00b08fd60a3713cf2d60a6f49ddb03a7f83364d45c6cda99ddf8f9` / `6a94d5021b2ab5fa6d4aba1769cac01161d359149c51ac997f5c37ff99df8b09`.

The matrix, Linux recovery, codec, playback/capture RELEASE ordering, and fresh-PCM fixtures remain permanent under `make verify-E5-T19a`. The scratch novel attack is discarded as redundant with those committed repeated-configuration and exact-PCM assertions. Every changed runtime branch is exercised; no changed runtime hunk remains unclassified.

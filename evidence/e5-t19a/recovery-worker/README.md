# PCM lifecycle remediation — frozen worker submission

Runtime/source commit: `9e8e1c22423f935e2e918a687cc6633e1356869c`.
Final source/test/command head: `1be872f25f2d836f3d56310db82875053b6c185b`.
The only intervening changes are the built browser bundle/roadmap and supplemental
capture tests; no runtime changes occurred during the recorded gate.

## Recorded native and target gate

```sh
script -q evidence/e5-t19a/recovery-worker/gates.log make verify-E5-T19a
```

Exit 0. The gate passed format, core lib/test clippy with `gpu-trace`, 325 core unit
tests, 69 integration tests, the no-std wasm32 core build, and wasm32 wrapper check.
All 394 tests passed; none were ignored. The explicit `gpu-trace` feature also
avoids the repository's pre-existing unguarded GPU test-helper reference; no
unrelated GPU change was made.

`gates.log` SHA-256:
`a01dce36e9c6d6262322893b80735f6d0a64a9dd43d5f2980d654fef5b15142a`.

The recording demonstrates spec-derived request/state checks against actual
control handlers, invalid-request non-mutation across configured states, retained
parameters after RELEASE, initial/reset PREPARE refusal, and exact NEW PCM after
Linux's STOP → RELEASE → PREPARE recovery. Lines 356–357 record the former failing
wire response now returning `0x8000`, with validated parameters retained. Actual
whole-machine and composite snapshot roundtrips recover into a fresh clock/sink
without SET_PARAMS or replaying old PCM. Both TX and RX alias tests falsify ACK
ordering: pending I/O must complete before RELEASE's response and the next PREPARE.
RX tests also cover source removal, disabled capture, and missing/unready RX
refusal without a fabricated response or any host capture access.

Frozen SHA-256:

- `crates/core/src/dev/virtio/snd/mod.rs`:
  `7e70cdd9774499a217ee6a57e81a67dcfee513e978521409b0b8b5f097b94802`.
- `crates/core/src/dev/virtio/snd/snapshot.rs`:
  `78664c364542ea7099bcf038737832d950ad39954e8312d8c963b28043cc1115`.
- `crates/core/tests/virtio_snd.rs`:
  `8fca257d2cd3d90d0db7654951454d5135a493508d6be8fc9feca0e1688de357`.
- `crates/core/tests/desktop_machine_audio_resume.rs`:
  `e11839d5d5b89adc3b65f5f788adf1de2c6030a5a4a22f53f2abb2c2c19b8412`.
- `crates/core/tests/virtio_snd_release_capture.rs`:
  `ad152a4d7c310c4cdcfa022a6fbd77679c1eb592c4df3456febb7762c4b1d702`.
- `Makefile`:
  `9347e739336da9f5f1e3755c8d7aa88af51391bbcc11cc46f5a076c730b89c64`.

## Built demo

`make web-dist` completed before bundle commit
`c90bc4e466358be1f0a02e5a0ff609eb0e129c6d`. Source and dist WASM both hash to
`551206882e7e3ec605dfe04571e53046a81678ebd542fdccafc2c08d8188c229`.
The pre-existing dirty dist artifact manifests were preserved and not staged.

```sh
E5_DEMO_TASK=E5-T19a E5_DEMO_OUT=evidence/e5-t19a/recovery-bundle-smoke \
node tools/verify/e5-t18e-demo-smoke.mjs
```

One Chromium load: **126 passed, 0 failed**, no console/page/HTTP errors, with the
current E5-T19a IN PROGRESS entry visible. The screenshot was inspected.
`../recovery-bundle-smoke/demo-suite.json` SHA-256:
`86cd29f569ea592d1cfb1e28de61e63a4695e67abc21cb766f97f59140f26da1`;
`demo-suite.png`:
`1257b0f560ecf9c82e477154d0798c2a1e98403024a754852f0d9cf18b972710`.

This built-demo smoke proves assembly, ISA regression coverage, and roadmap
handoff. It does not itself prove Linux playback or the E5-T26f timing/restore
criteria. A separate fresh Linux-browser diagnostic is in progress; no browser
playback result, task verification, merge, or production deployment is claimed here.

# E5-T26i frozen adapter submission

Runtime/test implementation: `99b8e692fddb7b1e82e4175e152ef5682c6b9373`.
Built browser and task metadata: `bfebb8d4`.
Final bundle cache stamp / desktop comparison head:
`faddd274c934e09aec18161758c690a3b87bde8e`.
The latter two commits do not change runtime source or the compiled WASM bytes.

This is the opt-in clock/lifecycle boundary, not an F timing verdict, production
default change, Omarchy image change, merge, or deployment. Existing ICount is
still the default. Explicit wall mode retains the conservative non-chaining path.

## Commands and direct results

```sh
make verify-E5-T26i-runtime
wasm-pack test --node crates/wasm --lib --test guest_clock -- guest_clock --nocapture
make web-dist
make tasks-json
make web-dist
node tools/verify/e5-t26i-clock-worker.mjs
E5_DEMO_TASK=E5-T26i E5_DEMO_OUT=evidence/e5-t26i/demo node tools/verify/e5-t18e-demo-smoke.mjs
node tools/verify/e5-t26i-browser-clock.mjs
```

The runtime gate passed 28 native tests and 95 JS tests, format/clippy checks,
and the no-default-features wasm32 core build. The WASM invocation passed all
three wrapper fixtures and five guest-clock fixtures. Unchanged JIT timekeeping
survived 52,800 samples and 24,598 evictions; its deterministic timer-interrupt
lockstep also passed. Logs are preserved verbatim; the existing unrelated
`hart_ctrl.rs` unused-import warning is not suppressed.

The small built-browser fixture executes the listed guest instructions, busy-polls
the UART without WFI, reads `rdtime` in the guest, and emits eight actual raw bytes
per sample. Wall mode tracks real monotonic time in both execution backends:

| Backend | Mode | Guest delta (ms) | Host observation delta (ms) |
| --- | --- | ---: | ---: |
| direct | icount | 110 | 718.6600 |
| direct | wall | 724.990 | 724.4300 |
| worker | icount | 100 | 657.8900 |
| worker | wall | 648.285 | 646.4900 |

The explicit 500 ms pause leaves the complete clock-state object unchanged.
The first resumed wall `rdtime` excludes that pause. ICount final mtime is checked
against the exact recorded retirement count divided by ten. The JSON retains
instruction words, raw UART bytes, sample request/receive intervals, and machine
states; this is guest evidence, not a query-string or host-clock-only assertion.

The built demo completed **126 passed, 0 failed**, with zero console/page/HTTP
errors, and shows the new task honestly as in progress. The screenshot records
that visible task entry. The desktop comparison beneath `../browser/` completed
at `faddd274`: ICount **5028.065 ms**, wall **7518.450 ms**. Both contain the actual
conditional playback marker and attached non-silent PCM with no browser/HTTP
errors. Both retain the unchanged F timing failure. Wall advances 7283.315 guest
milliseconds within host bounds 7231.100–7309.935 ms; ICount advances 574.7393 guest
milliseconds within host bounds 4749.320–4808.775 ms. Thus the clock is real but
does not fix interaction latency. No default change is justified by this run.

The comparison JSON SHA-256 is
`0a6d1662c67cd32b5c9fe5f128090a6cfd85b04dc827d1c2b6512279ee476306`.
Its sealed baseline is retained at
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26i-clock-ni2iS7`,
origin `http://127.0.0.1:61628`; the baseline is never relaunched. Each mode uses
its own verified byte-identical copy. Snapshot SHA-256 is
`4ebdd9f6edb253d940a93082118068c089c844f985b13e0a7593956d6ccf88fb`;
profile SHA-256 is
`778bc49dcdc7551de0b2f6a23e4b32a30ce72dea2c00e425bfdc302820d8fc65`.

## Artifact identity

| Artifact | SHA-256 |
| --- | --- |
| `runtime.log` | `49c8c420a40359d06b6a955793d78c72a9e1ca8d291fc8fa014c1856ed7c7a09` |
| `wasm.log` | `a219b2a51b9668c43a4f6ba4c08ab7fbc0570bfe96d8f19b6ed8ec5500d0ed3d` |
| `../worker/guest-rdtime.json` | `e33a52f024c9031f82e3995175f973ed217655f519ea836f8bfbe3c32ecd059e` |
| `../demo/demo-suite.json` | `47036998a0d7577fc54455ca8f326134cd9528fd23b2a165e120327b845ae489` |
| `../demo/demo-suite.png` | `7ee1ac7b4ddf3ea4f723d7bf0aee03d16d86f15f454a9cdd55c582ffe433bcd8` |
| source and dist `wasm_vm_wasm_bg.wasm` | `30c8f2ab3b1f3c25db77c03d6161d39e55de7ea3d88447f83f5d7942952c3a28` |

The pre-existing dirty `web/dist/artifacts.json` and
`web/dist/artifacts-node-alpine.json` were restored byte-for-byte after both
bundle builds, were never staged, and are not release inputs for this proof.
The desktop runner authenticates its local kernel and full image against the
source manifests and seals all actual served runtime bytes before reuse.

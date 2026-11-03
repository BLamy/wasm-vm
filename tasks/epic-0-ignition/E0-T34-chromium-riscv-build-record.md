---
id: E0-T34
epic: 0
title: Preserve the built Replay RISC-V browser and exact local port sources
priority: 0.37
status: verified
depends_on: [E0-T33]
estimate: S
risk: low
capstone: false
---

## Boundary

Preserve the completed local browser build as inert artifacts: exact port patches,
source/configuration digests, runtime hashes, and recorded reference-run results.
Keep the pre-backport E0-T33 checkpoint intact. This task does not apply patches,
launch the browser, implement a sandbox, change wasm-vm execution, or claim the
browser already runs inside wasm-vm. The reference runs are evidence of the local
port's progress, not verification of a production integration or a Replay driver.
Never push or submit a PR to replayio/chromium.

## Deliverables

- Tracked port-source closure and provenance manifest, including the explicitly
  approved local sandbox backport, its upstream license, and all later adaptations.
- Runtime binaries and complete logs retained under the ignored project workspace.
- A read-only integrity command and guide distinguishing the exact built port,
  reference tests, pre-backport snapshot, and still-pending wasm-vm integration.

## Deterministic acceptance

`python3 tools/chromium/check-built-artifacts.py`

Validate every archived patch/configuration/log and runtime digest, ELF RISC-V
identity, and the source pin. Require real local artifacts; do not fetch, compile,
run, apply patches, push, or change a source checkout. A clone without the large
local artifacts can inspect the tracked provenance but cannot claim to have them.

## Adversarial verification

Low-risk direct result: inspect every new archival/configuration file, independently
compare digests with the retained files, and check all documented runtime claims
against the actual logs. No security or instruction correctness is inferred from
archival correspondence. Carry E0-T33's unchanged HELD results forward. A later
runtime integration task must prove execution on wasm-vm's CPU and devices.

## Verification log

### 2026-11-03 — worker — activation

Requested by the user as part of the local Replay Chromium RISC-V build. E0-T33
is verified at `93f6b72f93e7d211d521f88eb2263e15a6fa4313`. Its source snapshot
and manifest remain unchanged. The user explicitly approved the local sandbox
backport and tests; all upstream publication remains prohibited.

### 2026-11-03 — worker — source and reference result frozen

The compiled browser is retained at
`local/chromium-riscv64/artifacts/2026-11-03/build20/chrome`, SHA-256
`df9b431511f435c463e5d39f3dde30d2d204e06105685b601b8ce2372819b8ef`.
Its runtime bundle is SHA-256
`fae3717a934ea33d0a47d258a921c9d9643fe1a595d1eb9e3238a029e21ad42e`.
The archived final Ninja check reports no remaining work. The source record
matches all 92 changed/generated inputs against the actual native build tree.
Reference evidence records the RISC-V Linux kernel, all 338 sandbox suite cases,
two live renderer seccomp observations, and the GUI page before/after keyboard
activation (run counter 1 then 2). This log is a preservation claim; it does not
promote the external sandbox port to a production security guarantee or claim
execution inside wasm-vm. Guest/browser runtime gates for a later integration
remain separate. Low-risk submission binds these inert archives and the read-only
checker at the frozen product head recorded below.

### 2026-11-03 — worker — implemented

Frozen product head: `2457ab808fda3b6a9a4d5c4e116b1ce335f5c3ce`. Recorded submission:
`evidence/e0-t34/worker.json`, SHA-256
`7b4fe7439923713521aad4fc8aa1e79971879d74bf91437e06dd6ad8d57b68a4`.
All four recorded commands passed: scoped `git diff --check`, checker Python
compilation, task policy, and `python3 tools/chromium/check-built-artifacts.py`.
The direct command validates all 32 archived files, 3 retained artifacts, both
RISC-V ELF headers, all 13 runtime bundle contents, source-record correspondence,
and the cited reference transcript. It performs no source mutation, patch
application, execution, network request or publication. Original raw CRLF serial
bytes are preserved using path-specific Git attributes. No runtime, web, deploy
or GitHub workflow changes are part of this layer. Only a fresh verifier may
set this preservation task to verified.

### 2026-11-03 — verifier — predictions before evidence inspection

- P1: Worker evidence will match its cited digest and frozen product head;
  all 32 archive records and three retained artifact digests will match real
  local files. Both binaries will have little-endian ELF64 RISC-V headers, and
  the runtime bundle will contain exactly its 13 declared files plus checksums.
- P2: Each combined patch's changed paths will be represented in the 92-input
  source record, with only the two driver-symbol files supplied by the archived
  generator. Repository pins, native comparison, final Ninja result, configuration,
  and source digests will correspond to the preserved build rather than E0-T33's
  older pre-backport snapshot.
- P3: The complete reference transcript will contain all 338 ordered successful
  suite cases, the declared binary digests and RISC-V kernel identity, and exactly
  two renderer observations with UID 1000, namespaces, NoNewPrivs 1, Seccomp 2,
  and no no-sandbox launch flag. The recorded launcher will disable retries.
- P4: The two actual PNGs will show a passing page with JavaScript/WebAssembly 42
  and canvas [42,128,64,255], with the run count changing from 1 to 2 consistently
  with the archived keyboard input and page code.
- P5: The new checker will only inspect bytes/records, and the guide will bound
  the reference observations without claiming general sandbox correctness, a
  Replay recording driver, or browser execution inside wasm-vm. Unchanged E0-T33
  results carry forward; this task does not require a new browser run or rebuild.

### 2026-11-03 — verifier — VERDICT: verified

VERDICT: verified

- P1 identity and retention — HELD. Worker JSON SHA-256 is
  `7b4fe7439923713521aad4fc8aa1e79971879d74bf91437e06dd6ad8d57b68a4`;
  all 36 product-file hashes match frozen head
  `2457ab808fda3b6a9a4d5c4e116b1ce335f5c3ce` and current bytes
  (`evidence/e0-t34/worker.json:2,4-40`). All four recorded commands exited zero,
  and fresh direct acceptance passed. Independently hashed all 32 archives and
  three retained artifacts; inspected both ELF headers (ELF64 little-endian,
  machine 243, flags `0x5`, double-float ABI); checked all 13 runtime members,
  exact inventory, and checksum text against `built/manifest.json` and
  `runtime-files.json`. The large files remain ignored and untracked.
- P2 complete source record — HELD. Five combined patches cover 90 source paths:
  79 tracked-file diffs and 11 new files. Read-only native Git diffs match every
  archived hunk for those tracked paths; full new-file contents match their
  recorded digests. The two remaining driver files match the archived generator's
  literal string expressions without executing the generator. Independently
  compared all 92 source digests, five repository heads, GN arguments, Abseil
  notice, and both final executable hashes with the native container tree; all
  match the archives. All five `git apply --reverse --check` operations passed
  without applying patches. Citations: `built/source-inputs.json:2-9,11-379`,
  `native-source-check.json:1-374`, and the five combined patch files. The preserved
  final Ninja log reports no work at
  `reference/chromium-build-20-frozen-check.log:2`; build-20 link actions are at
  `reference/chromium-build-20.log:4-8`. This proves correspondence, not port semantics.
- P3 recorded reference observations — HELD. The serial payloads decode exactly
  to the three archived validation scripts, and their end markers report zero.
  The full transcript contains exactly 338 distinct ordered completion entries,
  338 RUN entries, 338 OK entries, no failed/skipped entries, and a success marker
  at `reference/guest-build20-evidence.log:1516`. The archived sandbox command uses
  one job and retry limit zero (`riscv-build20-sandbox.sh:15`). Kernel identity and
  binary hashes match at transcript lines 3-6. Renderer PID 11056 reports UID
  1000, NSpid `11056 9 1`, NoNewPrivs 1, Seccomp 2 at lines 18-26; PID 11057
  reports UID 1000, NSpid `11057 10 1`, NoNewPrivs 1, Seccomp 2 at lines 27-35.
  Their command lines at lines 16-17 omit `--no-sandbox`. The three documented
  UPower service messages are preserved; no zero-diagnostics result is inferred.
- P4 graphical evidence — HELD. Inspected the actual
  `reference/chromium-gui-build20.png` and `chromium-gui-build20-input.png`.
  Both show pass=true, JavaScript/WebAssembly 42, and pixel [42,128,64,255];
  the first shows runs=1 and the second runs=2 with the real button focused.
  Digests match the manifest. The archived QMP actions are Tab, Enter, then
  screendump (`qemu-build20-keyboard.json:2-44`), consistent with `smoke.html`'s
  incrementing callback. The visible x86_64 identity string is explicitly disclosed
  in the guide; ELF/kernel evidence identifies the actual RISC-V machine.
- P5 scope and side effects — HELD. Direct acceptance also completed under a Python
  audit hook forbidding file writes, process/exec calls, and socket operations.
  The checker uses archive streams without filesystem extraction. Guide lines
  13-16, 24-25, 49-55, and 79-85 distinguish preservation, unrecorded reference
  browsing, and pending wasm-vm integration. The byte-preserving Git attributes
  match all new patch/license/log paths. E0-T33's product/evidence bytes are
  unchanged, so all its HELD results carry forward without rehashing its raw base.
- COVERAGE — Traced checker execution covered lines
  `2-8,11-12,15-16,20-25,28-32,35-43,45-51,53-69,71-77,79-84,86-109,112-113`.
  Waived line 17: failure-only diagnostic, with no sabotage required for this
  low-risk direct-result task. All archival/configuration bytes were inspected,
  hashed or compared; the guide/attributes and task/queue metadata were inspected
  directly. External runtime-looking patch, setup, page, and validation-script
  hunks are inert records here; their runtime correctness is outside this claim.
- SUITE — Retain the new integrity checker, complete reference transcript, PNGs,
  and source/runtime digest records as the repeatable archival artifact. No new
  runtime test is appropriate for this preservation-only change. No browser was
  launched, source changed, patch applied, build run, or security/integration claim
  promoted during verification.

Commands: `python3 tools/chromium/check-built-artifacts.py`; independent SHA-256,
ELF, tar-member and source-record comparisons; read-only Docker/native Git and
file inspections (`rev-parse`, scoped `diff`, and reverse `apply --check`);
serial-payload decoding and full transcript counting; actual PNG inspection;
audited/traced direct acceptance; `git check-attr text whitespace`;
`git check-ignore --no-index -v`; `git ls-files -- local/chromium-riscv64/artifacts`;
`qemu-system-riscv64 --version`; `git diff --check 93f6b72f..2457ab808`.
Reference paths above are under `evidence/e0-t34/`; `built/` paths are under
`tools/chromium/`.

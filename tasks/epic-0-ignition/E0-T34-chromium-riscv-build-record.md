---
id: E0-T34
epic: 0
title: Preserve the built Replay RISC-V browser and exact local port sources
priority: 0.37
status: in-progress
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

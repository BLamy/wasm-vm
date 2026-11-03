---
id: E0-T33
epic: 0
title: Preserve the local Replay Chromium RISC-V build workspace
priority: 0.36
status: implemented
depends_on: [E0-T32]
estimate: S
risk: low
capstone: false
---

## Boundary

User-requested local project housekeeping and provenance. Retain a real copy of the
existing Replay Chromium RISC-V source/dependencies and build records inside this
project, without putting the large checkout or disk images in Git or Docker build
contexts. Record its exact source pin, local port patch digests, and incomplete build
status. This task makes no browser correctness, sandbox, performance, record/replay,
or wasm-vm guest integration claim. The cancelled stock-Chromium Epic 8 tasks stay
cancelled. Publishing is limited to BLamy/wasm-vm; never push or open a PR upstream
in replayio/chromium.

## Deliverables

- Ignored project-local `local/chromium-riscv64/` containing the source Git repository,
  dependency checkouts, local changes, build scripts/logs, and immutable GUI base.
- Small tracked provenance manifest, port patch archive, read-only local-copy check,
  and instructions explaining the separate active build container.
- Git and Docker ignore rules for the large local workspace.

## Deterministic acceptance

`python3 tools/chromium/check-local-copy.py`

The command must confirm the pinned Replay source revision, real local Git checkout,
port patches and changed-source digests, dependency revisions, and ignore rules.
It must report that the full Chrome executable is still unbuilt and that no sandbox
backport has been applied. It must perform no fetch, push, build, or source mutation.
The check requires the retained local workspace; a fresh clone of wasm-vm alone
contains its manifest and patch archive, not Chromium's large source tree or images.

## Adversarial verification

Low risk, direct result only: independently compare the retained source and patch
archive to the manifest, inspect Git/Docker exclusions, and ensure the documentation
does not present partial compilation or a standalone QEMU desktop as a working
Chromium or a wasm-vm browser integration. Source/patch archival is evidence of
preservation, not evidence that the archived runtime port is correct.

## Verification log

### 2026-11-03 — worker — activation

Requested directly by the user while cleaning old worktrees and updating to main.
Parent E0-T32 is verified. Based on `origin/main` at
`24e2a1a639993394f6dbddc74970eeeac8c0f054`; previous local edits and worktree proofs
are preserved outside this task's diff.

### 2026-11-03 — worker — implemented

Frozen product head: `d7afe1dffdba5bb6ffcc6df6b2f54f3f66a12438` above activation
`0c0148060`. Evidence: `evidence/e0-t33/worker.json` and `worker.txt`; transcript
SHA-256 `a9660cf492e4ecd9f795a749c2529a49d5d82364bf6753471e8684510c788976`.
The JSON binds every product file's bytes to this head and records each command
and exit code. Commands, all exit 0:

```sh
git diff --check HEAD^ HEAD
python3 -m py_compile tools/chromium/check-local-copy.py
python3 tools/check_task_policy.py
python3 tools/chromium/check-local-copy.py
```

The retained copy contains 724,964 files (24,912,955,843 logical bytes before the
small follow-up compile records). The direct check validates 125 installed Git
repository heads, 81 source/setup/evidence files (including the GUI raw-image
digest), 9 port patches, and 7 license notices. It checks the real Git directories
are inside the project copy, expected source-change sets, Git/Docker exclusions,
and the absence of sandbox changes or a complete Chrome executable in this
checkpoint. The active container's subsequent build 12 completed 1,761 actions
and failed only on 29 sandbox actions; the user has since explicitly approved
the local sandbox backport and tests. That follow-up is outside this preserved
pre-backport snapshot and outside this task's correctness claim.

All changed runtime-looking lines are inert archival patch data, not applied by
the new check. The claim is preservation and honest provenance, not validity of
those external runtime changes. No Rust, wasm, demo, CI, or deploy behavior changes;
guest execution evidence and those build/browser gates are inapplicable here.
Only a fresh verifier may promote this task to verified.

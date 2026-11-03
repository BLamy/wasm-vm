---
id: E0-T33
epic: 0
title: Preserve the local Replay Chromium RISC-V build workspace
priority: 0.36
status: verified
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

### 2026-11-03 — verifier — predictions before evidence inspection

- P1: The worker transcript digest and every recorded product-file digest will
  match the frozen product head `d7afe1dffdba5bb6ffcc6df6b2f54f3f66a12438`;
  the recorded acceptance command will exit zero without a stale-head substitution.
- P2: The retained project copy will contain real local Git metadata and exactly
  the 125 pinned repository heads, the declared changed-source sets, all 81 file
  digests, all 9 patch byte streams, and all 7 license byte streams. The immutable
  GUI base will match its pinned digest. Patch headers will account for the declared
  changed source; this predicts archival correspondence, not port correctness.
- P3: Git will ignore the source and GUI image, Docker's root context will exclude
  the retained directory, and none of that directory will be tracked. The direct
  command will read source/Git state and will not fetch, push, build, or alter it.
- P4: The retained checkpoint will have no full Chrome binary or sandbox backport;
  the guide will identify partial compilation and the QEMU desktop as incomplete,
  separate work rather than a working browser or wasm-vm integration.

Scope: low-risk direct-result verification. No automatic cold clone, sabotage,
runtime-port validation, guest execution, browser run, or external active-build
comparison is required by this archival claim.

### 2026-11-03 — verifier — VERDICT: needs-evidence

VERDICT: needs-evidence

- P1 evidence binding — HELD. All 22 recorded product byte streams match both
  frozen head `d7afe1dffdba5bb6ffcc6df6b2f54f3f66a12438` and the current files;
  post-freeze commits change only task/evidence metadata. The transcript digest is
  `a9660cf492e4ecd9f795a749c2529a49d5d82364bf6753471e8684510c788976`.
  Citations: `evidence/e0-t33/worker.json:2,48-72`, `worker.txt:1,13-19`.
  Fresh direct acceptance exited zero with the same five result lines.
- P2 preserved bytes and recorded pins — HELD. Independently checked all 125
  declared Git heads, real repository roots and local Git directories, locally
  available commit objects, and no external object alternates. All 81 file hashes,
  9 retained/archive patch comparisons, and 7 source/archive license comparisons
  match `tools/chromium/workspace.json:12-513,597-997`. The 8 GiB GUI base matches
  SHA-256 `9a9b656f654ed0a3783385e6bd153775ea56dfe62de85cd8b155ed798c2f9558`.
  All 56 declared changed-source paths are hashed and covered by the patch headers;
  all nine patches pass read-only `git apply --reverse --check` against their
  retained source roots. This holds archival correspondence only.
- P2 setup/dependency completeness — NEEDS EVIDENCE. Predicted the installed
  repository inventory was exhausted by the manifest. A filesystem scan found
  126 Git repositories, including unlisted `local/chromium-riscv64/tools/depot_tools`
  at clean HEAD `bed65db1bb5d1022dab89cf62e7609b12084747b`. Rechecked with
  `git --no-optional-locks -C local/chromium-riscv64/tools/depot_tools rev-parse HEAD`
  and `status --short`. This is an actual build dependency: retained
  `configure-and-build.sh:14-17`, `prepare-host-tools.sh:4`, and
  `sync-dependencies.sh:4` use `/work/tools/depot_tools`. The separate pin at
  `workspace.json:138-139` is `src/third_party/depot_tools` at `2c0a8c7...`, not
  this checkout; the checker only iterates declared repositories at
  `check-local-copy.py:42-46`. Demand: pin the retained host-tool checkout in the
  manifest and record direct acceptance at the corrected frozen product head.
  The source/patch claim is not contradicted; this is a provenance coverage gap.
- P3 exclusions and read-only behavior — HELD. `git check-ignore --no-index -v`
  identifies `.gitignore:6` for both source and GUI image; `git ls-files --
  local/chromium-riscv64` is empty. `.dockerignore:2` excludes the entire directory
  with no later negation. `git check-attr text whitespace` confirms the verbatim
  archives are not normalized. The check only reads files and invokes Git
  inspection commands with `--no-optional-locks`; no fetch/push/build/source-write
  operation exists in `check-local-copy.py:14-85`.
- P4 honest checkpoint scope — HELD. Retained sandbox/features diffs are empty,
  `src/out/RISCV64/chrome` is absent, and pinned `logs/build-state.json` says both
  full build and sandbox backport are false. The copy omits the live GUI run
  directory and writable overlay. `docs/chromium-riscv64.md:38-58,69-76,83-98`
  explicitly limits the compilation, Replay driver, QEMU desktop, and integration
  claims. The original active workspace/container was not used as checkpoint proof.
- COVERAGE — The direct run plus line tracing executed checker lines
  `2,4-7,10-11,14-16,20-25,28-29,33-36,40-85,88-89`. Waived lines 30 and 37-39:
  failure-only diagnostics; low-risk direct-result policy does not require
  sabotage. Every manifest/archive/license byte was read; ignore/attribute and
  guide changes were inspected directly. Task/queue/evidence hunks are declarative
  bookkeeping. No archived runtime hunk was executed or claimed correct.
- SUITE — Keep the existing integrity checker as the repeatable archival gate;
  no runtime test is appropriate for this housekeeping change. Carry all HELD
  results forward when their product bytes/boundaries and evidence digest remain
  unchanged; recheck only the missing host-tool pin and corrected evidence binding.

Additional checks: `git diff --check origin/main..HEAD`; Python `compile()` on
the checker; independent filesystem repository inventory, SHA-256/byte comparisons,
patch-header/change-set comparison, read-only reverse patch checks, and a traced
direct acceptance run. Worker JSON SHA-256:
`07344746ea8c648d60d29cf6773950d38b2b9fdd65bebd1034174d4b571d876a`.

### 2026-11-03 — worker — missing setup pin supplied

Frozen follow-up product head: `29359c386` (manifest only). Added the retained
`tools/depot_tools` checkout at `bed65db1bb5d1022dab89cf62e7609b12084747b`.
Evidence: `evidence/e0-t33/worker-followup.json`, SHA-256
`e2edab16bbadc0c2e055c77eb6b58ccfb7798ec1d7e08e6194711ed9c610e96d`.
The direct acceptance command passed with **126** pinned repositories. Its record
compares the manifest to the prior product head: exactly one repository entry was
added, and every other manifest field and product file is unchanged. All earlier
HELD results carry forward; no source, checker, patch or license bytes changed.
No runtime gates were restarted for this setup-provenance proof gap.

### 2026-11-03 — verifier — follow-up predictions before evidence inspection

- P5: The manifest will differ only by adding `tools/depot_tools` at
  `bed65db1bb5d1022dab89cf62e7609b12084747b`; its real retained Git directory and
  clean HEAD will match that pin. All other product bytes and the original
  evidence digests will remain unchanged, so prior HELD results carry forward.
- P6: The follow-up evidence digest will match the worker's cited digest, bind
  the corrected manifest to frozen head `29359c386`, and record direct acceptance
  exiting zero with 126 pinned repositories. The added entry will execute through
  the existing read-only repository-check loop without introducing runtime code.

### 2026-11-03 — verifier — VERDICT: verified

VERDICT: verified

- P5 missing setup pin — HELD. `workspace.json:513-516` adds exactly the retained
  `tools/depot_tools` checkout at `bed65db1bb5d1022dab89cf62e7609b12084747b`.
  Independently checked its real repository root, Git directory inside the retained
  copy, matching clean HEAD, locally available commit object, and absence of external
  object alternates. Removing this single entry makes the manifest equal to the
  prior manifest. All 21 other product-file hashes and both original evidence
  digests are unchanged. This closes the sole provenance coverage gap in the prior
  126-repository inventory.
- P6 corrected evidence binding — HELD. Follow-up record
  `evidence/e0-t33/worker-followup.json:2,4-8,9-38` binds the manifest to frozen head
  `29359c3865eff11dbe5ea182b49a0af5d7fc129f`. The manifest's SHA-256 is
  `fffcb71f2990ec8e03f97e4b491b94bf474bc8e12835c528e01dabe0524e801b`.
  The record's SHA-256 is
  `e2edab16bbadc0c2e055c77eb6b58ccfb7798ec1d7e08e6194711ed9c610e96d`.
  The recorded direct acceptance exits zero with empty stderr and precisely the
  prior output amended to 126 pinned repositories. Current product bytes match
  the frozen head, and the recorded unchanged-file hash table matches the original.
- CARRY-FORWARD — P1's original evidence integrity, P2's source/patch/license/GUI
  preservation, P3's exclusions/read-only behavior, P4's honest scope, and the
  previous coverage waivers remain HELD. Their code, dependency boundaries, and
  original evidence digests did not change. P6 supplies the new manifest binding;
  no unrelated runtime or broad workspace gates were restarted.
- COVERAGE/SUITE — The only new product hunk is declarative repository data,
  consumed by the existing checker loop at `check-local-copy.py:42-46` during the
  recorded 126-repository acceptance run and independently inspected above. The
  existing integrity checker remains the repeatable archival acceptance artifact;
  no runtime test is needed for this manifest-only correction. No claim about the
  archived Chromium port's correctness, sandbox, or integration is added.

Commands: read-only `git rev-parse`, `git status --short`, and `git cat-file -t`
for the added repository; independent JSON/byte/SHA-256 comparisons against the
two frozen product heads and original evidence; `git diff --check
9029967f4..29359c386`; `git diff --check`. This verification changes only this log,
task status, and the generated queue.

### 2026-11-03 — worker — copied-launcher documentation correction

The guide incorrectly said the copied launcher creates an overlay. Its actual
`test -f "$image"` requires one. Replaced that sentence with the explicit
`qemu-img create` command; source, manifest, runtime and acceptance checker are
unchanged. This is a low-risk documentation correction. All earlier HELD results
carry forward; only the new command and launcher correspondence need inspection.

### 2026-11-03 — verifier — overlay-doc predictions before inspection

- P7: From the project root, the documented command will name the retained raw
  base as its backing file and create a qcow2 at the copied launcher's default
  image path. The launcher will require that file rather than create it. A
  temporary-output check will produce qcow2 metadata with the raw backing file
  and its 8 GiB virtual size without changing the retained base or launching a VM.
- P8: The correction will change only the guide and task/queue bookkeeping;
  manifest, checker, patch/license archive, and prior evidence bytes will remain
  unchanged. Earlier HELD results therefore carry forward.

### 2026-11-03 — verifier — overlay-doc VERDICT: verified

VERDICT: verified

- P7 command/launcher correspondence — HELD. Guide lines 98-100 name the retained
  raw base and the exact default overlay path from retained
  `gui/start-riscv-linux.sh:3,8`. The launcher requires `test -f "$image"` at line 11
  and contains no `qemu-img` command. Parsed the guide's shell block and executed
  its exact arguments with only the output redirected to a temporary directory.
  Creation exited zero; `qemu-img info --output=json` reported `format=qcow2`,
  `backing-filename-format=raw`, the retained absolute base path, and
  `virtual-size=8589934592`. The temporary overlay was removed. Retained base
  inode/size/mtime/ctime were unchanged, the retained overlay remained absent,
  and no launcher, VM, browser, or build was run.
- P8 incremental binding — HELD. Frozen product head
  `a25d37e9530842b41b9f59273674bd208c75ebad` changes only the guide and task/queue
  bookkeeping. Current guide bytes match that head with SHA-256
  `77f440fdc6aec36986dcb533f289cf0353e451814b9ffa2687073ff6b8972e36`.
  Manifest, checker, patch/license archive, and all three prior evidence files
  are unchanged; their recorded evidence digests still match. Prior HELD results
  and coverage waivers carry forward for those unchanged boundaries. This direct
  result supplies the binding for the corrected guide.
- COVERAGE/SUITE — The only changed product hunk is the overlay prerequisite and
  command at `docs/chromium-riscv64.md:93-104`, directly inspected and exercised
  above. No new runtime test or full archive rehash is appropriate for this
  documentation correction. Temporary proof output was discarded after inspecting
  its metadata; the command and observed values are recorded here.

Commands: parsed `qemu-img create -f qcow2 -F raw -b <retained absolute raw base>
<temporary output>`; `qemu-img info --output=json <temporary output>`; read-only
launcher inspection; Git diff/byte and prior-evidence digest comparisons;
`git diff --check 4bbbd6dfc..a25d37e95`; `git diff --check`.

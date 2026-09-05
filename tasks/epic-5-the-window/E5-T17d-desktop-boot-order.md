---
id: E5-T17d
epic: 5
title: Prove headless desktop boot ordering and seat runtime
priority: 517.4
status: verified
depends_on: [E5-T17c]
estimate: S
risk: high
capstone: false
---

## Goal

Show that the final Alpine desktop image reaches a serial autologin reliably, starts seatd before
the desktop command, and creates the correct desktop runtime directory without hanging init.

## Boundary

This slice owns repeated cold headless boots and ordering evidence. It does not repair compositor
behavior or rework the T17 image builder unless the ordering proof identifies a concrete defect.

## Deliverables

- A bounded native-emulator serial boot harness and `make verify-E5-T17d` target.
- Evidence from 20 cold boots showing the autologin user, seatd readiness, `start-desktop` launch
  order, runtime-directory mode/owner, and bounded failure logs.
- A concise boot-order playbook for T18, including the exact markers used to detect races.

## Acceptance criteria

- [ ] All 20 cold serial boots reach the expected autologin user without an init hang or timeout.
- [ ] Every boot proves seatd is running before autologin invokes `start-desktop`, and records the
      desktop user's `/run/user/1000` as mode 0700 with the correct owner.
- [ ] A deliberate compositor-start failure exits/logs within the bound and leaves init usable;
      it does not deadlock tty1 or hide the failure.
- [ ] `make verify-E5-T17d` passes using only the final T17c image/chunk handoff and produces
      replayable serial evidence.

## Adversarial verification

Delay service readiness, perturb boot timing with independent fixed seeds, and kill the first
desktop process. Look specifically for an autologin race, stale runtime-directory ownership, seatd
zombies, or an init process waiting forever. A single ordering inversion or unbounded failure is
a refutation.

## Verification log

### 2026-09-05 — verifier — VERDICT: verified

- Prediction: all 20 cold native-emulator boots reach the serial login boundary and fixed
  post-login stop without timeout; observed `ok=true`, `{code:102, signal:null}`, login and
  `MaxInstrs` markers for every run, with positive retired counts in
  `evidence/e5-t17d/boot-01-guest-evidence.txt` through `boot-20-guest-evidence.txt`.
- Prediction: every boot preserves seatd-before-runtime-before-start-desktop ordering, live
  seatd state, `/run/user/1000` mode `0700` uid/gid `1000`, bounded compositor failure, and a
  usable return; all 20 embedded logs and their Docker/debugfs extractions held, including
  `E5T17B_WESTON_NOT_READY=1`, `E5T17D_COMPOSITOR_FAILURE_BOUNDED=30`, and
  `E5T17D_DESKTOP_RETURNED=0`. All 60 raw console/stderr/guest-evidence hashes and 40 embedded
  guest-log hashes matched `evidence/e5-t17d/boot-order.json`.
- Prediction: the report is bound to the final T17c handoff; held at image sha256
  `467306a5d842f95927c1f5823363271b55854517f6318576a6a137f5615a5c1e`, package manifest
  `ba86429d08e11360309b346e8fb757f44f318eccefed3e243dcaf425b91ad908`, file manifest
  `c82b20c083d808a797bd8db9c080a2be0c3ef7859d29e5b818bbfa99d8427cf0`, and the 8,192-entry
  split chunk manifest with 3,211 reused positions and 803 new objects.
- Bounded novel sabotage: copied the report to `target/e5-t17d/boot-order-sabotage.json`, changed
  boot-01's runtime marker to `gid=999` and recomputed its embedded hash; the verifier rejected
  it with `boot-01: missing runtime-directory readiness`. The built-in self-test also rejected
  ordering inversion, owner mutation, zombie state, and timeout.
- Incremental re-verification: `f187ec5..f0b88bd` changes only verifier parsing captures for
  runtime owners; prior 20-boot runtime evidence was carried forward unchanged.

Commands: `node tools/verify/e5-t17d-desktop-boot-order.mjs --self-test`; Docker/debugfs extraction
of all 20 `target/e5-t17d/boots/*/alpine-rootfs.ext4` images; raw artifact/hash/marker audit;
T17c handoff/chunk-manifest audit; `E5_T17D_EVIDENCE=target/e5-t17d/boot-order-sabotage.json
node tools/verify/e5-t17d-desktop-boot-order.mjs` (expected rejection).

# Release assurance boundary

`wasm-vm` does not wait for all roadmap tasks before it can ship. “Fully tested and secure” is not
a terminal state; releases make a bounded claim against a named threat model and keep regression
walls running afterward.

## v0.1 — persistent networked Alpine

The first supported release boundary is the verified Epic 3 capstone (E3-T28), not completion of
Epics 4–7. It includes the verified Level 1 architecture, Level 2 boot/platform boundary, and the
Epic 3 persistence/network/browser path needed to boot and use Alpine. Acceleration, GUI, SMP,
sharing, and box64 remain experimental future features and do not block v0.1.

A v0.1 release candidate requires:

- E1-T24, E2-T26, E3-T19, E3-T26, E3-T27, and E3-T28 verified at their exact submitted heads;
- no active `refuted`, `implemented`, or `evidence-needed` release-boundary task;
- the full native/WASM architecture regression wall green in CI;
- fresh-profile browser boot with zero application console errors;
- persistence recovery, explicit network-provider identity, HTTPS egress, secret audit, and
  deployment teardown evidence;
- a dependency/license/CVE scan recorded for the release commit;
- documented known limitations and an incident/reporting contact.

`verification-debt` outside this boundary does not block v0.1. Debt within the boundary must be
verified, removed from the supported claim, or explicitly listed as a release blocker.

## After release

High-risk changes continue to use the full adversarial charter. Medium- and low-risk changes use
the tiered policy in `AGENTS.md`; broad workspace, compliance, stress, and cross-target suites run
in CI/nightly. A release claim is revoked when a standing regression wall or supported-boundary
security proof becomes red.

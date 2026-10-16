---
kind: "Field guide"
source: "web/docs-source/guides/verification.md"
scope: "Authored explanation; verification belongs to the named evidence"
---

# Reproduce a claim

A verification result belongs to a named claim, code revision, command, and evidence digest. The repository separates an implementing worker from a fresh critic so a summary alone cannot close a task.

## Architecture baseline

The [Level 1 report](./docs.html?page=reference-docs-level1-report) records native and WebAssembly RISC-V architectural checks, including 395 Sail tests with zero exclusions. Reproduce its named acceptance with:

```sh title="Architecture gate"
make level1-gate
```

That result establishes the report's architectural boundary. Storage recovery, networking, desktop, JIT workloads, and renderer features require their own acceptance.

## Evidence layers

| Evidence | What it can establish |
| --- | --- |
| Guest instruction trace | The retired instruction sequence and concrete architectural state |
| State digest | A canonical state comparison at a named point |
| Spike / Sail / QEMU differential | Agreement with a named reference under the recorded workload |
| Deterministic native / wasm tests | Asserted behavior exercised by the test input |
| Recorded browser capture | Visible behavior on the built page, with its console and interaction record |

The operating policy's 2026-09-01 update waives host rr traces and retires `ssh dev`. Proof runs happen on the local machine, with local Docker for Linux-only tooling. Historical runbooks retain their old host commands as records; follow current [AGENTS.md](https://github.com/BLamy/wasm-vm/blob/main/AGENTS.md) for new work.

## Task states

These read-only examples use Docstream's native task markers. Each icon has an accessible state name. They explain the workflow; they are not live task results. The [repository roadmap](./roadmap.html) publishes the actual task ledger.

- [ ] **Pending** — eligible work has not started.
- [~] **In progress** — the worker owns the active implementation.
- [?] **Implemented / evidence needed** — an implementation is submitted, or its proof needs completion. The task file retains the exact `implemented` or `evidence-needed` status; this shared icon does not collapse their meaning.
- [b] **Blocked** — a named dependency prevents acceptance; its repro and `blocked_on` remain in the task.
- [d] **Verification debt** — historical landed work is parked outside the active lane, without current exact-head proof. Docstream calls this visual state **Parked**.
- [!] **Refuted** — evidence contradicted the claim and semantic rework is required.
- [x] **Verified** — a separate critic interrogated the evidence and failed to refute the stated boundary.
- [-] **Cancelled** — the task was explicitly retired or replaced.

The `Properties` disclosure identifies this guide's authored scope. Reference pages carry their original source revision and SHA-256. Neither a property nor a marked checkbox creates evidence, and this reader cannot edit either. Only the repository's verifier workflow can set `verified`.

## Local gates

```sh title="Local regression gauntlet"
make ci
```

GitHub Actions is disabled in this repository. Browser bundles build locally; the pre-commit hook maintains deployable `web/dist`, and Cloudflare Pages hosts the published site. Do not create a GitHub workflow as a substitute for the local proof loop.

## Inspect a result

{% stepper %}
{% step %}
Read the task's acceptance and the diff before interpreting the evidence.
{% endstep %}
{% step %}
Predict a concrete state, then check the trace, digest, browser result, or deterministic assertion that could contradict it.
{% endstep %}
{% step %}
Hold changed code against exercised paths. Unexecuted behavior needs evidence; configuration and logging waivers need a reason.
{% endstep %}
{% step %}
Record the finding at an exact trace line, evidence digest, test assertion, or diff line. A verifier changes status only after the claim survives its charter.
{% endstep %}
{% endstepper %}

## Detailed reference

- [Canonical trace format](./docs.html?page=reference-docs-trace-format)
- [Differential harness](./docs.html?page=reference-tools-diff-readme)
- [Compliance setup](./docs.html?page=reference-compliance-readme)
- [Fuzzing](./docs.html?page=reference-tools-fuzz-readme)
- [Stress validation](./docs.html?page=reference-tests-stress-readme)
- [Verifier runbook](./docs.html?page=reference-tools-verify-runbook)
- [Release assurance boundary](./docs.html?page=reference-docs-release-assurance)

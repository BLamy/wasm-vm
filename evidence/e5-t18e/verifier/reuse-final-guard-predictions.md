# Final bounded reuse-guard delta predictions

Registered 2026-09-06T06:23:18.074Z before executing this delta.
Main HEAD observed: 0d966c1fb8ef31e05c2bca52e1a191d9de235af3.
Harness under test SHA-256: e4aba2537476b5ed093cf729991693f1dd0adf581dcaa390f8284620566df816.

- U1: Unchanged miniature old/current repositories pass the actual extracted
  branch. Dirty generated old web/dist outputs outside the bound runtime also
  pass, matching the explicit exception used by the real original rebuild.
- U2: New .cargo/config and rust-toolchain files are rejected in BOTH current and
  reused checkouts, whether ordinary untracked files or ignored through the
  disposable .git/info/exclude file. Eight negative cases, each checked twice.
- U3: A dirty tools/build-file-agent.sh in the reused checkout is rejected by the
  newly added old-checkout tracked-input diff. It is intentionally not one of
  previous.sources, so this exercises the new predicate.
- U4: That exact added old-checkout git-diff predicate passes read-only on the
  actual original clone when generated web/dist is excluded. Prior actual-clone
  anchor, optional-input absence, current input and Makefile checks carry HELD.

No other boundary is added. Reuse prior 22 HELD repair cases, cache guard/mutation
proof, and unchanged runtime/image/rebuild results. No guest/browser/image build,
worker edit, task status, queue, or user-repository commit is performed.

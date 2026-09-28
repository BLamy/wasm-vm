# E5.5-T03bb fresh-critic predictions

Written after reading the task and source/harness diff at bd25d454, before
inspecting the worker logs, physical recording, or running the candidate tests.

1. For a compiled dynamic successor with dynamic chaining disabled, the Machine
   never calls the publication hook. Real browser-executor publication installs
   and live dynamic entries remain zero; ordinary execution still proceeds.
   With the option enabled, publications name the resolved virtual/physical target.
2. On one real executor, off-to-on toggling after warm execution enables new
   publications and safe dynamic hits. Turning it off again prevents new dynamic
   publications. No stale generated option state defeats either transition.
3. A bounded virtual remap or execute-authority change after warming a dynamic
   target cannot execute a stale unauthorized target; clearing/relinking respects
   the current authority and guest registers/traps match the interpreter.
4. Static edges still link and chain with dynamic chaining off. Both option values
   remain architecturally equivalent to the interpreter for varied bounded guest
   data and run quanta; actual JIT execution must be observed in each candidate.
5. Removing the new outer guard causes the worker regression to fail. The guard
   surrounds the entire call, not merely the installs statistic. No hidden map or
   table mutation is accepted as disabled behavior.
6. The frozen receipt binds its exact source, helper/resources and WASM, the same
   prepared pair, runtime and original deadlines. Independently reconstructed
   physical input/readbacks decide nonce acceptance. Inspect the actual PNG; a
   stale or late result cannot open T03q even with zero publication installs.
7. The prescribed core/wasm/browser-JIT/harness gates pass from a pristine exact
   source clone with scrubbed Rust/Cargo/Node configuration. A failed or missing
   gate remains a proof gap until resolved.

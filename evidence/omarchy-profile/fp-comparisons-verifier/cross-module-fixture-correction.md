# Cross-module fixture correction

The first independent WASM run reached 5 passing tests and one fixture failure:
`pre-freeze-wasm-verifier.log:46–50`, BranchTaken instead of Budget.
The initial fixture warmed links with FS=Clean, then changed to FS=Initial.
Existing (unchanged) `crates/wasm/src/jit_browser.rs:134–135` includes FS in the
context key; `:1940–1954` clears static link words when that key changes.
The test therefore had not established a live cross-module edge.

Correct only the test: before each measured budget, warm under the intended
FS=Initial context, publish the successor, restore entry FS/flags/registers,
then execute. Link-entry counters remain mandatory. No expected state value or
runtime code changes. P1–P4, P6, P7 and same-module P5 from the first run carry
forward because their code and evidence are unchanged. Rerun only the missing
cross-module coverage before the final frozen acceptance.

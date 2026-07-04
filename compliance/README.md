# RISCOF architectural compliance (E1-T20)

Runs [riscv-arch-test](https://github.com/riscv-non-isa/riscv-arch-test) through
[RISCOF](https://riscof.readthedocs.io): each test is compiled per the DUT's declared ISA,
run on our emulator (**DUT**) and on **Spike** (**reference**), and both dump a memory
*signature* region (`begin_signature`..`end_signature`) that must match bit-exactly.

## Reference = Spike (not Sail)
Spike is already in the `wasm-vm-toolchain:local` Docker image (run via `tools/toolchain/run.sh`),
and is the spec-sanctioned Sail fallback — so no heavy opam/ocaml build. gcc (compile) and Spike
(reference) both run inside that image; the DUT is our native `wasm-vm-cli`.

## Provision (hermetic, pinned)
```
bash compliance/provision.sh
```
Installs `riscof==1.25.3` into `compliance/.venv` and clones `riscv-arch-test` at the pinned
commit `df886adb05eb892f915d3403ff14e8c061552be8` (both gitignored). Requires the Docker toolchain
image (Spike). Verified reachable: pypi + github, `spike --help` via Docker.

## Status / remaining deliverables (E1-T20 is IN PROGRESS)
Provisioning ✅ (this dir). Still to land before the PR:
1. **Signature-dump exit path** in the core + CLI: `wasm-vm-cli run --signature=FILE
   --signature-granularity=4`. The loader already scans `.symtab` for `tohost`; extend it to expose
   `begin_signature`/`end_signature`, and at HTIF halt write RAM[begin..end) as 4-byte little-endian
   words, one per line, 8 lowercase hex digits (RISCOF convention).
2. **DUT plugin** `riscof_wasmvm.py` + `wasmvm_isa.yaml` (must match `misa` from E1-T01 — a CI
   cross-check parses both) + `wasmvm_platform.yaml` (mtvec reset, tohost addr) + `env/model_test.h`
   (RVMODEL halt = tohost write; signature macros) + `env/link.ld`. Compile via the Docker gcc, run
   via the native DUT binary.
3. **Reference plugin** wrapping the Docker Spike.
4. `config.ini`, a `make riscof` target (HTML report), a CI job, and `EXCLUSIONS.md` (spec-cited
   justification per excluded test; target empty).
5. **wasm32 DUT leg**: signatures byte-identical to the native DUT (leans on E1-T22).
6. **Mutation check**: a seeded bug (e.g. LWU sign-extension) must produce ≥1 signature mismatch.

#!/usr/bin/env python3
"""E4-T26 — one-command local reproduction of any JIT compliance matrix cell.

The full Epic 1 compliance surface (every vendored riscv-tests suite) must reach a
verdict/byte-identical result to the interpreter under each JIT configuration. This driver
reproduces one matrix cell locally from a clean invocation.

Usage:
    tools/compliance.py --jit <config>     # run one riscv-tests JIT config
    tools/compliance.py --jit all          # run all four configs + the no-waivers gate
    tools/compliance.py --riscof --jit <c> # architectural RISCOF-vs-Sail run (see notes)
    tools/compliance.py --list             # list configs

Configs (each a distinct matrix row, all must be verdict-identical to the interpreter):
    default     jit-default    — shipping tier policy (threshold 64, default cache, chaining on)
    threshold0  jit-threshold0 — threshold 1: EVERY block driven through the JIT pipeline (incl.
                                 the fallback-decision code for never-translated F/D/CSR/ecall
                                 blocks). Closes the "the JIT never saw them" gap.
    churn       jit-churn      — threshold 1 + BatchLru eviction (max_batches=2): eviction churn
    nochain     jit-nochain    — threshold 1, block chaining OFF: isolates chaining bugs

The native riscv-tests matrix runs headlessly here. The RISCOF signature-vs-Sail architectural
run needs the Sail reference model binary (`sail_riscv_sim`) + the RISCOF venv; if the Sail
binary is not on PATH this driver prints the dev-box command instead of fabricating a result.
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# config alias -> matrix test fn in crates/jit-runtime/tests/jit_execution.rs
CONFIGS = {
    "default": "jit_config_matrix::matrix_jit_default",
    "threshold0": "jit_config_matrix::matrix_jit_threshold0",
    "churn": "jit_config_matrix::matrix_jit_churn",
    "nochain": "jit_config_matrix::matrix_jit_nochain",
}


def run_native(configs):
    """Run the given riscv-tests JIT matrix rows (+ the no-waivers gate) via cargo test."""
    filters = [CONFIGS[c] for c in configs]
    # Always include the no-waivers gate so a cell run also proves no test was dropped.
    filters.append("jit_config_matrix::no_waivers_vs_epic1_baseline")
    rc = 0
    for f in filters:
        print(f"\n== compliance: riscv-tests × {f} ==", flush=True)
        cmd = [
            "cargo", "test", "-q", "-p", "wasm-vm-jit-runtime",
            "--test", "jit_execution", f, "--", "--nocapture",
        ]
        r = subprocess.run(cmd, cwd=REPO)
        rc = rc or r.returncode
    return rc


def run_riscof(config):
    """Architectural RISCOF-vs-Sail run under a JIT config (signature byte-compare vs Sail)."""
    sail = shutil.which("sail_riscv_sim") or shutil.which("riscv_sim_RV64")
    venv_riscof = REPO / "compliance" / ".venv" / "bin" / "riscof"
    if sail is None or not venv_riscof.exists():
        print(
            "RISCOF architectural run DEFERRED to the dev box: the Sail reference model binary\n"
            "(`sail_riscv_sim`) is not on PATH on this host"
            f" (riscof venv present: {venv_riscof.exists()}).\n\n"
            "Dev-box command (runs the DUT under the JIT config, byte-compares signatures vs Sail):\n"
            f"    WASMVM_JIT={config} bash tools/run_riscof.sh\n\n"
            "The DUT plugin honors WASMVM_JIT to force the matching hotness/chaining/eviction knobs;\n"
            "with the threshold0 config every arch-test block is driven through the JIT pipeline.",
            file=sys.stderr,
        )
        return 2
    print(f"== RISCOF × {config} (reference = Sail) ==", flush=True)
    env_cmd = ["env", f"WASMVM_JIT={config}", "bash", "tools/run_riscof.sh"]
    return subprocess.run(env_cmd, cwd=REPO).returncode


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--jit", metavar="CONFIG", help="config: default|threshold0|churn|nochain|all")
    ap.add_argument("--riscof", action="store_true",
                    help="run the architectural RISCOF-vs-Sail signature comparison")
    ap.add_argument("--list", action="store_true", help="list configs and exit")
    args = ap.parse_args()

    if args.list:
        for k, v in CONFIGS.items():
            print(f"  {k:12s} -> {v}")
        return 0

    if not args.jit:
        ap.error("one of --jit or --list is required")

    if args.jit == "all":
        selected = list(CONFIGS.keys())
    elif args.jit in CONFIGS:
        selected = [args.jit]
    else:
        ap.error(f"unknown config {args.jit!r}; choose from {', '.join(CONFIGS)} or 'all'")

    if args.riscof:
        rc = 0
        for c in selected:
            rc = rc or run_riscof(c)
        return rc
    return run_native(selected)


if __name__ == "__main__":
    sys.exit(main())

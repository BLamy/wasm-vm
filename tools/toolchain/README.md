# Reference RISC-V toolchain (E0-T13)

Pinned `riscv64-unknown-elf-gcc`, **Spike** (`riscv-isa-sim`), and
`qemu-system-riscv64` — the exact versions that golden binaries (E0-T14) and
differential traces (E0-T20) are validated against. All pins live in
[`versions.env`](versions.env); scripts and this doc both source it.

The **Docker path is canonical and reproducible**; native installs are documented
conveniences.

## Docker (canonical)

Requires only Docker.

```sh
tools/toolchain/build.sh                 # build + tag wasm-vm-toolchain:local
tools/toolchain/build.sh --no-cache      # cold rebuild (reproducibility check)

tools/toolchain/run.sh -- riscv64-unknown-elf-gcc --version
tools/toolchain/run.sh -- spike --help
tools/toolchain/run.sh -- qemu-system-riscv64 --version
tools/toolchain/run.sh -- tools/toolchain/smoke.sh     # end-to-end round-trip
```

`run.sh` bind-mounts the repo at `/work` and maps your UID/GID, so any artifacts it
produces are owned by you, not root. It derives the repo root from its own location,
so it works from any cwd and tolerates spaces in paths.

The image records the Spike commit it was built from at `/opt/riscv/SPIKE_COMMIT`:

```sh
tools/toolchain/run.sh -- cat /opt/riscv/SPIKE_COMMIT   # must equal SPIKE_COMMIT
```

## Native installs (conveniences)

Version parity with the pinned Docker image is **not** guaranteed on native installs;
use Docker for anything that feeds a differential trace.

### macOS (Homebrew)

The `riscv-software-src/homebrew-riscv` tap provides the ELF cross toolchain; QEMU is
in core; Spike is a source build.

```sh
brew tap riscv-software-src/riscv
brew install riscv-tools          # riscv64-unknown-elf-gcc + binutils + newlib
brew install qemu                 # qemu-system-riscv64

# Spike from the pinned commit:
git clone https://github.com/riscv-software-src/riscv-isa-sim.git
cd riscv-isa-sim
git checkout "$(sed -n 's/^SPIKE_COMMIT="\(.*\)".*/\1/p' /path/to/versions.env)"
brew install dtc                  # device-tree-compiler
mkdir build && cd build
../configure --prefix="$HOME/.local/riscv"
make -j"$(sysctl -n hw.ncpu)" && make install
export PATH="$HOME/.local/riscv/bin:$PATH"
```

> Formula note: if `riscv-tools` is unavailable in your tap snapshot, the individual
> cross-compiler formulae `riscv64-elf-gcc` and `riscv64-elf-binutils` are in
> **homebrew-core** (install plain, no tap). They expose `riscv64-elf-gcc` etc. —
> note the binary prefix is `riscv64-elf-`, *not* `riscv64-unknown-elf-`, so adjust
> commands accordingly (or symlink).

### Linux (Ubuntu 24.04, apt)

Mirrors the Dockerfile:

```sh
sudo apt-get install -y \
  gcc-riscv64-unknown-elf=13.2.0-11ubuntu1+12 \
  qemu-system-misc=1:8.2.2+ds-0ubuntu1.17 \
  build-essential device-tree-compiler git
# then build Spike from SPIKE_COMMIT exactly as the Dockerfile does.
```

## Smoke test

[`smoke.sh`](smoke.sh) assembles [`smoke.S`](smoke.S) (a 4-instruction rv64i program
that writes `1` to `tohost`) with [`smoke.ld`](smoke.ld) and runs it under Spike,
asserting exit status 0 — a full compile + reference-run round-trip. Run it inside the
container:

```sh
tools/toolchain/run.sh -- tools/toolchain/smoke.sh
```

To confirm it actually detects failure, corrupt `smoke.S` with a bad opcode and re-run;
Spike must exit nonzero.

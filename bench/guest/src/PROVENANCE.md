# Benchmark source provenance (E4-T03)

The CoreMark and Dhrystone C sources under this directory are vendored verbatim (unmodified)
from the upstreams below at the pinned commits. Recorded per-file sha256 lets anyone confirm
the checked-in copies match upstream. The benchmark ELFs in `bench/guest/` are built from
exactly these files by `bench/build.sh` inside the pinned toolchain image.

## CoreMark

- Upstream: https://github.com/eembc/coremark
- Pinned commit: `1f483d5b8316753a742cbf5590caf5bd0a4e4777` (2025-05-01)
- License: Apache-2.0 (see `coremark/LICENSE.md`)
- Port: the upstream **posix** port (`posix/core_portme.{c,h}`), whose timing uses
  `clock_gettime` via `<time.h>` (`GETMYTIME` → `CLOCK_REALTIME`, nanosecond source). The guest
  runs no NTP, so REALTIME advances monotonically during a run — equivalent to MONOTONIC here.
  The five `core_*.c` files + `coremark.h` are the portable benchmark core.

| file | sha256 |
|------|--------|
| coremark/core_list_join.c | ca00e4e010ece47d7f040cb92aa50a95345a00d3171b59d088f6b243be06ce7b |
| coremark/core_main.c | 17884c93c5b94378eb0ff02b4df3725756cf2addb9b8cbcaa6200a4649ff5ca7 |
| coremark/core_matrix.c | ecdff717b5a5c4907d221a606760e25499899cbf617582c05d40db71c91351e4 |
| coremark/core_portme_posix_overrides.h | 1dc67b5c1b9c773cccc740b911d708333d3bf154c3313f77b8a52e18209eda59 |
| coremark/core_portme.c | f2b48f062058d528a5907e339ffd05d98f64d59e7c40d500fe05563eb5247ad0 |
| coremark/core_portme.h | a40e90ef4c5a5626d438afee1f8da628c2800105d4c3b5318e8810b34be554f2 |
| coremark/core_state.c | f4b84bb0a3452c45a4daa664ab502bfdccbd31cb57d93e9ac490c60937717a4e |
| coremark/core_util.c | a3fbfcb9bb943b638624b8ece01c5836dd56a96d7bcde2697b248d077447327f |
| coremark/coremark.h | 42642b9a06c7ed2b3bd9eda971b7c3868c4f5d27bf7ef6c4bba11291a0c2598a |
| coremark/coremark.md5 | dad92861212f8f012e75974e23ea97f7a275a375e0d3bc1d3b216423ba6b6306 |
| coremark/LICENSE.md | 9577b9c846f61fd69a0d8ac965998c6450c7d8969f71f0bb4a931b91aebad28a |

## Dhrystone 2.1

- Upstream: https://github.com/sifive/benchmark-dhrystone (verbatim mirror of Reinhold P.
  Weicker's Dhrystone Benchmark, Version 2.1, C, May 1988).
- Pinned commit: `0ddff533cc9052c524990d5ace4560372053314b` (2020-04-15)
- License: original Dhrystone terms (see `dhrystone/LICENSE`)
- Timing: compiled with `-DTIME` (the `time(2)`, whole-second timer — the same knob the vendored
  upstream Makefile uses). The alternative `times(2)` path redeclares `extern int times()`, which
  is a hard conflict with glibc's `clock_t times(struct tms*)`; `-DTIME` sidesteps it. The
  1-second resolution is compensated by tuning `-DDHRY_ITERS=<N>` so the run lasts well over 10 s.

| file | sha256 |
|------|--------|
| dhrystone/dhry_1.c | 18797298a8d4278ef076fdc0845ab501074bd7f2e7539541f188c951f0cfd069 |
| dhrystone/dhry_2.c | 7954383013caead70e8283375b249ecbaa1aaf092b526acbcac3f187a015c108 |
| dhrystone/dhry.h | e99827a51a006a91fbcddc7fc44ea2303a45eddf39b1d3f887fde8306a2e2e04 |
| dhrystone/LICENSE | e02586eabc5e3675cd959cb777cc13664413f247715b25f1c30c27b9e4ba0126 |

To re-verify: `shasum -a 256 coremark/* dhrystone/*` from this directory.

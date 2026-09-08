# Native ash read primitive — 2026-09-08

Diagnostic only (`acceptance: false`). **The native byte-read behavior reproduced:**
BusyBox 1.36.1 ash issued one successful `read(..., 1)` per byte for the three
real proc files below. The whole-file comparator used real BusyBox `cat`, not a
synthetic reader. This does not measure RISC-V/browser time or run the full
resident identity helper, and does not authorize changing that helper.

## Recorded result

One final native trace run, after the browser closed: 14:39:42.973–14:39:43.146 UTC,
container exit 0. Those timestamps bracket Docker start/attach, **not a comparative
benchmark**. Raw evidence is [builtin.strace](builtin.strace),
[whole.strace](whole.strace), the six `*-{stat,fdinfo,io}.data` outputs, PID files,
and [versions.txt](versions.txt). [summary.json](summary.json) retains every target
read's trace line, PID, requested/returned byte counts, and output/trace hashes.

| Real native proc file | ash bytes | ash successful / EOF reads | cat bytes | cat successful / EOF reads |
| --- | ---: | ---: | ---: | ---: |
| `/proc/$pid/stat` | 302 | 302 / 0 | 302 | 1 / 1 |
| `/proc/$pid/fdinfo/3` | 41 | 41 / 1 | 41 | 1 / 1 |
| `/proc/$pid/io` | 101 | 101 / 1 | 100 | 1 / 1 |

The ash process is PID 16; its target reads are trace lines 3–448. The other ash
process is PID 20; actual cat children 21/22/23 read its proc files at
`whole.strace` lines 4–5, 8–9, and 12–13. All ash target requests are one byte;
all cat target requests are 65536 bytes. Thus ash made 444 positive target reads
plus two EOF reads, versus cat's three positive reads plus three EOF reads.
The single-line `stat` builtin stops at its newline rather than requesting EOF.

These are live files of different native shell processes. In particular their
`io` values and lengths need not match. The parser instead proves that **each
trace's concatenated returned bytes exactly equal that operation's real output**.
FD 3 is `/dev/null`, deliberately not a fabricated FIFO or PCM descriptor.

## Source boundary and limits

Repository/runtime base HEAD: `2ace135363cf0fa3cf7ba978fe6810e564eecc03`, checked
unchanged before/after. The new probe and parser were not yet committed in that
HEAD: their exact recorded bytes are bound by the hashes below and copied
`run.sh`, not by a claim that the base commit contains the new tooling.
The unchanged resident helper
[`tools/guest/e5-t26f-resident-aplay.sh`](../../../tools/guest/e5-t26f-resident-aplay.sh)
uses `read -r` for stat at lines 24–29, fdinfo at 46–48 and 66–68, and io at 92–93.
The probe uses that read primitive, but preserves whitespace in one variable and
prints each line for byte authentication instead of doing identity-field parsing.
It does **not** source or execute `e5_observe`, nor test its wchan, ALSA status,
FIFO, same-player identity, or post-restore behavior.

The native aarch64 BusyBox binary is not the guest RISC-V binary. Strace perturbs
execution; this recording has no syscall-duration attribution. Cat additionally
executes a child, so lower read-call count does not establish net guest savings.
This result supports investigating native byte-read amplification independently
of the earlier write probe; it neither establishes the cause of the 4313.125 ms
browser failure nor converts compile-queue/read counts into host time.

## Exact commands and isolation

Executed from the repository root:

```sh
node evidence/e5-t26f/resident-read-probe/record.mjs
node evidence/e5-t26f/resident-read-probe/check-parser.mjs
```

The recorder invokes the actual parser as:

```sh
node tools/verify/e5-t26f-ash-read-probe.mjs evidence/e5-t26f/resident-read-probe
```

The full command/exit transcript is [transcript.log](transcript.log); native shell
commands are in [run.sh](run.sh), byte-identical to the owned probe source.
Both recorder and parser refuse an existing final output. For another run use a
fresh sibling evidence directory containing the recorder, not this retained one.

Cached Alpine 3.20 image:
`sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc`.
Final owned container: `e5-t26f-ash-read-probe-native-1788878382451` (exited).
Limits: network none, one CPU, 128 MiB, 32 PIDs, bounded recorder subprocess
timeouts. No downloads, packages installed, mounts, browser, or emulator boot.
Strace and seven library targets/SONAME aliases were copied only from stopped
`e5-t26f-ash-write-probe-native`; it remained stopped and was never started or
written. [provenance.json](provenance.json) records the actual boundaries.

Two setup failures are retained, not presented as successful runs:
[setup-path-failure.log](setup-path-failure.log) stopped before container creation;
[setup-library-failure.log](setup-library-failure.log) and
[setup-versions-failure.txt](setup-versions-failure.txt) show missing SONAME aliases
before tracing began. Docker `cp -L` archived resolved basenames; copying the
original aliases too fixed this mechanical setup issue in a fresh container.
There was only one completed native trace run.

## Parser self-validation and hashes

Four bounded offline checks passed: unchanged real evidence accepted; changed
output byte, wrong returned-byte count, and missing read each refused without
writing a summary. These are deliberately mutated copies, **not native evidence**.
Their logs live under `parser-check-*`; [parser-checks.json](parser-checks.json)
also confirms canonical raw files stayed byte-identical. No broader test gate ran.

SHA256 pins:

| Artifact | SHA256 |
| --- | --- |
| Unchanged resident helper | `2ae65408985f18be8b1287521bad23803282d652bb8f98421a135a351dac213c` |
| Native `/bin/busybox` | `b9d035e89b4c0575872bade852c34ccc5a4a1ee4bdd105bb445eb16c9aeba1ba` |
| Native `/usr/bin/strace` | `8d7b13d30761a08476806783409072471de9dbf24e2bc90b973bc592204a3352` |
| Probe / `run.sh` | `ff640c09cf2ef4fb4ef3713b0ab03403ff9d82ff5b48f93d94610df3779ad80b` |
| Parser | `78eed6e63871af82ce9e1299a203c6bb17c9355adbfa103636575d42729d21d9` |
| `builtin.strace` | `98fbf71a0c46faba98889da60bc2df49c56b913c413105e6cbca8c634f96177d` |
| `whole.strace` | `a9e9d21929a8cbc1633ea8da083bee07d95c57ff294e46a0244b4983c2c1db19` |
| `summary.json` | `caa6e888d971cda0e9e86d15f313339eecfe5d927f1e5a8f2314b5f045297190` |
| `provenance.json` | `a28c884cd56d25ca95f2e60827af5fcd2fa129258428fb9411d7d2fd888831a2` |
| `transcript.log` | `f15fb62efb62bf61572a61daa5310b9302c920bf4ae4465443421f3020246e9c` |
| `parser-checks.json` | `fa2c28494d3db9b9c02dd9ba178c846fa4bc5059f5d520f57f9e75bc0742d158` |

## Independent disposition

Fresh Daybreak Blue critic Euler holds the bounded native read-primitive claim
in `../resident-read-verifier/report.md`. It checks raw calls, byte reconstruction,
tool/provenance pins, setup-failure exclusions and a novel unsupported-C-escape
attack. That deliberately mutated copy fails before writing a summary and leaves
canonical inputs unchanged. It does not verify F, the actual identity helper,
RISC-V execution, or a speedup. No native container or old browser run was repeated.

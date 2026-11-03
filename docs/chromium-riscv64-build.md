# Built local Replay Chromium RISC-V browser

The local port now builds **Chromium 108.0.5359.0** for Linux RISC-V LP64D from
Replay `master` revision `f2472ba7bee0ed0d91736df49035af867cce6692`.
The exact built artifacts are retained in
`local/chromium-riscv64/artifacts/2026-11-03/build20/`. Verify their presence and
archival integrity with:

```sh
python3 tools/chromium/check-built-artifacts.py
```

The large binaries remain local and ignored. A fresh clone contains the source
patches, configuration, hashes and reference evidence, but does not download the
browser. The read-only command requires those actual retained binaries. It does
not execute the browser or establish a new runtime result.

## Exact source record

`tools/chromium/built/source-inputs.json` pins the five changed Git repositories
and 92 changed/generated source inputs. `native-source-check.json` records an
exact byte comparison against the native container build tree. The final Ninja
check reports `no work to do` for `chrome`, `sandbox_linux_unittests`, and
`chrome_sandbox`. This binds the archived changes to the tested build; it is not
a claim of a hermetic or byte-reproducible toolchain rebuild.

Apply each combined port patch only in its named repository at its recorded HEAD:

| Patch | Repository under the retained workspace |
| --- | --- |
| `chromium.patch` | `src` |
| `angle.patch` | `src/third_party/angle` |
| `ffmpeg.patch` | `src/third_party/ffmpeg` |
| `swiftshader.patch` | `src/third_party/swiftshader` |
| `webrtc.patch` | `src/third_party/webrtc` |

`chromium.patch` already includes the Crashpad port and approved sandbox backport.
`opensuse-sandbox-upstream.patch` is the unmodified upstream reference, not an
additional patch to apply. The original is from
[openSUSE's RISC-V Chromium port](https://api.opensuse.org/public/source/home:Andreas_Schwab:riscv:chromium/chromium/riscv-sandbox.patch).
`sandbox-adaptations.json` records the changes needed for Chromium 108, including
old syscall guards and RISC-V ptrace argument handling. The combined root patch
also enables the sandboxed zygote for explicitly unrecorded RISC-V browsing and
uses Abseil's monotonic-clock fallback on RISC-V Linux.

The archived setup scripts and GN arguments describe the existing ARM64 Ubuntu
24.04 Colima build with native Clang/LLD 18, Python 3.8 and the RISC-V glibc sysroot.
`prepare-unbundled-driver.py` generates the two recorded driver-symbol source files.
There is **no matching RISC-V recording driver**: every browser test sets
`RECORD_REPLAY_DONT_RECORD=1`. The result supports normal browsing; Replay recording
and replay remain unproven.

The independent pre-backport source checkpoint from E0-T33 remains intact. Its
[guide](chromium-riscv64.md) and `workspace.json` describe that older snapshot.
The current built source changes are preserved in this separate patch closure.
Existing license notices are in `tools/chromium/licenses/`; the additional Abseil
notice is retained alongside this build record.

## Recorded reference result

`evidence/e0-t34/reference/` preserves the actual build and serial transcripts,
executed validation scripts, test page and graphical captures. This reference
uses QEMU 11.1.1, the project's Linux 6.6.63 kernel, Ubuntu Base 24.04.5 riscv64,
and Weston 13 with DRM/Pixman and direct Wayland Chromium.

- All **338** Linux sandbox suite cases completed successfully, with one launcher
  job and retries disabled. The earlier five failures were repaired before this run.
- Two renderer processes report UID 1000, PID namespaces, `NoNewPrivs: 1`, and
  `Seccomp: 2`; their command lines have no `--no-sandbox` flag.
- The visible browser page reports JavaScript 42, WebAssembly 42, and the expected
  canvas pixel `[42, 128, 64, 255]`. Virtual keyboard Tab/Enter activates its real
  button and increases the visible run counter from 1 to 2.

The full transcript includes three missing optional UPower D-Bus service messages;
no zero-diagnostics claim is made. The screenshot's standardized Linux browser
identity string says `x86_64`; the retained ELF headers and actual kernel `uname`
identify the executable machine as RISC-V.

These are bounded reference observations, not a general sandbox audit, performance
comparison, or proof of execution inside wasm-vm. The requested final destination
is **inside wasm-vm**; image packaging and CPU/device/browser integration are the
next work. No fastest-distro claim has been measured.

Publish PRs only to **BLamy/wasm-vm**. Never push or submit a PR to
**replayio/chromium**. No GitHub Actions or upstream CI is enabled by this record.

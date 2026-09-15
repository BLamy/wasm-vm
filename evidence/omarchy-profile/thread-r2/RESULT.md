# First built cold attempt: UNPROVEN

Frozen harness: `af36874149d3a8c53f878e8a5d42e507028c24bc`.
The preflight receipt binds the actual built assets and helper closure.

The run began at 2026-09-13T22:37:41.641Z. Its 90-minute startup timer began at
22:37:46.805Z, but the first progress screenshot timed out after 20 seconds.
The harness consequently ended at 22:38:08.562Z with exit 1. This is a
recording failure, not a desktop compatibility or input-performance result.

The actual pre-app origin observation was empty. No browser console errors
were recorded. Raw worker serial output contains Linux 6.6.63 startup output;
the guest had not reached graphical readiness. The failure screenshot was
successfully captured and inspected by the coordinator: black background and
the real “Starting Omarchy desktop / Booting Omarchy…” dialog, no desktop.
No pair or physical input measurement was produced.

Preserved evidence:

- `cold-built/report.json`: SHA-256
  `bc53cfe269e7ba371c913856a97d7f6bb920c280a12b18c0b92ec5e7b6ad12fe`.
- `cold-built/failure.png`: SHA-256
  `6593b2d16c0cae886aa23f8d13b8a56305240c22833f1ddc0c9083463ad37934`.
- `cold-built.log`: SHA-256
  `08d8dce866a32e92cf2d7e207cd1fd508c945ba3e838ee2f02fbf7560f2fa283`.

The bounded correction is recording-only: a cold-start progress screenshot
TimeoutError is retained as a diagnostic and does not terminate startup.
Other errors still fail. The final desktop screenshot stays mandatory and
uses the remaining startup budget. The separate physical-input deadline
stays exactly 120 seconds. Freeze this correction and record to a new folder;
do not replace the first attempt or its preflight receipt.

## Full-budget built cold rerun: UNPROVEN

Frozen harness: `30b76b4fe886db040aabf584bf79b82bc484412b`.
`preflight-rerun.json` binds the built assets/helper closure at that head and
the preceding preflight receipt. No emulator, guest image, kernel, production
artifact, or physical-input deadline changed for this recording correction.

Exact command (local Chrome/socket access required):

```sh
set -o pipefail
OMARCHY_CANDIDATE_CHUNKS=target/omarchy-thread-r1/chunked \
OMARCHY_EXPECT_RENDERER=llvmpipe \
OMARCHY_EXPECT_LP_NUM_THREADS=0 \
OMARCHY_BROWSER_TIMEOUT_MS=5400000 \
node tools/verify/omarchy-desktop-live.mjs local \
  evidence/omarchy-profile/thread-r2/cold-built-r2 cold-pair \
2>&1 | tee evidence/omarchy-profile/thread-r2/cold-built-r2.log
```

The run began at 2026-09-13T22:43:38.183Z. The startup timer ran from
22:43:42.402Z to 2026-09-14T00:13:42.402Z: the full 5,400,000 ms budget.
The report finished at 00:13:47.307Z with `result:"failed"`,
`classification:"UNPROVEN"`, and `cold-pair startup deadline exceeded`.
The coordinator consumed the original command session's exit status 1.
There were zero recorded browser console errors and zero progress screenshot
errors. This was not another early screenshot failure.

The pre-app observation at 22:43:41.821Z shows an empty IndexedDB, Cache
Storage, service-worker registration/controller, localStorage and
sessionStorage, with no VM or worker messages. The URL requests
`noSnapshot=1&persist=1`. The later controller restore-outcome observation
was not reached; empty initial storage is not a substitute for that missing
acceptance observation.

`wvm:guest-ready` arrived at page-relative 3,405,555.735 ms (about 56.76
minutes). No `wvm:desktop-ready` event arrived. The final screenshot,
personally inspected by the coordinator, shows a black canvas behind the
real “Starting Omarchy desktop” dialog and “Downloads complete. The guest
is responding slowly; waiting for the desktop…” status. It does not show
a mapped graphical desktop or successful GUI input.

The raw `report.json` worker wire includes the app's actual quiet readiness
RPCs even though `serialCommands:[]` and the legacy `serial.log` omit those
explicit harness probes/quiet output respectively. Completed
`hyprctl -i 0 -j layers` replies include `no such instance` and fenced exit
1; the completed `__WVEND_mu0hodsd69_1` is followed by a later unfinished
readiness command at cutoff. These replies are not a PID-bound crash record.
The actual compositor PID/environment and active renderer were not observed.

No RAM/disk pair, restored-browser arm, physical nonce or input result was
produced (`inputEvents:[]`). Startup budget exhaustion is not a negative
LP0 compatibility result and does not satisfy T03g. The existing LP1
baseline and prior HELD evidence are unchanged. Omarchy responsiveness is
still unresolved; nothing was published to production or R2, and no PR was
merged. Do not repeat the identical full-budget experiment automatically or
silently bypass T03d's unresolved planning dependency.

Preserved raw rerun evidence (SHA-256):

- `preflight-rerun.json`:
  `f91f036c9df252a88b3a4f79dca84d5418edc44027dc6045e9b0acba8aae4a0f`.
- `cold-built-r2.log`:
  `bdeb93d4bc5301d9a4ee64391af9ebb941ae4c7b434ee1afc89bc1a733f4a690`.
- `cold-built-r2/report.json`:
  `766f19c3dad6f59a2bec769899fe60bdabd38514be953b3f7cc2916f8e94303f`.
- `cold-built-r2/serial.log`:
  `9ae939e178e9f09ee19c2b79eb78121491a92ceb01da6bd3caf42c04c2e4358b`.
- `cold-built-r2/failure.png` and final `latest.png` (identical bytes):
  `8d5e1fcb91c1c5aa44899488e589b42a0cb4914c5238f1a2763054f7267edfa6`.

The 30 focused harness tests passed before the rerun; their original output
is retained in `harness-rerun-tests.log`. They validate the recording guards,
not desktop compatibility. The new full-budget result is submitted to the
fresh Daybreak Blue critic against its pre-result predictions P6–P9; only
that separate review may adjudicate the task's evidence status.

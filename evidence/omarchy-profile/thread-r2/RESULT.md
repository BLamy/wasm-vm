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

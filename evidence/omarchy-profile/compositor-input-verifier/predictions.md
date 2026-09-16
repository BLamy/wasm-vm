# E5.5-T03ap — independent pre-result predictions

Recorded 2026-09-16 by fresh verifier `/root/compositor_input_verifier`.
At prediction time AP is pending, AO is implemented awaiting its final critic,
and no AP observer implementation or AP fixture/guest result has been inspected.
Read first: `tasks/epic-5.5-omarchy/E5.5-T03ap-compositor-input-trace.md`.
This is a medium-risk diagnostic-only boundary. No desktop success is predicted.

## Predictions and falsifiers

| ID | Prediction made before the result | Narrow evidence / falsifier |
| --- | --- | --- |
| P1 | The observer attaches to the actual Hyprland process and records each observed TID's TGID and process identity, including start time. It cannot silently substitute a same-name process, reused PID, or a second reader. | Raw `/proc` identity, attachment records and input-fd identity agree. A failed attach or ambiguous process identity is preserved and restricts the result. |
| P2 | Any claim covering compositor reads is bounded by an explicit observed thread set and interval. Attachment is per TID. Existing-thread races and later clones are either handled or recorded as gaps. | Enumerations/clone events, successful seize/stop receipts and end-of-observation thread state; an unobserved live TID prevents a whole-process no-read claim. |
| P3 | A recorded read return is matched to the preceding ENTRY of the same TID using `PTRACE_GET_SYSCALL_INFO.op`, not a global or per-thread alternating bit. Unpaired EXIT, unsupported architecture, short info results and ptrace errors cannot inherit prior arguments. | For each selected read, trace TID, syscall number, fd, buffer, requested length, ENTRY and EXIT kinds, signed return and error flag. Injected/interleaved stops must not shift pairing. |
| P4 | Only the bytes actually returned by a successful selected read are decoded. Negative returns, zero returns, memory-copy failures and truncation remain visible. The observer does not turn an unsuccessful read into stale events. | Independent fixture literals, requested count, signed return, exact raw bytes, copied byte count and declared capture limit. No decoding beyond the positive return. A read path outside supported coverage is named rather than silently ruled out. |
| P5 | RV64 evdev bytes are decoded as 24-byte little-endian events: two 64-bit timeval fields followed by 16-bit type, 16-bit code and signed 32-bit value. Whole-event short reads remain valid; any residual bytes remain an explicit incomplete capture. | Compare independently constructed literal bytes with decoded values, including signed value -1, EV_KEY, SYN_REPORT and SYN_DROPPED. No invented timestamp order between independent clocks. |
| P6 | An fd is called evdev only with current device identity attached to the actual consuming process/TID. Reusing the same fd number or returning event-shaped data from a pipe cannot inherit that classification. | Target/type/dev/inode/rdev identity at the selected call; if identity can race or changes, preserve the ambiguity. Bounded adversarial fixture below. |
| P7 | The guest trace preserves the real trusted keyboard sequence, exact AO runtime (`36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916`), exact AJ R2 pair, cap 256/recycling ON, original presentation and Enter+120 s readback deadline. Observer setup/output paths are separate from the nonce. | Frozen harness and binary hashes, raw input/worker/serial traffic, runtime config, pair hashes, host deadlines and actual before/after images. No hidden input or nonce-writing command is admitted. |
| P8 | Observer setup, sampling and cleanup have host deadlines, preserve nonzero exits/partial logs, and do not make a failed or late readback pass. The diagnostic result explicitly acknowledges ptrace scheduling effects. | Parent ownership/deadline records and unmodified acceptance timing; an observer failure produces limited or unproven diagnosis, never an invented compositor cause. |
| P9 | Real evdev bytes can establish consumption only by their bound reader and within the captured interval. No observed bytes establishes only a missing observation under the recorded coverage. SYN_DROPPED is preserved, but its presence alone does not uniquely identify overflow. | Compare raw event triples to the ordered physical-key sequence; preserve missing, duplicate, partial and unmatched events. Host acknowledgment, kernel delivery and compositor consumption remain distinct conclusions. |
| P10 | Every owned seized TID is released after normal completion, timeout or partial attachment failure. Cleanup does not leave Hyprland trace-stopped, kill it, or silently suppress application signals. | Successful detach / independently observed TracerPid 0 and live process state, or explicit exited identity. Fixture demonstrates post-detach progress. Unknown or failed cleanup is retained as such. |

## One bounded novel attack: event-shaped data on a reused fd

Use one deterministic Linux fixture process with two threads and a single chosen
fd number. On thread A, make a short successful read of fixed event-shaped bytes
from a pipe. Close/reuse that number for a second pipe/socket with a different
inode. Interleave thread B's nonblocking unsuccessful read and a short successful
read. The observer must retain exact per-TID bytes/return codes and updated fd
identity, and must never classify either pipe as compositor evdev. End with a
bounded detach and require both threads to finish afterward with TracerPid 0.
An identity-decoder fixture may additionally supply an explicitly input-typed
record, then mutate only its type/rdev/inode or reuse the fd, to prove that event
bytes alone cannot satisfy the input classification. Do not open a second real
input reader to simulate the compositor's own queue.

Independent literal RV64 event examples (no fixture value computed through the
production decoder):

- `(sec=1,usec=2,type=1,code=30,value=1)`:
  `0100000000000000020000000000000001001e0001000000`
- `(sec=3,usec=4,type=0,code=3,value=0)`:
  `030000000000000004000000000000000000030000000000`
- `(sec=5,usec=6,type=1,code=30,value=-1)`:
  `0500000000000000060000000000000001001e00ffffffff`
- `(sec=7,usec=8,type=0,code=0,value=0)`:
  `070000000000000008000000000000000000000000000000`

Expected short/error behavior is fixed before running: a request of 96 returning
24 yields exactly one event; a read returning -EAGAIN yields zero copied bytes
and no events; a successful 25-byte pipe read retains the extra byte as an
incomplete event (or is explicitly rejected as a non-evdev payload), never a
second event. The adversarial run stays local; it is not guest acceptance.

## Source checks informing this review

- Linux [ptrace documentation](https://man7.org/linux/man-pages/man2/ptrace.2.html):
  attachment is per thread, GET_SYSCALL_INFO identifies stop kind, and detach
  requires ptrace-stop. Review source of truth for signal/restart handling.
- Linux 6.6 [evdev implementation](https://github.com/torvalds/linux/blob/v6.6/drivers/input/evdev.c):
  reads return complete events; SYN_DROPPED can arise from queue overflow and
  other state changes, so a drop marker alone does not uniquely prove overflow.

No observer evidence, fixture result, actual guest result or implementation
coverage has yet been checked. Each prediction remains **NEEDS EVIDENCE** until
the worker freezes and submits the corresponding records.

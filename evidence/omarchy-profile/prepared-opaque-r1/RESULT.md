# Original-resolution opaque preparation: negative

Frozen implementation: `e841c3a19934ebe4144f6920849b918eb9bcc566`.
The fixed acceptance command restored R3 and ran one opaque-rule request.
Startup began at04:24:28.366Z, with its original04:39:28.366Z deadline.
The request ran from04:25:00.703Z to04:32:46.633Z. Its actual wire reply was:

```
ok
Hyprland IPC didn't respond in time

Couldn't read (6)
```

The guest command returned exit0, but the strict property parser rejected
the reply. An exit code or rule acknowledgment cannot prove the three
properties. No active-window query, fresh-pixel acceptance, paired export,
physical keyboard input or nonce followed. `target/omarchy-opaque-r1` is empty.
Owned browser/client cleanup completed normally; no watchdog or console error.

The worker personally viewed both actual desktop.png and failure.png: the
same empty Foot prompt at1280×800. Both images have SHA256
`97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f`.
Report SHA256:
`fc9ca57469a5d8a1b1c4215512a8752eb064c1e2a39d8a04ba9053930d8ec166`.
This proves neither opacity adoption nor desktop responsiveness, and admits
neither prepared-input work nor release.

Before the guest,53 affected tests,1 real Chrome input-fence/manifest test,
and2 syntax checks passed at the frozen head. Commands and source/runtime
carry checks are in `../prepared-opaque-gates/`. The unchanged runtime,
coherent-export body and prior exact-head/cold/deployment evidence carry;
synthetic export fixtures do not substitute for a usable real pair.

# Desktop boot-order proof

E5-T17d's native headless proof uses a fresh copy of the T17c desktop image for every run. The
native CLI stops at the serial `ttyS0` login prompt with `--profile-boot --no-input`; root remains
locked in the production image, so the proof does not add a debug credential or mutate the boot
configuration.

The persistent `/home/desktop/.local/state/wasm-vm/boot-order.log` is the runtime audit channel.
The markers must occur in this order on every boot:

```text
E5T17D_SEATD_READY=1 pid=<pid> state=<state>
E5T17D_RUNTIME_READY mode=0700 uid=1000 gid=1000
E5T17D_START_DESKTOP_AFTER_SEATD=1 pid=<pid> state=<state>
E5T17D_START_DESKTOP_RUNTIME mode=0700 uid=1000 gid=1000
E5T17D_COMPOSITOR_FAILURE_BOUNDED=30
E5T17D_DESKTOP_RETURNED=0
```

`E5T17D_SEATD_READY` is emitted by the `desktop-runtime` OpenRC service only after a live,
non-zombie seatd process is found. Its `need seatd` dependency and the recorded PID/state are the
seat readiness check. The runtime marker records the live tmpfs directory, which is otherwise not
visible in a post-boot ext4 inspection. `start-desktop` repeats the seatd and runtime checks before
it launches Weston. In headless mode Weston has no DRM device; `E5T17B_WESTON_NOT_READY=1` in
`weston.log`, followed by the 30-second bound and a clean return, is the deliberate failure path.
The serial login prompt after that path proves init/getty remained usable.

Run the exact local gate with:

```text
env -u RUSTFLAGS -u CARGO_HOME -u CARGO_TARGET_DIR -u RUST_LOG \
  -u NODE_OPTIONS -u npm_config_userconfig make verify-E5-T17d
```

The verifier rejects a missing or reordered marker, a mode/owner change, a zombie seatd state, a
missing Weston failure log, a timeout, a stale source image digest, or a missing guest evidence
record. T18's serial crash drill should preserve this channel and add its restart/fallback markers
next to it.

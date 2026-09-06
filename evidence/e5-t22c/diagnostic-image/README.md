# Disposable protocol-logging image — not an acceptance image

The `desktop-image-trace-v6` working-loop image uses the same module, packages,
kernel and renderer as v5. Its only installed-file change is adding
`--logger-scopes=log,proto` to the normal Weston command in `start-desktop`.
The exact diagnostic script is preserved alongside this note. The production
source was restored immediately after the build; this logging is not shipping.

Build command (with that one diagnostic argument in the startup source):

```
E5_T17B_OUT=target/e5-t22c/desktop-image-trace-v6 E5_T17B_PACKAGE_LOCK=tools/image/e5-t18e/MANIFEST.txt E5_T18B_INTERACTIVE=1 E5_T18D_RECOVERY=1 E5_T22C_RESIZE=1 bash tools/image/desktop.sh
target/release/wasm-vm chunk target/e5-t22c/desktop-image-trace-v6/alpine-rootfs.ext4 --out target/e5-t22c/chunks/desktop-trace-v6
E5_T22C_ITERATION=1 E5_T22C_IMAGE_DIR=target/e5-t22c/desktop-image-trace-v6 E5_T22C_CHUNKS=target/e5-t22c/chunks/desktop-trace-v6 E5_T22C_OUT=target/e5-t22c/iteration-trace-v6 node tools/verify/e5-t22c-guest-mode.mjs
```

Image SHA256: `f582f5556ba0954a7a7858fd3f453dfb530195683a7cdd9f6f8034e4a73c6009`.
File manifest SHA256: `2e12dfde165fca5388a6fd217a6db8e9064a9189eede80a2ba1e1941c1f40810`.
Package manifest SHA256: `ba86429d08e11360309b346e8fb757f44f318eccefed3e243dcaf425b91ad908`.

This instrumented run overlaps the unchanged-v5 pixel-coverage run. Its timing
is diagnostic, not a performance baseline or acceptance result. No debug
protocol/screenshot authorization is enabled: the existing local log subscriber
records protocol traffic from this disposable, fixed-content guest.

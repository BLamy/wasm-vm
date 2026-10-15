# Original-MMIO paired worker fixture

This is a small RV64 supervisor guest, **not Linux, Mesa or Hyprland**. It executes
inside the ordinary WasmLinux production worker; it does not use proof-only host
methods to submit GPU commands or modify guest RAM.

The guest negotiates the original virtio block, keyboard, tablet and GPU queues.
It draws green/red/blue with original VirGL shader/draw submissions, presents the
real retained scanout, and checks original response flags, full64-bit fences above
JavaScript's exact-integer range, and one used-ring advance per request. It writes
and repeatedly reads a literal512-byte disk marker. Trusted browser keyboard and
pointer input change the actual guest drawing, disk and cursor plane.

`node tools/virgl-production/paired-worker-browser.mjs OUTPUT roundtrip` records
save, close and fresh-worker restore at64MiB. Append `1024` for the production RAM
size. Both include new draws and actual drawn receipts before ready, exact saved
clock observation before execution, trusted keyboard/cursor and a second changed
disk/renderer/interactive-clock pair. This isolates the pairing boundary in
seconds; production Omarchy is separately booted, captured and verified in74d.

Regenerate the committed binary with
`node tools/virgl-production/paired-guest/build.mjs`. The command uses the existing
owned `wasm-vm-production-graphics-reference` Docker container and its
`riscv64-linux-gnu-gcc`/`objcopy`; it never runs a remote builder. The recurring
acceptance checks that regeneration preserves the committed binary hash.

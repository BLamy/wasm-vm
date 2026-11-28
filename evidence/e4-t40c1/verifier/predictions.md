# E4-T40c1 verifier predictions (written before running anything)

Head: 3a46f316d. 8125 serves this head's web/dist (sha256 of loader.js, wasm, sw.js match local web/dist).

- P1 profiling default-off: `Machine::profiling` initialises `false`; only `?profile=1` (loader.js `wantProfile`,
  main.js `selectedProfile`, desktop-resize.js test-only) or the CLI `--profile` arm it. No production page passes
  `profile: true`. So `turbo_ok` is unchanged for every non-profiled run.
- P2 concentration rerun: for each of click / type / node, top-100 pages cover > 80 % of samples and top-1000
  > 97 %; click top-1 is the 0x7fffadd3e page at 30-50 %; node's kernel share > 50 %; sample counts within ~30 %
  of the claim (371k / 157k / 255k); distinct pages in the low thousands.
- P3 attribution: in page 7fffadd3e during 8 clicks, the hottest regions are +0x5c0 / +0x640 (together > 50 % of
  the page) and +0xdc0 next. With libpixman +0x2d000 file offset, these are vaddr 0x2d5c0/0x2d640/0x2ddc0 (assuming
  text vaddr == file offset), which `nm` places inside `fast_composite_over_8888_8888` and `fast_path_fill`.
- P4 whose-page: 7fffadd3e maps r-xp to `libpixman-1.so.0.42.2` in a process with comm `sway`, file offset
  +0x2d000 (possibly also aliased in other processes, e.g. libgobject, per the claim's caveat).

## Results (after running)

- P1 HELD. `profiling: false` at crates/core/src/lib.rs:1085; armed only by `set_profiling`/`set_host_timer`; web
  callers: loader.js:955 (`profile ?? ?profile=1`), main.js:1316 (`?profile=1` or `opts.profile`, no caller passes
  `profile: true`), desktop-resize.js:51 (test-only `?profile=1`); CLI `--profile`. Production never arms it.
- P2 HELD. verifier/concentration.json: click 353,029 samples / 2,497 pages, top1 42.1 / top10 64.1 / top100 81.4 /
  top1000 98.4, kernel 8.6; type 158,148 / 1,690, 23.9 / 50.3 / 83.3 / 99.3, kernel 34.2; node 233,548 / 1,300,
  5.1 / 35.1 / 83.6 / 99.8, kernel 76.2. Click and type top page 7fffadd3e (148,688 and 37,763 samples).
- P3 HELD. hot-regions.log: +0x5c0 58,778, +0xdc0 46,406, +0x640 43,478, +0xc40 773. libpixman build id
  bb3d57b21ce79c6010f9560d0c25d2f3a50aacdf (lib and debug file match); first PT_LOAD offset 0 == vaddr 0, so file
  offset == vaddr. nm: fast_composite_over_8888_8888 [0x2d54a,0x2d690) holds 0x2d5c0 and 0x2d640; fast_path_fill
  [0x2dd42,0x2e03e) holds 0x2ddc0; the minor +0xc40 is fast_composite_add_8888_8888 [0x2db8a,0x2dc8c).
- P4 HELD. whose-page.log: `83 sway r-xp libpixman-1.so.0.42.2 +0x2d000`, aliased by four chrome processes'
  libgobject-2.0 +0x13000 (the claim's stated caveat).

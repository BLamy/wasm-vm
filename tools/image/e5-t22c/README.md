# Pinned in-place display adaptation

The selected guest is Alpine v3.20 riscv64, Weston **12.0.4-r0**, DRM and pixman.
This is not a compositor-agnostic plugin or a portable public-API-only module.

`build-display-tools.sh` verifies the signed build package lock, the upstream
12.0.4 source archive, exact public header equality, and the packaged libweston
ELF digest. It compiles the adapter against the **actual upstream internal DRM
headers**. There are no copied struct offsets or guessed private prototypes.
The empty local `config.h` selects no optional implementation: the DRM output,
head, device and mode layouts accessed here are unconditional in this release.
The linked `weston_output_mode_set_native` declaration comes from upstream
`libweston/backend.h`, and its implementation remains the pinned packaged ELF.

The adapter waits for a matching connector-cache mode and for outstanding DRM
pageflip/atomic/mode-switch work to complete. It adds at most two owned modes,
switches the native mode without removing the output/global, and retires only
its unused modes and their property blobs on the owning DRM file descriptor.
The backend retains destruction ownership of all entries still in its list.
No output disable, compositor restart, renderer replacement or guest-image
post-build editing is part of this path. The selected virtual GPU uses pixman
without the optional extra shadow framebuffer copy.

A negative return from the pinned backend is **fatal**, not safely retryable:
Weston may already have freed its renderer state. The adapter writes a fixed
diagnostic and immediately exits with status 70, without unsafe renderer cleanup
or false success. The existing bounded supervisor handles that failed process.
This fault path is not a successful resize and must never be counted as one;
the acceptance run requires unchanged compositor and client process identities.

The build-only sysroot is never copied into the guest. The existing 190-package
desktop lock remains unchanged; only the two custom ELFs, explicit configuration,
and opt-in diagnostic commands are added to the immutable image.

`wv-display-query` is a separate unprivileged Wayland client. Its current mode
comes from `wl_output`, while its preferred mode comes from independently read
kernel DRM EDID. Neither comes from the adapter's requested dimensions.

`tools/verify/e5-t22c-native.sh` compiles the actual adapter against the same
headers under native ASan/UBSan, stubbing only external services. It checks mode
ownership, bounded failures, pending transitions, destruction and EDID parsing.
Those tests do **not** claim to execute Weston, render a guest frame, or satisfy
the browser timing target. Only the separate recorded browser boot does that.
The native macOS run does not claim LeakSanitizer support.

Local build:

```sh
E5_T17B_OUT=target/e5-t22c/desktop-image-v4 \
E5_T17B_PACKAGE_LOCK=tools/image/e5-t18e/MANIFEST.txt \
E5_T18B_INTERACTIVE=1 E5_T18D_RECOVERY=1 E5_T22C_RESIZE=1 \
bash tools/image/desktop.sh
```

The production acceptance lock is only frozen after the worker iteration passes.
`E5_T22C_ITERATION=1` explicitly records non-verdict working-loop results.

The final `make verify-E5-T22c` target refuses a missing acceptance lock, rebuilds
the image and custom ELFs from source, checks native sanitizer and observer tests,
rebuilds the browser assets, and records one real desktop boot. The lock binds
source inputs, compiled ELFs, installed custom-file entries, the unchanged package
set, complete ext4 bytes and every served chunk. The recorder also checks that
its frozen source/head and image remain unchanged through the recording.

The browser pending-transition case records an advertised mode which differs
from the actual scanout before another resize request. This establishes a real
unfinished host/guest transition; it does not claim to inspect Weston internals.
The native sanitizer harness separately covers its pageflip, atomic-completion
and mode-switch pending flags.

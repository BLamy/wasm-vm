# Image artifacts

## E5 desktop handoff

The published desktop base is the reproducible E5-T17c build B:

| Artifact | Path | SHA-256 / measured value |
| --- | --- | --- |
| Image | `target/e5-t17c/repro-b/alpine-rootfs.ext4` | `467306a5d842f95927c1f5823363271b55854517f6318576a6a137f5615a5c1e` (1 GiB) |
| Package lock | `target/e5-t17c/repro-b/MANIFEST.txt` | `ba86429d08e11360309b346e8fb757f44f318eccefed3e243dcaf425b91ad908` |
| Custom-file lock | `target/e5-t17c/repro-b/FILE-MANIFEST.txt` | `c82b20c083d808a797bd8db9c080a2be0c3ef7859d29e5b818bbfa99d8427cf0` |
| Desktop chunks | `target/e5-t17c/chunks/desktop-b/manifest.json` | `1be3c29945747184c3ed868f51add1829e97bfd3945f456d4676d5f035fb4827` |
| E3 base chunks | `target/e5-t17c/chunks/base/manifest.json` | `bf6a2c61eb5292f5d1901bced572c51db4f63a18a85bf673b5871bccc46c8c46` |

The image uses the 11-package signed profile in
`tools/image/e5-t17a-desktop-packages.json`. Startup is DRM + Pixman through `seatd`, with tty1
autologin to `desktop`, `/usr/local/bin/start-desktop`, and the Weston desktop shell. The exact
E3 base is 512 MiB / 4,096 positions / 227 unique objects. The desktop artifact is 1 GiB / 8,192
positions / 822 unique objects. T17c measured 3,211 reused positions (78.3936%), 19 reused
objects, 803 new objects, and 105,250,816 fetched bytes. The allocated ext4 delta was 103,636,992
bytes; the accounted content delta is 105,250,816 bytes against the 350 MiB (367,001,600-byte)
budget.

`evidence/e5-t17c/desktop-image-reproducibility.json` is the source handoff. The final persistence
record is `evidence/e5-t17e/desktop-persistence.json`; it binds the image, both chunk manifests,
the package/file locks, the Docker/debugfs hygiene inspection, and the guest reload proof. T17e
adds `htop` only to a disposable runtime copy. It is not in the committed base profile or the
published base manifests.

Large image and chunk objects follow the existing E3 content-addressed artifact flow: publish the
small manifest through the Pages build and place the large image/chunk payloads behind the configured
R2 asset base. Do not put the 1 GiB image or its chunk objects in `web/dist`; Cloudflare Pages has a
25 MiB per-file limit. `tools/deploy-cloudflare.sh` rewrites the browser's `releases/` references to
the R2 asset base and removes large release directories from the Pages payload.

## Rebuild and verify

From a clean checkout with the pinned Docker/Alpine inputs available, run:

```sh
make verify-E5-T17e
```

That command rebuilds the T17c image in two output directories, verifies ext4 and chunk integrity,
recomputes the E3 dedupe numbers, inspects the final image read-only, boots a clean copy in the
native riscv64 emulator, runs `apk update` plus the signed `apk add --no-scripts --no-progress htop`
transaction, and performs two `save_resume`/reload cycles. The guest writes and `sync`s a sentinel
before each snapshot; the verifier requires the sentinel and `/lib/apk/db/installed` digest to match
after both reloads. It also records a rejected malformed unsigned package attempt and a final
guest-layer state digest after `poweroff`.

The persistence run uses the fixed desktop image, package name, sentinel value, snapshot identity,
and emulator flags. Runtime logs and snapshot blobs are under ignored `target/e5-t17e/`; committed
proof is under `evidence/e5-t17e/`. The proof is local guest evidence and intentionally has no
independent-machine, WebKit, or host-rr leg.

## T18 handoff

E5-T18 starts from this exact image and persistence record. Desktop bring-up work must rebuild the
image from the committed T17a profile rather than hand-editing the runtime copy, keep the T17c
package/file/chunk locks intact, and add any new startup or input evidence to the next task's
verification log. The T17e runtime copy is disposable and must never become the source artifact.

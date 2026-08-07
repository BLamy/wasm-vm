# E3.6-T05 — Node-preinstalled Alpine snapshot as the default (validate Node runs in the VM)

**Goal:** the default demo restores, in seconds, an Alpine host with **Node.js already installed**, so a
no-param load lands a shell with `node` on PATH — no boot, no `apk` wait. Builds on the shipped browser
Alpine restore (`evidence/epic-3.6/alpine-browser-restore.md`).

## What ships

- **Node baked via `apk`, snapshotted at a node-ready shell.** `tools/build-node-alpine-snapshot.sh`
  boots the pinned Alpine ext4 under the native CLI with `--net-slirp` (real outbound via slirp NAT +
  host-resolver DNS), runs `apk update && apk add nodejs npm`, and only fires the snapshot marker behind
  `node --version && npm --version`. Build log (dev): DHCP lease `10.0.2.15` obtained, `fetch
  https://dl-cdn.alpinelinux.org/alpine/v3.20/{main,community}/riscv64/APKINDEX.tar.gz`, `Installing
  nodejs (20.15.1-r0)`, `OK: 86 MiB in 92 packages`, `v20.15.1`, then `WVSNAPREADY` → snapshot written.
- **Node lives in the disk OVERLAY, not a re-chunked base.** So the disk delta rides the SAME
  `chunked-alpine` base (base_hash `03a8026f2a7c35f64cef19323d2b173456fc71f410df18f27a044607bbae1f14`)
  as bare Alpine; only the RAM snapshot + overlay-delta differ. No re-chunk was needed.
- **Both big artifacts on R2** (`s3://wasm-vm/boot-snapshot/`, public base
  `https://pub-ee599ce692e44e29868ebfa96dd9c7fd.r2.dev/`), since each exceeds the 25 MiB Cloudflare
  Pages cap. The RAM snapshot + tiny artifacts for busybox/bare-Alpine still ship on Pages as before.
- **Selector + default.** `web/main.js`: `?guest=` is now `busybox` / `alpine` / **`node-alpine`**, with
  **node-alpine the default** autoboot (`bootNodeAlpine()` → chunked-alpine R2 base + the node manifest).
  `?guest=busybox` / `?guest=alpine` still work; `?noAutoBoot` opt-out and the busybox cold-boot fallback
  (when the node artifacts aren't deployed) are preserved. All existing coherence machinery is reused
  unchanged (restoreDecisionCode, overlay-generation lock, stamped identity, markGuestReady + prompt
  nudge). Because the node RAM snapshot's page cache reflects the node-installed disk, `seedOverlayDelta`
  (base-hash-namespaced, no-op if an overlay already exists) means a returning bare-Alpine user cold-boots
  rather than getting an incoherent restore; a fresh load (the default) restores Node.

## Artifact sizes (real)

| artifact | raw | gz | sha256 | ships on |
|---|---|---|---|---|
| RAM snapshot `node-alpine-ready.snap.gz` | 221,831,892 B | 55,309,778 B | `43b755a6…` | R2 |
| overlay-delta `node-alpine-overlay-delta.bin.gz` | 75,858,397 B (18,484 × 4 KiB blocks) | 24,258,743 B | `60c9dc60…` | R2 |

Snapshot stamped `core_id=302e302e31…` (crate version 0.0.1) + `base_id=03a8026f…` (chunked-alpine
base_hash, == the deployed R2 base). Node: `nodejs 20.15.1-r0` (main) + `npm` (community).

R2 public 200 check (before the Playwright gate):
```
$ curl -sI https://pub-…r2.dev/boot-snapshot/node-alpine-ready.snap.gz    → HTTP/1.1 200, Content-Length: 55309778
$ curl -sI https://pub-…r2.dev/boot-snapshot/node-alpine-overlay-delta.bin.gz → HTTP/1.1 200
```

## Native round-trip proof (dev)

`tools/node-alpine-resume-proof.sh` reconstructs the post-install ext4 (= pristine + the 18,484-block
overlay-delta — `applied 18484 blocks`), zeroes the snapshot's coherence header (a fresh native machine
has all-zero identity; the header carries no checksum, so this is a clean label change), and resumes:
```
wasm-vm: resumed 221831892 bytes from …node-alpine-ready.snap — continuing guest
wasm-vm:~#
```
The resume lands directly at the node-ready Alpine shell (Alpine prompt `wasm-vm:~#`), confirming the
RAM snapshot + overlay-delta round-trip is coherent and Node is on the reconstructed disk. **Honest
caveat:** under the *native interpreter* (no JIT wired into the CLI `boot` path) a fresh `node`
invocation's V8 startup is extremely slow and did not print within the proof's time budget — the
authoritative Node-runs evidence is the deployed browser gate below, where the same snapshot restores and
`node` produces correct output. (A leaner native retry was run without `--net-slirp` to rule out
lingering network state; result appended if it completes.)

## Deployed Playwright gate — https://wasm-vm.pages.dev (authoritative)

Default load (no query param), fresh IndexedDB:

- **Restored:** `window.__linux.restoredFromBootSnapshot() === true`, `wvmDemo.isGuestReady() === true`,
  guest chip `root@node-alpine`, Alpine shell prompt `wasm-vm:~#` (NOT the busybox `~ #`).
- **Restore wall-time:** **~15.5 s** to restored+ready with the 79 MB of R2 artifacts warm in the HTTP
  cache (dominated by gunzip of the 221 MB RAM image + 76 MB delta + the IndexedDB overlay seed); cold
  adds the 79 MB R2 download on top. Two orders of magnitude under the ~15-min cold Alpine boot + apk.
- **`node -e 'console.log(6*7)'` → `42`** (real Node REPL output, ANSI-colored `\e[33m42\e[39m`).
- **Adversarial (single node process):** runtime-computed sum 1..1000 + write-file-then-read-back:
  `node -e 'let s=0;for(let i=1;i<=1000;i++)s+=i;const fs=require("fs");fs.writeFileSync("/root/p.txt","v="+s);console.log("ADV_"+s+"_"+fs.readFileSync("/root/p.txt","utf8"))'`
  → **`ADV_500500_v=500500`** — a non-canned computed result AND a live write/read on the restored,
  coherent filesystem.
- **Shell sanity:** `echo MARK_$((6*7))_END` → `MARK_42_END` in ~1.3 s.
- **Node speed (honest):** the deployed site is **not** cross-origin isolated (`crossOriginIsolated ===
  false`), so there is **no JIT** — Node runs interpreted. Each fresh `node` invocation's V8 startup takes
  **~55–80 s** wall (the 6*7 gate landed within an 80 s window; the adversarial program in ~55 s). Working,
  correct, but slow — the snapshot removes the boot+install cost, not V8's interpreted startup. JIT
  (cross-origin isolation) is the lever for making the Node *workload* fast (ties to E4-T28).

## Coherence guard

Unchanged from the shipped Alpine restore: the restore is accepted only when `restoreDecisionCode`
returns `resume` (core-hash + base_image_hash + overlay generation). The node RAM snapshot + overlay-delta
share generation 0; `seedOverlayDelta` refuses a delta whose base_binding ≠ the manifest base_hash, and
no-ops (→ cold boot) if an overlay already exists. A foreign build / different base / stale generation →
cold boot, never a broken guest.

## Files

- `tools/build-node-alpine-snapshot.sh` — the node-install snapshot build (native, dev).
- `tools/node-alpine-resume-proof.sh` — native reconstruct + resume + node proof.
- `tools/gen-node-alpine-manifest.sh` — emits `web/artifacts-node-alpine.json`.
- `tools/deploy-cloudflare.sh` — node-alpine snapshot+delta kept R2-pointed (not rewritten to Pages).
- `web/main.js` — `bootNodeAlpine()` + shared `bootAlpineFlavor()`, `?guest=node-alpine` default,
  node-alpine availability probe + guest chip.

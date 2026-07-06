# wasm-vm

**✅ Level 1 — architecturally RISC-V (native + WASM).** The complete RV64GC + privileged
machine passes the full riscv-tests suites AND RISCOF architectural compliance (395/0) against
the canonical RISC-V **Sail** reference, with zero allowlist/exclusion entries. Reproduce:
`make level1-gate` (report: [`docs/level1-report.md`](docs/level1-report.md); tag `level-1`).

**✅ Level 2 — unmodified Alpine riscv64 boots to a login shell IN THE BROWSER (E2-T26 capstone).**
Fetch the Linux kernel + 512 MB Alpine ext4 image, boot from virtio-blk in xterm.js to a `login:`
prompt, log in as root, and use `vi`/`top`/scripts/`poweroff`. Run it yourself:

```sh
cargo build --release -p wasm-vm-cli
bash tools/build-rootfs.sh            # build the Alpine ext4 image (once)
bash tools/demo-capstone.sh 8000      # builds the wasm bundle, serves, prints the demo script
# → open http://localhost:8000/ → click "Boot Alpine" → wait for login: → root (empty password)
```
The lighter **busybox** boot ("Boot Linux") also runs on the deployed page; Alpine's 512 MB image is
local-only via `serve-dev`. Capstone e2e: `web/tests/capstone.spec.js`.

A from-scratch virtual machine in Rust, compiled to WebAssembly, that boots real unmodified
Linux (Alpine riscv64) in a browser tab — target experience: a complete clone of
[webvm.io/alpine.html](https://webvm.io/alpine.html), then beyond it to a full GUI desktop
and self-hosting.

- **`ROADMAP.md`** — the guiding trajectory: seven stacked levels (a Kardashev scale for
  in-browser Linux), what each level gets you, and the capstone threshold that gates each.
- **`AGENTS.md`** — how agents drive the repo: the worker/verifier loop, what counts as
  evidence (rr traces + guest instruction traces), and the verifier charter.
- **`tasks/`** — the full work breakdown: one folder per epic, one file per task,
  `tasks/QUEUE.md` as the global priority queue.
- **`tools/build_queue.py`** — regenerates `tasks/QUEUE.md` from task frontmatter.

Execution model: one task at a time, top of queue, and no task is done until an
adversarial verifier fails to refute it (protocol in `tasks/README.md`).

Sibling project: [`~/Dev/almostnode`](../almostnode) emulates Node.js *APIs* in the browser;
wasm-vm emulates the *hardware*.

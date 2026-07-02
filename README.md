# wasm-vm

A from-scratch virtual machine in Rust, compiled to WebAssembly, that boots real unmodified
Linux (Alpine riscv64) in a browser tab — target experience: a complete clone of
[webvm.io/alpine.html](https://webvm.io/alpine.html), then beyond it to a full GUI desktop
and self-hosting.

- **`ROADMAP.md`** — the guiding trajectory: seven stacked levels (a Kardashev scale for
  in-browser Linux), what each level gets you, and the capstone threshold that gates each.
- **`tasks/`** — the full work breakdown: one folder per epic, one file per task,
  `tasks/QUEUE.md` as the global priority queue.
- **`tools/build_queue.py`** — regenerates `tasks/QUEUE.md` from task frontmatter.

Execution model: one task at a time, top of queue, and no task is done until an
adversarial verifier fails to refute it (protocol in `tasks/README.md`).

Sibling project: [`~/Dev/almostnode`](../almostnode) emulates Node.js *APIs* in the browser;
wasm-vm emulates the *hardware*.

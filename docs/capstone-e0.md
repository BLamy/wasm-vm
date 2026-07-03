# Epic 0 capstone — Hello from RV64, byte-for-byte against Spike

The Level 0 threshold, demonstrated end-to-end from a **cold start**: a browser page loads
the WASM module, runs the bare-metal `hello.elf`, prints `Hello from RV64` through the stub
console into xterm.js — and the instruction trace of that exact run matches Spike's
normalized trace **byte-for-byte**, with native, node-wasm, and browser-wasm all in
agreement.

> **Capstone rule:** perform everything on a machine (or fresh user account / pristine VM)
> that has never built this repo, and in a **fresh browser profile**. Any reliance on
> leftover state — a warm cargo cache with patched deps, a stale `web/pkg/`, a warm browser
> profile — refutes the claim.

## 1. Automated proof

```sh
tools/verify/cold_clone.sh capstone-e0        # cold clone + scrubbed env, then:  make capstone-e0
```

`make capstone-e0` runs `tools/capstone/e0.sh`, which:

1. runs the full epic regression (`make verify-all`);
2. builds the release CLI and the wasm package;
3. executes `hello.elf` through **three engines** and captures each canonical trace:
   - **native** — `wasm-vm run hello.elf --trace` (also asserts stdout is exactly
     `Hello from RV64` and the process exits 0);
   - **node-wasm** — `WasmMachine.set_trace(true)` → `take_trace()` via
     `tools/capstone/trace-node.mjs`;
   - **Spike** — `spike -l --log-commits`, normalized by `tools/diff/normalize_spike.py`
     and trimmed to our authoritative length (Spike spins on the guest's post-exit tail);
4. **`cmp`s all three pairwise** (native == node-wasm == Spike) at commit level — pc + insn
   + rd writebacks — asserting equal, non-zero line counts, and prints a PASS/FAIL summary.

`cmp` (exit 0, zero differing bytes) is the equality — never `diff -w`. Requires **Docker**
(Spike, via the E0-T13 container), **wasm-pack**, and **node**.

Expected summary (Apple M2, 2026-07-03): native/node/spike all **83** lines, all three
`cmp`s PASS, retired **83**, digest `df49438130a9da1733bd689ccf2327837ac09385f8e91ea685359f1b915ceb05`.

## 2. Manual browser step

```sh
make web-build          # wasm-pack build + npm ci (pinned xterm.js, no CDN) + copy ELFs
make web-serve          # http://localhost:8080
```

Launch each browser with a **throwaway profile** (no extensions, no cache):

```sh
# Chrome
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --user-data-dir="$(mktemp -d)" --no-first-run http://localhost:8080
# Firefox
"/Applications/Firefox.app/Contents/MacOS/firefox" \
    -profile "$(mktemp -d)" -no-remote http://localhost:8080
```

**Observable checklist** (both Chrome and Firefox):

- [ ] Page loads with **zero console errors** (DevTools console; our own `console.debug`
      digest line is fine).
- [ ] Click **Run** → the terminal prints exactly `Hello from RV64`.
- [ ] Status line shows **`exited code=0 retired=83`** — the retired count equals the native
      CLI's `retired=`.
- [ ] Offline check: after `web-build`, disconnect the network and hard-reload (cache
      disabled) — the page still loads and runs (assets are pinned, no CDN).

**Evidence — browser trace == native.** In the page's DevTools console:

```js
// run with tracing on, then dump the canonical trace the same way the CLI does
const m = new (await import('./pkg/wasm_vm_wasm.js')).WasmMachine(128);
m.setTrace(true);
m.loadElf(new Uint8Array(await (await fetch('./assets/hello.elf')).arrayBuffer()));
m.run(1e8);
copy(m.takeTrace());        // paste into /tmp/hello.browser.trace
```

```sh
wasm-vm run guest/prebuilt/hello.elf --trace /tmp/hello.native.trace
cmp /tmp/hello.browser.trace /tmp/hello.native.trace && echo "browser == native (byte-for-byte)"
```

Attach the terminal screenshot and the `cmp` result to the Verification log.

## 3. What "done" means

After this passes, Level 0 is closed: every Epic 1 change is developed against an
observable, Spike-anchored machine. `make verify-all` is green at the same commit, so the
claim covers the whole epic, not just the demo path.

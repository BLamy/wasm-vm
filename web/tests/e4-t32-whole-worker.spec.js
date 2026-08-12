import { expect, test } from "@playwright/test";

const rows = "#term .xterm-rows";

test("explicit isolated JIT actually executes translated blocks in the whole-machine worker", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?guest=busybox&nosw&jit=1&jitThreshold=512&profile=1");
  await page.waitForFunction(() => window.wvmDemo?.isGuestReady(), null, { timeout: 180_000 });
  await page.waitForFunction(() => typeof window.__jitStats === "function", null, { timeout: 30_000 });
  await page.evaluate(() => {
    const payload = `responsive_${"x".repeat(32)}`;
    window.__e4t32JitPayload = payload;
    let output = "";
    let resolveReady;
    window.__e4t32JitReadReady = new Promise((resolve) => { resolveReady = resolve; });
    window.__e4t32JitInputObserved = new Promise((resolve) => {
      const decoder = new TextDecoder();
      const unsubscribe = window.wvmDemo.onConsole((bytes) => {
        output = (output + decoder.decode(bytes, { stream: true })).slice(-2_000);
        // The shell echoes command source. Match a value that exists only after execution so an
        // echoed literal cannot make the test inject input before `read` is actually armed.
        if (/__JITREAD_[0-9]+\r?\n/.test(output)) resolveReady();
        if (output.includes(`JIT_INPUT_${payload}`)) { unsubscribe(); resolve(); }
      });
    });
    window.__e4t32JitWork = window.wvmDemo.run(
      "yes >/dev/null & p=$!; printf '\\n__JITREAD_%s\\n' \"$$\"; read x; echo JIT_INPUT_$x; kill $p; wait $p 2>/dev/null; echo JIT_WARM_DONE",
      120_000,
    );
  });
  await page.evaluate(() => window.__e4t32JitReadReady);
  await page.evaluate(() => {
    const started = performance.now();
    window.__e4t32JitLatencies = { inputMs: null, rpcMs: null, rpcError: null };
    window.__e4t32JitInputObserved.then(() => {
      window.__e4t32JitLatencies.inputMs = performance.now() - started;
    });
    window.__linuxCtl.jitStats().then(
      () => { window.__e4t32JitLatencies.rpcMs = performance.now() - started; },
      (error) => { window.__e4t32JitLatencies.rpcError = error?.message || String(error); },
    );
    window.wvmDemo.sendInput(new TextEncoder().encode(window.__e4t32JitPayload + "\r"));
  });
  await page.waitForTimeout(2_250);
  const latencyProof = await page.evaluate(async () => ({
    ...window.__e4t32JitLatencies,
    clientRpc: await window.__linuxCtl.workerRpcStats(),
    status: document.querySelector("#status")?.textContent,
    terminal: document.querySelector("#term .xterm-rows")?.textContent?.slice(-2_000),
  }));
  console.log("[e4-t32 JIT latency]", JSON.stringify(latencyProof));
  expect(latencyProof.rpcError).toBeNull();
  expect(latencyProof.rpcMs).not.toBeNull();
  expect(latencyProof.inputMs).not.toBeNull();
  const inputLatencyMs = latencyProof.inputMs;
  const rpcLatencyMs = latencyProof.rpcMs;
  const warm = await page.evaluate(() => window.__e4t32JitWork);
  expect(warm.stdout).toContain("JIT_WARM_DONE");
  expect(warm.stdout).toContain(`JIT_INPUT_responsive_${"x".repeat(32)}`);
  expect(inputLatencyMs).toBeLessThanOrEqual(2_000);
  expect(rpcLatencyMs).toBeLessThanOrEqual(2_000);
  await expect.poll(
    () => page.evaluate(async () => {
      const stats = await window.__jitStats?.();
      return Boolean(stats?.compiledBlocks > 0 && stats?.executedBlocks > 0 && stats?.retiredViaJit > 0);
    }),
    { timeout: 120_000, intervals: [250, 500, 1_000] },
  ).toBe(true);
  const proof = await page.evaluate(async () => {
    await window.__linuxCtl.pause();
    return {
      backend: document.documentElement.dataset.linuxBackend,
      policy: document.documentElement.dataset.jitPolicy,
      configured: window.__jit,
      actual: await window.__jitStats(),
      scheduler: await window.__schedulerStats(),
      rpc: await window.__workerRpcStats(),
      profile: await window.__linuxCtl.profileStats(),
    };
  });
  expect(proof.backend).toBe("whole-machine-worker");
  expect(proof.policy).toBe("enabled");
  expect(proof.configured.enabled).toBe(true);
  expect(proof.configured.threshold).toBe(512);
  expect(proof.actual.hasExecutor).toBe(true);
  expect(proof.actual.compiledBlocks).toBeGreaterThan(0);
  expect(proof.actual.executedBlocks).toBeGreaterThan(0);
  expect(proof.actual.retiredViaJit).toBeGreaterThan(0);
  expect(proof.scheduler.maxQuantum).toBeLessThanOrEqual(500_000);
  expect(proof.scheduler.retiredInstructions).toBeGreaterThan(0);
  expect(proof.scheduler.requestedInstructions).toBeGreaterThanOrEqual(proof.scheduler.retiredInstructions);
  expect(proof.scheduler.maxSliceMs).toBeLessThanOrEqual(2_000);
  expect(proof.rpc.maxMs).toBeLessThanOrEqual(2_000);
  expect(proof.profile.sampleCount).toBeGreaterThan(0);
  expect(proof.profile.totalNs).toBeGreaterThan(0);
  expect(proof.profile.jitPause.runCount).toBeGreaterThan(0);
  expect(proof.profile.jitPause.runCount).toBe(proof.scheduler.slices);
  expect(proof.profile.jitPause.totalSubmittedBlocks).toBeGreaterThan(0);
  expect(proof.profile.jitPause.maxSubmittedBytes).toBeGreaterThan(0);
  expect(proof.profile.jitPause.maxRunAttemptedBlocks).toBeLessThanOrEqual(8);
  expect(proof.profile.jitPause.maxRunSubmittedBlocks).toBeLessThanOrEqual(8);
  expect(proof.profile.jitPause.maxRunStagedNominations).toBeLessThanOrEqual(64);
  expect(proof.profile.jitPause.maxFinalPumps).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test("default fastest interpreter keeps whole-machine BusyBox rAF/input responsive", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.addInitScript(() => {
    const NativeWorker = globalThis.Worker;
    globalThis.__e4t32WorkerCounts = { constructed: 0, terminated: 0 };
    globalThis.Worker = class CountingWorker extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes("linux-worker.js")) globalThis.__e4t32WorkerCounts.constructed += 1;
      }
      terminate() {
        globalThis.__e4t32WorkerCounts.terminated += 1;
        return super.terminate();
      }
    };
  });
  await page.goto("/?nosw&noAutoBoot=1");
  const bootPair = page.evaluate(() => {
    document.querySelector("#boot-linux")?.click();
    return Promise.all([window.wvmDemo.runBusybox(), window.wvmDemo.runBusybox()]);
  });
  await page.waitForFunction(() => window.wvmDemo?.isGuestReady(), null, { timeout: 180_000 });
  expect(await bootPair).toEqual([{ ok: true }, { ok: true }]);
  expect(await page.evaluate(() => globalThis.__e4t32WorkerCounts.constructed)).toBe(1);
  await expect(page.locator("#boot-progress-bar")).toHaveAttribute("data-ready", "true");
  // A restored guest emits no cold-boot READY_MARKER. Its explicit ready transition must also stop
  // the chunk-progress fetchStats poll; otherwise an idle Worker receives ~4 RPCs/s forever.
  const idleRpcBefore = await page.evaluate(() => window.__linuxCtl.workerRpcStats());
  await page.waitForTimeout(1_100);
  const idleRpcAfter = await page.evaluate(() => window.__linuxCtl.workerRpcStats());
  expect(idleRpcAfter.calls - idleRpcBefore.calls).toBe(0);
  await page.waitForTimeout(5_000);
  const bootDiagnostic = await page.evaluate(async () => ({
    status: document.querySelector("#status")?.textContent,
    terminal: document.querySelector("#term .xterm-rows")?.textContent,
    backend: document.documentElement.dataset.linuxBackend,
    scheduler: await Promise.race([
      window.__linuxCtl?.schedulerStats?.(),
      new Promise((resolve) => setTimeout(() => resolve("rpc-timeout"), 2_000)),
    ]),
  }));
  console.log("[e4-t32 boot]", JSON.stringify(bootDiagnostic));
  const policy = await page.evaluate(() => ({
    backend: document.documentElement.dataset.linuxBackend,
    jitPolicy: document.documentElement.dataset.jitPolicy,
    jit: window.__jit,
  }));
  expect(policy.backend).toBe("whole-machine-worker");
  expect(policy.jitPolicy).toBe("interpreter-faster-for-cold-start");
  expect(policy.jit.enabled).toBe(false);
  expect(policy.jit.threshold).toBe(512);

  // Drive the actual page buttons through the explicit whole-worker command method. An offline
  // provider returns false; a page-boundary rejection must be rendered, not become an unhandled
  // click rejection or kill the VM; logout must still clear one-time credentials and persisted state.
  const tailscaleRpcBefore = await page.evaluate(() => window.__linuxCtl.workerRpcStats());
  await page.click("#ide-sb-net");
  await expect(page.locator("#ide-net-pop")).toHaveClass(/open/);
  await expect(page.locator("#ide-net-pop")).toBeVisible();
  await page.click("#tailscale-login");
  await expect(page.locator("#tailscale-status")).toContainText(
    "Boot with the Tailscale provider before requesting login.",
  );
  await page.evaluate(() => {
    const original = window.__linuxCtl.tailscaleCommand.bind(window.__linuxCtl);
    window.__e4t32TailscaleOriginal = original;
    window.__linuxCtl.tailscaleCommand = async (command) => {
      await original(command);
      throw new Error("injected worker command rejection");
    };
  });
  await page.click("#tailscale-login");
  await expect(page.locator("#tailscale-status")).toContainText(
    "Tailscale login failed: injected worker command rejection",
  );
  expect(await page.evaluate(() => window.wvmDemo.isGuestUp())).toBe(true);
  await page.evaluate(() => {
    window.__linuxCtl.tailscaleCommand = window.__e4t32TailscaleOriginal;
    localStorage.setItem("wasm-vm.tailscale-state.v1", JSON.stringify({ machine: "persisted" }));
    document.querySelector("#tailscale-auth-key").value = "tskey-one-time";
  });
  await page.click("#tailscale-logout");
  await expect(page.locator("#tailscale-status")).toContainText(
    "Persisted browser state cleared; no active Tailscale Worker.",
  );
  const tailscaleProof = await page.evaluate(async () => ({
    state: localStorage.getItem("wasm-vm.tailscale-state.v1"),
    auth: document.querySelector("#tailscale-auth-key").value,
    rpc: await window.__linuxCtl.workerRpcStats(),
    guestUp: window.wvmDemo.isGuestUp(),
  }));
  expect(tailscaleProof.state).toBeNull();
  expect(tailscaleProof.auth).toBe("");
  expect(tailscaleProof.guestUp).toBe(true);
  expect(tailscaleProof.rpc.calls - tailscaleRpcBefore.calls).toBeGreaterThanOrEqual(3);

  // Exercise the production document visibilitychange listeners, not the direct __linux hook.
  // Headless Chromium keeps sibling pages visible, so drive the DOM visibility edge explicitly;
  // both main.js's pause policy and linux-worker-host's heartbeat suspension observe document.hidden.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(
    () => page.evaluate(() => window.__linux.isPaused()),
    { timeout: 10_000 },
  ).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(
    () => page.evaluate(() => window.__linux.isPaused()),
    { timeout: 10_000 },
  ).toBe(false);

  const computed = await page.evaluate(() => window.wvmDemo.run("v=$((37*113+9)); echo COMPUTED_${v}", 60_000));
  expect(computed.exit).toBe(0);
  expect(computed.stdout).toContain("COMPUTED_4190");

  const rafPromise = page.evaluate(() => new Promise((resolve) => {
    const gaps = [];
    let previous = performance.now();
    const frame = (now) => {
      gaps.push(now - previous);
      previous = now;
      if (gaps.length >= 150) {
        gaps.sort((a, b) => a - b);
        resolve({ p99: gaps[Math.floor(gaps.length * 0.99)], max: gaps.at(-1) });
      } else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }));
  const workPromise = page.evaluate(() => window.wvmDemo.run(
    "yes >/dev/null & p=$!; read x; echo INPUT_${x}; kill $p; wait $p 2>/dev/null; echo WORK_DONE",
    120_000,
  ));
  await page.waitForTimeout(100);
  const rpcUnderLoad = page.evaluate(async () => {
    const started = performance.now();
    await window.__linuxCtl.schedulerStats();
    return performance.now() - started;
  });
  const raf = await rafPromise;
  const inputStarted = Date.now();
  await page.evaluate(() => window.wvmDemo.sendInput(new TextEncoder().encode("responsive\r")));
  const work = await workPromise;
  expect(work.stdout).toContain("WORK_DONE");
  expect(work.stdout).toContain("INPUT_responsive");
  expect(Date.now() - inputStarted).toBeLessThanOrEqual(2_000);
  expect(await rpcUnderLoad).toBeLessThanOrEqual(2_000);
  expect(raf.p99).toBeLessThanOrEqual(20);

  const stats = await page.evaluate(async () => ({
    jit: await window.__jitStats(),
    scheduler: await window.__schedulerStats(),
  }));
  expect(stats.jit.hasExecutor).toBe(false);
  expect(stats.scheduler.maxQuantum).toBeLessThanOrEqual(500_000);
  expect(errors).toEqual([]);
});

test("worker routes legacy-interpreter and exact quantum options before its first slice", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/?guest=busybox&nosw&testHooks=1&startPaused=1&slowInterp=1&quantum=12345");
  await page.waitForFunction(() => window.wvmDemo?.isGuestReady(), null, { timeout: 180_000 });
  const routed = await page.evaluate(async () => ({
    backend: document.documentElement.dataset.linuxBackend,
    interpreter: document.documentElement.dataset.interpreter,
    paused: await window.__linux.isPaused(),
    scheduler: await window.__linuxCtl.schedulerStats(),
  }));
  expect(routed.backend).toBe("whole-machine-worker");
  expect(routed.interpreter).toBe("legacy");
  expect(routed.paused).toBe(true);
  expect(routed.scheduler.quantum).toBe(12_345);
  expect(routed.scheduler.maxQuantum).toBe(12_345);
  expect(routed.scheduler.slices).toBe(0);
  expect(routed.scheduler.requestedInstructions).toBe(0);
  expect(routed.scheduler.retiredInstructions).toBe(0);
});

test("worker timer-yield fallback preserves forward progress and interactive RPC/input", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/linux-worker.js", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const disablePostTask = [
      "try {",
      "  if (globalThis.scheduler) Object.defineProperty(globalThis.scheduler, 'postTask', { value: undefined, configurable: true });",
      "} catch {}",
      "",
    ].join("\n");
    await route.fulfill({ response, body: disablePostTask + source });
  });
  await page.goto("/?guest=busybox&nosw");
  await page.waitForFunction(() => window.wvmDemo?.isGuestReady(), null, { timeout: 180_000 });
  await page.evaluate(() => {
    const payload = `timer_${"x".repeat(32)}`;
    window.__e4t32TimerPayload = payload;
    let output = "";
    let resolveReady;
    window.__e4t32TimerReadReady = new Promise((resolve) => { resolveReady = resolve; });
    window.__e4t32TimerInputObserved = new Promise((resolve) => {
      const decoder = new TextDecoder();
      const unsubscribe = window.wvmDemo.onConsole((bytes) => {
        output = (output + decoder.decode(bytes, { stream: true })).slice(-2_000);
        if (/__TIMERREAD_[0-9]+\r?\n/.test(output)) resolveReady();
        if (output.includes(`TIMER_INPUT_${payload}`)) { unsubscribe(); resolve(); }
      });
    });
    window.__e4t32TimerWork = window.wvmDemo.run(
      "yes >/dev/null & p=$!; printf '\\n__TIMERREAD_%s\\n' \"$$\"; read x; echo TIMER_INPUT_$x; kill $p; wait $p 2>/dev/null; echo TIMER_DONE",
      120_000,
    );
  });
  await page.evaluate(() => window.__e4t32TimerReadReady);
  const latency = await page.evaluate(async () => {
    const started = performance.now();
    const rpc = window.__linuxCtl.schedulerStats().then(() => performance.now() - started);
    const input = window.__e4t32TimerInputObserved.then(() => performance.now() - started);
    window.wvmDemo.sendInput(new TextEncoder().encode(window.__e4t32TimerPayload + "\r"));
    const [rpcMs, inputMs] = await Promise.all([rpc, input]);
    return { rpcMs, inputMs };
  });
  const work = await page.evaluate(() => window.__e4t32TimerWork);
  expect(work.exit).toBe(0);
  expect(work.stdout).toContain("TIMER_DONE");
  expect(work.stdout).toContain(`TIMER_INPUT_timer_${"x".repeat(32)}`);
  expect(latency.rpcMs).toBeLessThanOrEqual(2_000);
  expect(latency.inputMs).toBeLessThanOrEqual(2_000);
  const scheduler = await page.evaluate(() => window.__linuxCtl.schedulerStats());
  expect(scheduler.yieldMode).toBe("timer");
  expect(scheduler.timerYields).toBeGreaterThan(0);
  expect(scheduler.schedulerYields).toBe(0);
  expect(scheduler.retiredInstructions).toBeGreaterThan(0);
  expect(scheduler.maxQuantum).toBeLessThanOrEqual(500_000);
  expect(errors).toEqual([]);
});

test("real Node autoboot owns BusyBox races until teardown, then permits a new flavor", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const NativeWorker = globalThis.Worker;
    globalThis.__e4t32FlavorWorkers = { constructed: 0, terminated: 0 };
    globalThis.Worker = class CountingWorker extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes("linux-worker.js")) globalThis.__e4t32FlavorWorkers.constructed += 1;
      }
      terminate() {
        globalThis.__e4t32FlavorWorkers.terminated += 1;
        return super.terminate();
      }
    };
    // Attack the actual 400 ms auto-boot callback in the same task, immediately after it has
    // synchronously claimed Node ownership. This cannot be weakened into a direct helper-only race.
    window.addEventListener("wvm:auto-boot-started", () => {
      globalThis.__e4t32BusyboxAutoRace = window.wvmDemo.runBusybox();
    }, { once: true });
  });
  await page.goto("/?guest=node-alpine&nosw&testHooks=1");
  await page.waitForFunction(() => window.__configuredAutoBootPromise && window.__e4t32BusyboxAutoRace);
  const outcomes = await page.evaluate(() => Promise.all([
    window.__configuredAutoBootPromise,
    window.__e4t32BusyboxAutoRace,
  ]));
  expect(outcomes[0]).toEqual({ ok: true });
  expect(outcomes[1]).toMatchObject({ ok: false, conflict: true });
  expect(outcomes[1].error).toContain("node-alpine boot already owns");
  await page.waitForFunction(() => window.wvmDemo?.isGuestReady(), null, { timeout: 180_000 });
  const sameOwner = await page.evaluate(() => window.wvmDemo.bootNodeAlpine());
  expect(sameOwner).toEqual({ ok: true, already: true });
  expect(await page.evaluate(() => globalThis.__e4t32FlavorWorkers)).toEqual({
    constructed: 1,
    terminated: 0,
  });
  const postReadyConflict = await page.evaluate(() => window.wvmDemo.runBusybox());
  expect(postReadyConflict).toMatchObject({ ok: false, conflict: true });
  expect(postReadyConflict.error).toContain("node-alpine boot already owns");
  const truth = await page.evaluate(async () => ({
    workers: globalThis.__e4t32FlavorWorkers,
    backend: document.documentElement.dataset.linuxBackend,
    guest: document.documentElement.dataset.linuxGuest,
    manifest: document.documentElement.dataset.linuxManifest,
    chip: document.querySelector("#ide-term-who")?.textContent,
    boot: window.__linuxBootStateForTest(),
    restored: await window.__linuxCtl.restoredFromBootSnapshot(),
  }));
  expect(truth).toMatchObject({
    workers: { constructed: 1, terminated: 0 },
    backend: "whole-machine-worker",
    guest: "node-alpine",
    manifest: "./artifacts-node-alpine.json",
    chip: "root@node-alpine",
    boot: {
      active: "node-alpine",
      inFlight: null,
      manifest: "./artifacts-node-alpine.json",
      guest: "node-alpine",
      guestReady: true,
      lastBootError: null,
    },
    restored: true,
  });
  expect(truth.boot.runBanner).toContain("Booting <b>Alpine</b>");
  expect(truth.boot.runBanner).not.toContain("busybox userland");

  const oldControls = await page.evaluate(() => {
    window.__linuxOwnerUiForTest.quota({ usage: 9, quota: 10, unsaved: true });
    window.__linuxOwnerUiForTest.writerStatus({ readOnly: true });
    window.__e4t32OldOwnerControls = {
      quotaRetry: document.querySelector("#q-retry"),
      quotaReadOnly: document.querySelector("#q-ro"),
      quotaReset: document.querySelector("#q-reset"),
      writerRetry: document.querySelector("#ro-retry"),
    };
    return {
      generation: window.__linuxOwnerUiForTest.generation,
      quotaVisible: getComputedStyle(document.querySelector("#quota-dialog")).display !== "none",
      writerVisible: getComputedStyle(document.querySelector("#ro-banner")).display !== "none",
      controls: Object.values(window.__e4t32OldOwnerControls).map(Boolean),
    };
  });
  expect(oldControls.generation).toBeGreaterThan(0);
  expect(oldControls.quotaVisible).toBe(true);
  expect(oldControls.writerVisible).toBe(true);
  expect(oldControls.controls).toEqual([true, true, true, true]);

  expect(await page.evaluate(() => window.__retireLinuxControllerForTest())).toBe(true);
  const retired = await page.evaluate(() => ({
    backend: document.documentElement.dataset.linuxBackend ?? null,
    state: window.__linuxBootStateForTest(),
    guestUp: window.wvmDemo.isGuestUp(),
    workers: globalThis.__e4t32FlavorWorkers,
    ownerUiHook: window.__linuxOwnerUiForTest,
    quota: {
      display: document.querySelector("#quota-dialog")?.style.display,
      children: document.querySelector("#quota-dialog")?.childElementCount,
      generation: document.querySelector("#quota-dialog")?.dataset.linuxOwnerGeneration ?? null,
    },
    writer: {
      display: document.querySelector("#ro-banner")?.style.display,
      children: document.querySelector("#ro-banner")?.childElementCount,
      generation: document.querySelector("#ro-banner")?.dataset.linuxOwnerGeneration ?? null,
    },
  }));
  expect(retired).toEqual({
    backend: null,
    state: {
      active: null,
      inFlight: null,
      manifest: null,
      guest: null,
      guestReady: false,
      runBanner: null,
      lastBootError: null,
    },
    guestUp: false,
    workers: { constructed: 1, terminated: 1 },
    ownerUiHook: null,
    quota: { display: "none", children: 0, generation: null },
    writer: { display: "none", children: 0, generation: null },
  });

  const busybox = await page.evaluate(() => window.wvmDemo.runBusybox());
  expect(busybox).toEqual({ ok: true });
  await page.waitForFunction(() => window.wvmDemo?.isGuestReady(), null, { timeout: 180_000 });
  const replacement = await page.evaluate(() => ({
    state: window.__linuxBootStateForTest(),
    workers: globalThis.__e4t32FlavorWorkers,
    backend: document.documentElement.dataset.linuxBackend,
    chip: document.querySelector("#ide-term-who")?.textContent,
  }));
  expect(replacement).toMatchObject({
    state: {
      active: "busybox",
      manifest: "./artifacts.json",
      guest: "busybox",
      guestReady: true,
      lastBootError: null,
    },
    workers: { constructed: 2, terminated: 1 },
    backend: "whole-machine-worker",
    chip: "root@busybox",
  });
  expect(replacement.state.runBanner).toContain("real RISC-V Linux guest");

  // Recreate both controls for the replacement, then click the retained, detached buttons from the
  // retired Node owner. Generation/controller guards must make all four stale capabilities inert.
  const staleAttack = await page.evaluate(async () => {
    const replacementController = window.__linuxCtl;
    const calls = { resumeAfterQuota: 0, continueReadOnly: 0, prompt: 0 };
    replacementController.resumeAfterQuota = async () => { calls.resumeAfterQuota += 1; };
    replacementController.continueReadOnly = async () => { calls.continueReadOnly += 1; };
    window.__linuxOwnerUiForTest.quota({ usage: 1, quota: 10, unsaved: true });
    window.__linuxOwnerUiForTest.writerStatus({ readOnly: true });
    const replacementGeneration = window.__linuxOwnerUiForTest.generation;
    const nativePrompt = window.prompt;
    window.prompt = () => { calls.prompt += 1; return "RESET"; };
    for (const control of Object.values(window.__e4t32OldOwnerControls)) control.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    window.prompt = nativePrompt;
    return {
      calls,
      sameController: window.__linuxCtl === replacementController,
      replacementGeneration,
      quotaGeneration: Number(document.querySelector("#quota-dialog")?.dataset.linuxOwnerGeneration),
      writerGeneration: Number(document.querySelector("#ro-banner")?.dataset.linuxOwnerGeneration),
      workers: globalThis.__e4t32FlavorWorkers,
      state: window.__linuxBootStateForTest(),
      guestUp: window.wvmDemo.isGuestUp(),
    };
  });
  expect(staleAttack).toMatchObject({
    calls: { resumeAfterQuota: 0, continueReadOnly: 0, prompt: 0 },
    sameController: true,
    workers: { constructed: 2, terminated: 1 },
    state: {
      active: "busybox",
      manifest: "./artifacts.json",
      guest: "busybox",
      guestReady: true,
    },
    guestUp: true,
  });
  expect(staleAttack.replacementGeneration).toBeGreaterThan(oldControls.generation);
  expect(staleAttack.quotaGeneration).toBe(staleAttack.replacementGeneration);
  expect(staleAttack.writerGeneration).toBe(staleAttack.replacementGeneration);
  expect(errors).toEqual([]);
});

test("a pre-READY Worker construction failure clears its unowned boot claim", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const NativeWorker = globalThis.Worker;
    globalThis.Worker = class RejectingLinuxWorker extends NativeWorker {
      constructor(url, options) {
        if (String(url).includes("linux-worker.js")) throw new Error("injected Worker construction failure");
        super(url, options);
      }
    };
  });
  await page.goto("/?guest=busybox&nosw&testHooks=1&noAutoBoot=1");
  await page.waitForFunction(() => typeof window.__linuxBootStateForTest === "function");
  const outcome = await page.evaluate(() => window.wvmDemo.runBusybox());
  expect(outcome).toEqual({ ok: false, error: "injected Worker construction failure" });
  const proof = await page.evaluate(() => ({
    state: window.__linuxBootStateForTest(),
    guestUp: window.wvmDemo.isGuestUp(),
    backend: document.documentElement.dataset.linuxBackend ?? null,
    chipHidden: document.querySelector("#ide-term-who")?.hidden,
  }));
  expect(proof).toEqual({
    state: {
      active: null,
      inFlight: null,
      manifest: null,
      guest: null,
      guestReady: false,
      runBanner: null,
      lastBootError: "injected Worker construction failure",
    },
    guestUp: false,
    backend: null,
    chipHidden: true,
  });
});

test("worker protocol failure becomes a clean fatal state; worker=0 remains explicit fallback", async ({ page }) => {
  test.setTimeout(240_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/?guest=busybox&nosw&testHooks=1");
  await page.waitForFunction(() => window.wvmDemo?.isGuestReady(), null, { timeout: 180_000 });
  await page.evaluate(() => {
    const controller = window.__linuxCtl;
    window.__killedLinuxController = controller;
    window.__linuxWorkerForTest.terminate();
    window.__killSettlements = Promise.allSettled([controller.stateDigest(), controller.whenDone]);
  });
  await expect(page.locator("#status")).toContainText("linux worker fatal", { timeout: 30_000 });
  await expect(page.locator("#status")).toContainText("?worker=0", { timeout: 30_000 });
  const killProof = await page.evaluate(async () => ({
    settled: await window.__killSettlements,
    future: await window.__killedLinuxController.resume().then(
      () => "resolved",
      (error) => error.message,
    ),
    guestUp: window.wvmDemo.isGuestUp(),
  }));
  expect(killProof.settled.map((entry) => entry.status)).toEqual(["rejected", "rejected"]);
  expect(killProof.future).toContain("heartbeat timed out");
  expect(killProof.guestUp).toBe(false);
  expect(pageErrors).toEqual([]);

  await page.goto("/?guest=busybox&nosw&worker=0&jit=0");
  await page.waitForFunction(() => window.wvmDemo?.isGuestReady(), null, { timeout: 180_000 });
  expect(await page.evaluate(() => document.documentElement.dataset.linuxBackend)).toBe("main-thread");
  expect(await page.evaluate(() => document.documentElement.dataset.jitPolicy)).toBe("forced-off");
  const result = await page.evaluate(() => window.wvmDemo.run("echo FALLBACK_OK", 30_000));
  expect(result.stdout).toContain("FALLBACK_OK");
  const fallbackCleanup = await page.evaluate(async () => {
    const controller = window.__linuxCtl;
    const counts = { release: 0, close: 0 };
    const release = controller.releaseWriterLock.bind(controller);
    const close = controller.closeStorage.bind(controller);
    controller.releaseWriterLock = async (...args) => { counts.release += 1; return release(...args); };
    controller.closeStorage = async (...args) => { counts.close += 1; return close(...args); };
    await controller.stop();
    await controller.whenDone;
    const deadline = performance.now() + 5_000;
    while (window.wvmDemo.isGuestUp() && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return { counts, guestUp: window.wvmDemo.isGuestUp() };
  });
  expect(fallbackCleanup).toEqual({ counts: { release: 1, close: 1 }, guestUp: false });
});

test("paused restore has deterministic initial-RAM, computed-output, and terminal-state parity", async ({ page }) => {
  test.setTimeout(360_000);
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  const parityRun = async (url, backend) => {
    await page.goto(url);
    await page.waitForFunction(() => window.wvmDemo?.isGuestReady(), null, { timeout: 180_000 });
    expect(await page.evaluate(() => document.documentElement.dataset.linuxBackend)).toBe(backend);
    expect(await page.evaluate(() => window.__linux.isPaused())).toBe(true);
    const pausedScheduler = await page.evaluate(() => window.__linuxCtl.schedulerStats());
    expect(pausedScheduler.slices).toBe(0);
    expect(pausedScheduler.requestedInstructions).toBe(0);
    expect(pausedScheduler.retiredInstructions).toBe(0);
    const initialDigest = await page.evaluate(() => window.__linuxCtl.stateDigest());
    await page.evaluate(() => {
      let output = "";
      window.__e4t32Poweroff = new Promise((resolve, reject) => {
        const decoder = new TextDecoder();
        const timer = setTimeout(() => {
          unsubscribe();
          reject(new Error(`poweroff digest timed out; tail=${output.slice(-1_000)}`));
        }, 120_000);
        const unsubscribe = window.wvmDemo.onConsole((bytes) => {
          output = (output + decoder.decode(bytes, { stream: true })).slice(-4_000);
          const marker = output.match(/(?:^|\r?\n)(__E4T32_PARITY_42)\r?\n/);
          const match = output.match(/state sha256=([0-9a-f]{64})/);
          if (!marker || !match) return;
          clearTimeout(timer);
          unsubscribe();
          resolve({ digest: match[1], computedOutput: marker[1], output });
        });
      });
      window.__e4t32PoweroffDone = window.__linuxCtl.whenDone;
      // The echoed source contains `%s` and an arithmetic expression, while only the guest shell
      // can produce the concrete `_42` line. This keeps output parity non-echo-spoofable without
      // treating the later wall-clock-sensitive diagnostic RAM hash as guest command output.
      window.wvmDemo.sendInput(new TextEncoder().encode(
        "printf '\\n__E4T32_PARITY_%s\\n' \"$((21 * 2))\"; poweroff -f\r",
      ));
    });
    expect(await page.evaluate(() => window.__linux.isPaused())).toBe(true);
    const queuedWhilePaused = await page.evaluate(() => window.__linuxCtl.schedulerStats());
    expect(queuedWhilePaused.slices).toBe(0);
    expect(queuedWhilePaused.requestedInstructions).toBe(0);
    expect(queuedWhilePaused.retiredInstructions).toBe(0);
    await page.evaluate(() => window.__linuxCtl.resume());
    const terminal = await page.evaluate(() => window.__e4t32Poweroff);
    const doneState = await page.evaluate(() => window.__e4t32PoweroffDone);
    expect(doneState).toMatch(/^(poweroff|exited:0)$/);
    return { initialDigest, doneState, ...terminal };
  };

  const worker = await parityRun(
    "/?guest=busybox&nosw&jit=0&testHooks=1&startPaused=1",
    "whole-machine-worker",
  );
  const main = await parityRun(
    "/?guest=busybox&nosw&worker=0&jit=0&testHooks=1&startPaused=1",
    "main-thread",
  );
  expect(worker.initialDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(main.initialDigest).toBe(worker.initialDigest);
  expect(worker.digest).toMatch(/^[0-9a-f]{64}$/);
  expect(main.doneState).toBe(worker.doneState);
  expect(worker.computedOutput).toBe("__E4T32_PARITY_42");
  expect(main.computedOutput).toBe(worker.computedOutput);
  // Live Linux reads the real Date.now-backed goldfish RTC, so scheduler/wall-clock timing may
  // legitimately change RAM after resume. Record both terminal RAM hashes as diagnostics; the
  // load-bearing deterministic boundary is the identical paused restore above plus exact output.
  console.log("[e4-t32 deterministic parity]", JSON.stringify({ worker, main }));
  expect(errors).toEqual([]);
});

test("a post-READY setup failure tears down its single Worker owner", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    const NativeWorker = globalThis.Worker;
    globalThis.__e4t32WorkerCounts = { constructed: 0, terminated: 0 };
    globalThis.Worker = class CountingWorker extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes("linux-worker.js")) globalThis.__e4t32WorkerCounts.constructed += 1;
      }
      terminate() {
        globalThis.__e4t32WorkerCounts.terminated += 1;
        return super.terminate();
      }
    };
  });
  await page.goto("/?guest=busybox&nosw&testHooks=1&testFailInitialJitStats=1");
  await expect(page.locator("#status")).toContainText("injected initial jitStats setup failure", {
    timeout: 180_000,
  });
  await expect.poll(
    () => page.evaluate(() => globalThis.__e4t32WorkerCounts),
    { timeout: 10_000 },
  ).toEqual({ constructed: 1, terminated: 1 });
  expect(await page.evaluate(() => window.wvmDemo.isGuestUp())).toBe(false);
});

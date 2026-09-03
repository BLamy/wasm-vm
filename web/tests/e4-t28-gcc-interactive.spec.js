// E4-T28e: run the pinned GCC overlay in the real Alpine guest while the browser injects
// independent terminal probes. The overlay is a local, gitignored input; the test refuses a
// missing or differently hashed image instead of falling back to a host compiler.
import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const overlayPath = path.join(repoRoot, "bench/guest/gcc.ext4");
const overlayManifestPath = path.join(repoRoot, "bench/guest/gcc-MANIFEST.txt");
const evidencePath = path.join(repoRoot, "evidence/e4-t28e/gcc-interactive-2026-09-03.json");
const expectedOverlaySha256 = "f53445f65b5e32b9fe3c47e0f84c52c850da2c747edae0abca60e9592a758c4a";
const expectedSourceSha256 = "0fcdc9888cb3a29ca8f176bac087e5fe6c7258a6ab06b1c271c1e109a11d3740";
const expectedObjectSha256 = "97198b27557042fb84de54881c5fb577505b4ee77c41bc056612be6173e5faca";
const expectedObjectSize = 302904;
const expectedKernelSha256 = "08caa7dd12aa40efa5a47f028359711eadc6577c91e9fffe5050f4c861879f58";
const expectedChunkManifestSha256 = "e756558bd4f4046b4830d496c003b6ef0f7b1713bf20de165762f07e544727ba";
const gccPackage = "gcc-13.2.1_git20240309-r1";
const sourceDateEpoch = 1704067200;
const gccGuestTimeoutMs = 2 * 60 * 60_000;
const enforceBudgets = process.env.E4T28E_ENFORCE === "1";
const probeIntervalMs = Math.max(100, Number(process.env.E4T28E_PROBE_INTERVAL_MS || 250));
const maxProbes = Math.max(3, Number(process.env.E4T28E_MAX_PROBES || 2_400));

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function gitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
}

function stripConsole(text) {
  return text.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|[ -/]*[@-~])/g, "").replace(/\r/g, "");
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

async function clearFreshOrigin(page, context) {
  await context.clearCookies();
  return page.evaluate(async () => {
    const indexedDbNames = typeof indexedDB.databases === "function"
      ? (await indexedDB.databases()).map((entry) => entry.name).filter(Boolean)
      : [];
    await Promise.all(indexedDbNames.map((name) => new Promise((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    })));
    const cacheNames = typeof caches === "undefined" ? [] : await caches.keys();
    if (typeof caches !== "undefined") await Promise.all(cacheNames.map((name) => caches.delete(name)));
    return { indexedDbNames, cacheNames };
  });
}

async function localArtifactIdentity(page) {
  return page.evaluate(async ({ expectedKernel, expectedChunks }) => {
    const digest = async (bytes) => {
      const raw = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(raw)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    };
    const read = async (url) => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { url, bytes, sha256: await digest(bytes) };
    };
    const manifest = await read("/releases/chunked-alpine/manifest.json");
    const parsed = JSON.parse(new TextDecoder().decode(manifest.bytes));
    const kernel = await read("/releases/kernel/6.6.63/Image");
    return {
      chunkManifestSha256: manifest.sha256,
      expectedChunkManifestSha256: expectedChunks,
      kernelSha256: kernel.sha256,
      expectedKernelSha256: expectedKernel,
      imageLen: parsed.image_len,
      chunkSize: parsed.chunk_size,
      chunkCount: parsed.chunks?.length ?? null,
    };
  }, { expectedKernel, expectedChunks });
}

test("runs pinned in-guest gcc while the browser remains interactive", async ({ page }, testInfo) => {
  test.setTimeout(gccGuestTimeoutMs + 180_000);
  expect(fs.existsSync(overlayPath), `missing pinned GCC overlay: ${overlayPath}`).toBe(true);
  expect(fs.existsSync(overlayManifestPath), `missing GCC manifest: ${overlayManifestPath}`).toBe(true);

  const overlaySha256 = sha256File(overlayPath);
  const overlaySize = fs.statSync(overlayPath).size;
  expect(overlaySha256).toBe(expectedOverlaySha256);
  const manifestText = fs.readFileSync(overlayManifestPath, "utf8");
  expect(manifestText).toContain(`gcc_package:        ${gccPackage}`);
  expect(manifestText).toContain(`gcc_ext4_sha256:    ${expectedOverlaySha256}`);

  const requestErrors = [];
  const consoleErrors = [];
  let documentHeaders = {};
  page.on("response", (response) => {
    const url = response.url();
    const pathname = new URL(url).pathname;
    if (response.status() === 404 && pathname === "/favicon.ico") return;
    if (response.status() >= 400) requestErrors.push(`HTTP ${response.status()} ${url}`);
    if (pathname === "/") documentHeaders = response.headers();
  });
  page.on("requestfailed", (request) => {
    if (!request.url().endsWith("/favicon.ico")) requestErrors.push(`FAILED ${request.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon.ico")) consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("crash", () => consoleErrors.push("PAGE_CRASHED"));

  const url = "/?noAutoBoot=1&testHooks=1&workerHeartbeatTimeoutMs=10000&" +
    "jit=1&jitThreshold=512&jitResidency=repack-off&jalr=1&region=1&quantum=100000#ide";
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const storageAtStart = await clearFreshOrigin(page, page.context());
    await page.waitForFunction(() => typeof window.__bootGccInteractive === "function", null, {
      timeout: 30_000,
    });

    const boot = await page.evaluate(async () => window.__bootGccInteractive());
    expect(boot, JSON.stringify(boot)).toMatchObject({ winner: "gcc" });
    await page.waitForFunction(() => Boolean(window.__linuxCtl && window.wvmDemo?.exec), null, {
      timeout: 30_000,
    });

    const setup = await page.evaluate(async () => window.wvmDemo.exec(
      "set -e; mkdir -p /mnt; mount -o ro,noload /dev/vdb /mnt; echo T28E_MOUNT_OK; " +
      "sha256sum /mnt/src/miniz.c; stat -c '%s' /mnt/src/miniz.c; " +
      "if command -v file >/dev/null 2>&1; then file /mnt/src/miniz.c; else echo T28E_FILE_UNAVAILABLE; fi",
      900_000,
      { quiet: true },
    ));
    expect(setup.exit, setup.stdout).toBe(0);
    expect(setup.stdout).toContain("T28E_MOUNT_OK");
    expect(setup.stdout).toContain(expectedSourceSha256);

    const runToken = `${Date.now().toString(16)}${Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0")}`;
    const compileCommand = [
      "rm -f /tmp/miniz.o",
      "T0=$(cut -d' ' -f1 /proc/uptime)",
      "SOURCE_DATE_EPOCH=1704067200 /mnt/gcc-wrap -O2 -frandom-seed=miniz -c /mnt/src/miniz.c -o /tmp/miniz.o",
      "RC=$?",
      "T1=$(cut -d' ' -f1 /proc/uptime)",
      "SECS=$(awk \"BEGIN {print $T1-$T0}\")",
      "SIZE=$(wc -c < /tmp/miniz.o 2>/dev/null || echo 0)",
      "SHA=$(sha256sum /tmp/miniz.o 2>/dev/null | cut -d' ' -f1)",
      `if command -v file >/dev/null 2>&1; then file /tmp/miniz.o | sed 's/^/T28E_FILE_${runToken} /'; else echo T28E_FILE_${runToken}_UNAVAILABLE; fi`,
      `TOKEN=${runToken}`,
      `printf 'T28E_RESULT_%s rc=%s secs=%s osize=%s osha=%s\\n' \"$TOKEN\" \"$RC\" \"$SECS\" \"$SIZE\" \"$SHA\"`,
    ].join("; ");

    await page.evaluate(({ command, token }) => {
      const state = {
        token,
        text: "",
        sentAt: Object.create(null),
        sentOrder: [],
        echoAt: Object.create(null),
        seenOrder: [],
        resultAt: null,
        compileSentAt: performance.now(),
      };
      window.__e4t28e = state;
      window.__e4t28eUnsubscribe = window.wvmDemo.onConsole((chunk) => {
        state.text += new TextDecoder().decode(chunk);
        const now = performance.now();
        for (const probe of state.sentOrder) {
          if (state.echoAt[probe] === undefined && state.text.includes(probe)) {
            state.echoAt[probe] = now;
            state.seenOrder.push(probe);
          }
        }
        if (state.resultAt === null && state.text.includes(`T28E_RESULT_${token} `)) {
          state.resultAt = now;
        }
      });
      window.wvmDemo.sendInput(new TextEncoder().encode(`${command}\r`));
    }, { command: compileCommand, token: runToken });

    await page.waitForFunction(
      () => window.__e4t28e?.text.includes("GCC_CMDLINE: /mnt/usr/bin/gcc"),
      null,
      { timeout: gccGuestTimeoutMs },
    );

    const probeTask = page.evaluate(async ({ interval, limit, token }) => {
      const state = window.__e4t28e;
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      for (let index = 0; index < limit; index += 1) {
        if (state.resultAt !== null) break;
        if (index > 0) await sleep(interval);
        if (state.resultAt !== null) break;
        const probe = `T28E_PROBE_${String(index).padStart(4, "0")}_${token}`;
        state.sentAt[probe] = performance.now();
        state.sentOrder.push(probe);
        window.wvmDemo.sendInput(new TextEncoder().encode(`echo ${probe}\r`));
      }
      return {
        sentAt: { ...state.sentAt },
        sentOrder: [...state.sentOrder],
      };
    }, { interval: probeIntervalMs, limit: maxProbes, token: runToken });

    await page.waitForFunction(() => window.__e4t28e?.resultAt !== null, null, {
      timeout: gccGuestTimeoutMs,
    });
    await probeTask;
    await page.waitForTimeout(Math.min(1_000, probeIntervalMs * 2));

    const captured = await page.evaluate(async () => {
      const state = window.__e4t28e;
      const controller = window.__linuxCtl;
      const [jit, scheduler, profile, stateDigest] = await Promise.all([
        controller.jitStats(),
        controller.schedulerStats(),
        controller.profileStats(),
        controller.stateDigest(),
      ]);
      return {
        ...state,
        backend: controller.backend,
        interpreter: document.documentElement.dataset.interpreter || null,
        jit,
        scheduler,
        profile,
        stateDigest,
        browser: {
          userAgent: navigator.userAgent,
          crossOriginIsolated: globalThis.crossOriginIsolated === true,
        },
      };
    });
    const output = stripConsole(captured.text);
    const resultMatch = output.match(new RegExp(
      `T28E_RESULT_${runToken} rc=(\\d+) secs=([0-9.]+) osize=(\\d+) osha=([0-9a-f]+)`,
    ));
    expect(resultMatch, output.slice(-4_000)).toBeTruthy();
    const gccResult = {
      rc: Number(resultMatch[1]),
      guestSeconds: Number(resultMatch[2]),
      objectSize: Number(resultMatch[3]),
      objectSha256: resultMatch[4],
    };
    const commandLineMatch = output.match(/GCC_CMDLINE:\s*(.+)/);
    const fileLineMatch = output.match(new RegExp(`T28E_FILE_${runToken} ([^\\n]+)`));
    const sentBeforeResult = captured.sentOrder.filter((probe) => captured.sentAt[probe] <= captured.resultAt);
    const samples = sentBeforeResult.map((probe) => ({
      probe,
      sentAt: captured.sentAt[probe],
      echoedAt: captured.echoAt[probe] ?? null,
      latencyMs: captured.echoAt[probe] == null ? null : captured.echoAt[probe] - captured.sentAt[probe],
    }));
    const latencies = samples.map((sample) => sample.latencyMs).filter((value) => value != null);
    const observedBeforeResult = captured.seenOrder.filter((probe) => sentBeforeResult.includes(probe));
    const reordered = observedBeforeResult.some((probe, index) => probe !== sentBeforeResult[index]);
    const interaction = {
      intervalMs: probeIntervalMs,
      sent: sentBeforeResult.length,
      echoed: latencies.length,
      lost: samples.filter((sample) => sample.latencyMs == null).map((sample) => sample.probe),
      reordered,
      p95Ms: percentile(latencies, 0.95),
      maxMs: latencies.length ? Math.max(...latencies) : null,
      samples,
    };

    expect(gccResult.rc, output).toBe(0);
    expect(gccResult.objectSize).toBe(expectedObjectSize);
    expect(gccResult.objectSha256).toBe(expectedObjectSha256);
    expect(commandLineMatch?.[1] || output).toContain("-O2");
    expect(captured.backend).toBe("whole-machine-worker");
    expect(captured.interpreter).toBe("fast");
    expect(captured.jit?.hasExecutor).toBe(true);
    expect(Number(captured.jit?.executedBlocks || 0)).toBeGreaterThan(0);
    expect(captured.stateDigest).toMatch(/^[0-9a-f]{64}$/);
    if (enforceBudgets) {
      expect(gccResult.guestSeconds).toBeLessThanOrEqual(20);
      expect(interaction.lost).toEqual([]);
      expect(interaction.reordered).toBe(false);
      expect(interaction.p95Ms).toBeLessThan(100);
    }

    const artifacts = await localArtifactIdentity(page);
    expect(artifacts.kernelSha256).toBe(expectedKernelSha256);
    expect(artifacts.chunkManifestSha256).toBe(expectedChunkManifestSha256);
    expect(requestErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("e4-t28e-gcc-interactive.png"), fullPage: true });

    const evidence = {
      schema_version: 1,
      schema: "e4-t28e-gcc-interactive-v1",
      date: new Date().toISOString(),
      candidate: { commit: gitHead(), exactHead: true },
      workload: {
        id: "e4-t28e-pinned-gcc-miniz-v1",
        command: "SOURCE_DATE_EPOCH=1704067200 /mnt/gcc-wrap -O2 -frandom-seed=miniz -c /mnt/src/miniz.c -o /tmp/miniz.o",
        resolvedCommand: commandLineMatch?.[1] ?? null,
        sourcePath: "/mnt/src/miniz.c",
        sourceSha256: expectedSourceSha256,
        sourceBytes: 322_549,
        sourceDateEpoch,
        gccPackage,
        hostCompiler: false,
      },
      overlay: {
        path: "bench/guest/gcc.ext4",
        url: "/gcc-overlay/gcc.ext4",
        sizeBytes: overlaySize,
        sha256: overlaySha256,
        manifestPath: "bench/guest/gcc-MANIFEST.txt",
        manifestSha256: sha256(manifestText),
      },
      compile: {
        ...gccResult,
        guestSeconds: gccResult.guestSeconds,
        fileOutput: fileLineMatch?.[1] ?? "file-unavailable",
        expectedObjectSize,
        expectedObjectSha256,
        hostElapsedMs: captured.resultAt - captured.compileSentAt,
      },
      interaction,
      controls: {
        jit: true,
        jitThreshold: 512,
        jitResidency: "repack-off",
        jalr: true,
        region: true,
        interpreter: "fast",
        quantum: 100000,
        freshContext: true,
        noSnapshot: true,
        persist: false,
      },
      runtime: {
        backend: captured.backend,
        stateDigest: captured.stateDigest,
        jit: captured.jit,
        scheduler: captured.scheduler,
        profile: captured.profile,
      },
      browser: {
        ...captured.browser,
        headers: {
          crossOriginOpenerPolicy: documentHeaders["cross-origin-opener-policy"] ?? null,
          crossOriginEmbedderPolicy: documentHeaders["cross-origin-embedder-policy"] ?? null,
        },
        requestErrors,
        consoleErrors,
      },
      artifacts,
      evidence: {
        screenshot: testInfo.outputPath("e4-t28e-gcc-interactive.png"),
        budgetEnforced: enforceBudgets,
        budgetStatus: {
          guestSeconds: gccResult.guestSeconds <= 20 ? "held" : "gap",
          echoP95: interaction.p95Ms != null && interaction.p95Ms < 100 ? "held" : "gap",
        },
      },
      storageAtStart,
    };
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    await page.evaluate(() => window.__e4t28eUnsubscribe?.()).catch(() => {});
  }
});

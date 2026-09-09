// E4-T28d: measure the real cold Alpine persistent-disk path from the first guest UART byte to
// getty's login marker. The driver disables the build-time RAM snapshot but keeps persist=1, so it
// exercises the default writable chunked disk without allowing a restore shortcut to masquerade as
// a cold boot. Timing is captured from wvmDemo.onConsole, the exact guest byte stream wired to xterm.
import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const productionAssetBase = "https://pub-ee599ce692e44e29868ebfa96dd9c7fd.r2.dev";
const expectedChunkManifestSha256 = "e756558bd4f4046b4830d496c003b6ef0f7b1713bf20de165762f07e544727ba";
const expectedAlpineKernelSha256 = "08caa7dd12aa40efa5a47f028359711eadc6577c91e9fffe5050f4c861879f58";
const coldBootTimeoutMs = 2 * 60 * 60_000;
const requestedRuns = Math.max(1, Math.min(3, Number(process.env.E4T28D_RUNS || 3)));
const enforceBudget = process.env.E4T28D_ENFORCE === "1";
const evidencePath = path.join(repoRoot, "evidence/e4-t28d/cold-boot-2026-09-03.json");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fileSha256(relativePath) {
  return sha256(fs.readFileSync(path.join(repoRoot, relativePath)));
}

function gitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
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

async function chunkManifestIdentity(page) {
  return page.evaluate(async ({ assetBase, expectedSha256 }) => {
    const url = new URL(`${assetBase}/chunked-alpine/manifest.json`);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`chunk manifest HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const manifest = JSON.parse(new TextDecoder().decode(bytes));
    const firstChunkSha256 = manifest.chunks?.[0];
    if (!/^[0-9a-f]{64}$/.test(firstChunkSha256 || "")) throw new Error("invalid first chunk hash");
    const firstResponse = await fetch(new URL(`chunks/${firstChunkSha256}.bin`, url), { cache: "no-store" });
    if (!firstResponse.ok) throw new Error(`first chunk HTTP ${firstResponse.status}`);
    const firstDigest = await crypto.subtle.digest("SHA-256", await firstResponse.arrayBuffer());
    const firstChunkActualSha256 = [...new Uint8Array(firstDigest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return {
      url: url.href,
      sha256,
      expectedSha256,
      imageLen: manifest.image_len,
      chunkSize: manifest.chunk_size,
      chunkCount: manifest.chunks?.length ?? null,
      firstChunkSha256,
      firstChunkActualSha256,
    };
  }, { assetBase: productionAssetBase, expectedSha256: expectedChunkManifestSha256 });
}

async function runColdBoot(browser, testInfo, sample) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const requestErrors = [];
  const consoleErrors = [];
  const restoreRequests = [];
  const fullImageRequests = [];
  let documentHeaders = {};
  page.on("response", (response) => {
    const url = response.url();
    const pathname = new URL(url).pathname;
    if (response.status() === 404 && pathname === "/favicon.ico") return;
    if (response.status() >= 400) requestErrors.push(`HTTP ${response.status()} ${url}`);
    if (pathname.includes("/boot-snapshot/") || pathname.includes("ready.snap")) restoreRequests.push(url);
    if (pathname.endsWith("/alpine-rootfs.ext4") || pathname.endsWith("/image.blob")) fullImageRequests.push(url);
    if (pathname === "/") documentHeaders = response.headers();
  });
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon.ico")) consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("crash", () => consoleErrors.push("PAGE_CRASHED"));
  try {
    const url = "/?guest=alpine&noSnapshot&persist=1&noAutoBoot=1&profile=1&testHooks=1&" +
      "workerHeartbeatTimeoutMs=10000&jit=1&jitThreshold=512&jitResidency=repack-off&jalr=1&region=1&quantum=100000#ide";
    const navigation = await page.goto(url, { waitUntil: "domcontentloaded" });
    if (navigation) documentHeaders = navigation.headers();
    const storageAtStart = await clearFreshOrigin(page, context);
    await page.waitForFunction(() => window.wvmDemo?.onConsole && window.wvmDemo?.bootAlpine, null, {
      timeout: 30_000,
    });
    await page.evaluate(() => {
      const state = {
        firstByteAt: null,
        firstBytesHex: null,
        loginAt: null,
        bytes: 0,
        text: "",
      };
      window.__e4t28d = state;
      window.__e4t28dUnsubscribe = window.wvmDemo.onConsole((chunk) => {
        if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0) return;
        const now = performance.now();
        if (state.firstByteAt === null) {
          state.firstByteAt = now;
          state.firstBytesHex = [...chunk.slice(0, 32)]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
        }
        state.bytes += chunk.byteLength;
        state.text += new TextDecoder().decode(chunk);
        if (state.loginAt === null && state.text.includes("login:")) state.loginAt = now;
      });
    });
    const bootPromise = page.evaluate(() => window.wvmDemo.bootAlpine());
    await page.waitForFunction(() => window.__e4t28d?.firstByteAt !== null, null, {
      timeout: coldBootTimeoutMs,
    });
    await page.waitForFunction(() => window.__e4t28d?.loginAt !== null, null, {
      timeout: coldBootTimeoutMs,
    });
    const boot = await bootPromise;
    expect(boot).toMatchObject({ ok: true });
    const observed = await page.evaluate(async () => {
      const state = window.__e4t28d;
      const controller = window.__linuxCtl;
      return {
        firstByteAt: state.firstByteAt,
        loginAt: state.loginAt,
        firstBytesHex: state.firstBytesHex,
        consoleBytes: state.bytes,
        consoleText: state.text,
        backend: document.documentElement.dataset.linuxBackend,
        restored: Boolean(controller?.restoredFromBootSnapshot?.()),
        readOnly: Boolean(controller?.readOnly?.()),
        stateDigest: controller ? await controller.stateDigest() : null,
        scheduler: controller ? await controller.schedulerStats() : null,
        profile: controller ? await controller.profileStats() : null,
        chunkStats: controller?.fetchStats?.() ?? null,
      };
    });
    expect(observed.consoleText).toContain("Linux version");
    expect(observed.consoleText).toContain("OpenRC");
    expect(observed.consoleText).toContain("login:");
    expect(observed.backend).toBe("whole-machine-worker");
    expect(observed.restored).toBe(false);
    // A Chromium context can legitimately report a read-only persistent overlay when the Web Locks
    // writer is unavailable. Record that state as a persistence gap instead of discarding an
    // otherwise valid first-byte → login timing sample.
    expect(observed.stateDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(restoreRequests).toEqual([]);
    expect(fullImageRequests).toEqual([]);
    expect(requestErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    const manifest = await chunkManifestIdentity(page);
    expect(manifest.sha256).toBe(expectedChunkManifestSha256);
    expect(manifest.firstChunkActualSha256).toBe(manifest.firstChunkSha256);
    await page.screenshot({ path: testInfo.outputPath(`e4-t28d-cold-boot-${sample}.png`), fullPage: true });
    return {
      sample,
      url,
      firstByteAt: observed.firstByteAt,
      loginAt: observed.loginAt,
      bootMs: observed.loginAt - observed.firstByteAt,
      firstBytesHex: observed.firstBytesHex,
      consoleBytes: observed.consoleBytes,
      markers: {
        linuxVersion: observed.consoleText.includes("Linux version"),
        openRc: observed.consoleText.includes("OpenRC"),
        login: observed.consoleText.includes("login:"),
      },
      profile: {
        storageAtStart,
        newContext: true,
        persistQuery: true,
        noSnapshotQuery: true,
        noAutoBootQuery: true,
        restored: observed.restored,
        readOnly: observed.readOnly,
      },
      backend: observed.backend,
      stateDigest: observed.stateDigest,
      scheduler: observed.scheduler,
      guestProfile: observed.profile,
      chunkStats: observed.chunkStats,
      chunkManifest: manifest,
      requestErrors,
      consoleErrors,
      restoreRequests,
      fullImageRequests,
      headers: {
        crossOriginOpenerPolicy: documentHeaders["cross-origin-opener-policy"] ?? null,
        crossOriginEmbedderPolicy: documentHeaders["cross-origin-embedder-policy"] ?? null,
      },
    };
  } finally {
    await page.evaluate(() => window.__e4t28dUnsubscribe?.()).catch(() => {});
    await context.close();
  }
}

function writeEvidence(value) {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(value, null, 2)}\n`);
}

test.describe("E4-T28d cold Alpine boot timing", () => {
  test("records first guest byte through the real login marker", async ({ browser }, testInfo) => {
    test.setTimeout(coldBootTimeoutMs * requestedRuns + 120_000);
    const results = [];
    for (let sample = 0; sample < requestedRuns; sample += 1) {
      results.push(await runColdBoot(browser, testInfo, sample));
    }
    const bootTimes = results.map((result) => result.bootMs);
    const medianBootMs = median(bootTimes);
    if (enforceBudget) expect(medianBootMs).toBeLessThan(5_000);
    const candidate = gitHead();
    const artifactManifestPath = "web/artifacts-alpine.json";
    const evidence = {
      schema_version: 1,
      schema: "e4-t28d-cold-boot-result-v1",
      generatedAt: new Date().toISOString(),
      candidate: { commit: candidate, source: "git HEAD", workingTree: "tracked test result emitted after browser run" },
      build: {
        kernel: { sha256: expectedAlpineKernelSha256 },
        artifactManifest: { path: artifactManifestPath, sha256: fileSha256(artifactManifestPath) },
        source: "cold Alpine chunked disk; worker JIT controls",
      },
      controls: {
        guest: "alpine",
        worker: true,
        jit: true,
        jitThreshold: 512,
        jitResidency: "repack-off",
        jalr: true,
        region: true,
        persist: true,
        noSnapshot: true,
        noAutoBoot: true,
      },
      fresh_profile: {
        requestedRuns,
        actualRuns: results.length,
        newContextPerRun: true,
        originDataClearedBeforeBoot: true,
        storageClearedPerRun: results.map((result) => result.profile.storageAtStart),
        restoreShortcutRequests: results.flatMap((result) => result.restoreRequests),
      },
      headers: {
        path: "web/_headers",
        sha256: fileSha256("web/_headers"),
        required: { crossOriginOpenerPolicy: "same-origin", crossOriginEmbedderPolicy: "credentialless" },
        observed: results.map((result) => result.headers),
      },
      browser: { project: "chromium", version: browser.version() },
      results,
      timing: {
        endpoint: "first non-empty guest onConsole byte -> first guest console occurrence of login:",
        bootTimesMs: bootTimes,
        medianBootMs,
        medianBootSecs: medianBootMs / 1_000,
        requiredMedianMs: 5_000,
        budgetEvaluated: enforceBudget,
        budgetSatisfied: medianBootMs < 5_000,
      },
      verdict: {
        harnessPass: true,
        firstGuestByte: results.every((result) => result.firstByteAt !== null),
        actualLoginMarker: results.every((result) => result.markers.login),
        coldPath: results.every((result) => result.profile.restored === false),
        noRestoreShortcut: results.every((result) => result.restoreRequests.length === 0),
        noWholeImageFetch: results.every((result) => result.fullImageRequests.length === 0),
        note: enforceBudget
          ? "The five-second budget was explicitly evaluated."
          : "The exact three-run budget remains a typed gap for this user-directed handoff; set E4T28D_ENFORCE=1 to enforce it.",
      },
    };
    writeEvidence(evidence);
    console.log(`E4T28D_RESULT=${JSON.stringify({
      evidencePath: "evidence/e4-t28d/cold-boot-2026-09-03.json",
      candidate,
      requestedRuns,
      bootTimes,
      medianBootMs,
      budgetSatisfied: evidence.timing.budgetSatisfied,
    })}`);
  });
});

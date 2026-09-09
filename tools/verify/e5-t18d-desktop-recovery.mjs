#!/usr/bin/env node
// Two fresh real Chromium/RISC-V boots. Linux process doubles are NOT accepted here.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { inspectRecoveryCanvas } from "./e5-t18d-surface.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(repo);
const imageDir = path.resolve(process.env.E5_T18D_IMAGE_DIR || "target/e5-t18d/desktop-image-v5");
const chunkDir = path.resolve(process.env.E5_T18D_DESKTOP_ASSET_DIR || "target/e5-t18d/chunks/desktop-v5");
const out = path.resolve(process.env.E5_T18D_EVIDENCE_DIR || "evidence/e5-t18d");
const timeout = Number(process.env.E5_T18D_TIMEOUT_MS || 900_000);
const chrome = process.env.E5_T18D_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (process.env.E5_T18D_REQUIRE_HEAD) assert.equal(head, process.env.E5_T18D_REQUIRE_HEAD);
const transcript = [];
const sources = {};
const activePages = new Map();
let browser, server;
const progressTimer = setInterval(async () => {
  for (const [label, page] of activePages) {
    try {
      const progress = await page.evaluate(async () => ({ serial: window.__desktopRecovery?.serial() || "",
        state: window.__desktopRecovery?.state(), scheduler: await window.__desktopController?.schedulerStats() }));
      await writeFile(path.join(out, `${label}-progress.json`), JSON.stringify(progress, null, 2));
      console.log(`E5T18D_PROGRESS=${label} frames=${progress.state?.frames} retired=${progress.scheduler?.retiredInstructions} serial=${progress.serial.slice(-150).replaceAll("\n", " ")}`);
    } catch (failure) { transcript.push(`progress: ${failure.message}\n`); }
  }
}, 30_000);
progressTimer.unref();

async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function waitFor(predicate, label, limit = timeout) {
  const deadline = Date.now() + limit;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await sleep(500);
  }
  throw new Error(`bounded wait expired: ${label}`);
}

async function serialRequest(page, verb, tag) {
  const offset = await page.evaluate(() => window.__desktopRecovery.serial().length);
  await page.evaluate((command) => window.__desktopRecovery.command(command), verb);
  return waitFor(async () => {
    const value = await page.evaluate((start) => window.__desktopRecovery.serial().slice(start), offset);
    return value.includes(`E5T18D_${tag}_END`) ? value.replaceAll("\r", "") : null;
  }, `${verb} serial response`, 120_000);
}

async function stateUntil(page, predicate, label) {
  return waitFor(async () => {
    const value = await serialRequest(page, "status", "STATUS");
    return predicate(value) ? value : null;
  }, label);
}

async function capture(page, label) {
  const state = await page.evaluate(() => window.__desktopRecovery.capture());
  const surface = await page.evaluate(inspectRecoveryCanvas);
  const png = await page.screenshot({ path: path.join(out, `${label}.png`) });
  return { ...state, surface, screenshot: `${label}.png`, screenshotSha256: sha(png) };
}

async function boot(base, fault) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1120 }, deviceScaleFactor: 1, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (failure) => errors.push(String(failure)));
  page.on("console", (message) => {
    transcript.push(`browser ${message.type()}: ${message.text()}\n`);
    if (message.type() === "error" && !message.location().url?.endsWith("/favicon.ico")) errors.push(message.text());
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await page.goto(`${base}/desktop-recovery.html?recoveryTest=1${fault ? "&recoveryFault=config" : ""}`);
  activePages.set(fault ? "broken-config" : "three-crashes", page);
  await waitFor(async () => page.evaluate(() => window.__desktopRecovery?.serial().includes("E5T18D_TEST_CONSOLE_READY")), "serial test console");
  return { page, context, errors };
}

async function assertFallback(page, reason, label) {
  const status = await stateUntil(page, (value) => value.includes(`desktop.failed=${reason}\n`), label);
  assert.match(status, /desktop\.ready=absent\n/);
  assert.match(status, /weston\.pid=absent\n/);
  assert.match(status, new RegExp(`event=fallback reason=${reason}`));
  const tty = await waitFor(async () => {
    const value = await serialRequest(page, "tty", "TTY");
    return value.includes("DESKTOP FAILED") && value.includes("login:") &&
      /getty pid=\d+ args=.*desktop-fallback\.issue.*tty1/.test(value) ? value : null;
  }, "tty1 getty with actual console banner");
  const proof = await waitFor(async () => {
    const current = await page.evaluate(() => window.__desktopRecovery.state());
    return current.frames > 0 ? current : null;
  }, "fallback framebuffer");
  assert.equal(proof.error, null);
  const frame = await capture(page, label);
  assert.ok(frame.surface.black / frame.surface.total > .8, "fallback is not a text console");
  assert.ok(frame.surface.white > 500, "fallback text was not rendered");
  return { status, tty, frame };
}

await mkdir(out, { recursive: true });
try {
  for (const file of ["tools/rootfs/start-desktop", "tools/rootfs/desktop-autologin", "tools/rootfs/desktop-runtime.initd", "tools/rootfs/desktop-test-console", "tools/rootfs-inner.sh", "tools/build-rootfs.sh", "tools/image/desktop.sh", "tools/serve-dev.sh", "web/desktop-recovery.html", "web/desktop-recovery.js", "web/src/input/desktop-recovery-policy.js", "tools/verify/e5-t18d-desktop-recovery.mjs"]) {
    sources[file] = await hashFile(file);
  }
  const metadata = JSON.parse(await readFile(path.join(imageDir, "desktop-info.json"), "utf8"));
  sources["web/linux-worker-protocol.js"] = await hashFile("web/linux-worker-protocol.js");
  sources["tools/verify/e5-t18d-surface.mjs"] = await hashFile("tools/verify/e5-t18d-surface.mjs");
  for (const file of ["desktop-recovery.js", "desktop-recovery.html", "linux-worker-protocol.js", "src/input/desktop-recovery-policy.js"]) {
    assert.equal(await hashFile(`web/dist/${file}`), await hashFile(`web/${file}`), `built-page source drift: ${file}`);
  }
  assert.equal(await hashFile(path.join(imageDir, "alpine-rootfs.ext4")), metadata.image.sha256);
  const customFiles = await readFile(path.join(imageDir, "FILE-MANIFEST.txt"), "utf8");
  for (const [source, destination] of Object.entries({
    "start-desktop": "/usr/local/bin/start-desktop", "desktop-autologin": "/usr/local/sbin/desktop-autologin",
    "desktop-runtime.initd": "/etc/init.d/desktop-runtime", "desktop-test-console": "/usr/local/sbin/desktop-test-console",
  })) {
    assert.ok(customFiles.includes(`${sources[`tools/rootfs/${source}`]} 0755 ${destination}`), `image has stale ${source}`);
  }
  const manifest = await readFile(path.join(chunkDir, "manifest.json"));
  const publication = { imageSha256: metadata.image.sha256, chunkManifestSha256: sha(manifest),
    fileManifestSha256: sha(customFiles), packageManifestSha256: await hashFile(path.join(imageDir, "MANIFEST.txt")) };
  const lock = JSON.parse(await readFile("tools/image/e5-t18d-desktop-image.json", "utf8"));
  assert.equal(lock.schema, "wasm-vm.e5-t18d.image-lock.v1");
  for (const [name, digest] of Object.entries(publication)) assert.equal(digest, lock[name], `published ${name} drift`);
  // Verify the bytes actually served to the guest, not just the independent ext4 input's hash.
  const chunkManifest = JSON.parse(manifest);
  assert.equal(chunkManifest.image_len, 1_073_741_824);
  assert.equal(chunkManifest.chunk_size, 131_072);
  assert.equal(chunkManifest.chunks.length, 8192);
  assert.equal(chunkManifest.layout, "split");
  const reconstructed = createHash("sha256"), objects = new Map();
  for (const digest of chunkManifest.chunks) {
    assert.match(digest, /^[0-9a-f]{64}$/);
    if (!objects.has(digest)) {
      const bytes = await readFile(path.join(chunkDir, "chunks", `${digest}.bin`));
      assert.equal(sha(bytes), digest, "corrupt content-addressed chunk");
      assert.equal(bytes.length, chunkManifest.chunk_size);
      objects.set(digest, bytes);
    }
    reconstructed.update(objects.get(digest));
  }
  assert.equal(reconstructed.digest("hex"), publication.imageSha256, "served chunk store is not the claimed ext4 image");
  sources["tools/image/e5-t18d-desktop-image.json"] = await hashFile("tools/image/e5-t18d-desktop-image.json");
  console.log(`E5T18D_IMAGE=${publication.imageSha256}`);
  const port = await new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => { const value = probe.address().port; probe.close(() => resolve(value)); });
  });
  server = spawn("bash", ["tools/serve-dev.sh", String(port)], {
    env: { ...process.env, E5_T18D_DESKTOP_ASSET_DIR: chunkDir }, detached: true, stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (bytes) => transcript.push(bytes.toString()));
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => { try { return (await fetch(`${base}/desktop-recovery.html`)).ok; } catch { return false; } }, "server", 30_000);
  assert.equal((await fetch(`${base}/e5t18d-desktop/not-a-chunk.txt`)).status, 404);
  const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
  browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
  const cases = [];
  const outcomes = await Promise.allSettled([false, true].map(async (fault) => {
    const label = fault ? "broken-config" : "three-crashes";
    console.log(`E5T18D_BOOT=${label}`);
    const { page, context, errors } = await boot(base, fault);
    try {
      if (fault) {
        const fallback = await assertFallback(page, "compositor-config-missing", label);
        assert.doesNotMatch(fallback.status, /event=ready |event=started /);
        cases.push({ label, fallback });
      } else {
        const attempts = [];
        for (let attempt = 1; attempt <= 3; attempt++) {
          const status = await stateUntil(page, (value) => new RegExp(`desktop.ready=${attempt} \\d+\\n`).test(value), `ready attempt ${attempt}`);
          const pid = Number(status.match(/desktop\.ready=\d+ (\d+)/)[1]);
          assert.match(status, new RegExp(`\\d{4}-\\d{2}-\\d{2}T.*Z E5T18D event=ready attempt=${attempt} pid=${pid}`));
          await waitFor(async () => (await page.evaluate(inspectRecoveryCanvas)).desktop,
            `painted desktop attempt ${attempt}`, 120_000);
          const frame = await capture(page, `ready-${attempt}`);
          assert.ok(frame.surface.desktop, "desktop wallpaper/panel not rendered");
          attempts.push({ attempt, pid, status, frame });
          console.log(`E5T18D_READY attempt=${attempt} pid=${pid}`);
          await page.evaluate(() => window.__desktopRecovery.command("crash"));
        }
        const fallback = await assertFallback(page, "restart-budget-exhausted", label);
        assert.equal(new Set(attempts.map((attempt) => attempt.pid)).size, 3);
        assert.equal((fallback.status.match(/event=attempt /g) || []).length, 3);
        assert.equal((fallback.status.match(/event=exit .*status=137/g) || []).length, 3);
        // Observe real execution beyond fallback; a paused guest cannot conceal init respawn.
        const before = await page.evaluate(() => window.__desktopController.schedulerStats());
        await waitFor(async () => {
          const now = await page.evaluate(() => window.__desktopController.schedulerStats());
          return Number(now.retiredInstructions) - Number(before.retiredInstructions) >= 10_000_000;
        }, "post-fallback execution");
        const after = await serialRequest(page, "status", "STATUS");
        assert.equal((after.match(/event=attempt /g) || []).length, 3);
        cases.push({ label, attempts, fallback, after });
      }
      assert.deepEqual(errors, [], "browser console errors");
      await writeFile(path.join(out, `${label}.json`), JSON.stringify({ head, publication, sources,
        ...cases.find((result) => result.label === label), passed: true }, null, 2) + "\n");
      await writeFile(path.join(out, `${label}-serial.log`), await page.evaluate(() => window.__desktopRecovery.serial()));
      console.log(`E5T18D_CASE_PASS=${label}`);
    } catch (failure) {
      await page.screenshot({ path: path.join(out, `${label}-failure.png`) });
      await writeFile(path.join(out, `${label}-serial.log`), await page.evaluate(() => window.__desktopRecovery.serial()));
      throw failure;
    } finally { activePages.delete(label); await context.close(); }
  }));
  for (const result of outcomes) if (result.status === "rejected") throw result.reason;
  cases.sort((left, right) => left.label.localeCompare(right.label));
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), head, "HEAD moved during recording");
  for (const [file, digest] of Object.entries(sources)) assert.equal(await hashFile(file), digest, `${file} moved during recording`);
  await writeFile(path.join(out, "desktop-recovery.json"), JSON.stringify({ schema: "wasm-vm.e5-t18d.recovery.v1", task: "E5-T18d", head,
    predictions: ["new PID and fresh readiness after each crash", "exactly three crashes end at visible tty1 getty", "broken config never claims readiness"],
    sources, publication, browser: browser.version(), cases, passed: true }, null, 2) + "\n");
  console.log("E5T18D_PASS=2");
} finally {
  clearInterval(progressTimer);
  await browser?.close();
  if (server) { try { process.kill(-server.pid, "SIGTERM"); } catch (failure) { if (failure.code !== "ESRCH") throw failure; } }
  await writeFile(path.join(out, "desktop-recovery-browser-console.log"), transcript.join(""));
}

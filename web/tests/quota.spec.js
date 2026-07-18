// E3-T10 acceptance (browser): storage quota surfaced up front, quota-exhaustion dialog with
// no lost write, and per-image reset-disk scoping. Current Chromium reports a CDP quota override
// as active but does not enforce it for IndexedDB, so the full proof aborts the REAL IDB transaction
// with QuotaExceededError after an exact 50 MiB of 4 KiB overlay puts.
//
// The full quota-exhaustion/recovery/reset proof is opt-in (`E3_T10_FULL=1`) because it performs
// three interpreter boots. This file's FAST checks (indicator, reset scoping, ephemeral warning)
// run in seconds and don't need a full boot. Local/nightly only.
import { test, expect, chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rows = "#term .xterm-rows";
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const have =
  fs.existsSync(path.join(WEB, "artifacts-alpine.json")) &&
  fs.existsSync(path.resolve(WEB, "../releases/chunked-alpine/manifest.json"));

test.describe("E3-T10: storage quota + reset-disk", () => {
  test.skip(!have, "needs releases/chunked-alpine + web/artifacts-alpine.json");

  test("overlayDbName is per-image + reset deletes only that DB", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
    // Drive the exported helpers directly (no full boot): name derivation + scoped delete.
    const result = await page.evaluate(async () => {
      const mod = await import("./pkg/wasm_vm_wasm.js");
      await mod.default();
      const m1 = await (await fetch("./releases/chunked-alpine/manifest.json")).text();
      const name = mod.overlayDbName(m1);
      // A different manifest (mutate the last chunk hash → a different, still-valid image) →
      // different base hash → different DB name.
      const alt = JSON.parse(m1);
      const i = alt.chunks.length - 1;
      alt.chunks[i] = alt.chunks[i].slice(0, -1) + (alt.chunks[i].endsWith("a") ? "b" : "a");
      const name2 = mod.overlayDbName(JSON.stringify(alt));
      // Seed two databases, delete only the first, confirm the second survives.
      const open = (n) =>
        new Promise((res, rej) => {
          const r = indexedDB.open(n, 1);
          r.onsuccess = () => { r.result.close(); res(); };
          r.onerror = () => rej(r.error);
          r.onupgradeneeded = () => {};
        });
      await open(name);
      await open(name2);
      const del = (n) =>
        new Promise((res, rej) => {
          const r = indexedDB.deleteDatabase(n);
          r.onsuccess = () => res();
          r.onerror = () => rej(r.error);
          r.onblocked = () => res();
        });
      await del(name);
      const list = (await indexedDB.databases()).map((d) => d.name);
      return { name, name2, distinct: name !== name2, survivorPresent: list.includes(name2), deletedGone: !list.includes(name) };
    });
    expect(result.name).toMatch(/^wvov-/);
    expect(result.distinct, "different images → different DB names").toBe(true);
    expect(result.deletedGone, "reset deleted the target DB").toBe(true);
    expect(result.survivorPresent, "a second image's overlay survives the reset").toBe(true);
  });

  test("storage indicator appears on a persistent boot", async ({ page }) => {
    await page.goto("/?persist=1");
    await expect(page.locator("#boot-alpine")).toBeEnabled();
    await page.click("#boot-alpine");
    // The indicator is populated by onStorage right after the Web-Lock/persist() resolve, well
    // before login — no full boot needed.
    await expect(page.locator("#storage-indicator")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("#storage-indicator")).toContainText(/MB/);
  });

  test("a denied persist request gives an explicit private/incognito warning", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.storage, "persist", {
        configurable: true,
        value: async () => false,
      });
    });
    await page.goto("/?persist=1");
    await expect(page.locator("#boot-alpine")).toBeEnabled();
    await page.click("#boot-alpine");
    await expect(page.locator("#storage-warning")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("#storage-warning")).toContainText("private/incognito storage is temporary");
  });

  test("forced quota: Retry, Continue/EIO, recovery, typed reset, pristine reboot", async () => {
    test.skip(process.env.E3_T10_FULL !== "1", "set E3_T10_FULL=1 for the three-boot quota proof");
    test.setTimeout(5_400_000); // up to 90 min: three ~18-min interpreter boots + quota writes
    const evidenceDir = path.resolve(WEB, "../evidence/e3-t10");
    fs.mkdirSync(evidenceDir, { recursive: true });

    // A disposable real profile preserves IndexedDB across the crash/recovery pages without touching
    // the developer's browser profile.
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "wasm-vm-e3t10-"));
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      baseURL: "http://127.0.0.1:8123",
      viewport: { width: 1280, height: 720 },
    });
    const tracePath = path.join(evidenceDir, "quota-playwright-trace.zip");
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    // Deterministic quota fault at the production boundary. We still call the real web-sys
    // IdbObjectStore::put until the limit, then abort that exact transaction and throw the same
    // DOMException name as the browser. Rust's StorageError classifier and the JS pump see the
    // production failure shape; no onQuota callback is invoked by the harness.
    await context.addInitScript(() => {
      const proto = IDBObjectStore.prototype;
      const originalPut = proto.put;
      const originalEstimate = navigator.storage.estimate.bind(navigator.storage);
      const quota = 50 * 1024 * 1024;
      let blockPuts = 0;
      let failAt = Number.POSITIVE_INFINITY;
      let enabled = false;
      Object.defineProperty(proto, "put", {
        configurable: true,
        value(...args) {
          if (this.name === "blocks") {
            blockPuts += 1;
            if (enabled && blockPuts >= failAt) {
              try { this.transaction.abort(); } catch {}
              throw new DOMException("E3-T10 deterministic origin quota", "QuotaExceededError");
            }
          }
          return originalPut.apply(this, args);
        },
      });
      Object.defineProperty(navigator.storage, "estimate", {
        configurable: true,
        value: async () => {
          const real = await originalEstimate();
          return { ...real, usage: Math.min(blockPuts * 4096, quota), quota };
        },
      });
      window.__e3t10Quota = {
        enableAfter(additionalBlockPuts) {
          failAt = blockPuts + additionalBlockPuts;
          enabled = true;
        },
        disable() {
          enabled = false;
          failAt = Number.POSITIVE_INFINITY;
        },
        state: () => ({ blockPuts, failAt, enabled, quota }),
      };
    });
    let page = context.pages()[0] || (await context.newPage());
    const errors = [];
    const transcript = [];
    let bootNumber = 0;
    let summary = null;
    const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: path.resolve(WEB, ".."),
      encoding: "utf8",
    }).trim();
    const watchErrors = (p) =>
      p.on("console", (m) => {
        const text = m.text();
        if (m.type() === "error" && !text.includes("favicon.ico") && !/Failed to load resource.*404/.test(text)) {
          errors.push(text);
        }
      });
    watchErrors(page);

    const type = (p, text) =>
      p.evaluate((s) => window.__term.typeBytes(new TextEncoder().encode(s)), text);
    const beginTranscript = async (p, label) => {
      await p.evaluate(() => {
        window.__e3t10TranscriptUnsubscribe?.();
        window.__e3t10Transcript = [];
        window.__e3t10TranscriptUnsubscribe = window.wvmDemo.onConsole((bytes) => {
          window.__e3t10Transcript.push(...bytes);
        });
      });
      transcript.push(`\n===== ${label} =====\n`);
    };
    const takeTranscript = async (p, label) => {
      const text = await p.evaluate(() => {
        const bytes = Uint8Array.from(window.__e3t10Transcript || []);
        window.__e3t10Transcript = [];
        return new TextDecoder().decode(bytes);
      }).catch(() => "<page unavailable>");
      transcript.push(`\n--- ${label} ---\n${text}`);
      return text;
    };
    const terminalScreenshot = async (p, name) => {
      await p.evaluate(() => window.__term.term.scrollToBottom());
      await p.locator("#term").screenshot({ path: path.join(evidenceDir, name) });
    };
    const bootToShell = async (p) => {
      await expect(p.locator("#boot-alpine")).toBeEnabled();
      bootNumber += 1;
      await beginTranscript(p, `boot ${bootNumber}`);
      await p.click("#boot-alpine");
      let sawOpenRC = false;
      for (let i = 0; i < 900; i++) {
        const text = await p.locator(rows).textContent().catch(() => "");
        if (/Kernel panic|Unable to mount root/.test(text)) throw new Error("kernel panic or root mount failure");
        if (text.includes("OpenRC")) sawOpenRC = true;
        if (sawOpenRC && text.includes("login:")) break;
        if (i === 899) throw new Error("did not reach Alpine login prompt");
        await p.waitForTimeout(1500);
      }
      await type(p, "root\r");
      await expect(p.locator(rows)).toContainText("wasm-vm:~#", { timeout: 120_000 });
      await type(p, 'echo QUOTA_SHELL_$((6*7))_OK\r');
      await expect(p.locator(rows)).toContainText("QUOTA_SHELL_42_OK", { timeout: 60_000 });
    };
    // Start from this image's pristine overlay. The fault stays disabled through boot, then model
    // a 50 MiB origin with 4 MiB remaining: exactly 1,024 additional 4 KiB puts may commit before
    // the real transaction is aborted. A near-full origin keeps this three-boot proof bounded while
    // still exercising the production IndexedDB/StorageFull boundary.
    try {
    await page.goto("/");
    const injectedName = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("e3t10-quota-preflight", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("blocks");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      window.__e3t10Quota.enableAfter(1);
      let name = "no-error";
      try {
        const tx = db.transaction("blocks", "readwrite");
        tx.objectStore("blocks").put(new Uint8Array(4096), 0);
      } catch (error) {
        name = error.name;
      }
      db.close();
      indexedDB.deleteDatabase("e3t10-quota-preflight");
      return name;
    });
    expect(injectedName, "preflight must abort a real IDB put with the browser quota name").toBe(
      "QuotaExceededError",
    );
    await page.reload(); // reset the injected block counter/fault before touching the real overlay
    await page.evaluate(async () => {
      const { resetDisk } = await import("./loader.js");
      await resetDisk();
    });
    expect(await page.evaluate(() => window.__e3t10Quota.state().quota)).toBe(50 * 1024 * 1024);
    await page.goto("/?persist=1&persistMax=1048576");
    await bootToShell(page);
    await page.evaluate(() => window.__e3t10Quota.enableAfter(1_024));

    // Write beyond the overridden quota. The persist pump must pause on StorageFull before silently
    // dropping the failed IndexedDB transaction. Retry without freeing ORIGIN storage must re-pause.
    // Direct I/O makes the acceptance observable at the virtio request boundary:
    // every completed 1 MiB dd record has crossed both the block completion and filesystem sync
    // boundary. After Continue flips the live backend read-only, the ONE parked, unacknowledged
    // request completes S_IOERR and dd must report nonzero. The reopened file is compared against
    // dd's exact completed-record count below; this is the load-bearing no-acked-write-loss proof.
    await type(
      page,
      "dd if=/dev/zero of=/root/quota-fill bs=1M count=80 oflag=direct; r=$?; echo QUOTA_DD_RC=$r; echo QUOTA_GUEST_$((6*7))_OK\r",
    );
    const dialog = page.locator("#quota-dialog");
    await expect(dialog).toBeVisible({ timeout: 900_000 });
    await expect(dialog).toContainText("Deleting files inside Alpine will not reclaim browser storage");
    await expect(dialog).not.toContainText("Free space in guest");
    expect(Number(await dialog.getAttribute("data-hits"))).toBe(1);
    await page.click("#q-retry");
    await page.waitForFunction(() => Number(document.querySelector("#quota-dialog")?.dataset.hits) >= 2, null, {
      timeout: 180_000,
    });
    const retryHits = Number(await dialog.getAttribute("data-hits"));
    await page.screenshot({ path: path.join(evidenceDir, "quota-dialog-after-retry.png") });

    // Continue must let the guest run: the parked write gets EIO and dd exits nonzero. No S_OK was
    // published for the failed transaction; the RAM-only overlay bytes may disappear on page close.
    await page.click("#q-ro");
    await expect(page.locator("#ro-banner")).toContainText("guest writes return I/O errors");
    await expect(page.locator(rows)).toContainText(/QUOTA_DD_RC=[1-9]/, { timeout: 180_000 });
    await expect(page.locator(rows)).toContainText("QUOTA_GUEST_42_OK", { timeout: 60_000 });
    const quotaTerminal = await page.locator(rows).textContent();
    const ddRc = Number(quotaTerminal.match(/QUOTA_DD_RC=(\d+)/)?.[1]);
    const recordsOut = [...quotaTerminal.matchAll(/(\d+)\+(\d+) records out/g)];
    expect(recordsOut.length, "dd must report its guest-completed record count").toBeGreaterThan(0);
    const [, ddFullText, ddPartialText] = recordsOut.at(-1);
    const ddFullRecords = Number(ddFullText);
    const ddPartialRecords = Number(ddPartialText);
    expect(ddPartialRecords, "a failed 1 MiB record must not be reported as completed").toBe(0);
    expect(ddFullRecords).toBeGreaterThan(0);
    expect(ddFullRecords).toBeLessThan(80);
    const ddDurableBytes = ddFullRecords * 1024 * 1024;
    const zeroHash = createHash("sha256");
    for (let i = 0; i < ddFullRecords; i++) zeroHash.update(Buffer.alloc(1024 * 1024));
    const expectedPrefixSha256 = zeroHash.digest("hex");
    await terminalScreenshot(page, "quota-continue-ioerr.png");
    await takeTranscript(page, "quota hit, retry, Continue, and dd IOERR");

    // Kill/reopen at the quota edge. A fresh document starts with the deterministic fault disabled,
    // so ext4 can replay its journal and write normally. Exact length + hash of every record dd
    // reported complete must survive; then run the actual T08 fsck command, not a dmesg proxy.
    await page.close({ runBeforeUnload: false });
    page = await context.newPage();
    watchErrors(page);
    await page.goto("/?persist=1&persistMax=1048576");
    await bootToShell(page);
    await type(
      page,
      `wc -c < /root/quota-fill | sed 's/^/QUOTA_REOPEN_SIZE=/' ; head -c ${ddDurableBytes} /root/quota-fill | sha256sum | sed 's/ .*$/ /' | sed 's/^/QUOTA_REOPEN_SHA256=/'\r`,
    );
    await expect(page.locator(rows)).toContainText(`QUOTA_REOPEN_SIZE=${ddDurableBytes}`, { timeout: 120_000 });
    await expect(page.locator(rows)).toContainText(`QUOTA_REOPEN_SHA256=${expectedPrefixSha256}`, { timeout: 300_000 });
    await type(page, "dmesg | grep -cE 'EXT4-fs error|EXT4-fs warning|corrupt' | sed 's/^/QUOTA_EXTBAD=/'\r");
    await expect(page.locator(rows)).toContainText("QUOTA_EXTBAD=0", { timeout: 60_000 });
    await type(
      page,
      "sync; mount -o remount,ro /; fsck.ext4 -f -n /dev/vda; r=$?; echo QUOTA_FSCK_RC=$r; mount -o remount,rw /; echo QUOTA_REMOUNT_RC=$?\r",
    );
    await expect(page.locator(rows)).toContainText("QUOTA_FSCK_RC=0", { timeout: 600_000 });
    await expect(page.locator(rows)).toContainText("QUOTA_REMOUNT_RC=0", { timeout: 120_000 });
    await terminalScreenshot(page, "quota-reopen-fsck.png");
    const resetToken = `RESET_${Date.now() % 100000000}`;
    await type(page, `echo ${resetToken} > /root/reset-marker && sync && echo RESET_MARKER_$((6*7))_OK\r`);
    await expect(page.locator(rows)).toContainText("RESET_MARKER_42_OK", { timeout: 180_000 });

    // The old idle-trickle attack is eliminated by the stronger write-through acknowledgement
    // contract: once the guest command returns, there is no acknowledged dirty backlog for an
    // idle pump to lose. Arm the quota fault, idle, and prove no hidden transaction or dialog can
    // appear because pendingBlocks/writeWaiting/flushWaiting all remain clear.
    await page.waitForFunction(() => {
      const s = window.__persistStats?.();
      return s && s.pendingBlocks === 0 && !s.writeWaiting && !s.flushWaiting;
    }, null, { timeout: 180_000 });
    const idlePutsBefore = await page.evaluate(() => {
      window.__e3t10Quota.enableAfter(1);
      return window.__e3t10Quota.state().blockPuts;
    });
    await page.waitForTimeout(5_000);
    const idleProof = await page.evaluate(() => ({
      stats: window.__persistStats(),
      puts: window.__e3t10Quota.state().blockPuts,
      dialogVisible: getComputedStyle(document.querySelector("#quota-dialog")).display !== "none",
    }));
    expect(idleProof).toEqual({
      stats: { pendingBlocks: 0, pendingBytes: 0, flushWaiting: false, writeWaiting: false },
      puts: idlePutsBefore,
      dialogVisible: false,
    });
    await page.evaluate(() => window.__e3t10Quota.disable());

    // Force a second quota hit, then drive the actual typed-confirmation UI. resetDisk closes the
    // live IDB handle, deletes only this image's database, stops the VM, and re-enables Boot.
    await page.evaluate(() => window.__e3t10Quota.enableAfter(128)); // 512 KiB more durable puts
    await type(page, "dd if=/dev/zero of=/root/reset-fill bs=1M count=8\r");
    await expect(page.locator("#quota-dialog")).toBeVisible({ timeout: 300_000 });
    page.once("dialog", (d) => d.accept("RESET"));
    await page.click("#q-reset");
    await expect(page.locator("#status")).toContainText("disk reset", { timeout: 30_000 });
    await takeTranscript(page, "reopen proof, fsck, idle proof, and typed reset");

    // Boot the same base again. Positive in-guest assertions prove both overlay markers are absent;
    // this cannot false-pass on stale xterm output because runLinuxBoot resets the terminal.
    await page.evaluate(() => window.__e3t10Quota.disable());
    await bootToShell(page);
    await type(
      page,
      "test ! -e /root/quota-fill && test ! -e /root/reset-marker && echo PRISTINE_$((6*7))_OK\r",
    );
    await expect(page.locator(rows)).toContainText("PRISTINE_42_OK", { timeout: 60_000 });
    await type(page, "dmesg | grep -cE 'EXT4-fs error|EXT4-fs warning|corrupt' | sed 's/^/RESET_EXTBAD=/'\r");
    await expect(page.locator(rows)).toContainText("RESET_EXTBAD=0", { timeout: 60_000 });
    expect(errors, `console errors: ${errors.join("; ")}`).toEqual([]);
    await terminalScreenshot(page, "pristine-after-reset.png");
    await takeTranscript(page, "pristine third boot");
    fs.writeFileSync(path.join(evidenceDir, "browser-console-errors.txt"), errors.join("\n"));
    summary = {
      sourceCommit,
      quotaBytes: 50 * 1024 * 1024,
      quotaRemainingAtFaultArmBytes: 4 * 1024 * 1024,
      retryHits,
      ddRc,
      ddFullRecords,
      ddPartialRecords,
      ddDurableBytes,
      reopenedBytes: ddDurableBytes,
      reopenedPrefixSha256: expectedPrefixSha256,
      guestUsableMarker: "QUOTA_GUEST_42_OK",
      recoveryExt4Errors: 0,
      fsckCommand: "fsck.ext4 -f -n /dev/vda",
      fsckRc: 0,
      idleProof,
      pristineMarker: "PRISTINE_42_OK",
      resetExt4Errors: 0,
      consoleErrors: errors.length,
    };
    } finally {
      await takeTranscript(page, "final browser state").catch(() => {});
      await context.tracing.stop({ path: tracePath }).catch((error) => {
        transcript.push(`\nTRACE STOP ERROR: ${error}\n`);
      });
      const traceSha256 = fs.existsSync(tracePath)
        ? createHash("sha256").update(fs.readFileSync(tracePath)).digest("hex")
        : null;
      transcript.unshift(`source commit: ${sourceCommit}\ntrace sha256: ${traceSha256}\n`);
      fs.writeFileSync(path.join(evidenceDir, "quota-terminal.txt"), transcript.join(""));
      if (summary) {
        summary.playwrightTrace = path.basename(tracePath);
        summary.playwrightTraceSha256 = traceSha256;
        fs.writeFileSync(
          path.join(evidenceDir, "browser-summary.json"),
          `${JSON.stringify(summary, null, 2)}\n`,
        );
      }
      await context.close();
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
  });
});

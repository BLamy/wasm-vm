// E3-T12d acceptance: browser resume-snapshot persistence + restore selection.
//
// The restore decision is a pure, header-level coherence gate (RestoreDecision::decide, native-tested
// in crates/core/tests/restore_decision.rs); this spec proves the BROWSER wiring on top of it — the
// wasm-bindgen exports (saveSnapshot/persistSnapshot/readStoredSnapshot/restoreDecisionCode/
// overlayGeneration/advanceOverlayGeneration/loadSnapshotBlob), the IndexedDB chunk store, and the
// window.__snapshot* hooks.
//
// IMPORTANT: a resume snapshot can only be taken on a PERSISTENT boot (newChunkedDiskPersistent) —
// that is the only boot shape that stamps the coherence identity (build + base binding) and owns a
// snapshot store. Busybox boots from an initramfs (no persistence), so it has no snapshot_base and its
// decision is always "missing". The production-sized chunked-Alpine image is served by the public R2
// manifest; only the local kernel and warm boot snapshot need to be present in this checkout. The
// direct raw-Playwright evidence harness uses the same artifact-bearing browser path because the
// normal runner deadlocks on this host's Node 24 before discovering tests.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rows = "#term .xterm-rows";
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const have = fs.existsSync(path.join(WEB, "artifacts-alpine.json"));

test.describe("E3-T12d: browser resume-snapshot persistence + restore selection", () => {
  test.skip(!have, "needs web/artifacts-alpine.json (persistent boot shape)");

  test("save → reload → durable overlay write survives and makes the snapshot stale", async ({ page }) => {
    test.setTimeout(1_800_000); // ~30 min: two full persistent boots

    const errs = [];
    page.on("console", (m) => {
      const t = m.text();
      if (m.type() === "error" && !t.includes("favicon.ico") && !/Failed to load resource.*404/.test(t)) errs.push(t);
    });

    const bootToLogin = async () => {
      await page.waitForFunction(
        () => window.__ready === true && typeof window.wvmDemo?.bootAlpine === "function",
        null,
        { timeout: 120_000 },
      );
      expect(await page.evaluate(() => window.wvmDemo.bootAlpine())).toMatchObject({ ok: true });
      await page.waitForFunction(() => window.wvmDemo?.isGuestReady?.(), null, { timeout: 1_800_000 });
      const text = await page.locator(rows).textContent().catch(() => "");
      if (/Kernel panic|Unable to mount root/.test(text)) throw new Error("kernel panic");
    };

    // ── Boot 1: quiesce, then take + persist a whole-machine snapshot at a stable generation ─────
    await page.goto("/?persist=1&noAutoBoot=1");
    await bootToLogin();

    // The production guest may still be completing boot-time journal writes after the shell appears.
    // Pause the real worker and drain those writes first; otherwise the long snapshot chunk upload can
    // race a durable overlay commit and correctly turn the just-saved snapshot stale mid-recording.
    await page.evaluate(() => window.__linuxCtl.pause());
    await page.evaluate(() => window.__persist());
    const savedGeneration = await page.evaluate(() => window.__snapshotGeneration());

    // Before any snapshot the store is empty → the header-level decision is "missing".
    expect(await page.evaluate(() => window.__snapshotDecision())).toBe("missing");

    // Persist a resume snapshot; it is now coherent with the live machine identity → "resume".
    expect(await page.evaluate(() => window.__snapshotSave())).toBe(true);
    expect(await page.evaluate(() => window.__snapshotGeneration())).toBe(savedGeneration);
    expect(await page.evaluate(() => window.__snapshotDecision())).toBe("resume");
    await page.evaluate(() => window.__linuxCtl.resume());

    // AC2/AC3: exercise the import boundary without sending the production-sized bytes through
    // Playwright's protocol. The `slice()` copies below are deliberately test-only attack fixtures;
    // the production store still hashes and streams the supplied Uint8Array in bounded chunks.
    const integrity = await page.evaluate(async () => {
      const digest = async (bytes) => {
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
      };
      const original = await window.__snapshotExport();
      if (!original) throw new Error("snapshot export missing after save");
      const originalDigest = await digest(original);

      const truncated = original.slice(0, original.byteLength - 1);
      await window.__snapshotImport(truncated);
      const truncatedDecision = await window.__snapshotDecision();

      await window.__snapshotImport(original);
      const afterTruncationRestore = await window.__snapshotDecision();

      const mutated = original.slice();
      mutated[mutated.byteLength - 1] ^= 1;
      await window.__snapshotImport(mutated);
      const mutatedDecision = await window.__snapshotDecision();

      await window.__snapshotImport(original);
      const roundTripped = await window.__snapshotExport();
      return {
        originalBytes: original.byteLength,
        originalDigest,
        truncatedDecision,
        afterTruncationRestore,
        mutatedDecision,
        roundTripDigest: await digest(roundTripped),
      };
    });
    expect(integrity.truncatedDecision).toBe("corrupt");
    expect(integrity.afterTruncationRestore).toBe("resume");
    expect(integrity.mutatedDecision).toBe("corrupt");
    expect(integrity.roundTripDigest).toBe(integrity.originalDigest);
    expect(integrity.originalBytes).toBeGreaterThan(1_000_000);

    // ── Reload the tab (IndexedDB survives a same-origin reload) ────────────────────────────────
    // A fresh boot reconstructs the saved generation from the overlay metadata, so the snapshot is
    // coherent → "resume".
    await page.reload();
    await bootToLogin();
    await page.evaluate(() => window.__linuxCtl.pause());
    expect(await page.evaluate(() => window.__snapshotGeneration())).toBe(savedGeneration);
    expect(await page.evaluate(() => window.__snapshotDecision())).toBe("resume");

    // A real guest write reaches the write-back overlay and the awaited persist hook is the strict
    // IndexedDB durability barrier. The write is intentionally after the snapshot, so the old CPU/RAM
    // state must no longer be resumable over the newer disk generation.
    await page.evaluate(() => window.__linuxCtl.resume());
    const beforeWriteGeneration = await page.evaluate(() => window.__snapshotGeneration());
    const write = await page.evaluate(() => window.wvmDemo.run(
      "printf T12D_GENERATION_LIVE > /root/t12d-generation && sync",
      120000,
    ));
    expect(write.exit).toBe(0);
    await page.evaluate(() => window.__linuxCtl.pause());
    await page.evaluate(() => window.__persist());
    const afterWriteGeneration = await page.evaluate(() => window.__snapshotGeneration());
    expect(afterWriteGeneration).toBeGreaterThan(beforeWriteGeneration);
    expect(await page.evaluate(() => window.__snapshotDecision())).toBe("stale");

    // Reload again: both the generation and the guest's durable overlay write must survive together.
    await page.reload();
    await bootToLogin();
    expect(await page.evaluate(() => window.__linuxCtl.pause())).toBeUndefined();
    expect(await page.evaluate(() => window.__snapshotGeneration())).toBe(afterWriteGeneration);
    expect(await page.evaluate(() => window.__snapshotDecision())).toBe("stale");
    await page.evaluate(() => window.__linuxCtl.resume());
    const persisted = await page.evaluate(() => window.wvmDemo.run("cat /root/t12d-generation", 120000));
    expect(persisted.exit).toBe(0);
    expect(persisted.stdout).toContain("T12D_GENERATION_LIVE");

    expect(errs, `console errors: ${errs.join("; ")}`).toEqual([]);
  });
});

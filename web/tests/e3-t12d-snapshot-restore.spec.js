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
// decision is always "missing". The only persistent boot shape today is the chunked Alpine image, whose
// artifacts are gitignored and whose ~12-min browser boot OS-reaps on the mac dev box (see
// memory/browser-alpine-boot-reaped-on-mac.md) — so, exactly like idb-persist.spec.js, this SKIPS
// unless the chunked-Alpine artifact is present (never in CI). Run it explicitly on a box that can
// sustain the boot.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rows = "#term .xterm-rows";
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const have =
  fs.existsSync(path.join(WEB, "artifacts-alpine.json")) &&
  fs.existsSync(path.resolve(WEB, "../releases/chunked-alpine/manifest.json"));

test.describe("E3-T12d: browser resume-snapshot persistence + restore selection", () => {
  test.skip(!have, "needs releases/chunked-alpine + web/artifacts-alpine.json (persistent boot shape)");

  test("save → reload → decision resumes; then advance generation → decision goes stale", async ({ page }) => {
    test.setTimeout(1_800_000); // ~30 min: two full persistent boots

    const errs = [];
    page.on("console", (m) => {
      const t = m.text();
      if (m.type() === "error" && !t.includes("favicon.ico") && !/Failed to load resource.*404/.test(t)) errs.push(t);
    });

    const bootToLogin = async () => {
      await expect(page.locator("#boot-alpine")).toBeEnabled();
      await page.click("#boot-alpine");
      let sawOpenRC = false;
      for (let i = 0; i < 900; i++) {
        const text = await page.locator(rows).textContent().catch(() => "");
        if (/Kernel panic|Unable to mount root/.test(text)) throw new Error("kernel panic");
        if (text.includes("OpenRC")) sawOpenRC = true;
        if (sawOpenRC && text.includes("login:")) return;
        await page.waitForTimeout(1500);
      }
      throw new Error("did not reach login:");
    };

    // ── Boot 1: take + persist a whole-machine snapshot at the fresh-boot generation (0) ─────────
    await page.goto("/?persist=1&noAutoBoot=1");
    await bootToLogin();

    // Before any snapshot the store is empty → the header-level decision is "missing".
    expect(await page.evaluate(() => window.__snapshotDecision())).toBe("missing");

    // Persist a resume snapshot; it is now coherent with the live machine identity → "resume".
    expect(await page.evaluate(() => window.__snapshotSave())).toBe(true);
    expect(await page.evaluate(() => window.__snapshotDecision())).toBe("resume");

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
    // A fresh boot starts at overlay generation 0, the same generation the snapshot was taken at, so
    // the persisted blob is coherent with THIS same build + base image + generation → "resume".
    await page.reload();
    await bootToLogin();
    expect(await page.evaluate(() => window.__snapshotDecision())).toBe("resume");

    // Advancing the overlay commit generation invalidates that persisted snapshot: its frozen CPU/RAM
    // state no longer matches the (now newer) disk generation → the coherence guard says "stale". This
    // is the silent-corruption guard — a stale snapshot must never be resumed over a newer disk.
    await page.evaluate(() => window.__snapshotAdvanceGen());
    expect(await page.evaluate(() => window.__snapshotDecision())).toBe("stale");

    expect(errs, `console errors: ${errs.join("; ")}`).toEqual([]);
  });
});

#!/usr/bin/env node
// Read-only IndexedDB metadata inspection on a private copy of a closed diagnostic profile.
// No emulator, loader, guest, server or snapshot restoration is launched.
import assert from "node:assert/strict";
import { cp, lstat, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { chromium } from "../../web/node_modules/playwright/index.mjs";

const [recordFile, outputFile] = process.argv.slice(2);
assert.ok(recordFile && outputFile, "usage: inspect-resume FAILURE_JSON NEW_OUTPUT_JSON");
const bytes = await readFile(recordFile);
const record = JSON.parse(bytes);
const profile = record.milestones.run.profile;
const origin = record.milestones.run.binding.origin;
assert.equal(record.milestones.run.acceptance, false);
assert.ok(path.isAbsolute(profile) && (await lstat(profile)).isDirectory());
assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/u);
const scratch = await mkdtemp(path.join(os.tmpdir(), "e5-t26f-resume-inspection-"));
const copy = path.join(scratch, "profile");
await cp(profile, copy, { recursive: true, force: false, errorOnExist: true });
const context = await chromium.launchPersistentContext(copy, {
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, serviceWorkers: "block",
});
try {
  const page = await context.newPage();
  const url = `${origin}/__e5_t26f_readonly_metadata__`;
  await page.route(url, route => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Read-only snapshot metadata</title>" }));
  await page.goto(url);
  const metadata = await page.evaluate(async () => {
    const request = req => new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      if ("onupgradeneeded" in req) req.onupgradeneeded = () => { req.transaction.abort(); reject(Error("refusing to create a database")); };
    });
    const hex = value => value == null ? null : Array.from(new Uint8Array(value), b => b.toString(16).padStart(2, "0")).join("");
    const result = [];
    for (const info of await indexedDB.databases()) {
      if (!/^(?:wvov|wvsn)-[0-9a-f]{64}$/u.test(info.name)) continue;
      const db = await request(indexedDB.open(info.name, info.version));
      try {
        const stores = [...db.objectStoreNames];
        const meta = stores.includes("meta") ? await request(db.transaction("meta", "readonly").objectStore("meta").get(0)) : null;
        const first = stores.includes("chunks") ? await request(db.transaction("chunks", "readonly").objectStore("chunks").get(0)) : null;
        const header = first == null ? null : new Uint8Array(first).slice(0, 84);
        const metaBytes = meta == null ? null : new Uint8Array(meta);
        result.push({ ...info, stores, metaHex: hex(meta), firstChunkHeaderHex: hex(header),
          snapshotGeneration: header?.length === 84 && new TextDecoder().decode(header.slice(0, 8)) === "WVMRESU1"
            ? new DataView(header.buffer).getBigUint64(76, true).toString() : null,
          overlayGeneration: metaBytes?.length === 60 && new TextDecoder().decode(metaBytes.slice(0, 4)) === "wvov"
            ? new DataView(metaBytes.buffer, metaBytes.byteOffset, metaBytes.byteLength).getBigUint64(52, true).toString() : null });
      } finally { db.close(); }
    }
    return result;
  });
  assert.ok(metadata.some(entry => entry.name.startsWith("wvsn-")), "snapshot store is missing from the copied profile");
  const result = { sourceRecord: recordFile, sourceRecordSha256: createHash("sha256").update(bytes).digest("hex"),
    sourceProfile: profile, inspectedCopy: copy, origin, guestBooted: false, transactions: "readonly", metadata };
  await writeFile(outputFile, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(result, null, 2));
} finally { await context.close(); }

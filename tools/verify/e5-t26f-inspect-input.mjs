#!/usr/bin/env node
// Read-only input-snapshot diagnostics on a COPY of a closed failed browser profile.
// No emulator is loaded. Values describe the stored checkpoint, not live post-failure state.
import assert from "node:assert/strict";
import { cp, lstat, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { chromium } from "../../web/node_modules/playwright/index.mjs";

const [recordFile, outputFile] = process.argv.slice(2);
assert.ok(recordFile && outputFile, "usage: inspect-input FAILURE_JSON NEW_OUTPUT_JSON");
const bytes = await readFile(recordFile), record = JSON.parse(bytes);
const profile = record.milestones.run.profile, origin = record.milestones.run.binding.origin;
assert.equal(record.milestones.run.acceptance, false);
assert.ok(path.isAbsolute(profile) && (await lstat(profile)).isDirectory());
assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/u);
const copy = path.join(await mkdtemp("/private/tmp/e5-t26f-input-inspection-"), "profile");
await cp(profile, copy, { recursive: true, force: false, errorOnExist: true });
const context = await chromium.launchPersistentContext(copy, {
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, serviceWorkers: "block",
});
try {
  const page = await context.newPage(), url = `${origin}/__e5_t26f_readonly_input__`;
  await page.route(url, route => route.fulfill({ status: 200, contentType: "text/html",
    headers: { "content-security-policy": "default-src 'none'" },
    body: "<!doctype html><title>Read-only stored input metadata</title>" }));
  await page.goto(url);
  const metadata = await page.evaluate(async () => {
    const require = (condition, message) => { if (!condition) throw Error(message); };
    const request = req => new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
      if ("onupgradeneeded" in req) req.onupgradeneeded = () => {
        req.transaction.abort(); reject(Error("refusing to create database"));
      };
    });
    const hex = bytes => Array.from(bytes, x => x.toString(16).padStart(2, "0")).join("");
    const hash = async bytes => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
    const records = [];
    for (const info of await indexedDB.databases()) {
      if (!/^wvsn-[0-9a-f]{64}$/u.test(info.name)) continue;
      const db = await request(indexedDB.open(info.name, info.version));
      try {
        const get = (store, key) => request(db.transaction(store, "readonly").objectStore(store).get(key));
        const meta = new Uint8Array(await get("meta", 0)), view = new DataView(meta.buffer);
        require(meta.length === 92 && new TextDecoder().decode(meta.slice(0, 4)) === "wvsn", "bad meta");
        const chunkSize = view.getUint32(8, true), total = Number(view.getBigUint64(12, true));
        require(chunkSize > 0 && Number.isSafeInteger(total) && total >= 84, "bad snapshot length");
        const cached = new Map();
        async function range(offset, length) {
          require(Number.isSafeInteger(offset) && length >= 0 && offset + length <= total, "out-of-bounds range");
          const result = new Uint8Array(length);
          for (let pos = offset; pos < offset + length;) {
            const index = Math.floor(pos / chunkSize);
            if (!cached.has(index)) {
              const raw = await get("chunks", index);
              require(raw != null, "missing chunk");
              const chunk = new Uint8Array(raw);
              require(chunk.length === Math.min(chunkSize, total - index * chunkSize), "short chunk");
              cached.set(index, chunk);
            }
            const chunk = cached.get(index), start = pos % chunkSize;
            const count = Math.min(chunk.length - start, offset + length - pos);
            result.set(chunk.subarray(start, start + count), pos - offset); pos += count;
          }
          return result;
        }
        const header = await range(0, 84);
        require(new TextDecoder().decode(header.slice(0, 8)) === "WVMRESU1", "bad container");
        const sections = [], input = [];
        for (let offset = 84; offset < total;) {
          const section = new DataView((await range(offset, 8)).buffer);
          const tag = section.getUint32(0, true), length = section.getUint32(4, true);
          require(offset + 8 + length <= total && sections.length < 64, "bad section bounds");
          sections.push({ tag, offset, length });
          if ([13, 14, 15].includes(tag)) {
            require(length < 1024 * 1024, "oversized diagnostic input payload");
            const payload = await range(offset + 8, length), magic = new TextEncoder().encode("WVINP001");
            const matches = [];
            for (let p = 0; p + 68 <= payload.length; p++) {
              if (magic.every((byte, i) => payload[p + i] === byte)) matches.push(p);
            }
            require(matches.length === 1, "ambiguous input codec position");
            const p = matches[0], v = new DataView(payload.buffer, p);
            input.push({ tag, sectionOffset: offset, codecOffset: offset + 8 + p,
              payloadSha256: await hash(payload), version: v.getUint16(8, true),
              pendingFrames: v.getUint32(12, true), pendingEvents: v.getUint32(16, true),
              pendingEventBudget: v.getUint32(20, true), stagedEvents: v.getUint32(24, true),
              droppedFrames: v.getBigUint64(32, true).toString(), droppedEvents: v.getBigUint64(40, true).toString() });
          }
          offset += 8 + length;
        }
        records.push({ database: info.name, metaHex: hex(meta), totalBytes: total, sections, input,
          inspectedChunkIndexes: [...cached.keys()] });
      } finally { db.close(); }
    }
    return records;
  });
  assert.ok(metadata.some(x => x.input.some(i => i.tag === 13)), "stored keyboard payload missing");
  const report = { sourceRecord: recordFile, sourceRecordSha256: createHash("sha256").update(bytes).digest("hex"),
    sourceProfile: profile, inspectedCopy: copy, origin, guestBooted: false, transactions: "readonly",
    limitation: "Stored pre-run checkpoint only; no live post-failure input counters", metadata };
  await writeFile(outputFile, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
} finally { await context.close(); }

#!/usr/bin/env node
// E5-T34g (promoted by the verifier): browser attacks on the synchronous whole-image read seam —
// the cases the task's adversarial list names that no other harness boots.
//
//   bash tools/serve-dev.sh 8123 &      # serves web/ + /releases
//   node tools/verify/e5-t34g-local-read-attacks.mjs [corrupt-late|persist-prefill|persist-lazy|extra-prefill|tight-prefill ...]
//                                                                                    (default: all)
//
// Legs (Alpine chunked image, `window.__bootAlpineChunkedCold`):
//   corrupt-late     A whole image whose declared SHA-256 matches its bytes but in which one chunk
//                    that is NOT read first (E5_T34G_BAD_CHUNK, default 74: first demanded ~20 s in,
//                    after the root mount) fails the manifest hash. The page must report the
//                    permanent failure for exactly that chunk, the tab must not crash, and no
//                    chunk or Range request may appear. The image is built on demand next to the
//                    good one (releases/chunked-alpine/corrupt-chunk<N>.img.gz, gitignored).
//   persist-prefill  A PERSISTENT (IndexedDB) disk with a whole-image prefill: boots the
//                    `ChunkedPersistent` construction site with the local reader live, writes and
//                    syncs, overwrites two bytes inside a base block, and hashes a fixed sorted set
//                    of cold files (COLDSUM). Zero chunk/Range requests, zero fetch waits.
//   persist-lazy     The same persistent boot with NO local image (the reader answers "not here"):
//                    the asynchronous network path. Its COLDSUM is the differential reference.
//   extra-prefill    The `ChunkedWithExtra` construction site (a read-only second drive) with a
//                    local image; same COLDSUM file set.
//   tight-prefill    A local image under the smallest settable block-cache budget (1 MiB: eight
//                    chunks), so chunks are evicted and supplied again throughout the boot. The
//                    cache must report evictions, more local hits than distinct chunks, no fetch
//                    wait, and the same COLDSUM.
// When more than one of the COLDSUM legs runs, their sums must be equal: the bytes a guest reads
// through the synchronous local path are the bytes the network path delivers.
//
// Local-only inputs: releases/chunked-alpine/{manifest.json,chunks/,alpine-rootfs.img.gz(.json)}
// and web/artifacts-alpine.json. Evidence -> evidence/e5-t34g/attacks (override: E5_T34G_OUT).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const base = process.env.E5_T34G_URL || "http://127.0.0.1:8123";
const out = path.resolve(process.env.E5_T34G_OUT || path.join(repo, "evidence/e5-t34g/attacks"));
const chunked = path.join(repo, "releases/chunked-alpine");
const whole = JSON.parse(fs.readFileSync(path.join(chunked, "alpine-rootfs.img.gz.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(chunked, "manifest.json"), "utf8"));
assert.equal(whole.size, manifest.image_len, "whole image sidecar must match the manifest image_len");
const ALL = ["corrupt-late", "persist-prefill", "persist-lazy", "extra-prefill", "tight-prefill"];
const modes = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
for (const m of modes) assert.ok(ALL.includes(m), `unknown leg ${m}`);
fs.mkdirSync(out, { recursive: true });

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

// A copy of the good whole image with one byte of `chunk` flipped, and a sidecar whose declared
// SHA-256 is that of the corrupted bytes (so the loader's whole-image check passes and only the
// per-chunk verification in wasm can catch it). Rebuilt only if missing or stale.
function corruptImage(chunk) {
  const name = `corrupt-chunk${chunk}.img.gz`;
  const gz = path.join(chunked, name), sidecar = `${gz}.json`;
  if (fs.existsSync(gz) && fs.existsSync(sidecar)) {
    const meta = JSON.parse(fs.readFileSync(sidecar, "utf8"));
    if (meta.from === whole.sha256 && meta.corruptedChunk === chunk) return { name, meta };
  }
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(chunked, "alpine-rootfs.img.gz")), { maxOutputLength: manifest.image_len });
  assert.equal(raw.length, manifest.image_len);
  const cs = manifest.chunk_size, lo = chunk * cs, hi = Math.min(lo + cs, raw.length);
  assert.ok(chunk > 0 && lo < raw.length, "the corrupted chunk must exist and must not be chunk 0");
  assert.equal(sha256(raw.subarray(lo, hi)), manifest.chunks[chunk], "the chunk matches the manifest before the flip");
  assert.equal(manifest.chunks.filter((h) => h === manifest.chunks[chunk]).length, 1, "pick a chunk with a unique hash");
  const offset = lo + 4097;
  raw[offset] ^= 0xff;
  assert.notEqual(sha256(raw.subarray(lo, hi)), manifest.chunks[chunk]);
  const meta = { size: raw.length, sha256: sha256(raw), corruptedOffset: offset, corruptedChunk: chunk, from: whole.sha256 };
  fs.writeFileSync(gz, zlib.gzipSync(raw, { level: 6 }));
  fs.writeFileSync(sidecar, JSON.stringify(meta, null, 2) + "\n");
  return { name, meta };
}

const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({
  executablePath: process.env.E5_T34G_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const save = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2) + "\n");
const isChunkReq = (r) => r.url.includes("/chunked-alpine/chunks/") || r.range !== null;
const isWholeReq = (r) => /\/chunked-alpine\/[^/]*\.img\.gz$/.test(new URL(r.url).pathname);
// The xterm buffer (scrollback included, soft-wrapped rows rejoined).
const BUFFER_TEXT = () => {
  const buf = window.__term.term.buffer.active;
  let text = "";
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (!line) continue;
    text += (i > 0 && !line.isWrapped ? "\n" : "") + line.translateToString(true);
  }
  return text;
};
const screenText = (page) => page.evaluate(`(${BUFFER_TEXT})()`);
const waitScreen = (page, needle, timeout) =>
  page.waitForFunction(`(${BUFFER_TEXT})().includes(${JSON.stringify(needle)})`, null, { timeout, polling: 1000 });
const waitScreenRe = (page, source, timeout) =>
  page.waitForFunction(`new RegExp(${JSON.stringify(source)}).test((${BUFFER_TEXT})())`, null, { timeout, polling: 1000 });
const type = (page, s) => page.evaluate((x) => window.__term.typeBytes(new TextEncoder().encode(x)), s);
const BOOT_TIMEOUT_MS = Number(process.env.E5_T34G_BOOT_TIMEOUT_MS ?? 60 * 60 * 1000);
const WHOLE = { wholeImageUrl: "./releases/chunked-alpine/alpine-rootfs.img.gz", wholeImageSha256: whole.sha256, wholeImageSize: whole.size };
const COLDSUM_CMD = "find /usr/lib /lib /usr/share -xdev -type f | sort | head -400 | xargs cat | sha256sum | sed 's/^/COLDSUM_/'\r";

async function open(extra) {
  // A fresh context per page: its own IndexedDB, so a persistent leg never sees another's disk.
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  const state = { requests: [], consoleErrors: [], crashed: false };
  const t0 = Date.now();
  page.on("request", (r) => {
    const h = r.headers();
    state.requests.push({ t: Date.now() - t0, method: r.method(), url: r.url(), range: h.range ?? null });
  });
  page.on("console", (m) => {
    // The favicon 404 is the one allowed error (AGENTS.md 3a).
    if (m.type() === "error" && !m.text().includes("favicon.ico") && !m.location().url?.endsWith("/favicon.ico")) {
      state.consoleErrors.push(m.text());
    }
  });
  page.on("pageerror", (e) => state.consoleErrors.push(String(e)));
  page.on("crash", () => { state.crashed = true; });
  await page.goto(`${base}/?testHooks=1&noAutoBoot=1`);
  await page.waitForFunction(() => window.__wasmReady?.() === true, null, { timeout: 120_000 });
  state.bootAt = Date.now();
  await page.evaluate((x) => { void window.__bootAlpineChunkedCold(x); }, extra);
  return { page, state };
}

async function shell(page, state) {
  await waitScreen(page, "login:", BOOT_TIMEOUT_MS);
  const loginMs = Date.now() - state.bootAt;
  await type(page, "root\r");
  await page.waitForTimeout(3000);
  await type(page, "\r");
  await page.waitForTimeout(2000);
  return loginMs;
}

const counts = (state) => ({ total: state.requests.length, whole: state.requests.filter(isWholeReq).length,
  chunkOrRange: state.requests.filter(isChunkReq).length });
const waits = (s) => s && { fetchWaits: s.fetchWaits, fetchRequestedChunks: s.fetchRequestedChunks, fetchWaitTotalMs: s.fetchWaitTotalMs };

function assertHealthy(mode, state, screen, fetchStats, local) {
  assert.equal(state.crashed, false, "tab crashed");
  assert.deepEqual(state.consoleErrors, [], `console errors: ${state.consoleErrors.join("; ")}`);
  assert.equal(fetchStats.error, null);
  assert.doesNotMatch(screen, /Kernel panic|I\/O error|EXT4-fs error|Buffer I\/O/);
  const c = counts(state);
  if (local) {
    assert.equal(c.whole, 1, `${mode}: exactly one whole-image request`);
    assert.equal(c.chunkOrRange, 0, `${mode}: no chunk or Range request`);
    assert.equal(fetchStats.localImage, true);
    assert.equal(fetchStats.fetches, 0, "no network chunk fetch");
    assert.ok(fetchStats.localHits > 0, "chunks served locally");
  } else {
    assert.equal(c.whole, 0);
    assert.ok(c.chunkOrRange > 0);
    assert.equal(fetchStats.localImage, false);
    assert.equal(fetchStats.localHits, 0);
    assert.ok(fetchStats.fetches > 0);
  }
}

async function persistent(mode) {
  const local = mode === "persist-prefill";
  const { page, state } = await open({ ...(local ? WHOLE : {}), persist: true });
  const loginMs = await shell(page, state);
  // 1. A write, a durable sync, and a read back through the overlay.
  await type(page, "echo VERIFIER_$((40+2))_A > /root/v.txt && sync && cat /root/v.txt\r");
  await waitScreen(page, "VERIFIER_42_A", 600_000);
  // 2. Overwrite two bytes inside an existing base block (read-modify-write over base content).
  await type(page, "printf ZZ | dd of=/etc/motd bs=1 seek=1 conv=notrunc 2>/dev/null; sync; echo PB_$(head -c 4 /etc/motd | od -An -c | tr -d ' \\n')_END\r");
  await waitScreen(page, "PB_WZZc_END", 600_000);
  // 3. A fixed, sorted set of files the boot has mostly not touched: cold base chunks.
  await type(page, COLDSUM_CMD);
  await waitScreenRe(page, "COLDSUM_[0-9a-f]{64}", 900_000);
  await type(page, "sync; echo SYNCED_$((1+1))\r");
  await waitScreen(page, "SYNCED_2", 600_000);
  const screen = await screenText(page);
  fs.writeFileSync(path.join(out, `${mode}-serial.log`), screen + "\n");
  const [fetchStats, scheduler, persistStats] = await page.evaluate(async () => [
    await window.__chunkedStats(), await window.__schedulerStats?.(), await window.__persistStats?.(),
  ]);
  const result = { mode, loginMs, coldsum: /COLDSUM_([0-9a-f]{64})/.exec(screen)[1], crashed: state.crashed,
    consoleErrors: state.consoleErrors, counts: counts(state), fetchStats, persistStats, scheduler: waits(scheduler) };
  save(`${mode}.json`, result);
  assertHealthy(mode, state, screen, fetchStats, local);
  assert.ok(persistStats, "a persistent boot reports persist statistics");
  if (local) assert.equal(result.scheduler.fetchWaits, 0, "no read (or partial-block write) waited for a run slice to end");
  await page.close();
  return result;
}

async function extraPrefill() {
  // Any served file works as the second drive; the chunk manifest is small and starts `{"version"`.
  const extra = "./releases/chunked-alpine/manifest.json";
  const sectors = Math.floor(fs.statSync(path.join(chunked, "manifest.json")).size / 512);
  const { page, state } = await open({ ...WHOLE, extraDiskUrl: extra });
  const loginMs = await shell(page, state);
  await type(page, "echo XD_$(cat /sys/block/vdb/size)_$(head -c 9 /dev/vdb | tr -dc a-z)_END\r");
  await waitScreenRe(page, "XD_[0-9]+_[a-z]+_END", 600_000);
  await type(page, COLDSUM_CMD);
  await waitScreenRe(page, "COLDSUM_[0-9a-f]{64}", 900_000);
  const screen = await screenText(page);
  fs.writeFileSync(path.join(out, "extra-prefill-serial.log"), screen + "\n");
  const [fetchStats, scheduler] = await page.evaluate(async () => [await window.__chunkedStats(), await window.__schedulerStats?.()]);
  const result = { mode: "extra-prefill", loginMs, coldsum: /COLDSUM_([0-9a-f]{64})/.exec(screen)[1],
    extra: /XD_([0-9]+_[a-z]+)_END/.exec(screen)[1], crashed: state.crashed, consoleErrors: state.consoleErrors,
    counts: counts(state), fetchStats, scheduler: waits(scheduler) };
  save("extra-prefill.json", result);
  assertHealthy("extra-prefill", state, screen, fetchStats, true);
  assert.equal(result.extra, `${sectors}_version`, "the second drive is present and readable");
  assert.equal(result.scheduler.fetchWaits, 0);
  await page.close();
  return result;
}

async function tightPrefill() {
  const { page, state } = await open({ ...WHOLE, cacheBudgetMib: 1 });
  const loginMs = await shell(page, state);
  await type(page, COLDSUM_CMD);
  await waitScreenRe(page, "COLDSUM_[0-9a-f]{64}", 900_000);
  const screen = await screenText(page);
  fs.writeFileSync(path.join(out, "tight-prefill-serial.log"), screen + "\n");
  const [fetchStats, scheduler] = await page.evaluate(async () => [await window.__chunkedStats(), await window.__schedulerStats?.()]);
  const result = { mode: "tight-prefill", loginMs, coldsum: /COLDSUM_([0-9a-f]{64})/.exec(screen)[1], crashed: state.crashed,
    consoleErrors: state.consoleErrors, counts: counts(state), fetchStats, scheduler: waits(scheduler) };
  save("tight-prefill.json", result);
  assertHealthy("tight-prefill", state, screen, fetchStats, true);
  assert.equal(fetchStats.cache.budgetBytes, 1 << 20);
  assert.ok(fetchStats.cache.evictions > 0, "the budget forced evictions");
  assert.ok(fetchStats.cache.residentBytes <= 1 << 20, "residency stays within the budget");
  assert.ok(fetchStats.localHits > fetchStats.cache.residentBytes / manifest.chunk_size, "evicted chunks were supplied again");
  assert.equal(result.scheduler.fetchWaits, 0, "a request that fits the store never parks");
  await page.close();
  return result;
}

async function corruptLate() {
  const { name, meta } = corruptImage(Number(process.env.E5_T34G_BAD_CHUNK ?? 74));
  const c = meta.corruptedChunk;
  const { page, state } = await open({ wholeImageUrl: `./releases/chunked-alpine/${name}`, wholeImageSha256: meta.sha256, wholeImageSize: meta.size });
  // The loader halts the machine on the first permanent fetch failure (its controller — and
  // fetchStats — go away), so the evidence is the halt message plus the request log.
  await waitScreen(page, `lazy chunk fetch failed: chunk ${c}: LocalImageCorrupt { chunk: ${c} }`, BOOT_TIMEOUT_MS);
  const haltMs = Date.now() - state.bootAt;
  const screen = await screenText(page);
  fs.writeFileSync(path.join(out, "corrupt-late-serial.log"), screen + "\n");
  await page.waitForTimeout(3000); // let any (forbidden) fallback request surface
  const alive = await page.evaluate(() => 6 * 7); // the page itself must still answer
  const result = { mode: "corrupt-late", corrupt: { name, ...meta }, haltMs, alive, crashed: state.crashed,
    consoleErrors: state.consoleErrors, mountedRoot: /VFS: Mounted root/.test(screen), counts: counts(state),
    chunkRequests: state.requests.filter(isChunkReq) };
  save("corrupt-late.json", result);
  assert.equal(alive, 42);
  assert.equal(state.crashed, false, "tab crashed");
  assert.ok(state.consoleErrors.some((e) => e.includes(`chunk ${c}: LocalImageCorrupt`)), "wasm reported the corrupt chunk");
  assert.equal(result.counts.whole, 1);
  assert.equal(result.counts.chunkOrRange, 0, "a corrupt local image never falls back to the network");
  assert.ok(result.mountedRoot, "the corrupt chunk was reached after the root mount, i.e. not by the first read");
  await page.close();
  return result;
}

const results = {};
try {
  for (const mode of modes) {
    const started = Date.now();
    results[mode] = mode === "corrupt-late" ? await corruptLate() : mode === "extra-prefill" ? await extraPrefill()
      : mode === "tight-prefill" ? await tightPrefill() : await persistent(mode);
    console.log(`E5-T34g ${mode}: PASS (${Date.now() - started} ms)`);
  }
  const sums = Object.fromEntries(Object.values(results).filter((r) => r.coldsum).map((r) => [r.mode, r.coldsum]));
  if (Object.keys(sums).length > 1) {
    assert.equal(new Set(Object.values(sums)).size, 1, `cold file bytes differ between paths: ${JSON.stringify(sums)}`);
    console.log(`E5-T34g differential: PASS (${Object.keys(sums).join(" = ")}) ${Object.values(sums)[0]}`);
  }
  save("summary.json", Object.fromEntries(Object.values(results).map((r) => [r.mode, {
    loginMs: r.loginMs, haltMs: r.haltMs, coldsum: r.coldsum, counts: r.counts,
    localHits: r.fetchStats?.localHits, fetches: r.fetchStats?.fetches, fetchWaits: r.scheduler?.fetchWaits,
    evictions: r.fetchStats?.cache?.evictions,
  }])));
} finally {
  await browser.close();
}

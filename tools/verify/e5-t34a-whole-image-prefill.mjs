#!/usr/bin/env node
// E5-T34a acceptance: the Alpine chunked image boots in WHOLE-IMAGE PREFILL mode — one streamed
// request for the gzip of the raw image, every chunk then served from that JS-side buffer (sliced and
// hash-verified in wasm), ZERO per-chunk or Range requests during boot — and reaches the same
// `login:` + shell marker as the lazy per-chunk baseline. Two in-browser attacks: a corrupt image
// whose declared SHA-256 matches its (corrupted) bytes must be refused by the per-chunk verify in
// wasm with no network fallback, and a wrong declared size must be refused before any image request.
//
//   bash tools/serve-dev.sh 8123 &      # serves web/ + /releases
//   node tools/verify/e5-t34a-whole-image-prefill.mjs [size|corrupt|prefill|lazy ...]   (default: all)
//
// Local-only inputs: releases/chunked-alpine/{manifest.json,chunks/,alpine-rootfs.img.gz(.json),
// corrupt-chunk0.img.gz(.json)} (tools/build-whole-image.sh) and web/artifacts-alpine.json.
// Evidence → evidence/e5-t34a/ (override with E5_T34A_OUT). Browser: system Chrome (E5_T34A_CHROME).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const base = process.env.E5_T34A_URL || "http://127.0.0.1:8123";
const out = path.resolve(process.env.E5_T34A_OUT || path.join(repo, "evidence/e5-t34a"));
const chunked = path.join(repo, "releases/chunked-alpine");
const whole = JSON.parse(fs.readFileSync(path.join(chunked, "alpine-rootfs.img.gz.json"), "utf8"));
const imageLen = JSON.parse(fs.readFileSync(path.join(chunked, "manifest.json"), "utf8")).image_len;
assert.equal(whole.size, imageLen, "whole image sidecar must match the manifest image_len");
const modes = process.argv.slice(2).length ? process.argv.slice(2) : ["size", "corrupt", "prefill", "lazy"];
fs.mkdirSync(out, { recursive: true });

const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({
  executablePath: process.env.E5_T34A_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const save = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2) + "\n");
const isChunkReq = (r) => r.url.includes("/chunked-alpine/chunks/") || r.range !== null;
const isWholeReq = (r) => /\/chunked-alpine\/[^/]*\.img\.gz$/.test(new URL(r.url).pathname);
// The xterm buffer (scrollback included, soft-wrapped rows rejoined), independent of which renderer
// paints the grid.
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

async function open(extra) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  const requests = [];
  const consoleErrors = [];
  const t0 = Date.now();
  // Chromium reports the whole-machine worker's fetches as page requests too.
  page.on("request", (r) => {
    const h = r.headers();
    requests.push({ t: Date.now() - t0, method: r.method(), url: r.url(), range: h.range ?? null });
  });
  page.on("console", (m) => {
    // The favicon 404 is the one allowed error (AGENTS.md 3a); its console entry names only the URL.
    if (m.type() === "error" && !m.text().includes("favicon.ico") && !m.location().url?.endsWith("/favicon.ico")) {
      consoleErrors.push(m.text());
    }
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  await page.goto(`${base}/?testHooks=1&noAutoBoot=1`);
  await page.waitForFunction(() => window.__wasmReady?.() === true, null, { timeout: 120_000 });
  const bootAt = Date.now();
  await page.evaluate((x) => { void window.__bootAlpineChunkedCold(x); }, extra);
  return { page, requests, consoleErrors, bootAt };
}

async function login(page) {
  await waitScreen(page, "login:", 1_800_000);
  const screen = await screenText(page);
  assert.doesNotMatch(screen, /Kernel panic|Unable to mount root/);
  const type = (s) => page.evaluate((x) => window.__term.typeBytes(new TextEncoder().encode(x)), s);
  await type("root\r");
  await page.waitForTimeout(3000);
  await type("\r");
  await page.waitForTimeout(2000);
  await type("echo PREFILL_$((6*7))_OK\r");
  await waitScreen(page, "PREFILL_42_OK", 300_000);
  return screenText(page);
}

const results = {};
async function run(mode) {
  const started = Date.now();
  if (mode === "size") {
    const { page, requests } = await open({
      wholeImageUrl: "./releases/chunked-alpine/alpine-rootfs.img.gz",
      wholeImageSha256: whole.sha256,
      wholeImageSize: whole.size - 1,
    });
    await waitScreen(page, "whole image: declared size 805306367 differs from manifest image_len 805306368", 120_000);
    const screen = await screenText(page);
    assert.deepEqual(requests.filter(isWholeReq), [], "refused before the image request");
    assert.deepEqual(requests.filter(isChunkReq), []);
    save("size-mismatch.json", { screen: screen.split("\n").filter((l) => /cannot boot/.test(l)), requests });
    await page.close();
  } else if (mode === "corrupt") {
    const bad = JSON.parse(fs.readFileSync(path.join(chunked, "corrupt-chunk0.img.gz.json"), "utf8"));
    const { page, requests, consoleErrors } = await open({
      wholeImageUrl: "./releases/chunked-alpine/corrupt-chunk0.img.gz",
      wholeImageSha256: bad.sha256,
      wholeImageSize: bad.size,
    });
    // The loader halts the machine on the first permanent fetch failure (its controller — and
    // fetchStats — go away), so the evidence is the halt message on the console plus the request log.
    await waitScreen(page, "lazy chunk fetch failed: chunk 0: LocalImageCorrupt { chunk: 0 }", 900_000);
    const screen = await screenText(page);
    fs.writeFileSync(path.join(out, "corrupt-serial.log"), screen + "\n");
    await page.waitForTimeout(2000); // let any (forbidden) fallback request surface
    save("corrupt-requests.json", { corrupt: bad, consoleErrors, wholeRequests: requests.filter(isWholeReq),
      chunkRequests: requests.filter(isChunkReq), requests });
    assert.ok(consoleErrors.some((e) => e.includes("chunk 0: LocalImageCorrupt")), "wasm reported the corrupt chunk");
    assert.equal(requests.filter(isWholeReq).length, 1);
    assert.deepEqual(requests.filter(isChunkReq), [], "a corrupt local image never falls back to the network");
    await page.close();
  } else if (mode === "prefill" || mode === "lazy") {
    const extra = mode === "prefill"
      ? { wholeImageUrl: "./releases/chunked-alpine/alpine-rootfs.img.gz", wholeImageSha256: whole.sha256, wholeImageSize: whole.size }
      : {};
    const { page, requests, consoleErrors, bootAt } = await open(extra);
    const screen = await login(page);
    fs.writeFileSync(path.join(out, `${mode}-serial.log`), screen + "\n");
    const loginMs = Date.now() - bootAt;
    const stats = await page.evaluate(() => window.__chunkedStats());
    save(`${mode}-requests.json`, { loginMs, imageLen, wholeImage: mode === "prefill" ? whole : null,
      counts: { total: requests.length, whole: requests.filter(isWholeReq).length, chunkOrRange: requests.filter(isChunkReq).length },
      requests });
    save(`${mode}-fetchstats.json`, stats);
    await page.screenshot({ path: path.join(out, `${mode}-login.png`), fullPage: true });
    if (mode === "prefill") {
      assert.equal(requests.filter(isWholeReq).length, 1, "exactly one whole-image request");
      assert.deepEqual(requests.filter(isChunkReq), [], "no chunk or Range request during boot");
      assert.equal(stats.localImage, true);
      assert.equal(stats.error, null);
      assert.equal(stats.fetches, 0, "no network chunk fetch");
      assert.equal(stats.bytes, 0);
      assert.ok(stats.localHits > 0, "chunks served locally");
    } else {
      assert.deepEqual(requests.filter(isWholeReq), []);
      assert.ok(requests.filter(isChunkReq).length > 0);
      assert.equal(stats.localImage, false);
      assert.equal(stats.localHits, 0);
      assert.ok(stats.fetches > 0);
    }
    assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join("; ")}`);
    results[mode] = { loginMs, localHits: stats.localHits, fetches: stats.fetches };
    await page.close();
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
  console.log(`E5-T34a ${mode}: PASS (${Date.now() - started} ms)`);
}

try {
  for (const m of modes) await run(m);
  if (Object.keys(results).length) save("summary.json", results);
} finally {
  await browser.close();
}

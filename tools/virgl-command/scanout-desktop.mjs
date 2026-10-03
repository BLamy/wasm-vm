#!/usr/bin/env node
// E6-T11c: exactly one unchanged Epic5 desktop boot from the built default bundle.
// The external image is read only. This server has no general filesystem route.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = fileURLToPath(import.meta.url);
const repo = path.resolve(path.dirname(script), '../..');
const dist = path.join(repo, 'web/dist');
const EXPECTED_IMAGE_BYTES = 1_073_741_824;
const EXPECTED_IMAGE_SHA256 = '467306a5d842f95927c1f5823363271b55854517f6318576a6a137f5615a5c1e';
const EXPECTED_MANIFEST_SHA256 = '1be3c29945747184c3ed868f51add1829e97bfd3945f456d4676d5f035fb4827';
const CHUNK_BYTES = 131_072;
const KERNEL = Object.freeze({
  url: 'releases/kernel/6.6.63/Image', size: 24_208_896,
  sha256: 'af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce',
});
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  assert.ok(['--output', '--image', '--assets', '--timeout-ms'].includes(key), `unknown option ${key}`);
  assert.ok(value && !value.startsWith('--') && !args.has(key), `missing or repeated option ${key}`);
  args.set(key, value);
}
for (const key of ['--output', '--image', '--assets']) assert.ok(args.has(key), `${key} is required`);
const output = path.resolve(args.get('--output'));
const imagePath = path.resolve(args.get('--image'));
const assets = path.resolve(args.get('--assets'));
const manifestPath = path.join(assets, 'manifest.json');
const timeoutMs = Number(args.get('--timeout-ms') ?? 900_000);
assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 30_000, '--timeout-ms must be an integer >= 30000');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (...argv) => execFileSync('git', argv, { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
const report = {
  schema: 'wasm-vm.virgl-scanout-desktop.v1', task: 'E6-T11c', status: 'running',
  gitHead: git('rev-parse', 'HEAD').toString().trim(),
  command: [process.execPath, ...process.argv.slice(1)], startedAt: new Date().toISOString(),
  scope: { guestExecution: true, productionVirgl: false, desktop3dAcceleration: false, unchanged2dDesktop: true },
  acceptance: { runCount: 1, freshContexts: 1, headed: true, cacheDisabled: true, serviceWorkers: 'block', noSerialInput: true, warmBoots: 0 },
  errors: { console: [], page: [], requests: [], http: [], server: [] }, served: [],
};
let browser, context, page, server, publication;
const served = new Map(), transcript = [];
const record = (kind, detail) => transcript.push(JSON.stringify({ at: new Date().toISOString(), kind, detail }));
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
async function fileBinding(file) {
  const stat = await fs.stat(file);
  assert.ok(stat.isFile(), `not a file: ${file}`);
  return { path: file, bytes: stat.size, sha256: await hashFile(file) };
}
function gitBinding(file, bytes) {
  const relative = path.relative(repo, file);
  let headSha256 = null;
  try { headSha256 = sha256(git('show', `${report.gitHead}:${relative}`)); } catch {}
  return { gitPath: relative, headSha256, matchesGitHead: headSha256 === sha256(bytes) };
}
async function authenticateInputs() {
  const image = await fileBinding(imagePath);
  assert.equal(image.bytes, EXPECTED_IMAGE_BYTES, 'read-only desktop image size');
  assert.equal(image.sha256, EXPECTED_IMAGE_SHA256, 'read-only desktop image digest');
  const bytes = await fs.readFile(manifestPath);
  assert.equal(sha256(bytes), EXPECTED_MANIFEST_SHA256, 'desktop chunk manifest digest');
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.version, 1); assert.equal(manifest.layout, 'split');
  assert.equal(manifest.image_len, EXPECTED_IMAGE_BYTES); assert.equal(manifest.chunk_size, CHUNK_BYTES);
  assert.equal(manifest.chunks.length, 8192);
  const members = new Map();
  for (const [index, digest] of manifest.chunks.entries()) {
    assert.match(digest, /^[0-9a-f]{64}$/u, `chunk ${index} digest`);
    if (!members.has(digest)) members.set(digest, []);
    members.get(digest).push(index);
  }
  const kernel = await fileBinding(path.join(repo, KERNEL.url));
  assert.equal(kernel.bytes, KERNEL.size, 'kernel size'); assert.equal(kernel.sha256, KERNEL.sha256, 'kernel digest');
  const artifacts = JSON.parse(await fs.readFile(path.join(dist, 'artifacts-alpine.json')));
  assert.deepEqual(artifacts.artifacts.kernel, KERNEL, 'built artifact manifest names the bound kernel');
  report.image = { before: image, expectedSha256: EXPECTED_IMAGE_SHA256, expectedBytes: EXPECTED_IMAGE_BYTES };
  report.manifest = { path: manifestPath, bytes: bytes.length, sha256: sha256(bytes), version: 1,
    layout: 'split', chunkSize: CHUNK_BYTES, chunkCount: manifest.chunks.length, uniqueChunks: members.size };
  report.kernel = kernel;
  return { bytes, members };
}
async function startServer() {
  // Only tracked built files can be served. No source-tree fallback or directory listing.
  const files = git('ls-files', '-z', '--', 'web/dist').toString().split('\0').filter(Boolean);
  const routes = new Map(files.map((file) => [`/${file.slice('web/dist/'.length)}`, path.join(repo, file)]));
  const distReal = await fs.realpath(dist);
  const assetsReal = await fs.realpath(assets);
  const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
    '.json': 'application/json', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
  server = createServer(async (request, response) => {
    let urlPath = '';
    try {
      assert.equal(request.method, 'GET', 'server only accepts GET');
      urlPath = new URL(request.url, 'http://localhost').pathname;
      if (urlPath === '/favicon.ico') { response.writeHead(204).end(); return; }
      let file, bytes, kind, indices;
      if (urlPath === '/e5t18a-desktop/manifest.json') {
        file = manifestPath; kind = 'manifest'; bytes = await fs.readFile(file);
        assert.equal(sha256(bytes), EXPECTED_MANIFEST_SHA256, 'manifest changed while serving');
      } else if (urlPath.startsWith('/e5t18a-desktop/')) {
        const match = /^\/e5t18a-desktop\/chunks\/([0-9a-f]{64})\.bin$/u.exec(urlPath);
        assert.ok(match && publication.members.has(match[1]), 'chunk URL must belong to the authenticated manifest');
        file = path.join(assets, 'chunks', `${match[1]}.bin`); kind = 'chunk';
        assert.ok((await fs.realpath(file)).startsWith(assetsReal + path.sep), 'chunk symlink escaped asset store');
        bytes = await fs.readFile(file); indices = publication.members.get(match[1]);
        assert.equal(bytes.length, CHUNK_BYTES, 'chunk byte length');
        assert.equal(sha256(bytes), match[1], 'chunk content address');
      } else if (urlPath === `/${KERNEL.url}`) {
        file = path.join(repo, KERNEL.url); kind = 'artifact'; bytes = await fs.readFile(file);
        assert.equal(bytes.length, KERNEL.size, 'served kernel size'); assert.equal(sha256(bytes), KERNEL.sha256, 'served kernel digest');
      } else {
        file = routes.get(urlPath); kind = 'source';
        assert.ok(file, `unbound route ${urlPath}`);
        assert.ok((await fs.realpath(file)).startsWith(distReal + path.sep), 'built source symlink escaped dist');
        bytes = await fs.readFile(file);
      }
      // Chromium can report ERR_ABORTED after a fully consumed no-store Fetch stream.
      // The bound immutable kernel uses no-cache; the fresh context and CDP cache-disable
      // remain authoritative. See worker/kernel-network-diagnostic for full-byte controls.
      const cacheControl = urlPath === `/${KERNEL.url}` ? 'no-cache' : 'no-store';
      const digest = sha256(bytes), previous = served.get(urlPath);
      if (previous) assert.equal(previous.sha256, digest, `served file changed during boot: ${urlPath}`);
      else served.set(urlPath, { url: urlPath, path: file, kind, bytes: bytes.length, sha256: digest,
        requests: 0, cacheControl, ...(indices ? { manifestIndices: indices } : {}), ...(kind === 'source' ? gitBinding(file, bytes) : {}) });
      served.get(urlPath).requests += 1;
      record('served', { url: urlPath, kind, bytes: bytes.length, sha256: digest, cacheControl });
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
        'Content-Length': bytes.length, 'Cache-Control': cacheControl,
        'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }).end(bytes);
    } catch (error) {
      report.errors.server.push({ url: urlPath, message: error.message }); record('server-error', { url: urlPath, message: error.message });
      if (!response.headersSent) response.writeHead(404); response.end();
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${server.address().port}`;
}
function assertProof(proof) {
  assert.ok(proof && typeof proof === 'object', 'desktop proof is missing');
  assert.equal(proof.schema, 'wasm-vm.e5-t18a.desktop-cold-boot.v1'); assert.equal(proof.task, 'E5-T18a');
  assert.deepEqual({ wallpaper: proof.readiness?.wallpaper, panel: proof.readiness?.panel?.ready, menu: proof.readiness?.menu },
    { wallpaper: true, panel: true, menu: true }, 'wallpaper, panel and menu must coexist on the presented frame');
  assert.deepEqual(proof.canvas, { width: 1280, height: 800 }); assert.equal(proof.selectedBackend, 'canvas2d');
  assert.ok(proof.frameCount > 0, 'real scanout frames'); assert.equal(proof.paused, true, 'pause before readback');
  assert.ok(proof.fetchStats?.fetches > 0 && proof.fetchStats.bytes > 0, 'real image chunk fetches');
  assert.match(proof.stateDigest, /^[0-9a-f]{64}$/u, 'actual guest state digest');
  assert.equal(proof.image.expectedSha256, EXPECTED_IMAGE_SHA256); assert.equal(proof.image.manifestSha256, EXPECTED_MANIFEST_SHA256);
  assert.equal(proof.image.imageLen, EXPECTED_IMAGE_BYTES); assert.equal(proof.image.chunkSize, CHUNK_BYTES);
  assert.equal(proof.image.chunkCount, 8192); assert.equal(proof.image.layout, 'split');
  assert.deepEqual(proof.presentation?.errors, [], 'presentation errors');
  assert.ok(Number.isSafeInteger(proof.bootToDesktopMs) && proof.bootToDesktopMs > 0);
}
async function captureDiagnostics() {
  if (!page || page.isClosed()) return;
  report.diagnostics = await page.evaluate(() => ({
    status: document.getElementById('desktop-status')?.textContent,
    ready: document.documentElement.dataset.desktopReady,
    inspection: globalThis.__desktopLiveInspection?.() ?? null,
    proof: globalThis.__desktopProof?.() ?? null,
  })).catch((error) => ({ error: error.message }));
  const serial = await page.evaluate(() => globalThis.__scanoutDesktopSerial ?? null).catch(() => null);
  if (serial) {
    const bytes = Buffer.from(serial.text, 'utf8');
    await fs.writeFile(path.join(output, 'serial.log'), bytes);
    report.serial = { path: 'serial.log', bytes: bytes.length, sha256: sha256(bytes),
      outputMessages: serial.messages, overflow: serial.overflow, workerCount: serial.workers };
  }
  const name = report.status === 'passed' ? 'desktop.png' : 'failure.png';
  try {
    await page.screenshot({ path: path.join(output, name), fullPage: true, timeout: 15_000 });
    report.screenshot = { path: name, sha256: await hashFile(path.join(output, name)) };
  } catch (error) { report.screenshotError = error.message; }
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const scriptBefore = await fs.readFile(script);
  report.harness = { path: script, bytes: scriptBefore.length, sha256: sha256(scriptBefore), ...gitBinding(script, scriptBefore) };
  try {
    publication = await authenticateInputs();
    const base = await startServer();
    const { chromium } = await import(pathToFileURL(path.join(repo, 'web/node_modules/playwright/index.mjs')).href);
    const executablePath = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    browser = await chromium.launch({ executablePath, headless: false, args: [] });
    report.browser = { name: browser.browserType().name(), version: browser.version(), executablePath, headed: true, args: [] };
    const browserCdp = await browser.newBrowserCDPSession();
    report.browser.systemInfo = await browserCdp.send('SystemInfo.getInfo');
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    // Passive observation only: retain the same worker messages that the unchanged page receives.
    // The listener never transfers, modifies, acknowledges or injects a message.
    await context.addInitScript(() => {
      const state = { text: '', messages: 0, workers: 0, overflow: false };
      Object.defineProperty(globalThis, '__scanoutDesktopSerial', { value: state });
      const NativeWorker = globalThis.Worker;
      globalThis.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args); state.workers += 1;
          const decoder = new TextDecoder();
          this.addEventListener('message', ({ data }) => {
            if (data?.type !== 'output' || !(data.buffer instanceof ArrayBuffer)) return;
            state.messages += 1;
            if (state.text.length > 4 * 1024 * 1024) { state.overflow = true; return; }
            state.text += decoder.decode(new Uint8Array(data.buffer), { stream: true });
          });
        }
      };
    });
    page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    page.on('console', (message) => {
      const entry = { type: message.type(), text: message.text(), location: message.location() }; record('console', entry);
      if (message.type() === 'error') report.errors.console.push(entry);
    });
    page.on('pageerror', (error) => { report.errors.page.push(error.message); record('pageerror', error.message); });
    const requestIds = new WeakMap(), responses = new WeakMap(); let nextRequestId = 1;
    const requestMetadata = (request) => {
      if (!requestIds.has(request)) requestIds.set(request, `request-${nextRequestId++}`);
      return { requestId: requestIds.get(request), url: request.url(), method: request.method(),
        resourceType: request.resourceType(), isNavigationRequest: request.isNavigationRequest() };
    };
    page.on('request', (request) => record('request', { ...requestMetadata(request), headers: request.headers() }));
    page.on('requestfinished', (request) => record('requestfinished', { ...requestMetadata(request), timing: request.timing() }));
    page.on('requestfailed', (request) => {
      const entry = { ...requestMetadata(request), failure: request.failure()?.errorText,
        timing: request.timing(), response: responses.get(request) ?? null };
      report.errors.requests.push(entry); record('requestfailed', entry);
    });
    page.on('response', (response) => {
      const metadata = { status: response.status(), headers: response.headers() };
      responses.set(response.request(), metadata);
      record('response', { ...requestMetadata(response.request()), ...metadata });
      if (response.status() >= 400) report.errors.http.push({ url: response.url(), status: response.status() });
    });
    report.url = `${base}/desktop.html?e5T18a=1&jit=1&quantum=500000`;
    const started = Date.now();
    await page.goto(report.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => ['ready', 'error'].includes(document.documentElement.dataset.desktopReady), null, { timeout: timeoutMs });
    report.proof = await page.evaluate(() => globalThis.__desktopProof?.() ?? null);
    assertProof(report.proof);
    report.elapsedMs = Date.now() - started;
    report.canvas = await page.evaluate(async () => {
      const canvas = document.getElementById('desktop-canvas');
      const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const digest = await crypto.subtle.digest('SHA-256', rgba);
      return { width: canvas.width, height: canvas.height, format: 'RGBA8', bytes: rgba.byteLength,
        sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') };
    });
    assert.equal(report.canvas.bytes, 1280 * 800 * 4);
    report.proofExports = await page.evaluate(async () => {
      const module = await import('./pkg/wasm_vm_wasm.js');
      return Object.keys(module).filter((key) => /^WasmVirgl.*Proof$/u.test(key));
    });
    assert.deepEqual(report.proofExports, [], 'default build must omit all VirGL proof exports');
    report.browser.webgl = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return null;
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const info = { version: gl.getParameter(gl.VERSION), renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR) };
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return info;
    });
    assert.ok(report.browser.webgl, 'hardware WebGL2 browser context');
    assert.doesNotMatch(report.browser.webgl.renderer, /swiftshader|llvmpipe|softpipe|software|lavapipe/iu, 'software renderer is forbidden');
    assert.deepEqual(report.errors, { console: [], page: [], requests: [], http: [], server: [] }, 'zero browser/server errors');
    const wasm = served.get('/pkg/wasm_vm_wasm_bg.wasm');
    assert.ok(wasm && wasm.bytes > 0, 'served actual default Wasm');
    report.servedWasmSha256 = wasm.sha256;
    assert.ok([...served.values()].some((entry) => entry.kind === 'chunk'), 'served authenticated guest chunks');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1;
  } finally {
    await captureDiagnostics();
    if (report.status === 'passed') {
      try {
        assert.equal(report.serial?.overflow, false, 'complete serial transcript');
        assert.equal(report.serial.workerCount, 1, 'one guest worker');
        assert.ok(report.serial.outputMessages > 0, 'observed actual guest serial output');
        assert.equal(report.serial.bytes, report.proof.serialBytes, 'serial observer byte count');
        assert.equal(report.serial.sha256, report.proof.serialSha256, 'serial observer digest');
      } catch (error) { report.status = 'failed'; report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
    }
    await context?.close().catch(() => {}); await browser?.close().catch(() => {});
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    try {
      if (report.image) {
        report.image.after = await fileBinding(imagePath);
        report.image.unchanged = report.image.after.sha256 === report.image.before.sha256 && report.image.after.bytes === report.image.before.bytes;
        assert.equal(report.image.unchanged, true, 'read-only image changed during boot');
        const manifestAfter = await fileBinding(manifestPath);
        report.manifest.after = manifestAfter; assert.equal(manifestAfter.sha256, EXPECTED_MANIFEST_SHA256, 'manifest changed after boot');
      }
      for (const entry of served.values()) {
        const after = await fileBinding(entry.path);
        entry.unchanged = after.bytes === entry.bytes && after.sha256 === entry.sha256;
        assert.equal(entry.unchanged, true, `served file changed after boot: ${entry.url}`);
      }
      report.harness.unchanged = sha256(await fs.readFile(script)) === report.harness.sha256;
      assert.equal(report.harness.unchanged, true, 'harness changed during boot');
      report.gitHeadAfter = git('rev-parse', 'HEAD').toString().trim();
      assert.equal(report.gitHeadAfter, report.gitHead, 'git head changed during boot');
    } catch (error) {
      report.status = 'failed'; report.postRunFailure = { message: error.message, stack: error.stack }; process.exitCode = 1;
    }
    const transcriptBytes = Buffer.from(transcript.join('\n') + '\n');
    await fs.writeFile(path.join(output, 'browser.jsonl'), transcriptBytes);
    report.transcript = { path: 'browser.jsonl', bytes: transcriptBytes.length, sha256: sha256(transcriptBytes) };
    report.served = [...served.values()].sort((left, right) => left.url.localeCompare(right.url));
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  if (report.status !== 'passed') throw new Error(report.failure?.message ?? report.postRunFailure?.message ?? 'desktop proof failed');
  console.log(`E6-T11c desktop: one cold boot passed (${report.proof.bootToDesktopMs} ms), ${report.proof.frameCount} frames, canvas ${report.canvas.sha256}; zero errors.`);
}
await main();

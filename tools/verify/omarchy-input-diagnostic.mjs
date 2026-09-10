// Interactive real-guest diagnostics; not an acceptance substitute.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { chromium } from "../../web/node_modules/playwright/index.mjs";
import { physicalStroke } from "./omarchy-browser-session.mjs";

const repo = process.cwd();
const positional = [];
const options = {};
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) { positional.push(arg); continue; }
  const key = arg.slice(2).replaceAll("-", "");
  if (key === "checkonly") { options[key] = true; continue; }
  if (!["pairdirectory", "chunkmanifest", "chunkdir", "clickdelayms", "jitresidency"].includes(key)) {
    throw Error(`unknown diagnostic option: ${arg}`);
  }
  const value = process.argv[++i];
  if (!value || value.startsWith("--")) throw Error(`missing value for ${arg}`);
  options[key] = value;
}
const output = positional[0] ? path.resolve(positional[0]) : null;
const divider = positional[1] || "64";
if (!/^(1|2|4|8|16|32|64)$/u.test(divider)) throw Error("invalid diagnostic divider");
const jit = positional[2] || "1";
if (!/^[01]$/u.test(jit)) throw Error("invalid diagnostic JIT selector");
const jitResidency = options.jitresidency;
if (jitResidency !== undefined && !["repack-off", "cap-256"].includes(jitResidency)) {
  throw Error("invalid --jit-residency; expected repack-off or cap-256");
}
if (jitResidency !== undefined && positional[2] !== "1") {
  throw Error("--jit-residency requires the explicit diagnostic JIT selector 1");
}
if (!output && !options.checkonly) throw Error("diagnostic output directory is required");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const regularFile = async (filename, label) => {
  const info = await fs.stat(filename).catch(() => null);
  if (!info?.isFile()) throw Error(`${label} is not a regular file: ${filename}`);
  return filename;
};
const directory = async (filename, label) => {
  const info = await fs.stat(filename).catch(() => null);
  if (!info?.isDirectory()) throw Error(`${label} is not a directory: ${filename}`);
  return filename;
};

const candidateMode = Boolean(options.checkonly || options.pairdirectory || options.chunkmanifest || options.chunkdir);
let candidate = null;
if (candidateMode) {
  if (!options.checkonly && (!options.pairdirectory || !(options.chunkmanifest || options.chunkdir))) {
    throw Error("candidate mode requires --pair-directory and --chunk-manifest or --chunk-dir");
  }
  const pairDirectory = await directory(path.resolve(options.pairdirectory || "releases/boot-snapshot"), "candidate pair directory");
  let chunkManifest = path.resolve(options.chunkmanifest || (options.chunkdir
    ? path.join(options.chunkdir, "manifest.json") : "target/omarchy-profile-chunks-r2-256k/manifest.json"));
  const manifestInfo = await fs.stat(chunkManifest).catch(() => null);
  if (manifestInfo?.isDirectory()) chunkManifest = path.join(chunkManifest, "manifest.json");
  await regularFile(chunkManifest, "candidate chunk manifest");
  const chunkDir = path.resolve(options.chunkdir || path.dirname(chunkManifest));
  await directory(chunkDir, "candidate chunk directory");
  const nestedChunkDir = path.join(chunkDir, "chunks");
  const chunkFilesDir = (await fs.stat(nestedChunkDir).catch(() => null))?.isDirectory() ? nestedChunkDir : chunkDir;
  const manifestBytes = await fs.readFile(chunkManifest);
  let imageManifest;
  try { imageManifest = JSON.parse(manifestBytes); } catch (error) { throw Error(`invalid candidate chunk manifest: ${error}`); }
  if (!Array.isArray(imageManifest.chunks) || !imageManifest.chunks.length ||
      !imageManifest.chunks.every((name) => typeof name === "string" && /^[0-9a-f]{64}$/u.test(name))) {
    throw Error("candidate chunk manifest has no valid content-hash chunks");
  }
  const chunkNames = new Set(await fs.readdir(chunkFilesDir));
  const missing = imageManifest.chunks.find((name) => !chunkNames.has(`${name}.bin`));
  if (missing) throw Error(`candidate chunk is missing: ${path.join(chunkFilesDir, `${missing}.bin`)}`);
  const templatePath = path.join(repo, "web/artifacts-omarchy.json");
  const template = JSON.parse(await fs.readFile(templatePath, "utf8"));
  const kernelPath = path.resolve(repo, template.artifacts.kernel.url);
  const snapshotPath = path.join(pairDirectory, "omarchy-ready.snap.gz");
  const deltaPath = path.join(pairDirectory, "omarchy-overlay-delta.bin.gz");
  const sourceFiles = { kernel: kernelPath, bootSnapshot: snapshotPath, overlayDelta: deltaPath, chunkManifest };
  const source = {};
  for (const [name, filename] of Object.entries(sourceFiles)) {
    const bytes = await fs.readFile(await regularFile(filename, `candidate ${name}`));
    source[name] = { filename, size: bytes.length, sha256: hash(bytes) };
  }
  candidate = {
    pairDirectory, chunkDir: chunkFilesDir, chunkManifest, source,
    manifest: {
      generated: "LOCAL-ONLY diagnostic candidate (explicit real input pair; not a release claim)",
      artifacts: {
        kernel: { url: "/candidate/kernel", sha256: source.kernel.sha256, size: source.kernel.size },
        bootSnapshot: { url: "/candidate/boot-snapshot", sha256: source.bootSnapshot.sha256, size: source.bootSnapshot.size },
        overlayDelta: { url: "/candidate/overlay-delta", sha256: source.overlayDelta.sha256, size: source.overlayDelta.size },
      },
      chunkedImage: {
        key: `chunked-omarchy/manifest-${source.chunkManifest.sha256}.json`,
        sha256: source.chunkManifest.sha256,
        size: source.chunkManifest.size,
      },
    },
  };
}
if (options.checkonly) {
  console.log(JSON.stringify({
    result: "candidate-source-check-pass",
    label: candidate.manifest.generated,
    chunkManifestKey: candidate.manifest.chunkedImage.key,
    source: candidate.source,
  }));
  process.exit(0);
}
await fs.mkdir(output, { recursive: false });
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (candidate && pathname === "/artifacts-omarchy.json") {
    response.writeHead(200, { "Content-Type": "application/json", "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" });
    response.end(JSON.stringify(candidate.manifest)); return;
  }
  let filename;
  if (candidate && pathname === "/candidate/kernel") filename = candidate.source.kernel.filename;
  else if (candidate && pathname === "/candidate/boot-snapshot") filename = candidate.source.bootSnapshot.filename;
  else if (candidate && pathname === "/candidate/overlay-delta") filename = candidate.source.overlayDelta.filename;
  else if (candidate && pathname === `/${candidate.manifest.chunkedImage.key}`) filename = candidate.chunkManifest;
  else if (candidate && pathname.startsWith("/chunked-omarchy/")) {
    const relative = pathname.slice("/chunked-omarchy/".length);
    const name = relative.startsWith("chunks/") ? relative.slice("chunks/".length).replace(/\.bin$/u, "") : "";
    if (!/^[0-9a-f]{64}$/u.test(name)) { response.writeHead(404).end(); return; }
    filename = path.join(candidate.chunkDir, `${name}.bin`);
  } else {
    const root = pathname.startsWith("/releases/") ? repo : path.join(repo, "web/dist");
    filename = path.resolve(root, `.${pathname}`);
    if (!filename.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  }
  try {
    const bytes = await fs.readFile(filename);
    response.writeHead(200, { "Content-Type": filename.endsWith(".js") ? "text/javascript"
      : filename.endsWith(".json") ? "application/json" : filename.endsWith(".wasm") ? "application/wasm" : filename.endsWith(".html") ? "text/html" : "application/octet-stream",
      "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" });
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
const history = [];
const port = server.address().port;
const defaultClickDelay = options.clickdelayms === undefined ? undefined : Number(options.clickdelayms);
if (defaultClickDelay !== undefined && (!Number.isInteger(defaultClickDelay) || defaultClickDelay < 0)) throw Error("invalid --click-delay-ms");
const lines = createInterface({ input: process.stdin });
try {
  const assetOverride = candidate ? `&omarchyAssetBase=${encodeURIComponent(`http://127.0.0.1:${port}`)}` : "";
  const residencyOverride = jitResidency === undefined ? "" : `&jitResidency=${encodeURIComponent(jitResidency)}`;
  await page.goto(`http://127.0.0.1:${port}/app.html?guest=omarchy&desktop=1&omarchyDivider=${divider}&jit=${jit}${residencyOverride}${assetOverride}#ide`);
  await page.waitForFunction(() => window.wvmDemo?.isGuestReady?.(), null, { timeout: 120000 });
  const pageUrl = page.url();
  const sourceReceipt = candidate?.source ?? { kind: "web-dist", root: path.join(repo, "web/dist"), candidate: false };
  const sessionReceipt = { pageUrl, sourceReceipt, jitResidency: jitResidency ?? null };
  history.push({ time: new Date().toISOString(), event: "ready", ...sessionReceipt });
  await fs.writeFile(path.join(output, "diagnostic.json"), JSON.stringify(history, null, 2));
  console.log(JSON.stringify({ ready: "INPUT_DIAGNOSTIC_READY", mode: candidate ? "local-candidate-diagnostic" : "default", ...sessionReceipt }));
  for await (const line of lines) {
    try {
      const request = JSON.parse(line);
      let result;
      if (request.op === "quit") break;
      if (request.op === "exec") result = await page.evaluate((cmd) => window.wvmDemo.exec(cmd, 300000, { quiet: true }), request.command);
      if (request.op === "click") {
        const delay = request.delayMs ?? request.delay ?? defaultClickDelay;
        await page.locator("#ide-display-canvas").click({ position: { x: request.x, y: request.y }, timeout: 300000, ...(delay === undefined ? {} : { delay }) });
        result = { clicked: { x: request.x, y: request.y }, delayMs: delay ?? 0 };
      }
      if (request.op === "resize") {
        if (!Number.isInteger(request.width) || !Number.isInteger(request.height) || request.width < 1 || request.height < 1) throw Error("resize requires positive integer width and height");
        await page.setViewportSize({ width: request.width, height: request.height });
        await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height, { width: request.width, height: request.height });
        result = { viewport: page.viewportSize(), nativeResize: true };
      }
      if (request.op === "type") {
        for (const character of request.text) {
          const { code, shift } = physicalStroke(character);
          if (shift) await page.keyboard.down("ShiftLeft");
          await page.keyboard.press(code, { delay: request.delay || 100 });
          if (shift) await page.keyboard.up("ShiftLeft");
        }
        if (request.enter) await page.keyboard.press("Enter");
      }
      if (request.op === "stats") result = await page.evaluate(async () => ({
        focus: document.activeElement?.id, keyboard: window.__keyboardCapture?.stats(),
        keyboardFrames: window.__keyboardCapture?.frames(), keyboardDiagnostics: window.__keyboardCapture?.diagnostics(),
        pointerFrames: window.__pointer?.frames(), pointerDiagnostics: window.__pointer?.diagnostics(),
        cursor: window.__cursor?.state(), rpc: await window.__workerRpcStats?.(),
        display: window.__presentation?.state(),
        clock: await window.__linuxCtl?.guestClockState?.(), scheduler: await window.__schedulerStats?.(), jit: await window.__jitStats?.(),
      }));
      if (request.op === "screenshot") {
        if (!/^[a-z0-9-]+\.png$/u.test(request.name)) throw Error("invalid screenshot name");
        await page.screenshot({ path: path.join(output, request.name) });
        result = path.join(output, request.name);
      }
      const entry = { time: new Date().toISOString(), ...sessionReceipt, request, result: result ?? "sent" };
      history.push(entry);
      await fs.writeFile(path.join(output, "diagnostic.json"), JSON.stringify(history, null, 2));
      console.log(JSON.stringify(entry));
    } catch (error) { console.error(String(error)); }
  }
} finally {
  lines.close(); await browser.close(); server.close();
}

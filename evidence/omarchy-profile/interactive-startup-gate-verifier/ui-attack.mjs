import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "../../../web/node_modules/playwright/index.mjs";

const repo = path.resolve(import.meta.dirname, "../../..");
const out = import.meta.dirname;
const root = path.join(repo, "web/dist");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const records = [];
const served = new Map();
const note = (phase, value) => {
  records.push({ phase, ...value });
  console.log(JSON.stringify(records.at(-1)));
};
await mkdir(out, { recursive: true });
const source = await Promise.all([
  "web/ide.js", "web/dist/ide.js", "web/main.js", "web/dist/main.js",
  "web/omarchy-startup-state.js", "web/dist/omarchy-startup-state.js",
].map(async (filename) => {
  const bytes = await readFile(path.join(repo, filename));
  return { path: filename, size: bytes.length, sha256: hash(bytes) };
}));
note("source", {
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  scopeStatus: execFileSync("git", ["status", "--short", "--", "web/ide.js", "web/dist/ide.js", "web/main.js", "web/dist/main.js", "web/omarchy-startup-state.js"], { cwd: repo, encoding: "utf8" }),
  files: source,
  kind: "real-built-IDE-lifecycle-fixture; lifecycle dispatch is synthetic; no guest or nonce synthesized",
});
assert.equal(source[0].sha256, source[1].sha256);
assert.equal(source[2].sha256, source[3].sha256);
assert.equal(source[4].sha256, source[5].sha256);
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  if (pathname === "/lifecycle.html") {
    const bytes = Buffer.from('<!doctype html><html><head><style>body { margin: 0; }</style></head><body><section id="panel-ide" class="active"><div id="ide-root"></div></section><script type="module" src="/ide.js"></script></body></html>');
    served.set(pathname, { path: "verifier-owned-lifecycle-fixture", size: bytes.length, sha256: hash(bytes) });
    response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
    response.end(bytes); return;
  }
  const file = pathname === "/artifacts-alpine.json"
    ? path.join(repo, "web/artifacts-alpine.json") : path.resolve(root, `.${pathname}`);
  if (pathname !== "/artifacts-alpine.json" && !file.startsWith(`${root}/`)) {
    response.writeHead(404).end(); return;
  }
  try {
    const bytes = await readFile(file);
    served.set(pathname, { path: path.relative(repo, file), size: bytes.length, sha256: hash(bytes) });
    const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".css": "text/css" };
    response.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store",
      "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" });
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const errors = [];
const httpErrors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => {
    if (message.type() === "error" && !message.location().url?.endsWith("/favicon.ico")) errors.push(message.text());
  });
  page.on("response", response => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) httpErrors.push({ url: response.url(), status: response.status() });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/lifecycle.html?guest=omarchy&desktop=1`);
  await page.waitForFunction(() => document.documentElement.dataset.wvmDesktop === "omarchy" && document.getElementById("ide-display-canvas")?.getBoundingClientRect().width > 0);
  await page.evaluate(() => {
    window.__verifierEvents = [];
    window.__verifierDesktopReady = 0;
    window.addEventListener("wvm:desktop-ready", () => window.__verifierDesktopReady += 1);
    for (const type of ["pointerdown", "pointerup", "click", "keydown", "keyup"]) {
      document.addEventListener(type, event => window.__verifierEvents.push({
        type, trusted: event.isTrusted, target: event.target?.id || event.target?.className,
        overlay: Boolean(event.target?.closest?.("#omarchy-boot-overlay")), key: event.key || null,
      }), true);
    }
  });
  const dispatch = (type, detail) => page.evaluate(({ type, detail }) => window.dispatchEvent(new CustomEvent(type, { detail })), { type, detail });
  const state = () => page.evaluate(() => {
    const overlay = document.getElementById("omarchy-boot-overlay");
    const canvas = document.getElementById("ide-display-canvas");
    const card = overlay.querySelector(".omarchy-boot-card");
    const rect = element => {
      const { x, y, width, height, top, right, bottom, left } = element.getBoundingClientRect();
      return { x, y, width, height, top, right, bottom, left };
    };
    const cr = rect(canvas), sr = rect(overlay);
    const centre = { x: cr.x + cr.width / 2, y: cr.y + cr.height / 2 };
    const hit = point => {
      const el = document.elementFromPoint(point.x, point.y);
      return { ...point, target: el?.id || el?.className, tag: el?.tagName, overlay: Boolean(el?.closest("#omarchy-boot-overlay")), toolbar: Boolean(el?.closest("#omarchy-desktop-toolbar")) };
    };
    const stripHits = [];
    if (!overlay.hidden) for (const dx of [1, sr.width / 2, sr.width - 1]) {
      for (const dy of [1, sr.height / 2, sr.height - 1]) stripHits.push(hit({ x: sr.x + dx, y: sr.y + dy }));
    }
    return {
      status: document.getElementById("omarchy-boot-status").textContent,
      desktop: document.getElementById("omarchy-desktop-status").textContent,
      toolbarState: document.getElementById("omarchy-desktop-toolbar").dataset.state,
      overlayHidden: overlay.hidden, overlayInteractive: overlay.dataset.interactive || null,
      overlayDisplay: getComputedStyle(overlay).display,
      overlayPointerEvents: getComputedStyle(overlay).pointerEvents,
      cardPointerEvents: getComputedStyle(card).pointerEvents,
      controlsDisplay: Object.fromEntries(["h1", ".omarchy-boot-progress", ".omarchy-boot-actions", ".omarchy-boot-log"].map(selector => [selector, getComputedStyle(overlay.querySelector(selector)).display])),
      overlayRect: sr, canvasRect: cr, centre: hit(centre), stripHits,
      focus: document.activeElement?.id, canvasTabIndex: canvas.tabIndex,
      desktopReadyEvents: window.__verifierDesktopReady, events: window.__verifierEvents,
    };
  });
  await dispatch("wvm:guest-booting");
  note("booting", await state());
  assert.equal(records.at(-1).overlayPointerEvents, "auto");
  assert.equal(records.at(-1).centre.overlay, true);
  await dispatch("wvm:guest-ready");
  note("interactive", await state());
  const interactive = records.at(-1);
  assert.equal(interactive.overlayHidden, false);
  assert.equal(interactive.overlayInteractive, "true");
  assert.equal(interactive.overlayPointerEvents, "none");
  assert.equal(interactive.cardPointerEvents, "none");
  assert.equal(interactive.centre.target, "ide-display-canvas");
  assert.equal(interactive.focus, "ide-display-canvas");
  assert.equal(interactive.canvasTabIndex, 0);
  assert.equal(interactive.toolbarState, "booting");
  assert.equal(interactive.desktopReadyEvents, 0);
  assert.ok(interactive.overlayRect.height < interactive.canvasRect.height / 4);
  assert.ok(Object.values(interactive.controlsDisplay).every(value => value === "none"));
  assert.ok(interactive.stripHits.every(value => !value.overlay));
  const stripCanvasPoint = interactive.stripHits.find(value => value.target === "ide-display-canvas");
  assert.ok(stripCanvasPoint, "no strip-covered canvas point survives computed hit-testing");
  await page.mouse.click(stripCanvasPoint.x, stripCanvasPoint.y);
  await page.keyboard.press("a");
  note("trusted-strip-click-and-key", await state());
  const input = records.at(-1).events;
  assert.ok(input.some(event => event.type === "pointerdown" && event.trusted && event.target === "ide-display-canvas" && !event.overlay));
  assert.ok(input.some(event => event.type === "pointerup" && event.trusted && event.target === "ide-display-canvas" && !event.overlay));
  assert.ok(input.some(event => event.type === "click" && event.trusted && event.target === "ide-display-canvas" && !event.overlay));
  assert.ok(input.some(event => event.type === "keydown" && event.trusted && event.target === "ide-display-canvas" && event.key === "a"));
  const screenshot = await page.screenshot({ path: path.join(out, "interactive-hit-target.png") });
  note("interactive-screenshot", { path: "interactive-hit-target.png", sha256: hash(screenshot) });

  for (const terminal of [
    { name: "error", type: "wvm:guest-error", detail: { message: "verifier error" } },
    { name: "halted", type: "wvm:guest-halted", detail: { message: "verifier halt" } },
    { name: "done", type: "wvm:guest-state", detail: { state: "done" } },
  ]) {
    await dispatch(terminal.type, terminal.detail);
    note(terminal.name, await state());
    const blocked = records.at(-1);
    assert.equal(blocked.overlayHidden, false);
    assert.equal(blocked.overlayInteractive, null);
    assert.equal(blocked.overlayPointerEvents, "auto");
    assert.equal(blocked.centre.overlay, true);
    const beforeInput = blocked.events.length;
    await page.mouse.click(blocked.centre.x, blocked.centre.y);
    note(`${terminal.name}-overlay-click`, await state());
    const events = records.at(-1).events.slice(beforeInput);
    assert.ok(events.some(event => event.type === "pointerdown" && event.trusted && event.overlay));
    assert.ok(events.every(event => event.target !== "ide-display-canvas"));
    await dispatch("wvm:guest-ready");
    await dispatch("wvm:desktop-ready");
    note(`${terminal.name}-late-ready`, await state());
    assert.equal(records.at(-1).status, blocked.status);
    assert.equal(records.at(-1).desktop, blocked.desktop);
    assert.equal(records.at(-1).overlayHidden, false);
    assert.equal(records.at(-1).overlayInteractive, null);
    assert.equal(records.at(-1).centre.overlay, true);
    await dispatch("wvm:guest-booting");
    note(`${terminal.name}-new-boot`, await state());
    assert.equal(records.at(-1).overlayPointerEvents, "auto");
    assert.equal(records.at(-1).overlayInteractive, null);
    assert.equal(records.at(-1).centre.overlay, true);
    await dispatch("wvm:guest-ready");
    if (terminal.name === "halted") {
      await dispatch("wvm:desktop-ready");
      note("desktop-ready-before-late-done", await state());
      assert.equal(records.at(-1).overlayHidden, true);
      assert.equal(records.at(-1).overlayInteractive, null);
      assert.equal(records.at(-1).desktop, "desktop visible · input is slow");
      assert.equal(records.at(-1).toolbarState, "ready");
    }
  }
  await dispatch("wvm:desktop-ready");
  note("desktop-ready", await state());
  assert.equal(records.at(-1).overlayHidden, true);
  assert.equal(records.at(-1).overlayInteractive, null);
  assert.equal(records.at(-1).desktop, "desktop visible · input is slow");
  assert.equal(records.at(-1).toolbarState, "ready");
  assert.deepEqual(errors, []);
  assert.deepEqual(httpErrors, []);
  note("result", { verdict: "HELD", browser: browser.version(), errors, httpErrors, resources: [...served.entries()].map(([url, value]) => ({ url, ...value })) });
} catch (error) {
  note("result", { verdict: "FAILED", error: String(error), stack: error.stack, errors, httpErrors });
  process.exitCode = 1;
} finally {
  await writeFile(path.join(out, "ui-attack.ndjson"), records.map(value => JSON.stringify(value)).join("\n") + "\n");
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

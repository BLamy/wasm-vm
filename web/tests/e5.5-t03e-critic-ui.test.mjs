import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";

import { chromium } from "../node_modules/playwright/index.mjs";

const webRoot = path.resolve(import.meta.dirname, "..");

test("critic: real IDE listeners keep startup phases and terminal readiness sticky", async (t) => {
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
      response.end('<!doctype html><html><head></head><body><section id="panel-ide" class="active"><div id="ide-root"></div></section><script type="module" src="/ide.js"></script></body></html>');
      return;
    }
    const allowed = new Map([
      ["/ide.js", "ide.js"],
      ["/omarchy-startup-state.js", "omarchy-startup-state.js"],
    ]);
    const relative = allowed.get(url.pathname);
    if (!relative) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
    createReadStream(path.join(webRoot, relative)).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const browser = await chromium.launch({
    headless: true,
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/?desktop=1&guest=omarchy`);
  await page.waitForFunction(() => document.documentElement.dataset.wvmDesktop === "omarchy");

  const dispatch = (type, detail) => page.evaluate(({ type, detail }) => {
    window.dispatchEvent(new CustomEvent(type, { detail }));
  }, { type, detail });
  const state = () => page.evaluate(() => ({
    status: document.querySelector("#omarchy-boot-status")?.textContent,
    desktop: document.querySelector("#omarchy-desktop-status")?.textContent,
    overlayHidden: document.querySelector("#omarchy-boot-overlay")?.hidden,
    progressHidden: document.querySelector("#omarchy-boot-progress")?.hidden,
    progressValue: document.querySelector("#omarchy-boot-progress")?.value,
    progressMax: document.querySelector("#omarchy-boot-progress")?.max,
    log: document.querySelector("#omarchy-boot-log")?.textContent,
  }));

  await dispatch("wvm:guest-booting");
  await dispatch("wvm:guest-progress", {
    phase: "bootSnapshot: downloading",
    loaded: 50,
    total: 100,
  });
  const downloading = await state();
  assert.equal(downloading.status, "Downloading boot snapshot… · 50 B / 100 B");
  assert.equal(downloading.progressHidden, false);
  assert.equal(downloading.progressValue, 50);
  assert.equal(downloading.progressMax, 100);

  await dispatch("wvm:guest-output", { text: "generic serial noise\n" });
  assert.equal((await state()).status, downloading.status, "serial output replaced transfer phase");

  await dispatch("wvm:guest-state", { state: "restoring" });
  const restoring = await state();
  assert.equal(restoring.status, "Restoring Omarchy desktop…");
  assert.equal(restoring.progressHidden, true);
  assert.equal(restoring.progressValue, 0);
  assert.equal(restoring.progressMax, 1);

  await dispatch("wvm:guest-progress", {
    phase: "bootSnapshot: unpacking",
    loaded: null,
    total: null,
  });
  assert.equal((await state()).progressHidden, true);
  await dispatch("wvm:guest-state", { state: "restored" });
  await dispatch("wvm:desktop-ready");
  const ready = await state();
  assert.equal(ready.status, "Desktop restored; waiting for guest response…");
  assert.equal(ready.desktop, "desktop visible · input is slow");
  assert.equal(ready.overlayHidden, true);
  assert.equal(ready.progressHidden, true);

  await dispatch("wvm:guest-progress", { phase: "kernel: downloading", loaded: 100, total: 100 });
  await dispatch("wvm:guest-state", { state: "fetching" });
  await dispatch("wvm:guest-ready");
  await dispatch("wvm:guest-output", { text: "late serial noise\n" });
  const afterLateEvents = await state();
  assert.equal(afterLateEvents.status, ready.status);
  assert.equal(afterLateEvents.desktop, ready.desktop);
  assert.equal(afterLateEvents.overlayHidden, true);
  assert.equal(afterLateEvents.progressHidden, true);
  assert.match(afterLateEvents.log, /late serial noise/);

  // A terminal state after a visible desktop must revoke visible readiness and reject every
  // non-boot event that could otherwise resurrect progress/readiness UI.
  await dispatch("wvm:guest-state", { state: "done" });
  const done = await state();
  assert.equal(done.status, "Guest finished; desktop readiness is not confirmed.");
  assert.equal(done.desktop, "desktop · Guest finished; desktop readiness is not confirmed.");
  assert.equal(done.overlayHidden, false);
  assert.equal(done.progressHidden, true);
  for (const [type, detail] of [
    ["wvm:desktop-ready", undefined],
    ["wvm:guest-ready", undefined],
    ["wvm:guest-progress", { phase: "kernel: downloading", loaded: 100, total: 100 }],
    ["wvm:guest-state", { state: "restoring" }],
  ]) await dispatch(type, detail);
  assert.deepEqual(await state(), done, "late event changed terminal done UI");

  await dispatch("wvm:guest-booting");
  const rebooting = await state();
  assert.equal(rebooting.status, "Booting Omarchy…");
  assert.equal(rebooting.overlayHidden, false);
  assert.equal(rebooting.progressHidden, true);
  await dispatch("wvm:guest-progress", { phase: "kernel: downloading", loaded: 25, total: 100 });
  assert.equal((await state()).progressHidden, false, "new boot did not clear done latch");

  for (const terminal of [
    { type: "wvm:guest-error", detail: { message: "critic error" }, status: "Boot error: critic error" },
    { type: "wvm:guest-halted", detail: { message: "critic halt" }, status: "Guest halted: critic halt" },
  ]) {
    await dispatch(terminal.type, terminal.detail);
    const terminalState = await state();
    assert.equal(terminalState.status, terminal.status);
    assert.equal(terminalState.overlayHidden, false);
    assert.equal(terminalState.progressHidden, true);
    assert.equal(terminalState.progressValue, 0);
    assert.equal(terminalState.progressMax, 1);
    for (const [type, detail] of [
      ["wvm:guest-ready", undefined],
      ["wvm:desktop-ready", undefined],
      ["wvm:guest-progress", { phase: "kernel: reading cache", loaded: 100, total: 100 }],
      ["wvm:guest-state", { state: "restored" }],
    ]) await dispatch(type, detail);
    assert.deepEqual(await state(), terminalState, `late event changed terminal ${terminal.type} UI`);

    await dispatch("wvm:guest-booting");
    await dispatch("wvm:guest-progress", { phase: "kernel: downloading", loaded: 25, total: 100 });
    const afterReset = await state();
    assert.equal(afterReset.status, "Downloading kernel… · 25 B / 100 B");
    assert.equal(afterReset.progressHidden, false, `new boot did not clear ${terminal.type} latch`);
  }
  assert.deepEqual(errors, []);
});

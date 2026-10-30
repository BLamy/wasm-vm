// E0-T29 on the PR 626 stack: recordings/time travel, saved sessions and self-checks as optional
// library panes over the native E9 controllers, the warm header, and the carried phone
// terminal-focus criterion. Everything below drives the real engine; no recording is faked.
// Run with PW_DISABLE_TS_ESM=1 (tools/verify-ui-workspace.sh): the pinned Playwright 1.49.1
// deadlocks in its TS ESM loader under Node 24; this spec is plain JS.
import { expect as baseExpect, test } from "@playwright/test";

test.setTimeout(180_000);
const expect = baseExpect.configure({ timeout: 10_000 });
const BOOT_MS = 120_000;

function watch(page) {
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`http ${r.status()}: ${r.url()}`);
  });
  return errors;
}

const termRows = (page) => page.locator("#term .xterm-rows").evaluate((el) => [...el.children].map((r) => r.textContent.trimEnd()));
const timeline = (page, key) => page.locator(`#session-timeline [data-timeline="${key}"]`);
const session = (page, key) => page.locator(`#session-library [data-session="${key}"]`);

async function startLinux(page, { tap = false } = {}) {
  const start = page.locator('[data-wv="start-linux"]');
  if (tap) await start.tap(); else await start.click();
  await page.waitForFunction(() => window.wvmDemo?.isGuestReady?.(), null, { timeout: BOOT_MS });
  // ide.js's startup /root listing (a quiet fenced RPC on the same serial path) has finished.
  await page.waitForFunction(() => !document.querySelector("#ide-explorer .ide-spin")
    && Boolean(document.querySelector("#ide-explorer .ide-node, #ide-explorer .ide-explorer-ph")), null, { timeout: 30_000 });
}

// Choose an option in a library Picker by its label.
async function pick(scope, label, optionText) {
  await scope.getByRole("button", { name: new RegExp(`${label}$`) }).click();
  await scope.page().getByRole("option", { name: optionText, exact: true }).click();
}

// Carried from the E0-T28 latest-source review (target/ui-verifier/foundation-626/): after
// keyboard navigation to Case studies on a phone, an ordinary tap on the terminal must give typing
// back to the same guest. No wvmDemo.focusTerminal(), locator.focus() or injected guest input.
test("phone 390: after keyboard Case studies, an ordinary terminal tap types into the same guest", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    const errors = watch(page);
    await page.goto("/index.html?nosw#ide");
    await startLinux(page, { tap: true });
    await page.locator("#term").tap();
    await expect(page.locator("#term textarea.xterm-helper-textarea")).toBeFocused();
    await page.keyboard.type("printf 'tap-%s-%s\\n' kept 626 > /tmp/ui-tap-626.txt; printf 'made-%s\\n' 626\n", { delay: 12 });
    await expect.poll(() => termRows(page), { timeout: 15_000 }).toContain("made-626");
    const before = await page.evaluate(() => {
      window.__wvTapBefore = { controller: window.__linuxCtl, ide: document.getElementById("ide-root") };
      return { url: location.href, session: window.wvmDemo.guestSession() };
    });

    const menu = page.getByRole("button", { name: "Open menu", exact: true });
    await menu.tap();
    const sheet = page.getByRole("dialog", { name: "Site menu" });
    const studies = sheet.getByRole("link", { name: "Case studies", exact: true });
    await expect(studies).toHaveAttribute("target", "_blank");
    // Keyboard activation: Tab through the sheet to the link, then Enter.
    for (let i = 0; i < 12 && !(await studies.evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press("Tab");
    await expect(studies).toBeFocused();
    const [popup] = await Promise.all([context.waitForEvent("page"), page.keyboard.press("Enter")]);
    await popup.waitForLoadState("domcontentloaded");
    await expect(popup).toHaveURL(/\/case-studies\.html$/);
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await popup.close();
    await page.bringToFront();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(menu).toBeFocused();

    // The ordinary tap is the whole return path.
    await page.locator("#term").tap();
    await expect(page.locator("#term textarea.xterm-helper-textarea")).toBeFocused();
    await page.keyboard.type("cat /tmp/ui-tap-626.txt\n", { delay: 12 });
    await expect.poll(() => termRows(page), { timeout: 15_000 }).toContain("tap-kept-626");
    const after = await page.evaluate(() => ({
      url: location.href,
      session: window.wvmDemo.guestSession(),
      sameController: window.__wvTapBefore.controller === window.__linuxCtl,
      sameIde: window.__wvTapBefore.ide === document.getElementById("ide-root"),
    }));
    expect(after).toEqual({ ...before, sameController: true, sameIde: true });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("first view: recordings and self-checks are optional, closed and owned by the native panels", async ({ page }) => {
  const errors = watch(page);
  await page.goto("/index.html?nosw#ide");
  await expect(page.locator("html")).toHaveAttribute("data-launcher-ready", "true");
  // No recording/configuration wall: every native E9 panel is in the DOM but not shown.
  const panels = page.locator("#panel-ide > details.session-library");
  expect(await panels.count()).toBe(16);
  for (const id of await panels.evaluateAll((els) => els.map((el) => el.id))) await expect(page.locator(`#${id}`)).toBeHidden();
  await expect(page.locator('[data-wv="recordings"]')).toHaveCount(0);
  await expect(page.locator('[data-wv="checks"]')).toHaveCount(0);

  // Before any guest: the launcher's closed section opens the same library pane.
  const refresh = timeline(page, "refresh");
  await expect(refresh).toBeEnabled({ timeout: 20_000 });
  await page.evaluate(() => {
    window.__wvRefreshClicks = 0;
    document.querySelector('#session-timeline [data-timeline="refresh"]').addEventListener("click", () => { window.__wvRefreshClicks += 1; });
  });
  await page.getByRole("button", { name: "Recordings and time travel" }).click();
  const pane = page.locator('[data-wv="recordings"]');
  await pane.getByRole("button", { name: "Refresh history", exact: true }).click();
  expect(await page.evaluate(() => window.__wvRefreshClicks)).toBe(1);
  await expect(pane.locator('[role="status"]').first()).toHaveText((await timeline(page, "status").textContent()).trim());
  expect(errors).toEqual([]);
});

test("Recordings: a real Linux sample records, opens and moves through library controls", async ({ page }) => {
  const errors = watch(page);
  await page.goto("/index.html?nosw#ide");
  await startLinux(page);
  await page.getByRole("button", { name: "Recordings", exact: true }).click();
  const pane = page.locator('[data-wv="recordings"]');
  await expect(pane).toBeVisible();

  // The timeline's real GPU frame node is shown in the pane while it is open.
  await expect(page.locator(".wv-rec-frame > [data-timeline-gpu-frame]")).toHaveCount(1);

  // Disabled states follow the controller.
  const open = pane.getByRole("button", { name: "Open replay", exact: true });
  const stop = pane.getByRole("button", { name: "Stop recording", exact: true });
  await expect(stop).toBeDisabled();
  expect(await timeline(page, "stop").isDisabled()).toBe(true);

  // Record a real sample on a private machine.
  await pane.getByRole("button", { name: "Record Linux sample", exact: true }).click();
  await expect.poll(() => timeline(page, "sessions").locator("option").count(), { timeout: 120_000 }).toBeGreaterThan(0);
  await expect(timeline(page, "record")).toBeEnabled({ timeout: 120_000 });
  const [value, label] = await timeline(page, "sessions").evaluate((s) => [s.options[0].value, s.options[0].textContent.trim()]);
  await pick(pane, "Saved recording", label);
  await expect(timeline(page, "sessions")).toHaveValue(value);
  await expect(open).toBeEnabled();
  await open.click();
  await expect(timeline(page, "active")).toContainText(value, { timeout: 60_000 });
  await expect(pane.locator('[data-wv="replay-navigation"]')).toBeVisible();
  const position = () => timeline(page, "position").textContent();
  await expect(pane.locator('[data-wv="replay-position"]')).toContainText(await position());

  // Exact transition: the native field receives the typed decimal string; Enter seeks.
  const target = pane.getByRole("textbox", { name: "Exact transition" });
  await target.fill("123");
  await expect(timeline(page, "target")).toHaveValue("123");
  await target.press("Enter");
  await expect.poll(position, { timeout: 60_000 }).toMatch(/^transition 123 /);
  // 2^64 is out of range: the 20-digit string reaches the controller unchanged and is refused.
  await target.fill("18446744073709551616");
  await expect(timeline(page, "target")).toHaveValue("18446744073709551616");
  const atRefusal = await position();
  await pane.getByRole("button", { name: "Seek transition", exact: true }).click();
  await expect.poll(() => timeline(page, "status").textContent(), { timeout: 30_000 }).not.toMatch(/^Seeking/);
  expect(await position()).toBe(atRefusal);

  // Step and keyframe navigation through library controls.
  const beforeStep = await position();
  await pane.getByRole("button", { name: "Step forward", exact: true }).click();
  await expect.poll(position, { timeout: 60_000 }).not.toBe(beforeStep);
  const keyframe = await timeline(page, "points").evaluate((s) => [s.options[1].value, s.options[1].textContent.trim()]);
  await pick(pane, "Saved keyframe", keyframe[1]);
  await expect(timeline(page, "points")).toHaveValue(keyframe[0]);
  const beforeKeyframe = await position();
  await pane.getByRole("button", { name: "Go to keyframe", exact: true }).click();
  await expect.poll(position, { timeout: 60_000 }).not.toBe(beforeKeyframe);

  // The scrubber: keyboard moves the native range (input), release seeks (change).
  const scrubBefore = await timeline(page, "scrub").inputValue();
  await pane.getByRole("slider", { name: "Scrub saved history" }).focus();
  await page.keyboard.press("End");
  await expect.poll(() => timeline(page, "scrub").inputValue()).not.toBe(scrubBefore);
  await expect.poll(() => timeline(page, "target").inputValue()).toMatch(/^\d{1,20}$/);

  // Console and readouts are the controller's own text.
  await expect.poll(async () => (await pane.locator('[data-wv="replay-console"]').textContent()) === (await timeline(page, "console").textContent())).toBe(true);

  // Closing the pane puts the GPU frame node back where the controller created it.
  await page.getByRole("button", { name: "Recordings", exact: true }).click();
  await expect(pane).toHaveCount(0);
  expect(await page.evaluate(() => {
    const frame = document.querySelector("[data-timeline-gpu-frame]");
    return frame?.parentElement?.id === "session-timeline" && frame.nextElementSibling?.dataset.timeline === "console";
  })).toBe(true);
  expect(errors).toEqual([]);
});

test("Recordings: continue from here, then export and import the recording in a fresh browser", async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const fresh = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    const errors = watch(page);
    await page.goto("/index.html?nosw#ide");
    await startLinux(page);
    await page.getByRole("button", { name: "Recordings", exact: true }).click();
    const pane = page.locator('[data-wv="recordings"]');
    await pane.getByRole("button", { name: "Record Linux sample", exact: true }).click();
    await expect.poll(() => timeline(page, "sessions").locator("option").count(), { timeout: 120_000 }).toBeGreaterThan(0);
    await expect(timeline(page, "record")).toBeEnabled({ timeout: 120_000 });
    const id = await timeline(page, "sessions").inputValue();
    await pane.getByRole("button", { name: "Open replay", exact: true }).click();
    await expect(timeline(page, "active")).toContainText(id, { timeout: 60_000 });

    // Continue from here: the controller's continuation controls appear in the pane; discard ends it.
    await pane.getByRole("button", { name: "Continue from here", exact: true }).click();
    const branch = pane.locator('[data-wv="replay-branch"]');
    await expect(branch.getByRole("button", { name: "Run continuation", exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(branch.getByRole("textbox", { name: "Serial input" })).toBeVisible();
    await expect(branch).toContainText((await timeline(page, "branch-origin").textContent()).trim());
    await expect(timeline(page, "status")).toContainText("Continuation paused", { timeout: 90_000 });
    await branch.getByRole("button", { name: /^(Discard unsaved continuation|Cancel continuation)$/ }).click();
    await expect(timeline(page, "status")).toContainText("discarded", { timeout: 30_000 });
    await expect(branch.getByRole("button", { name: "Run continuation" })).toHaveCount(0);

    // Export: a local file download, nothing uploaded.
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), pane.getByRole("button", { name: "Export recording", exact: true }).click()]);
    const file = test.info().outputPath("recording.wvsession");
    await download.saveAs(file);
    expect(download.suggestedFilename()).toBe(`wasm-vm-session-${id}.wvsession`);
    await expect(timeline(page, "status")).toContainText("No data was uploaded");
    expect(errors).toEqual([]);

    // Import in a separate browser profile, through the library button and the native file input.
    const other = await fresh.newPage();
    const otherErrors = watch(other);
    await other.goto("/index.html?nosw#ide");
    await other.getByRole("button", { name: "Recordings and time travel" }).click();
    const otherPane = other.locator('[data-wv="recordings"]');
    const importButton = otherPane.getByRole("button", { name: "Import recording file", exact: true });
    await expect(importButton).toBeEnabled({ timeout: 30_000 });
    const [chooser] = await Promise.all([other.waitForEvent("filechooser"), importButton.click()]);
    expect(await chooser.element().evaluate((el) => el.dataset.timeline)).toBe("bundle-file");
    await chooser.setFiles(file);
    await expect.poll(() => timeline(other, "sessions").evaluate((s) => [...s.options].map((o) => o.value)), { timeout: 90_000 }).toContain(id);
    await expect(timeline(other, "bundle-details")).toContainText("Imported manifest");
    expect(otherErrors).toEqual([]);
  } finally {
    await fresh.close();
    await context.close();
  }
});

test("Checkpoints: a real checkpoint session is saved and renamed through the library form", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watch(page);
  await page.goto("/index.html?nosw#ide");
  await startLinux(page);
  await page.getByRole("button", { name: "Recordings", exact: true }).click();
  const pane = page.locator('[data-wv="recordings"]');
  await pane.getByRole("radiogroup", { name: "Recordings view" }).getByText("Checkpoints").click();
  await pane.getByRole("button", { name: "New checkpoint guest", exact: true }).click();
  await expect(pane.getByRole("button", { name: "Start checkpoint recording", exact: true })).toBeEnabled({ timeout: 120_000 });
  await pane.getByRole("button", { name: "Start checkpoint recording", exact: true }).click();
  await expect(pane.getByRole("button", { name: "Checkpoint", exact: true })).toBeEnabled({ timeout: 120_000 });
  await pane.getByRole("button", { name: "Checkpoint", exact: true }).click();
  await expect.poll(() => session(page, "sessions").locator("option").count(), { timeout: 120_000 }).toBeGreaterThan(0);
  const name = pane.getByRole("textbox", { name: "Session name" });
  await expect(name).toBeEnabled({ timeout: 60_000 });
  await name.fill("ui-rename-626");
  await expect(session(page, "name")).toHaveValue("ui-rename-626");
  await name.press("Enter");
  await expect(session(page, "status")).toContainText("Session renamed", { timeout: 30_000 });
  await expect.poll(() => session(page, "sessions").evaluate((s) => [...s.options].map((o) => o.textContent))).toContainEqual(expect.stringContaining("ui-rename-626"));
  expect(errors).toEqual([]);
});

test("Checkpoints: library controls mirror disabled state and write the native storage limits", async ({ page }) => {
  const errors = watch(page);
  await page.goto("/index.html?nosw#ide");
  await startLinux(page);
  await page.getByRole("button", { name: "Recordings", exact: true }).click();
  const pane = page.locator('[data-wv="recordings"]');
  await pane.getByRole("radiogroup", { name: "Recordings view" }).getByText("Checkpoints").click();

  // Parity with the controller's disabled flags.
  for (const [key, name] of [["new", "New checkpoint guest"], ["checkpoint", "Checkpoint"], ["resume", "Resume guest"], ["delete", "Delete selected session"]]) {
    const disabled = await session(page, key).isDisabled();
    const button = pane.getByRole("button", { name, exact: true });
    if (disabled) await expect(button).toBeDisabled(); else await expect(button).toBeEnabled();
  }
  // The time/random checkbox is mirrored onto the library Switch's real input.
  const nativeEntropy = await session(page, "time-entropy").isDisabled();
  expect(await pane.getByRole("switch", { name: "Include time and random inputs" }).isDisabled()).toBe(nativeEntropy);

  // Storage limits: the strings typed are the native values, and Save runs the controller.
  await pane.getByRole("button", { name: "Limits and cleanup" }).click();
  await expect(session(page, "limit-points")).toBeEnabled({ timeout: 20_000 });
  const points = pane.getByRole("spinbutton", { name: "Restore points per session" }).or(pane.getByRole("textbox", { name: "Restore points per session" }));
  await points.fill("4000");
  await expect(session(page, "limit-points")).toHaveValue("4000");
  await pane.getByRole("button", { name: "Save storage limits", exact: true }).click();
  await expect(session(page, "status")).toContainText("Storage limits saved", { timeout: 20_000 });
  await expect(pane.locator('[role="status"]')).toContainText("Storage limits saved");
  expect(errors).toEqual([]);
});

test("Self-checks: every probe panel is listed with its own action, and a press runs that probe", async ({ page }) => {
  const errors = watch(page);
  await page.goto("/index.html?nosw#ide");
  await startLinux(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("dialog", { name: "Machine settings" }).getByRole("button", { name: /^Self-checks/ }).click();
  const pane = page.locator('[data-wv="checks"]');
  await expect(pane).toBeVisible();
  const native = await page.locator('#panel-ide > details.session-library[id$="-panel"]').evaluateAll((els) =>
    els.map((el) => ({ id: el.id, button: el.querySelector(".session-actions button").textContent.trim() })));
  expect(native.length).toBe(14);
  for (const { id, button } of native) {
    await expect(pane.locator(`[data-check="${id}"]`).getByRole("button", { name: button, exact: true })).toHaveCount(1);
  }
  // Run the small execution-boundary probe through its library button.
  const check = pane.locator('[data-check="event-clock-panel"]');
  await expect(check.getByRole("button", { name: "Check boundaries" })).toBeEnabled({ timeout: 30_000 });
  const before = await page.locator("#event-clock-status").textContent();
  await check.getByRole("button", { name: "Check boundaries" }).click();
  await expect.poll(() => page.locator("#event-clock-status").textContent(), { timeout: 30_000 }).not.toBe(before);
  await expect.poll(() => page.locator("#event-clock-pip").getAttribute("class"), { timeout: 150_000 }).toMatch(/\b(live|regressed)\b/);
  const pip = await page.locator("#event-clock-pip").getAttribute("class");
  await expect(check.getByText(/live/.test(pip) ? "Passed" : "Failed", { exact: true })).toBeVisible();
  await expect(check.locator('[role="status"]')).toHaveText((await page.locator("#event-clock-status").textContent()).replace(/\s+/g, " ").trim());
  expect(errors).toEqual([]);
});

test("phone 360: Tools opens Recordings as a full pane with a way back to the terminal", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    const errors = watch(page);
    await page.goto("/index.html?nosw#ide");
    await startLinux(page, { tap: true });
    await page.getByRole("button", { name: "Tools and settings" }).tap();
    await page.getByRole("dialog", { name: "Machine settings" }).getByRole("button", { name: /^Recordings/ }).tap();
    const pane = page.locator('[data-wv="recordings"]');
    await expect(pane).toBeVisible();
    await expect(page.locator("#ide-term-pane")).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    // The body is overflow-locked, so measure the pane itself: nothing in it may extend past the
    // viewport.
    expect(await pane.evaluate((el) => [...el.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5).length)).toBe(0);
    await expect(pane.getByRole("button", { name: "Record Linux sample", exact: true })).toBeVisible();
    await page.locator('[data-wv="pane-back"]').tap();
    await expect(pane).toHaveCount(0);
    await expect(page.locator("#ide-term-pane")).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("Settings shows the autoplay state as Sound; the header stays one warm row without the notice", async ({ page }) => {
  const errors = watch(page);
  // The header is one row: the same height at narrower desktop widths as at 1440 px, where the
  // version readout fits (before this slice it wrapped onto a second row below 900 px).
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto("/index.html?nosw#ide");
  await expect(page.locator('body > header [data-wv-ui="site-nav"][data-wv-mounted="true"]')).toBeAttached();
  const oneRow = (await page.locator("body > header").boundingBox()).height;
  await expect(page.locator("#version")).toBeVisible();
  for (const width of [900, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/index.html?nosw#ide");
    const header = page.locator("body > header");
    await expect(header.locator('[data-wv-ui="site-nav"][data-wv-mounted="true"]')).toBeAttached();
    expect((await header.boundingBox()).height).toBe(oneRow);
    await expect(page.locator("#version")).toBeHidden();
    await expect(page.locator("#audio-autoplay-badge")).toBeHidden();
    await expect(header).toHaveCSS("background-color", "rgba(21, 20, 16, 0.94)");
  }
  await startLinux(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const sound = page.getByRole("dialog", { name: "Machine settings" }).locator('[data-slot="list-section"]', { hasText: "Sound" });
  const badge = page.locator("#audio-autoplay-badge");
  const waiting = await badge.evaluate((el) => !el.hidden);
  await expect(sound).toContainText(waiting ? "Muted for now" : "On");
  // The controller's state reaches the row; no write can show the badge in the header.
  await badge.evaluate((el) => { el.hidden = false; el.dataset.audioState = "unavailable"; });
  await expect(sound).toContainText("Unavailable");
  await expect(badge).toBeHidden();
  expect(errors).toEqual([]);
});

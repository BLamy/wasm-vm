// E0-T29: launcher and workspace on the shared interface, driven through the real UI against the
// real engine. Run with PW_DISABLE_TS_ESM=1 (tools/verify-ui-workspace.sh): the pinned Playwright
// 1.49.1 deadlocks in its TS ESM loader under Node 24; this spec is plain JS.
import { expect as baseExpect, test } from "@playwright/test";

// Guest boots get their own explicit waits; UI assertions fail fast.
test.setTimeout(150_000);
const expect = baseExpect.configure({ timeout: 10_000 });
const BOOT_MS = 120_000;
const HEAVY = /\/releases\/|chunk|\.snap(\.gz)?$|\.ext4$|\/Image$|initramfs/;

function watch(page) {
  const errors = [];
  const requests = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("request", (r) => requests.push(new URL(r.url()).pathname));
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`http ${r.status()}: ${r.url()}`);
  });
  return { errors, requests };
}

const rows = (page) => page.locator("#term .xterm-rows");
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

async function waitReady(page) {
  await page.waitForFunction(() => window.wvmDemo?.isGuestReady?.(), null, { timeout: BOOT_MS });
  await expect(page.locator('[data-wv="guest-state"]')).toHaveText("Ready");
}

// Type into the real guest through the terminal and wait for a line the command does not contain.
async function run(page, command, expected, { tap = false } = {}) {
  const term = page.locator("#term");
  if (tap) await term.tap(); else await term.click();
  await page.keyboard.type(`${command}\n`);
  await expect.poll(() => rows(page).evaluate((el) => [...el.children].map((r) => r.textContent.trimEnd())), { timeout: 30_000 })
    .toContain(expected);
}

// Every visible ordinary control in the app panel must be a library control. Excluded: the engine
// surfaces themselves (xterm's input, the guest canvas, the code editor's textarea).
async function nativeControls(page) {
  return page.evaluate(() => [...document.querySelectorAll("#panel-ide :is(button, input, select, [role=button])")]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden")
    .filter((el) => !el.closest(".wv-ui") && !el.closest("#term") && !el.closest(".xterm"))
    .map((el) => el.id || el.dataset.action || el.dataset.a || el.textContent.trim().slice(0, 24)));
}

async function minTarget(page) {
  return page.evaluate(() => [...document.querySelectorAll(".wv-ui :is(button, a[href], [role=radio])")]
    // Visible targets only: react-aria's screen-reader dismiss buttons sit inside a VisuallyHidden
    // wrapper clipped to nothing.
    .filter((el) => {
      if (!el.offsetParent || el.closest("[hidden]")) return false;
      for (let node = el; node && node !== document.body; node = node.parentElement) {
        if (getComputedStyle(node).clipPath === "inset(50%)") return false;
      }
      return true;
    })
    .map((el) => {
      const target = el.matches("[role=radio]") ? el.closest("label") ?? el : el;
      const r = target.getBoundingClientRect();
      return { name: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 32), w: Math.round(r.width), h: Math.round(r.height) };
    })
    .filter((t) => t.h < 44 || t.w < 44));
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 360, height: 640 }]) {
  test(`first view at ${viewport.width}px: one primary action, nothing heavy fetched, no overflow`, async ({ browser }) => {
    const phone = viewport.width < 760;
    const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone });
    const page = await context.newPage();
    const { errors, requests } = watch(page);
    await page.goto("/index.html?nosw");
    await expect(page.locator("html")).toHaveAttribute("data-launcher-ready", "true");
    const launcher = page.locator("#os-launcher");
    await expect(launcher.getByRole("heading", { level: 1 })).toHaveText("Linux, running in this tab");

    const primaries = await launcher.locator('.wv-ui [data-slot="button"]').evaluateAll((els) =>
      els.filter((el) => getComputedStyle(el).backgroundColor === "rgb(228, 168, 83)").map((el) => el.textContent.trim()));
    expect(primaries).toEqual(["Start Linux"]);
    // No unconditional promise about images this host may not serve (E0-T29 r1 P3).
    expect(await launcher.textContent()).not.toMatch(/container runtime/i);
    for (const name of ["Alpine Linux with Node.js", "Alpine Linux", "Omarchy desktop"]) {
      await expect(launcher.getByRole("button", { name: `Start ${name}`, exact: true })).toBeVisible();
    }
    // The engine's own launcher stays in the DOM as the input contract, hidden.
    await expect(page.locator('#os-launcher [data-os="busybox"]')).toBeHidden();
    expect(await overflowX(page)).toBe(0);
    expect(requests.filter((p) => HEAVY.test(p))).toEqual([]);
    if (phone) expect(await minTarget(page)).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("Start Linux boots BusyBox; settings, views and panes operate the real workspace", async ({ page }) => {
  const { errors } = watch(page);
  await page.goto("/index.html?nosw");
  await page.getByRole("button", { name: "Start Linux" }).click();
  await waitReady(page);
  const bar = page.locator('[data-wv="workspace-bar"]');
  await expect(bar).toContainText("BusyBox");
  // First use: the restored shell has no fresh prompt, so the workspace says what to do until
  // the first command runs.
  const hint = page.locator('[data-wv="first-use-hint"]');
  await expect(hint).toContainText("Type a command and press Enter");
  await run(page, "printf 'ui-%s-%s\\n' ready 42", "ui-ready-42");
  await expect(hint).toHaveCount(0);
  expect(await nativeControls(page)).toEqual([]);

  // The terminal is the main content: full width under the bar, no empty editor/display above it.
  const vw = page.viewportSize().width;
  const termBox = await page.locator("#ide-term-pane").boundingBox();
  expect(termBox.width).toBeGreaterThan(vw - 2);
  await expect(page.locator("#ide-editor-body")).toBeHidden();
  await expect(page.locator("#ide-display-pane")).toBeHidden();
  for (const legacy of ["#ide-act-files", "#ide-sb-net", "#ide-keyboard-toggle"]) await expect(page.locator(legacy)).toBeHidden();

  // Settings: provider-conditional fields write main.js's own inputs and its persistence key.
  const trigger = page.getByRole("button", { name: "Settings" });
  await trigger.click();
  const sheet = page.getByRole("dialog", { name: "Machine settings" });
  const pick = async (label) => {
    await sheet.getByRole("button", { name: /Provider/ }).click();
    await page.getByRole("option", { name: label }).click();
  };
  await pick("WebSocket relay");
  expect(await page.evaluate(() => document.getElementById("network-provider").value)).toBe("websocket");
  await sheet.getByRole("textbox", { name: "WebSocket endpoint" }).fill("wss://relay.example/zzleak");
  expect(await page.evaluate(() => document.getElementById("network-websocket-url").value)).toBe("wss://relay.example/zzleak");
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem("wasm-vm.network-config.v1")))).toMatchObject({
    provider: "websocket",
    websocketUrl: "wss://relay.example/zzleak",
  });
  await expect(sheet.getByRole("textbox", { name: "One-time auth key" })).toHaveCount(0);

  await pick("Tailscale (public)");
  const auth = sheet.getByLabel("One-time auth key");
  await auth.fill("tskey-ui-not-persisted");
  expect(await page.evaluate(() => document.getElementById("tailscale-auth-key").value)).toBe("tskey-ui-not-persisted");
  await expect(sheet.getByRole("textbox", { name: "WebSocket endpoint" })).toHaveCount(0);
  // Log in presses main.js's button; its real status (this guest booted offline) comes back.
  await sheet.getByRole("button", { name: "Log in" }).click();
  await expect(sheet.locator('[data-wv="tailscale-status"]')).toContainText("Boot with the Tailscale provider before requesting login.");
  await sheet.getByRole("button", { name: "Log out and revoke" }).click();
  await expect(auth).toHaveValue("");
  expect(await page.evaluate(() => document.getElementById("tailscale-auth-key").value)).toBe("");

  await pick("Headscale (self-hosted)");
  await expect(sheet.getByRole("textbox", { name: "Headscale control server" })).toBeVisible();
  await pick("Private wvrelay (advanced)");
  await expect(sheet.getByLabel("Relay token")).toBeVisible();
  await pick("Offline");
  // The listbox closes with an exit animation; focus returns to the Select trigger after it.
  await expect(sheet.getByRole("button", { name: /Provider/ })).toBeFocused();
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored).not.toContain("tskey-ui-not-persisted");
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem("wasm-vm.network-config.v1"))).provider).toBe("offline");

  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(trigger).toBeFocused();
  // Nothing typed into the sheet reached the guest; keyboard input still works afterwards.
  expect(await rows(page).textContent()).not.toContain("zzleak");
  await run(page, "expr 6 \\* 7", "42");

  // One bounded view round trip: Display shows the guest canvas, Terminal brings the shell back.
  const mainView = page.getByRole("radiogroup", { name: "Main view" });
  await mainView.getByText("Display", { exact: true }).click();
  await expect(page.locator("#ide-display-pane")).toBeVisible();
  await expect(page.locator("#ide-term-pane")).toBeHidden();
  await mainView.getByText("Terminal", { exact: true }).click();
  await expect(page.locator("#ide-term-pane")).toBeVisible();
  await run(page, "printf 'view-%d\\n' $((40+2))", "view-42");

  // Panes open beside the terminal and give the width back when closed. Their controls are library
  // projections of ide.js's own (which stay in the DOM, hidden, as the engine's controls).
  await run(page, "printf 'hello from %s\\n' files > /root/ui-note.txt; echo saved-$((6*7))", "saved-42");
  await page.getByRole("button", { name: "Files" }).click();
  const side = page.locator('[data-wv-host="side"]');
  await expect(side).toBeVisible();
  await expect(page.locator("#ide-explorer")).toBeHidden();
  const narrowed = await page.locator("#ide-term-pane").boundingBox();
  expect(narrowed.width).toBeLessThan(vw - 200);
  await side.getByRole("button", { name: "Refresh" }).click();
  await side.getByRole("button", { name: "ui-note.txt" }).click();
  await expect(page.locator("#ide-textarea")).toHaveValue(/hello from files/);
  const editorBar = page.locator('[data-wv-host="editor"]');
  await expect(editorBar.getByRole("button", { name: "ui-note.txt", exact: true })).toBeVisible();
  await page.locator("#ide-textarea").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("edited-in-ui");
  await editorBar.getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => (await page.evaluate(() => window.wvmDemo.run("cat /root/ui-note.txt", 20_000))).stdout, { timeout: 20_000 })
    .toContain("edited-in-ui");
  expect(await nativeControls(page)).toEqual([]);
  await editorBar.getByRole("button", { name: "Close ui-note.txt" }).click();
  await expect(page.locator("#ide-editor-body")).toBeHidden();

  // BusyBox has no container runtime: a short library panel with a deliberate restart into
  // Alpine, and no guest probe written into the shell.
  const bytesBefore = await page.evaluate(() => window.__consoleBytes.length);
  await page.getByRole("button", { name: "Containers" }).click();
  await expect(side).toContainText("BusyBox cannot run containers");
  await expect(side).toContainText("not every host publishes one");
  const restart = side.getByRole("link", { name: /^Restart with Alpine/ }).first();
  await expect(restart).toHaveAttribute("href", /[?&]guest=(node-)?alpine(&|#|$)/);
  await page.waitForTimeout(2_000);
  expect(await page.evaluate(() => window.__consoleBytes.length)).toBe(bytesBefore);
  expect(await nativeControls(page)).toEqual([]);
  await page.getByRole("button", { name: "Containers" }).click();
  await expect(page.locator("#ide-side")).toBeHidden();
  expect((await page.locator("#ide-term-pane").boundingBox()).width).toBeGreaterThan(vw - 2);
  await page.getByRole("button", { name: /^Editor/ }).click();
  await expect(page.locator("#ide-editor-body")).toBeVisible();
  await page.getByRole("button", { name: /^Editor/ }).click();
  await expect(page.locator("#ide-editor-body")).toBeHidden();

  expect(await overflowX(page)).toBe(0);
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
  test(`phone ${viewport.width}px: start, full-width shell, tools as panes with a way back`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const { errors } = watch(page);
    await page.goto("/index.html?nosw");
    await page.getByRole("button", { name: "Start Linux" }).tap();
    await waitReady(page);
    await run(page, "printf 'ui-%s-%s\\n' ready 42", "ui-ready-42", { tap: true });
    const term = await page.locator("#term").boundingBox();
    expect(term.width).toBeGreaterThan(viewport.width - 24);
    expect(await overflowX(page)).toBe(0);
    expect(await minTarget(page)).toEqual([]);

    const tools = page.getByRole("button", { name: "Tools and settings" });
    await tools.tap();
    const sheet = page.getByRole("dialog", { name: "Machine settings" });
    await expect(sheet).toBeVisible();
    expect(await minTarget(page)).toEqual([]);
    await sheet.getByRole("button", { name: /^Files/ }).tap();
    await expect(sheet).toHaveCount(0);
    const back = page.getByRole("button", { name: "Back to terminal" });
    await expect(back).toBeFocused();
    await expect(page.locator('[data-wv-host="side"]')).toContainText("Files");
    await expect(page.locator("#ide-term-pane")).toBeHidden();
    expect(await minTarget(page)).toEqual([]);
    expect((await page.locator("#ide-side").boundingBox()).width).toBeGreaterThan(viewport.width - 2);
    await back.tap();
    await expect(page.locator("#ide-term-pane")).toBeVisible();
    await expect(page.locator("#ide-side")).toBeHidden();
    await run(page, "expr 40 + 2", "42", { tap: true });
    expect(await overflowX(page)).toBe(0);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("phone: reopening an existing file after Back shows its editor in the same guest", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const { errors } = watch(page);
  try {
    await page.goto("/index.html?nosw");
    await page.getByRole("button", { name: "Start Linux", exact: true }).tap();
    await waitReady(page);
    // Use the ordinary terminal tap/focus path before arranging the file. The first short command
    // also distinguishes a ready shell from the pre-existing early redraw/input startup issue.
    await run(page, "printf 'ui-%s-%s\\n' ready 42", "ui-ready-42", { tap: true });
    await run(page, "printf 'initial-%s\\n' 42 > /root/critic-note.txt; printf 'created-%s\\n' 42", "created-42", { tap: true });
    const session = await page.evaluate(() => window.wvmDemo.guestSession());
    const showFiles = async () => {
      await page.getByRole("button", { name: "Tools and settings" }).tap();
      const sheet = page.getByRole("dialog", { name: "Machine settings" });
      await sheet.getByRole("button", { name: /^Files/ }).tap();
      await expect(sheet).toHaveCount(0);
    };
    const side = page.locator('[data-wv-host="side"]');
    const editor = page.locator("#ide-textarea");
    await showFiles();
    await side.getByRole("button", { name: "Refresh", exact: true }).tap();
    await side.getByRole("button", { name: "critic-note.txt", exact: true }).tap();
    await expect(editor).toBeVisible();
    // The unchanged serial file loader can append trailing framing whitespace.
    await expect(editor).toHaveValue(/^initial-42\s*$/);
    await editor.fill("saved-from-phone-42\n");
    await page.locator('[data-wv-host="editor"]').getByRole("button", { name: "Save", exact: true }).tap();
    await expect.poll(async () => (await page.evaluate(() => window.wvmDemo.run("cat /root/critic-note.txt", 20_000))).stdout.trimEnd(), { timeout: 20_000 })
      .toBe("saved-from-phone-42");

    await page.getByRole("button", { name: "Back to terminal", exact: true }).tap();
    await expect(page.locator("#ide-term-pane")).toBeVisible();
    await expect(page.locator("#ide-tabstrip > .ide-tab")).toHaveCount(1);
    await showFiles();
    await side.getByRole("button", { name: "critic-note.txt", exact: true }).tap();
    // Tab count stays one. Activating the existing tab must still bring its editor into view.
    await expect(editor).toBeVisible({ timeout: 5_000 });
    await expect(editor).toHaveValue("saved-from-phone-42\n");
    await expect(page.locator("#ide-tabstrip > .ide-tab")).toHaveCount(1);
    expect(await page.evaluate(() => window.wvmDemo.guestSession())).toEqual(session);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("Omarchy's graphics choice sits behind Desktop settings and reaches the engine", async ({ page }) => {
  const { errors, requests } = watch(page);
  await page.goto("/index.html?nosw");
  await expect(page.locator("html")).toHaveAttribute("data-launcher-ready", "true");
  const graphics = page.getByRole("radiogroup", { name: "Desktop graphics" });
  await expect(graphics).toBeHidden();
  // Pointer: open the disclosure (1), choose (2).
  const trigger = page.getByRole("button", { name: "Desktop settings" });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(graphics).toBeVisible();
  await graphics.getByText("Software", { exact: true }).click();
  expect(await page.evaluate(() => document.getElementById("desktop-graphics").value)).toBe("software");
  // Keyboard: collapse and reopen with the keyboard, then move the choice with an arrow key.
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(graphics).toBeHidden();
  await page.keyboard.press("Enter");
  await expect(graphics).toBeVisible();
  await graphics.getByRole("radio", { name: "Software" }).focus();
  await page.keyboard.press("ArrowLeft");
  expect(await page.evaluate(() => document.getElementById("desktop-graphics").value)).toBe("gpu");
  expect(requests.filter((p) => HEAVY.test(p))).toEqual([]);
  expect(errors).toEqual([]);
});

test("a failed start shows the engine's error and Try again boots for real", async ({ page }) => {
  const { requests } = watch(page);
  await page.goto("/index.html?nosw");
  await expect(page.locator("html")).toHaveAttribute("data-launcher-ready", "true");
  await page.route(/\/releases\//, (route) => route.abort());
  await page.getByRole("button", { name: "Start Linux" }).click();
  const status = page.locator('[data-wv="launcher-status"]');
  await expect(status).toHaveText(/^Could not start busybox: .*Failed to fetch$/, { timeout: 30_000 });
  await expect(status).not.toContainText(" at ");
  await page.unroute(/\/releases\//);
  await page.getByRole("button", { name: "Try again" }).click();
  await waitReady(page);
  await run(page, "printf 'retry-%s\\n' ok", "retry-ok");
  expect(requests.some((p) => /\/releases\//.test(p))).toBe(true);
});

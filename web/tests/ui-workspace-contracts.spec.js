// E0-T29 r2: bounded UI-boundary proof for the library adapters that the guest images served here
// cannot exercise end to end (no wvrun in the local Alpine image, no GPU failure on demand).
//
// Everything runs in the real app (index.html, main.js, ide.js, ui.js) with a real BusyBox guest.
// Where a native control only exists with a container runtime or a GPU failure, the test inserts
// a FIXTURE: a copy of the engine's own markup contract (cited below) whose handlers RECORD what
// they receive. These cases prove that the library adapters forward values, events, actions and
// disabled state to the native controls and clean up after them. They do NOT prove that a
// container runtime or a GPU recovery works; nothing here reports guest success.
//
// Run with PW_DISABLE_TS_ESM=1 (tools/verify-ui-workspace.sh): the pinned Playwright 1.49.1
// deadlocks in its TS ESM loader under Node 24; this spec is plain JS.
import { expect as baseExpect, test } from "@playwright/test";

test.setTimeout(120_000);
const expect = baseExpect.configure({ timeout: 10_000 });

function watch(page) {
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

async function startBusyBox(page) {
  await page.goto("/index.html?nosw");
  await page.getByRole("button", { name: "Start Linux", exact: true }).click();
  await page.waitForFunction(() => window.wvmDemo?.isGuestReady?.(), null, { timeout: 90_000 });
  await expect(page.locator('[data-wv="guest-state"]')).toHaveText("Ready");
}

const rowsText = (page) => page.locator("#term .xterm-rows").evaluate((el) => [...el.children].map((r) => r.textContent.trimEnd()));

test("container panel adapters forward to ide.js's native controls and clean up (fixture: ide.js:2759-2785 markup)", async ({ page }) => {
  const errors = watch(page);
  await startBusyBox(page);
  await page.getByRole("button", { name: /^Editor/ }).click();

  // FIXTURE: the exact .ide-ctr-panel markup ide.js openContainer() builds, with recording
  // handlers in place of ide.js's container calls. Appended where ide.js appends real panels.
  await page.evaluate(() => {
    const panel = document.createElement("div");
    panel.className = "ide-ctr-panel active";
    panel.dataset.fixture = "ide.js openContainer markup";
    panel.innerHTML = `
      <div class="ide-ctr-head">
        <span class="id" data-a="identity">fixture-image · 0123456789ab</span>
        <span style="flex:1 1 auto"></span>
        <button class="ide-mini" data-a="refresh">↻ Logs</button>
        <span class="ide-ctr-stream-state" data-a="stream-status">snapshot</span>
        <label><input type="checkbox" data-a="follow"> Follow</label>
      </div>
      <pre class="ide-ctr-logs">fixture logs</pre>
      <section class="ide-ctr-exec" data-a="exec-pane">
        <div class="ide-ctr-exec-head">
          <strong>Exec</strong>
          <span class="sp"></span>
          <span class="ide-ctr-exec-status" data-a="exec-status">exec idle</span>
          <button class="ide-mini" type="button" data-a="exec-start">Start Exec</button>
          <button class="ide-mini" type="button" data-a="exec-exit" disabled>Exit Exec</button>
        </div>
        <div class="ide-ctr-exec-provenance" data-a="exec-provenance"></div>
        <pre class="ide-ctr-exec-output" data-a="exec-output">Exec is idle.</pre>
        <form class="ide-ctr-exec-form" data-a="exec-form">
          <span class="p">$</span>
          <input type="text" data-a="exec-input" placeholder="type a command in the interactive container (e.g. ls -la /)" autocomplete="off" spellcheck="false" />
          <button class="ide-mini" type="submit" data-a="exec-send">Send</button>
        </form>
      </section>`;
    const log = (window.__fixtureLog = []);
    const q = (a) => panel.querySelector(`[data-a="${a}"]`);
    q("refresh").addEventListener("click", () => log.push("refresh"));
    q("exec-start").addEventListener("click", () => log.push("exec-start"));
    q("exec-exit").addEventListener("click", () => log.push("exec-exit"));
    q("follow").addEventListener("change", (e) => log.push(`follow:${e.target.checked}`));
    q("exec-input").addEventListener("input", (e) => log.push(`input:${e.target.value}`));
    q("exec-form").addEventListener("submit", (e) => { e.preventDefault(); log.push(`submit:${q("exec-input").value}`); });
    for (const p of document.querySelectorAll("#ide-editor-body .ide-ctr-panel")) p.classList.remove("active");
    document.getElementById("ide-editor-body").appendChild(panel);
  });
  const log = () => page.evaluate(() => window.__fixtureLog);
  const panel = page.locator('[data-fixture="ide.js openContainer markup"]');

  // The workspace inserted its two hosts into the native panel and hid the native controls.
  const head = panel.locator('[data-wv-host="ctr-head"]');
  const exec = panel.locator('[data-wv-host="ctr-exec"]');
  await expect(head).toBeVisible();
  await expect(exec).toBeVisible();
  await expect(panel.locator(".ide-ctr-head")).toBeHidden();
  await expect(panel.locator(".ide-ctr-exec-form")).toBeHidden();
  await expect(panel.locator(".ide-ctr-logs")).toBeVisible(); // output text stays native

  // Buttons: pointer and keyboard both reach the native handler.
  await head.getByRole("button", { name: "Logs", exact: true }).click();
  await exec.getByRole("button", { name: "Start Exec", exact: true }).focus();
  await page.keyboard.press("Enter");
  expect(await log()).toEqual(["refresh", "exec-start"]);

  // Disabled parity follows the native button both ways.
  const exit = exec.getByRole("button", { name: "Exit Exec", exact: true });
  await expect(exit).toBeDisabled();
  await page.evaluate(() => { document.querySelector('[data-a="exec-exit"]').disabled = false; });
  await expect(exit).toBeEnabled();
  await exit.click();
  expect((await log()).at(-1)).toBe("exec-exit");

  // Checkbox adapter: the library Switch toggles the native checkbox and fires its change event.
  const follow = head.getByRole("switch", { name: "Follow" });
  await expect(follow).not.toBeChecked();
  await head.locator('[data-slot="switch"]').click();
  await expect(follow).toBeChecked();
  expect(await page.evaluate(() => document.querySelector('[data-a="follow"]').checked)).toBe(true);
  expect((await log()).at(-1)).toBe("follow:true");

  // ide.js:1931 disables Follow while a log stream starts/stops. The projection must mirror
  // that engine-owned state, just as it mirrors native button state above.
  await page.evaluate(() => { document.querySelector('[data-a="follow"]').disabled = true; });
  await expect(panel.locator('input[data-a="follow"]')).toBeDisabled({ timeout: 5_000 });
  await expect(follow).toBeDisabled({ timeout: 5_000 });
  await page.evaluate(() => { document.querySelector('[data-a="follow"]').disabled = false; });
  await expect(follow).toBeEnabled({ timeout: 5_000 });

  // Text input adapter: typed value reaches the native input with input events; Enter submits the
  // native form, whose handler reads the native value.
  const input = exec.getByRole("textbox");
  await input.fill("ls -la /");
  expect(await page.evaluate(() => document.querySelector('[data-a="exec-input"]').value)).toBe("ls -la /");
  expect(await log()).toContain("input:ls -la /");
  await input.press("Enter");
  expect((await log()).at(-1)).toBe("submit:ls -la /");
  // A value written by the engine (ide.js clears the input after sending) shows in the library field.
  await page.evaluate(() => { document.querySelector('[data-a="exec-input"]').value = ""; });
  await expect(input).toHaveValue("");

  // Portal lifecycle: removing the native panel (ide.js closeTab) removes both hosts.
  await page.evaluate(() => document.querySelector('[data-fixture="ide.js openContainer markup"]').remove());
  await expect(page.locator('[data-wv-host^="ctr-"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// r3: the library Switch forwards neither isDisabled nor a ref, so the projection mirrors the
// native disabled state onto its <input role="switch">. A press while disabled must forward nothing.
test("a projected Switch blocks presses while its native checkbox is disabled (fixture: ide.js Follow checkbox)", async ({ page }) => {
  const errors = watch(page);
  await startBusyBox(page);
  await page.getByRole("button", { name: /^Editor/ }).click();
  // FIXTURE: the Follow control from ide.js openContainer markup, with a recording handler.
  await page.evaluate(() => {
    const panel = document.createElement("div");
    panel.className = "ide-ctr-panel active";
    panel.dataset.fixture = "ide.js follow checkbox";
    panel.innerHTML = `<div class="ide-ctr-head"><label><input type="checkbox" data-a="follow"> Follow</label></div>`;
    window.__followLog = [];
    panel.querySelector('[data-a="follow"]').addEventListener("change", (e) => window.__followLog.push(e.target.checked));
    for (const p of document.querySelectorAll("#ide-editor-body .ide-ctr-panel")) p.classList.remove("active");
    document.getElementById("ide-editor-body").appendChild(panel);
  });
  const head = page.locator('[data-fixture="ide.js follow checkbox"] [data-wv-host="ctr-head"]');
  const follow = head.getByRole("switch", { name: "Follow" });
  await expect(follow).toBeEnabled();
  await page.evaluate(() => { document.querySelector('[data-fixture="ide.js follow checkbox"] [data-a="follow"]').disabled = true; });
  await expect(follow).toBeDisabled();
  // A real mouse press where the switch is drawn (Playwright's click() rightly refuses a disabled
  // control, so emulate the person pressing it anyway).
  const box = await head.locator('[data-slot="switch"]').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  await expect(follow).not.toBeChecked();
  expect(await page.evaluate(() => window.__followLog)).toEqual([]);
  await page.evaluate(() => { document.querySelector('[data-fixture="ide.js follow checkbox"] [data-a="follow"]').disabled = false; });
  await expect(follow).toBeEnabled();
  await head.locator('[data-slot="switch"]').click();
  await expect(follow).toBeChecked();
  expect(await page.evaluate(() => window.__followLog)).toEqual([true]);
  expect(errors).toEqual([]);
});

test("file drop on the library drop zone reaches file-transfer.js with the original files", async ({ page }) => {
  const errors = watch(page);
  await startBusyBox(page);
  await page.getByRole("button", { name: "Files", exact: true }).click();
  const zone = page.locator('[data-wv-host="side"] .wv-proj-drop');
  await expect(zone).toBeVisible();
  await expect(page.locator('[data-wv-host="side"]')).toContainText("Start an Alpine guest to copy files");

  // Record what the native drop zone receives, alongside file-transfer.js's own handlers.
  await page.evaluate(() => {
    window.__dropLog = [];
    document.getElementById("file-transfer-drop").addEventListener("drop", (e) => {
      window.__dropLog.push({ type: e.type, files: [...(e.dataTransfer?.files ?? [])].map((f) => `${f.name}:${f.size}`) });
    });
  });
  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["hello from a drop\n"], "drop-note.txt", { type: "text/plain" }));
    return dt;
  });
  await zone.dispatchEvent("dragover", { dataTransfer });
  await expect(page.locator("#file-transfer-drop")).toHaveClass(/dragging/);
  await expect(zone).toHaveAttribute("data-over", "true");
  await zone.dispatchEvent("drop", { dataTransfer });
  expect(await page.evaluate(() => window.__dropLog)).toEqual([{ type: "drop", files: ["drop-note.txt:18"] }]);
  await expect(page.locator("#file-transfer-drop")).not.toHaveClass(/dragging/);
  // file-transfer.js queued the dropped file in its own list; the projection shows that row.
  await expect(page.locator("#file-transfer-list")).toContainText("drop-note.txt");
  await expect(page.locator('[data-wv-host="side"]')).toContainText("drop-note.txt");
  expect(errors).toEqual([]);
});

test("Settings input actions press main.js's keyboard, pointer and terminal controls", async ({ page }) => {
  const errors = watch(page);
  await startBusyBox(page);
  await page.locator("#term").click();
  await page.keyboard.type("printf 'before-%s\\n' clear\n");
  await expect.poll(() => rowsText(page)).toContain("before-clear");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Machine settings" });

  // Capture switch -> #ide-keyboard-toggle -> main.js setKeyboardCaptured.
  expect(await page.evaluate(() => document.documentElement.dataset.keyboardCapture)).toBe("on");
  const capture = sheet.getByRole("switch", { name: "Send keys to the guest" });
  await expect(capture).toBeChecked();
  await sheet.locator('[data-slot="list-row"]', { hasText: "Send keys to the guest" }).locator('[data-slot="switch"]').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.keyboardCapture)).toBe("off");
  await expect(capture).not.toBeChecked();
  await sheet.locator('[data-slot="list-row"]', { hasText: "Send keys to the guest" }).locator('[data-slot="switch"]').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.keyboardCapture)).toBe("on");

  // Release -> #ide-keyboard-release -> releaseKeyboardState("panic-button").
  const before = await page.evaluate(() => window.__keyboardDebug?.releaseCount ?? 0);
  await sheet.getByRole("button", { name: "Release", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__keyboardDebug)).toMatchObject({ releaseCount: before + 1, lastReleaseReason: "panic-button" });

  // Pointer mode button mirrors the native toggle's disabled state (no guest display mode here).
  const nativePointerDisabled = await page.evaluate(() => document.getElementById("ide-pointer-toggle").disabled);
  const pointer = sheet.locator('[data-slot="list-row"]', { hasText: "Pointer mode" }).getByRole("button");
  if (nativePointerDisabled) await expect(pointer).toBeDisabled(); else await expect(pointer).toBeEnabled();

  // Clear -> #ide-term-clear -> the xterm buffer loses the earlier output; the guest keeps running.
  await sheet.getByRole("button", { name: "Clear", exact: true }).click();
  await expect.poll(() => rowsText(page)).not.toContain("before-clear");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await page.locator("#term").click();
  await page.keyboard.type("printf 'after-%s\\n' clear\n");
  await expect.poll(() => rowsText(page)).toContain("after-clear");
  expect(errors).toEqual([]);
});

test("GPU recovery links mirror main.js's state (fixture: main.js showGpuStatus/gpu-retry state)", async ({ page }) => {
  const errors = watch(page);
  await page.goto("/index.html?nosw");
  await expect(page.locator("html")).toHaveAttribute("data-launcher-ready", "true");
  const recovery = page.getByRole("group", { name: "Desktop graphics recovery" });
  await expect(recovery).toHaveCount(0);
  // FIXTURE: the DOM state main.js writes when a GPU desktop start fails (main.js showGpuStatus and
  // the Omarchy error path unhide #gpu-retry / #gpu-cold-retry and fill #gpu-status).
  await page.evaluate(() => {
    document.getElementById("gpu-status").textContent = "GPU connection lost. Reload to restart, or choose software rendering in the launcher.";
    document.getElementById("gpu-retry").hidden = false;
    document.getElementById("gpu-cold-retry").hidden = false;
  });
  await expect(recovery).toContainText("GPU connection lost.");
  const software = recovery.getByRole("link", { name: "Restart with software graphics" });
  const cold = recovery.getByRole("link", { name: "Cold boot with GPU rendering" });
  expect(await software.getAttribute("href")).toBe(await page.locator("#gpu-retry").getAttribute("href"));
  expect(await cold.getAttribute("href")).toBe(await page.locator("#gpu-cold-retry").getAttribute("href"));
  await page.evaluate(() => {
    document.getElementById("gpu-status").textContent = "";
    document.getElementById("gpu-retry").hidden = true;
    document.getElementById("gpu-cold-retry").hidden = true;
  });
  await expect(recovery).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("keyboard: reopening an open file with Enter brings the editor back (desktop)", async ({ page }) => {
  const errors = watch(page);
  await startBusyBox(page);
  await page.locator("#term").click();
  await page.keyboard.type("printf 'kb-%s\\n' 42 > /root/kb-note.txt; printf 'made-%s\\n' 42\n");
  await expect.poll(() => rowsText(page)).toContain("made-42");
  await page.getByRole("button", { name: "Files", exact: true }).click();
  const side = page.locator('[data-wv-host="side"]');
  await side.getByRole("button", { name: "Refresh", exact: true }).click();
  const row = side.getByRole("button", { name: "kb-note.txt", exact: true });
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#ide-textarea")).toBeVisible();
  await expect(page.locator("#ide-textarea")).toHaveValue(/^kb-42\s*$/);
  // Hide the editor, then reopen the same (still open) file from the keyboard.
  await page.getByRole("button", { name: /^Editor/ }).click();
  await expect(page.locator("#ide-textarea")).toBeHidden();
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#ide-textarea")).toBeVisible();
  await expect(page.locator("#ide-tabstrip > .ide-tab")).toHaveCount(1);
  expect(errors).toEqual([]);
});

// The retargeted e4-t32 Settings sequence (e4-t32-whole-worker.spec.js:174-209), recorded after an
// ordinary bounded start instead of that spec's racing first step and performance gauntlet.
test("e4-t32 sequence: Tailscale login, injected worker rejection and logout through Settings", async ({ page }) => {
  const errors = watch(page);
  await page.goto("/index.html?nosw&noAutoBoot=1");
  await page.waitForFunction(() => typeof window.wvmDemo?.runBusybox === "function", null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.wvmDemo.runBusybox())).toEqual({ ok: true });
  await page.waitForFunction(() => window.wvmDemo.isGuestReady(), null, { timeout: 90_000 });

  const rpcBefore = await page.evaluate(() => window.__linuxCtl.workerRpcStats());
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Machine settings" });
  await settings.getByRole("button", { name: /Provider/ }).click();
  await page.getByRole("option", { name: "Tailscale (public)" }).click();
  const login = settings.getByRole("button", { name: "Log in", exact: true });
  await login.click();
  await expect(page.locator("#tailscale-status")).toContainText("Boot with the Tailscale provider before requesting login.");
  await page.evaluate(() => {
    const original = window.__linuxCtl.tailscaleCommand.bind(window.__linuxCtl);
    window.__e4t32TailscaleOriginal = original;
    window.__linuxCtl.tailscaleCommand = async (command) => {
      await original(command);
      throw new Error("injected worker command rejection");
    };
  });
  await login.click();
  await expect(page.locator("#tailscale-status")).toContainText("Tailscale login failed: injected worker command rejection");
  await expect(settings.locator('[data-wv="tailscale-status"]')).toContainText("injected worker command rejection");
  expect(await page.evaluate(() => window.wvmDemo.isGuestUp())).toBe(true);
  await page.evaluate(() => {
    window.__linuxCtl.tailscaleCommand = window.__e4t32TailscaleOriginal;
    localStorage.setItem("wasm-vm.tailscale-state.v1", JSON.stringify({ machine: "persisted" }));
    document.querySelector("#tailscale-auth-key").value = "tskey-one-time";
  });
  await settings.getByRole("button", { name: "Log out and revoke", exact: true }).click();
  await expect(page.locator("#tailscale-status")).toContainText("Persisted browser state cleared; no active Tailscale Worker.");
  const proof = await page.evaluate(async () => ({
    state: localStorage.getItem("wasm-vm.tailscale-state.v1"),
    auth: document.querySelector("#tailscale-auth-key").value,
    rpc: await window.__linuxCtl.workerRpcStats(),
    guestUp: window.wvmDemo.isGuestUp(),
  }));
  expect(proof.state).toBeNull();
  expect(proof.auth).toBe("");
  expect(proof.guestUp).toBe(true);
  expect(proof.rpc.calls - rpcBefore.calls).toBeGreaterThanOrEqual(3);
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  // The injected rejection is reported by main.js as a console error in the original spec too.
  expect(errors.filter((e) => !/injected worker command rejection/.test(e))).toEqual([]);
});

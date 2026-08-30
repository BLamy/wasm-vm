#!/usr/bin/env node
// E3-T22d: exact-head browser evidence for the clipboard capstone. This intentionally uses the raw
// Playwright API rather than @playwright/test: the repository's Playwright Test runner deadlocks on
// this host's Node 24 before discovering tests, while the browser API is the same Chromium engine.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const base = (process.env.E3_T22D_WEB_BASE || "http://127.0.0.1:8123").replace(/\/$/, "");
const query = process.env.E3_T22D_QUERY || "noAutoBoot";
const runUrl = `${base}/?${query}`;
const out = path.join(repo, "evidence/e3-t22d");
const evidencePath = path.join(out, "clipboard-browser-2026-08-30.json");
const screenshotPath = path.join(out, "clipboard-browser-2026-08-30.png");
const { chromium } = await import(
  pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")).href,
);

const browser = await chromium.launch({
  headless: false,
  args: ["--disable-dev-shm-usage", "--js-flags=--max-old-space-size=4096"],
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const rawConsoleErrors = [];
// Chromium's console text omits the URL for a failed resource. CDP retains the URL, so use a
// deduplicated status+URL map to bind any tolerated console 404 to the explicitly allowed favicon.
const cdpHttpErrors = new Map();
const cdp = await context.newCDPSession(page);
await cdp.send("Network.enable");
const isFavicon404 = ({ status, url }) => {
  if (status !== 404) return false;
  try {
    return new URL(url).pathname.toLowerCase().endsWith("/favicon.ico");
  } catch {
    return false;
  }
};
cdp.on("Network.responseReceived", (event) => {
  if (event.response.status >= 400) {
    const error = { status: event.response.status, url: event.response.url };
    cdpHttpErrors.set(`${error.status} ${error.url}`, error);
  }
});
page.on("console", (message) => {
  const text = message.text();
  if (message.type() === "error") {
    rawConsoleErrors.push(text);
  }
});
page.on("pageerror", (error) => rawConsoleErrors.push(`pageerror: ${error.message}`));

const terminalBuffer = () => page.evaluate(() => {
  const buffer = window.__term.term.buffer.active;
  const lines = [];
  for (let index = 0; index < buffer.length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) || "");
  }
  return lines.join("\n");
});
const send = (value) => page.evaluate(
  (text) => window.__term.typeBytes(new TextEncoder().encode(text)),
  value,
);
const waitForText = async (needle, timeout = 120_000) => {
  await page.waitForFunction(
    (value) => {
      const buffer = window.__term?.term?.buffer?.active;
      if (!buffer) return false;
      for (let index = 0; index < buffer.length; index += 1) {
        if ((buffer.getLine(index)?.translateToString(true) || "").includes(value)) return true;
      }
      return false;
    },
    needle,
    { timeout },
  );
};
const waitForExactLine = async (needle, timeout = 120_000) => {
  await page.waitForFunction(
    (value) => {
      const buffer = window.__term?.term?.buffer?.active;
      if (!buffer) return false;
      for (let index = 0; index < buffer.length; index += 1) {
        const line = (buffer.getLine(index)?.translateToString(true) || "").trim();
        if (line.replace(/^(?:~ # )+/, "") === value) return true;
      }
      return false;
    },
    needle,
    { timeout },
  );
};
const waitForGuestSha = async (filePath, timeout = 360_000) => {
  const handle = await page.waitForFunction(
    (path) => {
      const buffer = window.__term?.term?.buffer?.active;
      if (!buffer) return false;
      for (let index = 0; index < buffer.length; index += 1) {
        const line = (buffer.getLine(index)?.translateToString(true) || "").trim();
        const match = line.match(/^([0-9a-f]{64})\s+(.+)$/);
        if (match && match[2] === path) return match[1];
      }
      return false;
    },
    filePath,
    { timeout },
  );
  try {
    return await handle.jsonValue();
  } finally {
    await handle.dispose();
  }
};
const waitForGuestFileSize = async (timeout = 360_000) => {
  const handle = await page.waitForFunction(
    () => {
      const buffer = window.__term?.term?.buffer?.active;
      if (!buffer) return false;
      for (let index = 0; index < buffer.length; index += 1) {
        const line = (buffer.getLine(index)?.translateToString(true) || "").trim();
        const match = line.match(/^(?:~ # )*E3T22D_GUEST_SIZE=(\d+)$/);
        if (match) return Number(match[1]);
      }
      return false;
    },
    null,
    { timeout },
  );
  try {
    return await handle.jsonValue();
  } finally {
    await handle.dispose();
  }
};
const sleep = (milliseconds) => page.waitForTimeout(milliseconds);
const guestDrainTimeout = 360_000;

let browserEvidence;
try {
  const startedAt = Date.now();
  await page.goto(runUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const faviconProbe = await page.evaluate(async () => {
    const response = await fetch("/favicon.ico", { cache: "no-store" });
    return { status: response.status, url: response.url };
  });
  await page.getByRole("tab", { name: "Demo", exact: true }).click();
  await page.waitForFunction(
    () => window.wvmDemo && typeof window.wvmDemo.runBusybox === "function" && window.__term,
    null,
    { timeout: 120_000 },
  );
  await page.evaluate(() => { void window.wvmDemo.runBusybox(); });
  const bootProgress = setInterval(async () => {
    console.log(`[browser] boot tail=${JSON.stringify((await terminalBuffer()).slice(-240))}`);
  }, 30_000);
  try {
    await page.waitForFunction(
      () => {
        const buffer = window.__term?.term?.buffer?.active;
        if (!buffer) return false;
        for (let index = 0; index < buffer.length; index += 1) {
          const text = buffer.getLine(index)?.translateToString(true) || "";
          if (text.includes("busybox userland up") || text.includes("[fast-boot: host ready")) return true;
        }
        return false;
      },
      null,
      { timeout: 900_000 },
    );
  } finally {
    clearInterval(bootProgress);
  }
  await page.evaluate(() => window.__term.focus());
  await page.locator("#term").click();
  let promptReady = false;
  for (let attempt = 0; attempt < 18 && !promptReady; attempt += 1) {
    await send("\r");
    try {
      await waitForText("~ #", 5_000);
      promptReady = true;
    } catch {
      await sleep(1_000);
    }
  }
  assert(promptReady, "busybox shell did not render a prompt after restored-ready");

  // AC1: the guest constructs the OSC 52 sequence; the browser observes the actual host clipboard
  // write (or the preserved blocked-write affordance if Chromium denies it).
  await page.evaluate(() => {
    window.__e3t22dCopied = null;
    window.__e3t22dBlocked = null;
    window.__term.onClipboardCopied((text) => { window.__e3t22dCopied = text; });
    window.__term.onClipboardCopyBlocked((text) => { window.__e3t22dBlocked = text; });
  });
  const oscCopy = String.raw`printf '\033]52;c;%s\a' "$(printf hi | base64)"`;
  await send(`${oscCopy}; echo E3T22D_COPY_SENT\r`);
  try {
    await page.waitForFunction(
      () => window.__e3t22dCopied === "hi" || window.__e3t22dBlocked === "hi",
      null,
      { timeout: 30_000 },
    );
  } catch (error) {
    console.log(JSON.stringify({
      copyTimeout: true,
      callbacks: await page.evaluate(() => ({ copied: window.__e3t22dCopied, blocked: window.__e3t22dBlocked })),
      terminalTail: (await terminalBuffer()).slice(-1200),
    }));
    throw error;
  }
  const clipboardText = await page.evaluate(async () => {
    const value = await Promise.race([
      navigator.clipboard.readText(),
      new Promise((resolve) => setTimeout(() => resolve(null), 2_000)),
    ]);
    return value;
  });
  const copyObservation = await page.evaluate((clipboard) => ({
    copied: window.__e3t22dCopied,
    blocked: window.__e3t22dBlocked,
    clipboard,
  }), clipboardText);
  assert(
    copyObservation.copied === "hi" ||
      copyObservation.blocked === "hi" ||
      copyObservation.clipboard === "hi",
    `OSC 52 copy did not deliver hi: ${JSON.stringify(copyObservation)}`,
  );

  // AC2: multi-line paste through the same public terminal bridge. The trailing newline is
  // intentional: in canonical tty mode it leaves the line buffer empty, so the following Ctrl-D
  // is EOF rather than merely returning a partial final line to cat.
  await send("cat > /tmp/e3t22d-multi\r");
  await sleep(300);
  await page.evaluate(() => window.__term.pasteText("alpha\nbravo\ncharlie\n"));
  await sleep(500);
  await send("\x04");
  await send("cat /tmp/e3t22d-multi\r");
  await waitForText("alpha", 30_000);
  await waitForText("bravo", 30_000);
  await waitForText("charlie", 30_000);

  // AC2/AC3: one million UTF-8 bytes are enqueued in one paste call and verified by the guest's
  // sha256sum. Lines remain below the canonical tty limit so the only possible failure is queue loss,
  // reordering, or premature termination.
  const requestedBytes = Number(process.env.E3_T22D_BYTES || 1_000_000);
  assert(Number.isInteger(requestedBytes) && requestedBytes > 0 && requestedBytes % 1_000 === 0);
  const line = "0123456789".repeat(99) + "012345678";
  const payload = Array.from({ length: requestedBytes / 1_000 }, () => line).join("\n") + "\n";
  assert.equal(payload.length, requestedBytes);
  const expectedSha = createHash("sha256").update(payload).digest("hex");
  // Busybox cat echoes every byte on a tty. Disable echo for the bulk transfer so the proof measures
  // the input queue and guest file, not a million-character xterm repaint; restore it in the same
  // shell command that prints the digest.
  await send("stty -echo; echo E3T22D_ECHO_OFF\r");
  await waitForExactLine("E3T22D_ECHO_OFF", 30_000);
  await send("cat > /root/paste.txt\r");
  await sleep(300);
  await page.evaluate((value) => window.__term.pasteText(value), payload);
  const highWater = await page.evaluate(() => window.__term.highWater());
  assert.ok(highWater >= payload.length, `high-water ${highWater} < payload ${payload.length}`);
  await send("\x04");
  await send(
    `echo E3T22D_CAT_DONE; ls -l /root/paste.txt; ` +
      `guest_size="$(wc -c < /root/paste.txt)"; echo E3T22D_GUEST_SIZE=$guest_size; ` +
      `test "$guest_size" -eq ${payload.length} && ` +
      `echo E3T22D_SIZE_OK || echo E3T22D_SIZE_BAD; ` +
      `sha256sum /root/paste.txt; stty echo; echo E3T22D_ECHO_RESTORED\r`,
  );
  // The interpreted guest may take more than 30 seconds to drain a million-byte tty paste before
  // the shell resumes. Keep the synchronization bound aligned with the digest wait below.
  await waitForExactLine("E3T22D_CAT_DONE", guestDrainTimeout);
  const observedFileSize = await waitForGuestFileSize(guestDrainTimeout);
  assert.equal(observedFileSize, payload.length, `guest file size ${observedFileSize} != payload ${payload.length}`);
  await waitForExactLine("E3T22D_SIZE_OK", guestDrainTimeout);
  const observedSha = await waitForGuestSha("/root/paste.txt");
  assert.equal(observedSha, expectedSha, `guest SHA ${observedSha} != host SHA ${expectedSha}`);
  await waitForExactLine("E3T22D_ECHO_RESTORED", 30_000);

  // AC3: make the real guest enable DECSET 2004, then prove a pasted command is held until an
  // explicit Enter. Ctrl-C cancels the first held paste so the pre-Enter file check cannot be merged
  // into it; the second paste is committed by Enter and checked afterward.
  const enableBracketed = String.raw`printf '\033[?2004h'`;
  await send(`${enableBracketed}\r`);
  await sleep(500);
  const bracketedEnabled = await page.evaluate(() => window.__term.bracketedPasteEnabled());
  assert.equal(bracketedEnabled, true, "guest DECSET 2004 did not reach xterm mode state");
  const bracketedCommand = "touch /tmp/e3t22d-bracketed\nprintf E3T22D_SECOND\n";
  await page.evaluate((value) => window.__term.pasteText(value), bracketedCommand);
  await sleep(1_000);
  await send("\x03");
  await send("test -e /tmp/e3t22d-bracketed && echo E3T22D_EARLY || echo E3T22D_HELD\r");
  await waitForExactLine("E3T22D_HELD", 30_000);
  await page.evaluate((value) => window.__term.pasteText(value), bracketedCommand);
  await sleep(500);
  await send("\r");
  await send("test -e /tmp/e3t22d-bracketed && echo E3T22D_EXECUTED || echo E3T22D_MISSING\r");
  await waitForExactLine("E3T22D_EXECUTED", 30_000);

  await page.screenshot({ path: screenshotPath, fullPage: false });
  const networkErrors = [...cdpHttpErrors.values()];
  const allowedHttpErrors = networkErrors.filter(isFavicon404);
  const faviconUrl = new URL(faviconProbe.url);
  const favicon404Observed = faviconProbe.status === 404 && faviconUrl.pathname.toLowerCase().endsWith("/favicon.ico");
  const unexpectedHttpErrors = networkErrors.filter((error) => !isFavicon404(error));
  const resource404ConsoleErrors = rawConsoleErrors.filter((text) =>
    /failed to load resource.*404|404.*not found/i.test(text));
  const consoleErrors = rawConsoleErrors.filter((text) =>
    !/failed to load resource.*404|404.*not found/i.test(text));
  assert.equal(favicon404Observed, true, `favicon probe was not the allowed 404: ${JSON.stringify(faviconProbe)}`);
  assert.deepEqual(unexpectedHttpErrors, [], `unexpected HTTP errors: ${JSON.stringify(unexpectedHttpErrors)}`);
  assert.equal(
    resource404ConsoleErrors.length,
    allowedHttpErrors.length,
    `unattributed resource 404 console events: ${JSON.stringify({ resource404ConsoleErrors, allowedHttpErrors })}`,
  );
  assert.deepEqual(consoleErrors, [], `unexpected console errors: ${JSON.stringify(consoleErrors)}`);
  browserEvidence = {
    schema: "e3-t22d-browser-clipboard-v1",
    capturedOn: "2026-08-30 America/New_York",
    runtimeHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    recording: {
      url: runUrl,
      browser: "Playwright Chromium headed",
      browserVersion: browser.version(),
      sequence: "busybox boot → OSC 52 copy → multiline paste → 1 MiB sha256 → DECSET 2004 held/Enter",
      durationSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
      consoleErrors,
      rawConsoleErrors,
      resource404ConsoleErrors,
      networkErrors,
      allowedHttpErrors,
      faviconProbe,
    },
    copy: copyObservation,
    multiline: { expectedLines: ["alpha", "bravo", "charlie"], observed: true },
    oneMiB: {
      path: "/root/paste.txt",
      payloadBytes: payload.length,
      fileSize: observedFileSize,
      guestFileSize: observedFileSize,
      expectedSha,
      observedSha,
      highWater,
    },
    bracketedPaste: { modeEnabled: bracketedEnabled, heldUntilEnter: true, executedAfterEnter: true },
    screenshot: "evidence/e3-t22d/clipboard-browser-2026-08-30.png",
    supportingGates: [
      "node --test web/tests/osc52.test.mjs web/tests/paste.test.mjs",
      "make web-build",
      "git diff --check",
    ],
  };
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(evidencePath, `${JSON.stringify(browserEvidence, null, 2)}\n`);
  console.log(JSON.stringify(browserEvidence));
} finally {
  await browser.close();
}

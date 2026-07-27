import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(WEB, "..");
const EVIDENCE = path.resolve(REPO, "evidence/e3-t19");
const PROVIDER = process.env.E3_T19_GUEST_PROVIDER ?? "";
const CONTROL_URL = process.env.E3_T19_CONTROL_URL ?? "";
const AUTH_KEY = process.env.E3_T19_AUTH_KEY ?? "";
const EXIT_NODE_ID = process.env.E3_T19_EXIT_NODE_ID ?? "";
const RELAY_TOKEN = process.env.E3_T19_RELAY_TOKEN ?? "";
const PUBLIC_URL = process.env.E3_T19_PUBLIC_URL ?? "https://1.1.1.1/";
const haveAlpine =
  fs.existsSync(path.join(WEB, "artifacts-alpine.json")) &&
  fs.existsSync(path.resolve(WEB, "../releases/chunked-alpine/manifest.json"));

test("clean composed browser VM completes public HTTPS through the explicitly selected provider", async ({ page }) => {
  test.skip(!PROVIDER, "set E3_T19_GUEST_PROVIDER to tailscale or relay");
  test.setTimeout(3_600_000);
  expect(["tailscale", "relay"]).toContain(PROVIDER);
  expect(haveAlpine, "build the production Alpine artifacts before the guest proof").toBe(true);
  if (PROVIDER === "tailscale") {
    expect(CONTROL_URL).not.toBe("");
    expect(AUTH_KEY).not.toBe("");
    expect(EXIT_NODE_ID).not.toBe("");
  } else {
    expect(RELAY_TOKEN).not.toBe("");
  }

  const consoleErrors = [];
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && !text.includes("favicon.ico") &&
        !/Failed to load resource.*404/.test(text)) consoleErrors.push(text);
  });
  const terminal = () => page.evaluate(() => {
    const buffer = window.__term.term.buffer.active;
    const lines = [];
    for (let i = 0; i < buffer.length; i += 1) {
      lines.push(buffer.getLine(i)?.translateToString(true) || "");
    }
    return lines.join("\n");
  });
  const send = (text) =>
    page.evaluate((value) => window.__term.typeBytes(new TextEncoder().encode(value)), text);
  const waitForTerminal = (needle, timeout) => page.waitForFunction((value) => {
    const buffer = window.__term.term.buffer.active;
    for (let i = 0; i < buffer.length; i += 1) {
      if ((buffer.getLine(i)?.translateToString(true) || "").includes(value)) return true;
    }
    return false;
  }, needle, { timeout });

  await page.goto("/");
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120_000 });
  await page.selectOption("#network-provider", PROVIDER);
  if (PROVIDER === "tailscale") {
    await page.fill("#tailscale-control-url", CONTROL_URL);
    await page.fill("#tailscale-hostname", "wasm-vm-guest-exit-compose");
    await page.fill("#tailscale-auth-key", AUTH_KEY);
    await page.fill("#tailscale-exit-node", EXIT_NODE_ID);
    await page.check("#tailscale-accept-dns");
  } else {
    await page.fill("#network-relay-url", "ws://localhost:18081");
    await page.fill("#network-relay-token", RELAY_TOKEN);
  }
  await page.click("#boot-alpine");

  let sawOpenRC = false;
  for (let i = 0; i < 360; i += 1) {
    const text = await page.locator("#term .xterm-rows").textContent().catch(() => "");
    if (/Kernel panic|Unable to mount root/.test(text)) {
      throw new Error(`Alpine boot failed: ${text.slice(-2000)}`);
    }
    if (text.includes("OpenRC")) sawOpenRC = true;
    if (sawOpenRC && (text.includes("login:") ||
        (text.includes("Welcome to Alpine Linux") && text.includes("/dev/ttyS0")))) break;
    if (i === 359) throw new Error("Alpine did not reach post-OpenRC getty");
    await page.waitForTimeout(5_000);
  }
  if (PROVIDER === "tailscale") {
    await expect(page.locator("#tailscale-status")).toContainText("Running", { timeout: 120_000 });
  }
  await send("root\r");
  await page.waitForTimeout(3_000);
  await send("\r");
  await page.waitForTimeout(2_000);
  await send(
    `ip -4 addr show dev eth0 | grep -q '10.0.2.15/24' && echo E3T19_DHCP_"OK" || echo E3T19_DHCP_"FAIL"; ` +
    `timeout 180 wget -qO /dev/null '${PUBLIC_URL}'; rc=$?; ` +
    `[ $rc -eq 0 ] && echo E3T19_GUEST_HTTPS_"OK" provider=${PROVIDER} rc=$rc || ` +
    `echo E3T19_GUEST_HTTPS_"FAIL" provider=${PROVIDER} rc=$rc; echo E3T19_GUEST_"DONE"\r`,
  );
  await waitForTerminal("E3T19_GUEST_DONE", 900_000);
  const text = await terminal();

  expect(text).toContain("E3T19_DHCP_OK");
  expect(text).toContain(`E3T19_GUEST_HTTPS_OK provider=${PROVIDER} rc=0`);
  expect(text).not.toMatch(/E3T19_(DHCP|GUEST_HTTPS)_FAIL/);
  expect(consoleErrors, `console errors: ${consoleErrors.join("; ")}`).toEqual([]);
  for (const secret of [AUTH_KEY, RELAY_TOKEN].filter(Boolean)) {
    expect(requests.every((url) => !url.includes(secret))).toBe(true);
    expect(JSON.stringify(await page.evaluate(() => ({ ...localStorage, ...sessionStorage })))).not.toContain(secret);
  }

  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE, `guest-https-${PROVIDER}.txt`), text);
  await page.screenshot({
    path: path.join(EVIDENCE, `guest-https-${PROVIDER}.png`),
    fullPage: true,
  });
  console.log("E3_T19_GUEST_HTTPS", JSON.stringify({ provider: PROVIDER, publicUrl: PUBLIC_URL }));
});

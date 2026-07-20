// Opt-in E3-T17 end-to-end proof: the unmodified Alpine guest obtains DHCP behind slirp, resolves
// MagicDNS through 10.0.2.3, and reaches TCP/UDP services as the browser's Headscale identity.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(WEB, "..");
const EVIDENCE = path.resolve(REPO, "evidence/e3-t17");
const CONTROL_URL = process.env.E3_T17_CONTROL_URL ?? "";
const AUTH_KEY = process.env.E3_T17_AUTH_KEY ?? "";
const HOSTNAME = process.env.E3_T17_HOSTNAME ?? "wasm-vm-alpine-tailnet";
const PEER_NAME = process.env.E3_T17_PEER_NAME ?? "";
const PEER_PORT = Number(process.env.E3_T17_PEER_PORT ?? 0);
const PEER_UDP_PORT = Number(process.env.E3_T17_PEER_UDP_PORT ?? 0);
const EXIT_NODE_ID = process.env.E3_T17_EXIT_NODE_ID ?? "";
const PUBLIC_URL = process.env.E3_T17_PUBLIC_URL ?? "";
const EVIDENCE_STEM = PUBLIC_URL ? "alpine-exit" : "alpine-tailnet";
const haveAlpine =
  fs.existsSync(path.join(WEB, "artifacts-alpine.json")) &&
  fs.existsSync(path.resolve(WEB, "../releases/chunked-alpine/manifest.json"));

test("stock Alpine uses the browser Headscale node for DHCP, MagicDNS, TCP, and UDP", async ({ page }) => {
  test.skip(
    process.env.E3_T17_ALPINE !== "1" || !haveAlpine || !CONTROL_URL || !AUTH_KEY ||
      !PEER_NAME || !PEER_PORT || !PEER_UDP_PORT,
    "set E3_T17_ALPINE=1 and the live Headscale/peer environment",
  );
  test.setTimeout(2_700_000);
  fs.mkdirSync(EVIDENCE, { recursive: true });

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
  await page.selectOption("#network-provider", "tailscale");
  await page.fill("#tailscale-control-url", CONTROL_URL);
  await page.fill("#tailscale-hostname", HOSTNAME);
  await page.fill("#tailscale-auth-key", AUTH_KEY);
  if (EXIT_NODE_ID) await page.fill("#tailscale-exit-node", EXIT_NODE_ID);
  await page.check("#tailscale-accept-dns");
  await page.click("#boot-alpine");

  let sawOpenRC = false;
  for (let i = 0; i < 1200; i += 1) {
    const text = await page.locator("#term .xterm-rows").textContent().catch(() => "");
    if (/Kernel panic|Unable to mount root/.test(text)) {
      throw new Error(`Alpine boot failed: ${text.slice(-2000)}`);
    }
    if (text.includes("OpenRC")) sawOpenRC = true;
    if (sawOpenRC && text.includes("login:")) break;
    if (i === 1199) throw new Error("Alpine did not reach a post-OpenRC login prompt");
    await page.waitForTimeout(1500);
  }
  await expect(page.locator("#tailscale-status")).toContainText("Running", { timeout: 120_000 });
  await send("root\r");
  await page.waitForTimeout(3_000);
  await send("\r");
  await page.waitForTimeout(2_000);

  // Split output markers across shell tokens so terminal command echo cannot satisfy assertions.
  await send(
    `ip -4 addr show dev eth0 | grep -q '10.0.2.15/24' && echo E3T17_DHCP_"OK" || echo E3T17_DHCP_"FAIL"; ` +
    `[ "$(awk '/^nameserver/{print $2; exit}' /etc/resolv.conf)" = 10.0.2.3 ] && echo E3T17_DNSCFG_"OK" || echo E3T17_DNSCFG_"FAIL"; ` +
    `nslookup ${PEER_NAME} 10.0.2.3 >/tmp/e3t17-nslookup 2>&1; rc=$?; ` +
    `grep -q '100\\.64\\.' /tmp/e3t17-nslookup && echo E3T17_MAGICDNS_"OK" rc=$rc || echo E3T17_MAGICDNS_"FAIL" rc=$rc; ` +
    `body=$(wget -qO- http://${PEER_NAME}:${PEER_PORT}/alpine); rc=$?; ` +
    `[ "$body" = wasm-vm-tailnet-fixture ] && echo E3T17_TCP_"OK" rc=$rc || echo E3T17_TCP_"FAIL" rc=$rc body=$body; ` +
    `udp=$(timeout 60 sh -c 'printf e3t17-guest-udp | nc -u -w 10 ${PEER_NAME} ${PEER_UDP_PORT}'); rc=$?; ` +
    `[ "$udp" = e3t17-guest-udp ] && echo E3T17_UDP_"OK" rc=$rc || echo E3T17_UDP_"FAIL" rc=$rc body=$udp; ` +
    (PUBLIC_URL
      ? `timeout 120 wget -qO /dev/null '${PUBLIC_URL}'; rc=$?; [ $rc -eq 0 ] && echo E3T17_HTTPS_"OK" rc=$rc || echo E3T17_HTTPS_"FAIL" rc=$rc; `
      : "") +
    `echo E3T17_"DONE"\r`,
  );
  await waitForTerminal("E3T17_DONE", 900_000);
  const text = await terminal();
  const dhcpStats = await page.evaluate(() => window.__dhcpStats());
  const status = await page.locator("#tailscale-status").textContent();

  expect(text).toContain("E3T17_DHCP_OK");
  expect(text).toContain("E3T17_DNSCFG_OK");
  expect(text).toContain("E3T17_MAGICDNS_OK rc=0");
  expect(text).toContain("E3T17_TCP_OK rc=0");
  if (PUBLIC_URL) expect(text).toContain("E3T17_HTTPS_OK rc=0");
  expect(text).toContain("E3T17_UDP_OK rc=0");
  expect(text).not.toMatch(/E3T17_(DHCP|DNSCFG|MAGICDNS|TCP|UDP)_FAIL/);
  expect(status).toContain(HOSTNAME);
  expect(requests.filter((url) => url.endsWith("/tailscale-connect/main.wasm"))).toHaveLength(1);
  expect(requests.every((url) => !url.includes(AUTH_KEY))).toBe(true);
  expect(consoleErrors, `console errors: ${consoleErrors.join("; ")}`).toEqual([]);

  // Only a fully passing run may replace durable evidence. Public-exit proof is kept separate
  // from the already-verified tailnet-only run so a failed experiment cannot erase either.
  fs.writeFileSync(path.join(EVIDENCE, `${EVIDENCE_STEM}-terminal.txt`), text);
  fs.writeFileSync(path.join(EVIDENCE, `${EVIDENCE_STEM}-summary.json`), `${JSON.stringify({
    hostname: HOSTNAME,
    peerName: PEER_NAME,
    peerPort: PEER_PORT,
    peerUdpPort: PEER_UDP_PORT,
    exitNodeId: EXIT_NODE_ID || null,
    publicUrl: PUBLIC_URL || null,
    dhcpStats,
    status,
    consoleErrors,
    tailscaleArtifactRequests: requests.filter((url) => url.endsWith("/tailscale-connect/main.wasm")).length,
  }, null, 2)}\n`);
  await page.screenshot({ path: path.join(EVIDENCE, `${EVIDENCE_STEM}.png`), fullPage: true });
});

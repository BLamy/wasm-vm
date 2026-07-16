import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = process.env.WASM_VM_E3_T15_EVIDENCE_DIR
  ? path.resolve(repo, process.env.WASM_VM_E3_T15_EVIDENCE_DIR)
  : path.join(repo, "evidence/e3-t15");
const webBase = (process.env.WASM_VM_E3_T15_WEB_BASE || "http://127.0.0.1:8124").replace(/\/$/, "");
const fixtureBase = (process.env.WASM_VM_E3_T15_DOH_BASE || "http://127.0.0.1:8053").replace(/\/$/, "");
const { chromium } = await import(
  pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")).href
);
await fs.mkdir(out, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--disable-dev-shm-usage", "--js-flags=--max-old-space-size=4096"],
});
const context = await browser.newContext({
  viewport: { width: 1800, height: 1200 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  const text = message.text();
  if (
    message.type() === "error" &&
    !text.includes("favicon.ico") &&
    !/Failed to load resource.*404/.test(text)
  ) {
    consoleErrors.push(text);
  }
});
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

const rows = page.locator("#term .xterm-rows");
const terminalText = () => rows.textContent().catch(() => "");
const terminalBuffer = () =>
  page.evaluate(() => {
    const buffer = window.__term.term.buffer.active;
    const lines = [];
    for (let index = 0; index < buffer.length; index += 1) {
      lines.push(buffer.getLine(index)?.translateToString(true) || "");
    }
    return lines.join("\n");
  });
const send = (text) =>
  page.evaluate(
    (value) => window.__term.typeBytes(new TextEncoder().encode(value)),
    text,
  );
const waitForTerminal = async (needle, timeout = 120_000) => {
  await page.waitForFunction(
    (value) => document.querySelector("#term .xterm-rows")?.textContent?.includes(value),
    needle,
    { timeout },
  );
};
const runCommand = async (command, marker, timeout = 120_000) => {
  console.log(`[browser] command ${marker}`);
  await send(`${command}; echo E3T15_"${marker}"\r`);
  await waitForTerminal(`E3T15_${marker}`, timeout);
  return terminalBuffer();
};
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const fixture = async (path) => {
  const response = await fetch(`${fixtureBase}${path}`);
  if (!response.ok) throw new Error(`fixture ${path}: HTTP ${response.status}`);
  return response;
};

let progressTimer;
try {
  await fixture("/reset");
  await fixture("/mode/hang");
  const target =
    `${webBase}/?slirpDoh=` +
    encodeURIComponent(`${fixtureBase}/dns-query`) +
    "&slirpLeaseSecs=60&e3t15=browser-final";
  console.log(`[browser] one cold load: ${target}`);
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120_000 });
  assert(await page.locator("#boot-alpine").isEnabled(), "full Alpine boot button disabled");
  const corsProbe = await page.evaluate(async (base) => {
    const response = await fetch(`${base}/counts`);
    return { ok: response.ok, body: await response.text() };
  }, fixtureBase);
  assert(corsProbe.ok, `browser cannot reach cross-origin DoH fixture: ${corsProbe.body}`);
  await page.click("#boot-alpine");
  const startedAt = Date.now();
  progressTimer = setInterval(async () => {
    try {
      const text = await terminalText();
      console.log(`[browser] boot ${(Date.now() - startedAt) / 1000 | 0}s tail=${JSON.stringify(text.slice(-180))}`);
    } catch {}
  }, 30_000);

  let sawOpenRC = false;
  let loggedIn = false;
  for (let index = 0; index < 1200; index += 1) {
    const text = await terminalText();
    if (/Kernel panic|Unable to mount root/.test(text)) throw new Error("Alpine kernel panic");
    if (text.includes("OpenRC")) sawOpenRC = true;
    if (sawOpenRC && text.includes("login:")) {
      loggedIn = true;
      break;
    }
    await page.waitForTimeout(1500);
  }
  clearInterval(progressTimer);
  progressTimer = undefined;
  assert(loggedIn, "stock Alpine did not reach login within 30 minutes");
  const loginSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(1));
  console.log(`[browser] login reached in ${loginSeconds}s while DoH was unavailable`);
  await send("root\r");
  await page.waitForTimeout(3000);
  await send("\r");
  await page.waitForTimeout(2000);

  let text = await runCommand(
    "ip -4 addr show dev eth0; ip route; cat /etc/resolv.conf",
    "AUTO_OK",
  );
  assert(text.includes("10.0.2.15/24"), "DHCP address 10.0.2.15/24 absent");
  assert(/default via 10\.0\.2\.2/.test(text), "DHCP default route absent");
  assert(/nameserver 10\.0\.2\.3/.test(text), "DHCP DNS server absent");

  text = await runCommand(
    "start=$(date +%s); nslookup -type=A fail.test; rc=$?; elapsed=$(($(date +%s)-start)); echo E3T15_\"FAIL_RESULT\" rc=$rc elapsed=$elapsed",
    "SERVFAIL_DONE",
  );
  let match = text.match(/E3T15_FAIL_RESULT rc=(\d+) elapsed=(\d+)/);
  assert(match && Number(match[1]) !== 0 && Number(match[2]) <= 5, `SERVFAIL was not fast: ${match}`);
  text = await runCommand(
    "start=$(date +%s); wget -T 5 -O /tmp/e3t15-fail http://fail.test/; rc=$?; elapsed=$(($(date +%s)-start)); echo E3T15_\"WGET_FAIL\" rc=$rc elapsed=$elapsed",
    "WGET_DONE",
  );
  match = text.match(/E3T15_WGET_FAIL rc=(\d+) elapsed=(\d+)/);
  assert(match && Number(match[1]) !== 0 && Number(match[2]) <= 5, `wget DNS failure was not fast: ${match}`);

  await fixture("/mode/success");
  text = await runCommand("nslookup dl-cdn.alpinelinux.org", "PUBLIC_OK");
  assert(text.includes("192.0.2.42"), "public-name DoH answer absent");

  text = await runCommand(
    "nslookup -type=A cache.test; nslookup -type=A cache.test",
    "CACHE_OK",
  );
  assert(text.includes("192.0.2.42"), "cache.test answer absent");
  let counts = await (await fixture("/counts")).json();
  assert(counts.counts["cache.test"] === 1, `cache.test upstream count ${counts.counts["cache.test"]}`);

  text = await runCommand(
    "printf '\\022\\064\\001\\000\\000\\001\\000\\000\\000\\000\\000\\000\\005large\\004test\\000\\000\\001\\000\\001' >/tmp/dns.q; cat /tmp/dns.q | nc -u -w 2 10.0.2.3 53 >/tmp/dns.udp; flags=$(dd if=/tmp/dns.udp bs=1 skip=2 count=2 2>/dev/null | hexdump -v -e '2/1 \"%02x\"'); ping -c 1 -W 1 large.test; ping_rc=$?; echo E3T15_\"TCP_PROOF\" udp_flags=$flags ping_rc=$ping_rc",
    "TCP_FALLBACK_OK",
  );
  match = text.match(/E3T15_TCP_PROOF udp_flags=([0-9a-f]+) ping_rc=(\d+)/);
  assert(match && match[1] === "8380", `UDP DNS answer did not set TC: ${match}\n${text.slice(-3000)}`);
  const automaticTcpAddress = text.match(/PING large\.test \((192\.0\.2\.\d+)\)/)?.[1];
  assert(
    automaticTcpAddress,
    `the guest resolver did not automatically retry the TC response over TCP: ${match}\n${text.slice(-3000)}`,
  );
  const tcpFallback = {
    udpFlags: match[1],
    guestCommand: "ping large.test",
    resolvedAddress: automaticTcpAddress,
    scriptedTcpQuery: false,
  };
  counts = await (await fixture("/counts")).json();
  assert(counts.counts["large.test"] === 1, `large.test upstream count ${counts.counts["large.test"]}`);

  text = await runCommand(
    "start=$(date +%s); nslookup -type=A nxdomain.test; rc=$?; elapsed=$(($(date +%s)-start)); echo E3T15_\"NXDOMAIN\" rc=$rc elapsed=$elapsed",
    "NXDOMAIN_DONE",
  );
  match = text.match(/E3T15_NXDOMAIN rc=(\d+) elapsed=(\d+)/);
  assert(match && Number(match[1]) !== 0 && Number(match[2]) <= 5, `NXDOMAIN was not fast: ${match}`);

  const dhcpBefore = await page.evaluate(() => window.__dhcpStats());
  assert(dhcpBefore, "DHCP diagnostics unavailable before the T1 check");
  text = await runCommand(
    "sleep 35; ping -c 1 -W 3 10.0.2.2; ip -4 addr show dev eth0",
    "RENEW_OK",
    180_000,
  );
  assert(text.includes("1 packets received"), "gateway ping failed after DHCP T1");
  assert(text.includes("10.0.2.15/24"), "lease missing after DHCP T1");
  const dhcpAfter = await page.evaluate(() => window.__dhcpStats());
  assert(
    dhcpAfter.renewRequests > dhcpBefore.renewRequests && dhcpAfter.renewAcks > dhcpBefore.renewAcks,
    `the production DHCP server did not observe a real client RENEW→ACK during T1: ${JSON.stringify({ dhcpBefore, dhcpAfter })}`,
  );

  const rawTerminal = await terminalBuffer();
  await fs.writeFile(`${out}/browser-terminal.txt`, rawTerminal);
  await page.locator("#panel-terminal").screenshot({ path: `${out}/browser-terminal.png` }).catch(async () => {
    await page.screenshot({ path: `${out}/browser-terminal.png`, fullPage: true });
  });

  await send("poweroff -f\r");
  await page.waitForFunction(
    () => document.querySelector("#status")?.textContent?.includes("machine halted"),
    null,
    { timeout: 300_000 },
  );
  const haltedStatus = await page.locator("#status").textContent();
  assert(haltedStatus.includes("exited:0"), `guest did not halt cleanly: ${haltedStatus}`);
  assert(consoleErrors.length === 0, `console errors after boot: ${consoleErrors.join("; ")}`);

  await page.locator("#suite-run").waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForFunction(() => !document.querySelector("#suite-run")?.disabled, null, { timeout: 60_000 });
  await page.click("#suite-run");
  await page.waitForFunction(
    () => document.querySelector("#suite-status")?.textContent?.startsWith("complete in"),
    null,
    { timeout: 600_000 },
  );
  const passed = Number(await page.locator("#metric-pass").textContent());
  const failed = Number(await page.locator("#metric-fail").textContent());
  assert(passed === 126 && failed === 0, `browser suite: ${passed} passed, ${failed} failed`);
  await page.locator("#panel-tests").screenshot({ path: `${out}/browser-suite.png` }).catch(async () => {
    await page.screenshot({ path: `${out}/browser-suite.png`, fullPage: true });
  });

  const roadmapItem = page.getByText("Zero-config Alpine DHCP + DNS", { exact: true });
  await roadmapItem.scrollIntoViewIfNeeded();
  const roadmapCard = roadmapItem.locator("xpath=ancestor::li[contains(@class,'cap')][1]");
  const roadmapText = await roadmapCard.textContent().catch(() => "");
  const roadmapPipClass = await roadmapCard.locator(".cap-pip").getAttribute("class");
  assert(roadmapPipClass?.includes("verified"), `roadmap pip is not verified: ${roadmapPipClass}`);
  await page.locator("#panel-roadmap").screenshot({ path: `${out}/browser-roadmap.png` }).catch(async () => {
    await page.screenshot({ path: `${out}/browser-roadmap.png`, fullPage: true });
  });
  assert(consoleErrors.length === 0, `final console errors: ${consoleErrors.join("; ")}`);

  counts = await (await fixture("/counts")).json();
  const summary = {
    url: target,
    coldLoads: 1,
    loginSeconds,
    runSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
    dhcp: {
      address: "10.0.2.15/24",
      gateway: "10.0.2.2",
      dns: "10.0.2.3",
      leaseSeconds: 60,
      beforeT1: dhcpBefore,
      afterT1: dhcpAfter,
    },
    doh: { endpoint: `${fixtureBase}/dns-query`, counts },
    tcpFallback,
    suite: { passed, failed },
    haltedStatus,
    roadmap: { text: roadmapText, pipClass: roadmapPipClass },
    consoleErrors,
  };
  await fs.writeFile(`${out}/browser-summary.json`, JSON.stringify(summary, null, 2) + "\n");
  await fs.writeFile(`${out}/browser-console-errors.txt`, consoleErrors.join("\n"));
  console.log(`[browser] PASS ${JSON.stringify(summary)}`);
} catch (error) {
  if (progressTimer) clearInterval(progressTimer);
  console.error(`[browser] FAIL ${error.stack || error}`);
  try {
    const rawTerminal = await terminalBuffer();
    await fs.writeFile(`${out}/browser-failure-terminal.txt`, rawTerminal);
    await fs.writeFile(`${out}/browser-failure-errors.txt`, `${error.stack || error}\n${consoleErrors.join("\n")}`);
    await page.screenshot({ path: `${out}/browser-failure.png`, fullPage: true });
  } catch {}
  await browser.close();
  process.exitCode = 1;
  throw error;
}

await browser.close();

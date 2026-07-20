// Full E3-T16 browser acceptance: boot stock Alpine, let its real DHCP client configure eth0,
// then wget a deterministic 100 MiB object through BrowserWebSocketTransport -> WsConnector ->
// wvrelay -> a real local HTTP server. Opt-in because the browser interpreter boot/transfer is long.
import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(WEB, "..");
const EVIDENCE = process.env.E3_T16_EVIDENCE_DIR
  ? path.resolve(REPO, process.env.E3_T16_EVIDENCE_DIR)
  : path.resolve(REPO, "evidence/e3-t16");
const TOTAL = 100 * 1024 * 1024;
const CHUNK = Buffer.from({ length: 1024 * 1024 }, (_, i) => i % 251);

async function startHttpFixture() {
  const expected = createHash("sha256");
  for (let sent = 0; sent < TOTAL; sent += CHUNK.length) expected.update(CHUNK);
  const sha256 = expected.digest("hex");
  const server = http.createServer(async (req, res) => {
    if (req.url !== "/100mb.bin") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(TOTAL),
      Connection: "close",
    });
    for (let sent = 0; sent < TOTAL; sent += CHUNK.length) {
      if (!res.write(CHUNK)) await new Promise((resolve) => res.once("drain", resolve));
    }
    res.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    port: server.address().port,
    sha256,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function startRelay() {
  const binary = path.resolve(REPO, "target/debug/wvrelay");
  if (!fs.existsSync(binary)) {
    throw new Error(`missing ${binary}; run cargo build -p wasm-vm-cli --bin wvrelay`);
  }
  const child = spawn(binary, ["127.0.0.1:0"], {
    cwd: REPO,
    env: { ...process.env, WVRELAY_HOST_MAP: "192.0.2.1=127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = await new Promise((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(() => reject(new Error(`wvrelay readiness timeout: ${stdout}`)), 10_000);
    child.once("error", reject);
    child.stdout.on("data", (data) => {
      stdout += data.toString();
      const match = stdout.match(/ws:\/\/[^\s]+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
  });
  return { url, close: () => child.kill("SIGTERM") };
}

test("stock Alpine wget verifies 100 MiB through one browser WebSocket relay", async ({ page }) => {
  test.skip(process.env.E3_T16_FULL !== "1", "set E3_T16_FULL=1 for the full Alpine relay proof");
  test.setTimeout(7_200_000);
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const fixture = await startHttpFixture();
  const relay = await startRelay();
  const errors = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && !text.includes("favicon.ico")) errors.push(text);
  });
  const terminal = () =>
    page.evaluate(() => {
      const buffer = window.__term.term.buffer.active;
      const lines = [];
      for (let i = 0; i < buffer.length; i += 1) {
        lines.push(buffer.getLine(i)?.translateToString(true) || "");
      }
      return lines.join("\n");
    });
  const send = (text) =>
    page.evaluate((value) => window.__term.typeBytes(new TextEncoder().encode(value)), text);
  const waitForTerminal = (needle, timeout) =>
    page.waitForFunction(
      (value) => {
        const buffer = window.__term.term.buffer.active;
        for (let i = 0; i < buffer.length; i += 1) {
          if ((buffer.getLine(i)?.translateToString(true) || "").includes(value)) return true;
        }
        return false;
      },
      needle,
      { timeout },
    );

  const waitForAlpineLogin = async () => {
    let sawOpenRC = false;
    for (let i = 0; i < 1200; i += 1) {
      const text = await page.locator("#term .xterm-rows").textContent().catch(() => "");
      if (/Kernel panic|Unable to mount root/.test(text)) {
        throw new Error(`Alpine boot failed: ${text.slice(-2000)}`);
      }
      if (text.includes("OpenRC")) sawOpenRC = true;
      if (sawOpenRC && text.includes("login:")) return;
      await page.waitForTimeout(1500);
    }
    throw new Error("Alpine did not reach a post-OpenRC login prompt within 30 minutes");
  };

  try {
    await page.goto(`/?slirpRelay=${encodeURIComponent(relay.url)}&e3t16=full`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 120_000 });
    await page.click("#boot-alpine");
    await waitForAlpineLogin();
    await send("root\r");
    await page.waitForTimeout(3_000);
    await send("\r"); // dismiss an optional Password:
    await page.waitForTimeout(2_000);

    const started = Date.now();
    await send(
      `wget -qO /root/e3t16-100m http://192.0.2.1:${fixture.port}/100mb.bin; rc=$?; ` +
        `bytes=$(wc -c </root/e3t16-100m); hash=$(sha256sum /root/e3t16-100m | cut -d' ' -f1); ` +
        `echo E3T16_"WGET" rc=$rc bytes=$bytes sha256=$hash\r`,
    );
    await waitForTerminal("E3T16_WGET", 5_400_000);
    const text = await terminal();
    const match = text.match(/E3T16_WGET rc=(\d+) bytes=(\d+) sha256=([0-9a-f]{64})/);
    expect(match, text.slice(-4000)).not.toBeNull();

    fs.writeFileSync(path.join(EVIDENCE, "alpine-relay-terminal.txt"), text);
    fs.writeFileSync(
      path.join(EVIDENCE, "alpine-relay-summary.json"),
      JSON.stringify(
        {
          relay: relay.url,
          expectedBytes: TOTAL,
          expectedSha256: fixture.sha256,
          wgetExitCode: Number(match[1]),
          receivedBytes: Number(match[2]),
          receivedSha256: match[3],
          seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
          consoleErrors: errors,
        },
        null,
        2,
      ) + "\n",
    );
    await page.screenshot({
      path: path.join(EVIDENCE, "alpine-relay-100m.png"),
      fullPage: true,
    });

    expect(Number(match[1])).toBe(0);
    expect(Number(match[2])).toBe(TOTAL);
    expect(match[3]).toBe(fixture.sha256);
    expect(errors, `console errors: ${errors.join("; ")}`).toEqual([]);
    await send("rm -f /root/e3t16-100m; poweroff -f\r");
  } finally {
    relay.close();
    await fixture.close();
  }
});

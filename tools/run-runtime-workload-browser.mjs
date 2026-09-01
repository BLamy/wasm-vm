#!/usr/bin/env node
/**
 * Browser adapter for web/bench-runtime-workloads.mjs.
 *
 * A fresh browser context gets its own IndexedDB namespace, so a benchmark never
 * competes with a user's open wasm-vm tab for the persistent guest disk. The
 * adapter uploads the exact local runner, waits for the real guest shell, runs
 * the requested variant, and retrieves the raw JSON through the guest console.
 */

import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(repositoryRoot, "web/node_modules/playwright"));

const VARIANTS = Object.freeze({
  "worker-jit": { environment: "wasm-vm-worker-jit", query: [] },
  "worker-interpreter": { environment: "wasm-vm-worker-interpreter", query: [["jit", "0"]] },
  "main-interpreter": { environment: "wasm-vm-main-interpreter", query: [["worker", "0"], ["jit", "0"]] },
});

function parseArguments(argv) {
  const options = {
    variant: "worker-jit",
    baseUrl: "https://wasm-vm.pages.dev",
    samples: 7,
    warmups: 2,
    payloadKib: 1024,
    streamChunkKib: 64,
    httpRequests: 8,
    headless: false,
    timeoutMs: 900_000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (!argument.startsWith("--")) throw new Error(`unexpected argument: ${argument}`);
    const separator = argument.indexOf("=");
    const key = separator === -1 ? argument.slice(2) : argument.slice(2, separator);
    const value = separator === -1 ? argv[++index] : argument.slice(separator + 1);
    if (value === undefined || value === "") throw new Error(`missing value for --${key}`);
    switch (key) {
      case "variant": options.variant = value; break;
      case "base-url": options.baseUrl = value; break;
      case "samples": options.samples = Number(value); break;
      case "warmups": options.warmups = Number(value); break;
      case "payload-kib": options.payloadKib = Number(value); break;
      case "stream-chunk-kib": options.streamChunkKib = Number(value); break;
      case "http-requests": options.httpRequests = Number(value); break;
      case "headless": options.headless = value !== "false" && value !== "0"; break;
      case "timeout-ms": options.timeoutMs = Number(value); break;
      case "output": options.output = value; break;
      default: throw new Error(`unknown option: --${key}`);
    }
  }
  if (!VARIANTS[options.variant]) throw new Error(`unknown variant: ${options.variant}`);
  for (const [name, value] of Object.entries(options)) {
    if (["variant", "baseUrl", "headless", "output"].includes(name)) continue;
    if (!Number.isInteger(value) || value <= 0) throw new Error(`--${name} must be a positive integer`);
  }
  return options;
}

function usage() {
  return `Usage: node tools/run-runtime-workload-browser.mjs [options]

Options:
  --variant=worker-jit|worker-interpreter|main-interpreter
  --base-url=https://wasm-vm.pages.dev
  --samples=7 --warmups=2 --payload-kib=1024 --stream-chunk-kib=64 --http-requests=8
  --headless=false --timeout-ms=900000 --output=/tmp/capture.json
`;
}

async function runGuest(page, command, timeoutMs) {
  const result = await page.evaluate(async ({ command: guestCommand, timeout }) => {
    if (!globalThis.wvmDemo?.isGuestUp?.()) throw new Error("guest is not up");
    const marker = `__RUNTIME_BENCH_END_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const decoder = new TextDecoder();
    let output = "";
    return await new Promise((resolve, reject) => {
      let timer;
      const unsubscribe = globalThis.wvmDemo.onConsole((bytes) => {
        output += decoder.decode(bytes, { stream: true })
          .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
          .replace(/\r/g, "");
        const match = output.match(new RegExp(`${marker}_(\\d+)`));
        if (!match) return;
        clearTimeout(timer);
        unsubscribe();
        let stdout = output.slice(0, match.index);
        const firstNewline = stdout.indexOf("\n");
        if (firstNewline !== -1) stdout = stdout.slice(firstNewline + 1);
        resolve({ stdout, exit: Number(match[1]) });
      });
      timer = setTimeout(() => {
        unsubscribe();
        reject(new Error("guest command timed out"));
      }, timeout);
      setTimeout(() => {
        globalThis.wvmDemo.sendInput(new TextEncoder().encode(
          `${guestCommand}; printf '\\n${marker}_%s\\n' "$?"\r`,
        ));
      }, 0);
    });
  }, { command, timeout: timeoutMs });
  if (!result || result.exit !== 0) {
    throw new Error(`guest command failed (exit ${result?.exit ?? "unknown"}): ${result?.stdout ?? ""}`);
  }
  return result.stdout ?? "";
}

async function uploadRunner(page, source, timeoutMs) {
  const encoded = source.toString("base64");
  await runGuest(page, ": > /tmp/bench-runtime-workloads.mjs", timeoutMs);
  // Keep each shell line below the guest tty's canonical input limit. The terminal bridge
  // backpressures large writes, but busybox ash still has a finite line buffer; a too-large
  // base64 command can be truncated before ash executes it and leave the RPC waiting forever.
  const chunkSize = 2_000;
  for (let offset = 0; offset < encoded.length; offset += chunkSize) {
    const chunk = encoded.slice(offset, offset + chunkSize);
    await runGuest(page, `printf '%s' '${chunk}' | base64 -d >> /tmp/bench-runtime-workloads.mjs`, timeoutMs);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const variant = VARIANTS[options.variant];
  const sourcePath = path.join(repositoryRoot, "web/bench-runtime-workloads.mjs");
  const source = await readFile(sourcePath);
  const url = new URL("/app.html", options.baseUrl);
  url.searchParams.set("guest", "node-alpine");
  url.searchParams.set("nosw", "");
  url.searchParams.set("persist", "1");
  url.searchParams.set("diagnosticStats", "1");
  for (const [key, value] of variant.query) url.searchParams.set(key, value);
  url.hash = "ide";

  const browser = await chromium.launch({ headless: options.headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(options.timeoutMs);
  page.setDefaultNavigationTimeout(options.timeoutMs);
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const startedAt = Date.now();
  try {
    await page.goto(url.href, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => Boolean(globalThis.wvmDemo?.isGuestReady?.()),
      undefined,
      { timeout: options.timeoutMs },
    );
    const readyMs = Date.now() - startedAt;
    await uploadRunner(page, source, options.timeoutMs);
    const guestOutputPath = "/tmp/runtime-workloads.json";
    const benchmarkCommand = [
      "node /tmp/bench-runtime-workloads.mjs",
      `--environment=${variant.environment}`,
      `--samples=${options.samples}`,
      `--warmups=${options.warmups}`,
      `--payload-kib=${options.payloadKib}`,
      `--stream-chunk-kib=${options.streamChunkKib}`,
      `--http-requests=${options.httpRequests}`,
      `--output=${guestOutputPath}`,
    ].join(" ");
    await runGuest(page, benchmarkCommand, options.timeoutMs);
    const encodedResult = await runGuest(
      page,
      `node -e "process.stdout.write(require('node:fs').readFileSync('${guestOutputPath}','base64'))"`,
      options.timeoutMs,
    );
    const result = JSON.parse(Buffer.from(encodedResult.replace(/\s+/g, ""), "base64").toString("utf8"));
    result.browser = {
      adapter: "tools/run-runtime-workload-browser.mjs",
      url: url.href,
      variant: options.variant,
      readyMs,
      consoleErrors,
      pageErrors,
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (options.output) await writeFile(path.resolve(options.output), serialized);
    process.stdout.write(`RUNTIME_BROWSER_WORKLOAD_RESULT=${JSON.stringify({
      output: options.output ? path.resolve(options.output) : null,
      status: result.status,
      environment: result.environment,
      readyMs,
      consoleErrors,
      pageErrors,
      workloads: result.workloads.map((workload) => ({ id: workload.id, summary: workload.summary })),
    })}\n`);
    if (consoleErrors.length > 0 || pageErrors.length > 0) process.exitCode = 2;
    if (!options.output) process.stdout.write(serialized);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});

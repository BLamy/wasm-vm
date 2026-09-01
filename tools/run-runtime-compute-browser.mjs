#!/usr/bin/env node
/**
 * Browser adapter for web/bench-runtime-compute.mjs.
 *
 * The browser only supplies the real Node-alpine guest. The exact checked-in compute runner is
 * uploaded into that guest, executed with the requested variant, and retrieved as raw JSON so the
 * result keeps its fixed checksums, individual samples, and environment metadata.
 */

import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(repositoryRoot, "web/node_modules/playwright"));

const VARIANTS = Object.freeze({
  "worker-jit": { environment: "wasm-vm-worker-jit", query: [] },
  "worker-interpreter": { environment: "wasm-vm-worker-interpreter", query: [["jit", "0"]] },
  "main-interpreter": {
    environment: "wasm-vm-main-interpreter",
    query: [["worker", "0"], ["jit", "0"]],
  },
});

function parseArguments(argv) {
  const options = {
    variant: "worker-jit",
    baseUrl: "https://wasm-vm.pages.dev",
    samples: 7,
    warmups: 2,
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
      case "headless": options.headless = value !== "false" && value !== "0"; break;
      case "timeout-ms": options.timeoutMs = Number(value); break;
      case "output": options.output = value; break;
      default: throw new Error(`unknown option: --${key}`);
    }
  }
  if (!VARIANTS[options.variant]) throw new Error(`unknown variant: ${options.variant}`);
  for (const [name, value] of Object.entries(options)) {
    if (["variant", "baseUrl", "headless", "output"].includes(name)) continue;
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`--${name} must be a positive integer`);
    }
  }
  return options;
}

function usage() {
  return `Usage: node tools/run-runtime-compute-browser.mjs [options]

Options:
  --variant=worker-jit|worker-interpreter|main-interpreter
  --base-url=https://wasm-vm.pages.dev
  --samples=7 --warmups=2 --headless=false --timeout-ms=900000
  --output=/tmp/wasm-vm-runtime-compute.json
`;
}

async function runGuest(page, command, timeoutMs) {
  const result = await page.evaluate(async ({ command: guestCommand, timeout }) => {
    if (!globalThis.wvmDemo?.isGuestUp?.()) throw new Error("guest is not up");
    const marker = `__RUNTIME_COMPUTE_END_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
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
  await runGuest(page, ": > /tmp/bench-runtime-compute.mjs", timeoutMs);
  const chunkSize = 2_000;
  for (let offset = 0; offset < encoded.length; offset += chunkSize) {
    const chunk = encoded.slice(offset, offset + chunkSize);
    await runGuest(
      page,
      `printf '%s' '${chunk}' | base64 -d >> /tmp/bench-runtime-compute.mjs`,
      timeoutMs,
    );
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const variant = VARIANTS[options.variant];
  const source = await readFile(path.join(repositoryRoot, "web/bench-runtime-compute.mjs"));
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
    if (message.type() === "error" && !message.text().includes("favicon")) {
      consoleErrors.push(message.text());
    }
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
    const guestOutputPath = "/tmp/runtime-compute.json";
    await runGuest(
      page,
      [
        "node /tmp/bench-runtime-compute.mjs",
        `--environment=${variant.environment}`,
        `--samples=${options.samples}`,
        `--warmups=${options.warmups}`,
        `--output=${guestOutputPath}`,
      ].join(" "),
      options.timeoutMs,
    );
    const encodedResult = await runGuest(
      page,
      `node -e "process.stdout.write(require('node:fs').readFileSync('${guestOutputPath}','base64'))"`,
      options.timeoutMs,
    );
    const result = JSON.parse(
      Buffer.from(encodedResult.replace(/\s+/g, ""), "base64").toString("utf8"),
    );
    result.browser = {
      adapter: "tools/run-runtime-compute-browser.mjs",
      url: url.href,
      variant: options.variant,
      readyMs,
      consoleErrors,
      pageErrors,
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (options.output) await writeFile(path.resolve(options.output), serialized);
    process.stdout.write(`RUNTIME_BROWSER_COMPUTE_RESULT=${JSON.stringify({
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

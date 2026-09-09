#!/usr/bin/env node

// E5-T07a: native guest-facing virtio-gpu probe proof. This deliberately uses the rebuilt
// kernel + checked-in initramfs through the native CLI; browser presentation belongs to T07b.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceDir = path.join(repo, "evidence/e5-t07a");
const cli = path.join(repo, "target/release/wasm-vm");
const kernel = path.join(repo, "releases/kernel/6.6.63/Image");
const initrd = path.join(repo, "releases/initramfs/initramfs.cpio.gz");
const fixture = path.join(repo, "tests/fixtures/gpu-probe.log");
const tracePath = path.join(evidenceDir, "gpu-probe.log");
const stdoutPath = path.join(evidenceDir, "native-console.log");
const stderrPath = path.join(evidenceDir, "native-stderr.log");
const guestEvidencePath = path.join(evidenceDir, "guest-evidence.txt");

async function requireFile(file) {
  await stat(file).catch(() => {
    throw new Error(`missing required proof input: ${path.relative(repo, file)}`);
  });
}

function runNative() {
  return new Promise((resolve, reject) => {
    const stdout = openSync(stdoutPath, "w");
    const stderr = openSync(stderrPath, "w");
    const args = [
      "boot",
      "--kernel",
      kernel,
      "--initrd",
      initrd,
      "--append",
      "console=ttyS0 earlycon=sbi",
      "--gpu-trace",
      tracePath,
      "--evidence",
      guestEvidencePath,
      "--profile-boot",
      "--no-input",
      "--no-reboot",
      "--max-instrs",
      "8000000000",
      "--quantum",
      "200000",
    ];
    const child = spawn(cli, args, { cwd: repo, stdio: ["ignore", stdout, stderr] });
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      closeSync(stdout);
      closeSync(stderr);
      callback();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new Error("native GPU probe exceeded 15 minute bound")));
    }, 15 * 60 * 1000);
    child.on("error", (error) => {
      clearTimeout(timeout);
      finish(() => reject(error));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      finish(() => {
        if (signal) reject(new Error(`native GPU probe terminated by ${signal}`));
        else resolve(code);
      });
    });
  });
}

function parseTrace(text) {
  const lines = text.trimEnd().split("\n");
  assert.equal(lines[0], "wasm-vm virtio-gpu command trace v1");
  const summary = /^(?:records)=(\d+) dropped=(\d+)$/u.exec(lines[1]);
  assert.ok(summary, "trace summary must be present");
  const records = lines.slice(2).map((line, index) => {
    const match =
      /^seq=(\d+) command=([A-Z0-9_]+)\((0x[0-9a-f]+)\) response=([A-Z0-9_]+)\((0x[0-9a-f]+)\) scanout=(-|\d+) resource=(-|\d+) dimensions=(-|\d+x\d+) avail=(\d+) used=(\d+) head=(\d+) len=(\d+)$/u.exec(
        line,
      );
    assert.ok(match, `trace line ${index + 3} has the canonical shape`);
    return {
      sequence: Number(match[1]),
      command: match[2],
      commandType: Number.parseInt(match[3], 16),
      response: match[4],
      responseType: Number.parseInt(match[5], 16),
      scanout: match[6] === "-" ? null : Number(match[6]),
      resource: match[7] === "-" ? null : Number(match[7]),
      dimensions: match[8],
      avail: Number(match[9]),
      used: Number(match[10]),
      head: Number(match[11]),
      length: Number(match[12]),
    };
  });
  assert.equal(Number(summary[1]), records.length, "trace record count matches its header");
  assert.equal(Number(summary[2]), 0, "bounded proof trace did not drop a command");
  return records;
}

function requireInOrder(records, commands) {
  let cursor = -1;
  for (const command of commands) {
    const index = records.findIndex((record, candidate) => candidate > cursor && record.command === command);
    assert.notEqual(index, -1, `${command} appears in the native probe`);
    cursor = index;
  }
}

async function main() {
  await Promise.all([requireFile(cli), requireFile(kernel), requireFile(initrd), requireFile(fixture)]);
  await mkdir(evidenceDir, { recursive: true });
  const code = await runNative();
  const consoleText = await readFile(stdoutPath, "utf8");
  const diagnostics = await readFile(stderrPath, "utf8");
  const traceText = await readFile(tracePath, "utf8");
  const fixtureText = await readFile(fixture, "utf8");
  assert.equal(code, 0, `native probe exited ${code}; see ${stderrPath}`);
  assert.match(consoleText, /userland up/u, "the guest reached the live initramfs boundary");
  assert.match(diagnostics, /profile complete \(stopped at userland marker\)/u);
  assert.doesNotMatch(diagnostics, /NEEDS_RESET|reset loop/u, "the probe did not reset or stall");

  const records = parseTrace(traceText);
  requireInOrder(records, [
    "GET_EDID",
    "GET_DISPLAY_INFO",
    "RESOURCE_CREATE_2D",
    "RESOURCE_ATTACH_BACKING",
    "SET_SCANOUT",
    "TRANSFER_TO_HOST_2D",
    "RESOURCE_FLUSH",
  ]);
  const display = records.find((record) => record.command === "GET_DISPLAY_INFO");
  assert.equal(display?.response, "RESP_OK_DISPLAY_INFO");
  const create = records.find((record) => record.command === "RESOURCE_CREATE_2D");
  assert.ok(create && create.dimensions !== "-", "framebuffer resource dimensions are traced");
  const transfer = records.find((record) => record.command === "TRANSFER_TO_HOST_2D");
  assert.equal(transfer?.response, "RESP_OK_NODATA");
  const flush = records.find((record) => record.command === "RESOURCE_FLUSH");
  assert.equal(flush?.response, "RESP_OK_NODATA");
  for (const [index, record] of records.entries()) {
    assert.equal(record.sequence, index, `trace sequence is contiguous at ${index}`);
    assert.equal(record.avail, (index + 1) & 0xffff, `avail progress at ${index}`);
    assert.equal(record.used, (index + 1) & 0xffff, `used progress at ${index}`);
  }
  assert.equal(traceText, fixtureText, "native probe matches the checked-in canonical fixture");

  console.log(
    JSON.stringify(
      {
        task: "E5-T07a",
        nativeExit: code,
        records: records.length,
        firstFramebufferDimensions: create.dimensions,
        transferResponse: transfer.response,
        flushResponse: flush.response,
        fixture: path.relative(repo, fixture),
        trace: path.relative(repo, tracePath),
        guestEvidence: path.relative(repo, guestEvidencePath),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`e5-t07a: ${error.stack ?? error}`);
  process.exitCode = 1;
});

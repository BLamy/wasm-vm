#!/usr/bin/env node
// Reproducible host orchestration for the E5-T26f observer. This file deliberately does not
// run the guest or claim that the observer has been exercised; it only builds and inspects the
// pinned C source. The real source/build run is frozen by the parent task after this lands.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const SOURCE = "tools/guest/e5-t26f-observer.c";
export const OUTPUT = "e5t26f-observe";
export const EPOCH = 1731542400;
export const TARGET = "riscv64-linux-musl";
export const CPU = "baseline_rv64";
export const ABI = "lp64d";
export const ZIG_VERSION = "0.16.0";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const execFile = promisify(execFileCallback);
const MAX_ELF_BYTES = 64 * 1024 * 1024;
const MAX_PROGRAM_HEADERS = 4096;
const MAX_SECTION_HEADERS = 4096;
const ELF64_HEADER_SIZE = 64;
const ELF64_PROGRAM_HEADER_SIZE = 56;
const ELF64_SECTION_HEADER_SIZE = 64;
const UINT64_MAX = (1n << 64n) - 1n;
const PT_LOAD = 1;
const PT_DYNAMIC = 2;
const PT_INTERP = 3;
const PF_X = 1;
const EF_RISCV_RVC = 0x1;
const EF_RISCV_FLOAT_ABI_MASK = 0x6;
const EF_RISCV_FLOAT_ABI_DOUBLE = 0x4;
const EF_RISCV_RVE = 0x8;
const EF_RISCV_TSO = 0x10;
const EF_RISCV_RV64ILP32 = 0x20;
const KNOWN_RISCV_FLAGS = EF_RISCV_RVC | EF_RISCV_FLOAT_ABI_MASK | EF_RISCV_RVE | EF_RISCV_TSO | EF_RISCV_RV64ILP32;
const POISON_ENV = [
  "CFLAGS", "CPPFLAGS", "CXXFLAGS", "CPATH", "C_INCLUDE_PATH", "CPLUS_INCLUDE_PATH", "OBJC_INCLUDE_PATH",
  "LIBRARY_PATH", "LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH", "RUSTFLAGS", "RUSTDOCFLAGS", "RUST_LOG",
  "CARGO_HOME", "CARGO_TARGET_DIR", "RUSTUP_HOME",
];

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const defaultRun = (command, args, options) => execFile(command, args, {
  timeout: 300_000,
  maxBuffer: 1024 * 1024,
  ...options,
});

export async function sha256File(filename) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(filename)) hash.update(bytes);
  return hash.digest("hex");
}

export function parseArguments(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = { "--out": "out", "--source-sha256": "sourceSha256" }[args[i]];
    assert.ok(key && result[key] === undefined && args[i + 1],
      "expected --out DIR --source-sha256 FROZEN_SHA256 (no duplicate/unknown options)");
    result[key] = args[i + 1];
  }
  assert.ok(result.out, "explicit fresh --out directory required");
  assert.match(result.sourceSha256 ?? "", /^[0-9a-f]{64}$/u, "explicit frozen --source-sha256 required");
  return result;
}

async function noSymlinks(filename, io) {
  const absolute = path.resolve(filename);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    const stat = await io.lstat(current).catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    assert.ok(!stat?.isSymbolicLink(), `refusing symlink: ${current}`);
  }
}

export async function guardOutput(repo, out, io = fs) {
  assert.ok(typeof out === "string" && out.length, "explicit fresh output required");
  const destination = path.resolve(repo, out);
  const root = path.resolve(repo, "target/e5-t26f");
  assert.ok(destination !== root && destination.startsWith(`${root}${path.sep}`),
    "output must be a fresh directory below target/e5-t26f");
  assert.doesNotMatch(destination, /[,\r\n\0]/u, "unsafe output path");
  await noSymlinks(destination, io);
  const stat = await io.lstat(destination).catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (stat) {
    assert.ok(stat.isDirectory(), "output path must be a directory");
    assert.equal((await io.readdir(destination)).length, 0, "refusing nonempty output directory; use a fresh run directory");
  }
  return destination;
}

async function requireRegular(filename, io, label) {
  await noSymlinks(filename, io);
  const stat = await io.lstat(filename).catch(error => {
    if (error.code === "ENOENT") throw new Error(`${label} is missing: ${filename}`);
    throw error;
  });
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), `${label} must be a regular non-symlink file: ${filename}`);
  return stat;
}

async function verifySource(filename, expectedSha256, { io, hashFile }, label = "source") {
  const stat = await requireRegular(filename, io, label);
  assert.ok(stat.size > 0, `${label} must be nonempty`);
  assert.equal(await hashFile(filename), expectedSha256, `${label} SHA256 differs from the frozen pin`);
  return stat.size;
}

function compilerEnv(destination, compilerPath, inherited = process.env) {
  // An allow-list is intentional: no caller-provided compiler, library, or Rust setting is
  // allowed to reach Zig. Explicit cache/temp paths stay inside this run directory.
  const env = {
    PATH: inherited.PATH ?? path.dirname(compilerPath),
    TMPDIR: path.join(destination, ".tmp"),
    SOURCE_DATE_EPOCH: String(EPOCH),
    ZIG_GLOBAL_CACHE_DIR: path.join(destination, ".zig-global-cache"),
    ZIG_LOCAL_CACHE_DIR: path.join(destination, ".zig-local-cache"),
  };
  for (const name of POISON_ENV) assert.equal(Object.hasOwn(env, name), false, `${name} must not be inherited`);
  return env;
}

async function resolveCompiler({ io = fs, hashFile = sha256File } = {}) {
  const found = (await execFile("which", ["zig"], { env: { PATH: process.env.PATH ?? "" } })).stdout.trim();
  assert.ok(found && !found.includes("\n"), "zig was not found on PATH");
  const realpath = await io.realpath(found);
  const stat = await requireRegular(realpath, io, "zig compiler");
  assert.ok(stat.size > 0, "zig compiler is empty");
  const sha256 = await hashFile(realpath);
  const version = (await execFile(realpath, ["version"], {
    env: { PATH: process.env.PATH ?? "", SOURCE_DATE_EPOCH: String(EPOCH) },
  })).stdout.trim();
  assert.equal(version, ZIG_VERSION, `Zig ${ZIG_VERSION} is required`);
  return { realpath, sha256, version };
}

function compilerRecord(compiler) {
  assert.ok(compiler && typeof compiler === "object", "compiler resolver returned no record");
  assert.match(compiler.realpath ?? "", /^\//u, "compiler realpath must be absolute");
  assert.match(compiler.sha256 ?? "", /^[0-9a-f]{64}$/u, "compiler SHA256 must be exact");
  assert.equal(compiler.version, ZIG_VERSION, `Zig ${ZIG_VERSION} is required`);
  return compiler;
}

function rangeEnd(offset, length, fileLength, label) {
  assert.ok(offset >= 0n && length >= 0n && offset <= UINT64_MAX && length <= UINT64_MAX, `${label} has invalid uint64 bounds`);
  const end = offset + length;
  assert.ok(end <= UINT64_MAX && end <= BigInt(fileLength), `${label} exceeds the output file`);
  return end;
}

function powerOfTwo(value) {
  return value === 0n || (value & (value - 1n)) === 0n;
}

export function validateElf(bytes) {
  assert.ok(bytes instanceof Uint8Array || Buffer.isBuffer(bytes), "ELF input must be bytes");
  assert.ok(bytes.byteLength > 0 && bytes.byteLength <= MAX_ELF_BYTES, "ELF size is empty or unbounded");
  assert.ok(bytes.byteLength >= ELF64_HEADER_SIZE, "ELF header is truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = offset => view.getUint16(offset, true);
  const u32 = offset => view.getUint32(offset, true);
  const u64 = offset => view.getBigUint64(offset, true);
  assert.equal(u32(0), 0x464c457f, "output is not ELF");
  assert.equal(bytes[4], 2, "output is not ELF64");
  assert.equal(bytes[5], 1, "output is not little-endian ELF");
  assert.equal(bytes[6], 1, "ELF identification version differs");
  assert.equal(u16(16), 2, "output is not an executable ELF");
  assert.equal(u16(18), 243, "output is not RISC-V");
  assert.equal(u32(20), 1, "ELF version differs");
  assert.equal(u16(52), ELF64_HEADER_SIZE, "ELF header size differs");

  const flags = u32(48);
  assert.equal(flags & ~KNOWN_RISCV_FLAGS, 0, "unknown RISC-V ABI flags are present");
  assert.equal(flags & EF_RISCV_RVE, 0, "RVE is incompatible with the RV64GC observer target");
  assert.equal(flags & EF_RISCV_TSO, 0, "TSO is outside the pinned RV64GC target");
  assert.equal(flags & EF_RISCV_RV64ILP32, 0, "RV64ILP32 is incompatible with lp64d");
  assert.equal(flags & EF_RISCV_FLOAT_ABI_MASK, EF_RISCV_FLOAT_ABI_DOUBLE, "ELF float ABI is not lp64d");

  const phoff = u64(32), shoff = u64(40);
  const phentsize = u16(54), phnum = u16(56);
  const shentsize = u16(58), shnum = u16(60), shstrndx = u16(62);
  assert.ok(phnum > 0 && phnum <= MAX_PROGRAM_HEADERS, "program header count is empty or unbounded");
  assert.equal(phentsize, ELF64_PROGRAM_HEADER_SIZE, "program header size differs");
  rangeEnd(phoff, BigInt(phentsize) * BigInt(phnum), bytes.byteLength, "program header table");
  if (shnum === 0) {
    assert.equal(shoff, 0n, "section header offset is nonzero with no section headers");
    assert.equal(shstrndx, 0, "section string index is nonzero with no section headers");
  } else {
    assert.ok(shnum <= MAX_SECTION_HEADERS, "section header count is unbounded");
    assert.equal(shentsize, ELF64_SECTION_HEADER_SIZE, "section header size differs");
    rangeEnd(shoff, BigInt(shentsize) * BigInt(shnum), bytes.byteLength, "section header table");
    assert.ok(shstrndx === 0 || shstrndx < shnum, "section string index is outside the section table");
  }

  let loadCount = 0;
  let executableEntry = false;
  for (let index = 0; index < phnum; index += 1) {
    const header = Number(phoff) + index * phentsize;
    const type = u32(header), segmentFlags = u32(header + 4);
    const offset = u64(header + 8), virtualAddress = u64(header + 16);
    const fileSize = u64(header + 32), memorySize = u64(header + 40), alignment = u64(header + 48);
    if (type === PT_INTERP) assert.fail("dynamic interpreter segment is forbidden");
    if (type === PT_DYNAMIC) assert.fail("dynamic linker segment is forbidden");
    if (type !== PT_LOAD) continue;
    loadCount += 1;
    assert.ok(fileSize <= memorySize, "load segment file size exceeds memory size");
    rangeEnd(offset, fileSize, bytes.byteLength, `load segment ${index}`);
    assert.ok(virtualAddress + memorySize <= UINT64_MAX, `load segment ${index} virtual range overflows`);
    assert.ok(powerOfTwo(alignment), `load segment ${index} alignment is not a power of two`);
    const entry = u64(24);
    if ((segmentFlags & PF_X) !== 0 && entry >= virtualAddress && entry < virtualAddress + fileSize) executableEntry = true;
  }
  assert.ok(loadCount > 0, "ELF has no loadable segments");
  assert.ok(executableEntry, "ELF entry point is not in an executable load segment");
  return {
    class: "ELF64",
    data: "little-endian",
    type: "ET_EXEC",
    machine: "RISC-V",
    machineNumber: 243,
    flags,
    rvc: (flags & EF_RISCV_RVC) !== 0,
    floatAbi: "double",
    programHeaders: phnum,
    loadSegments: loadCount,
    static: true,
  };
}

export async function validateOutput(filename, io = fs) {
  const stat = await requireRegular(filename, io, "observer output");
  assert.ok(stat.size > 0, "observer output must be nonempty");
  const bytes = await io.readFile(filename);
  assert.equal(bytes.length, stat.size, "observer output changed while reading");
  const elf = validateElf(bytes);
  return { size: stat.size, sha256: digest(bytes), elf };
}

function buildArguments({ repo, destination, compiler }) {
  const source = path.relative(repo, path.resolve(repo, SOURCE));
  const output = path.relative(repo, path.join(destination, OUTPUT));
  const prefixMap = `-ffile-prefix-map=${repo}=/wasm-vm`;
  return [compiler.realpath, "cc", "-target", TARGET, `-mcpu=${CPU}`, `-mabi=${ABI}`, "-std=c11", "-Os",
    "-Wall", "-Wextra", "-Werror", "-g0", "-s", "-static", "-fno-pie", "-fno-ident", prefixMap,
    "-Wl,--build-id=none", "-Wl,-no-pie", source, "-o", output];
}

function relativePath(repo, filename) {
  return path.relative(repo, filename).split(path.sep).join("/");
}

async function writeFailure(destination, failure, io) {
  const record = {
    schema: "wasm-vm.e5-t26f-observer-build-failure.v1",
    acceptance: false,
    error: String(failure),
    causes: failure.errors?.map(String),
  };
  await io.writeFile(path.join(destination, "build-failure.json"), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
}

export async function buildObserver({ out, sourceSha256, repo = REPO }, deps = {}) {
  assert.match(sourceSha256 ?? "", /^[0-9a-f]{64}$/u, "frozen source SHA256 required");
  const io = deps.io ?? fs;
  const hashFile = deps.hashFile ?? sha256File;
  const run = deps.run ?? defaultRun;
  const destination = await guardOutput(repo, out, io);
  const sourceFile = path.resolve(repo, SOURCE);
  const sourceSize = await verifySource(sourceFile, sourceSha256, { io, hashFile });
  const compiler = compilerRecord(await (deps.resolveCompiler ?? resolveCompiler)({ io, hashFile }));
  const compilerSize = (await requireRegular(compiler.realpath, io, "zig compiler")).size;
  assert.ok(compilerSize > 0, "zig compiler is empty");
  assert.equal(await hashFile(compiler.realpath), compiler.sha256, "zig compiler changed before build");

  // Recheck the empty directory immediately before claiming it. The marker makes partial output
  // visibly owned by this invocation; it is not success metadata and is never in SHA256SUMS.
  await guardOutput(repo, destination, io);
  await io.mkdir(destination, { recursive: true });
  await io.mkdir(path.join(destination, ".tmp"), { recursive: true });
  await io.mkdir(path.join(destination, ".zig-global-cache"), { recursive: true });
  await io.mkdir(path.join(destination, ".zig-local-cache"), { recursive: true });
  await io.writeFile(path.join(destination, ".e5-t26f-observer-owner"), "wasm-vm e5-t26f observer build owner\n", { flag: "wx" });

  const argv = buildArguments({ repo, destination, compiler });
  const env = compilerEnv(destination, compiler.realpath);
  let failure;
  let output;
  try {
    await run(compiler.realpath, argv.slice(1), { cwd: repo, env });
    output = await validateOutput(path.join(destination, OUTPUT), io);
  } catch (error) {
    failure = error;
  }

  // Preserve the before/after immutability proof even when compilation or ELF validation fails.
  // A failure in either postflight check is joined to the primary error and is recorded.
  for (const check of [
    () => verifySource(sourceFile, sourceSha256, { io, hashFile }, "source after build"),
    async () => assert.equal(await hashFile(compiler.realpath), compiler.sha256, "zig compiler changed during build"),
  ]) {
    try { await check(); } catch (error) {
      failure = failure ? new AggregateError([failure, error], "observer build postflight failed") : error;
    }
  }

  if (failure) {
    await writeFailure(destination, failure, io);
    throw failure;
  }

  const info = {
    schema: "wasm-vm.e5-t26f.observer-build.v1",
    task: "E5-T26f",
    source: { path: SOURCE, sha256: sourceSha256, size: sourceSize },
    binary: { path: relativePath(repo, path.join(destination, OUTPUT)), sha256: output.sha256, size: output.size },
    compiler: { version: compiler.version, path: compiler.realpath, sha256: compiler.sha256 },
    target: TARGET,
    cpu: CPU,
    abi: ABI,
    isa: "RV64GC",
    flags: ["-target", TARGET, `-mcpu=${CPU}`, `-mabi=${ABI}`],
    note: "ISA is claimed by compiler target/flags; ELF headers only establish format and ABI compatibility.",
    argv,
    epoch: EPOCH,
    environment: {
      inherited: ["PATH"],
      SOURCE_DATE_EPOCH: String(EPOCH),
      ZIG_GLOBAL_CACHE_DIR: relativePath(repo, path.join(destination, ".zig-global-cache")),
      ZIG_LOCAL_CACHE_DIR: relativePath(repo, path.join(destination, ".zig-local-cache")),
    },
    elf: output.elf,
  };
  const infoBytes = Buffer.from(`${JSON.stringify(info, null, 2)}\n`);
  try {
    await io.writeFile(path.join(destination, "build-info.json"), infoBytes, { flag: "wx" });
    const infoSha256 = digest(infoBytes);
    await io.writeFile(path.join(destination, "SHA256SUMS"),
      `${output.sha256}  ${OUTPUT}\n${infoSha256}  build-info.json\n`, { flag: "wx" });
  } catch (error) {
    // Publication is atomic at the contract level: a metadata write failure cannot leave a
    // success record that a later verifier could mistake for a completed build.
    await Promise.all(["build-info.json", "SHA256SUMS"].map(name => io.unlink(path.join(destination, name)).catch(() => {})));
    await writeFailure(destination, error, io);
    throw error;
  }
  return info;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await buildObserver(parseArguments(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

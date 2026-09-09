import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ABI, CPU, EPOCH, OUTPUT, SOURCE, TARGET, ZIG_VERSION,
  buildObserver, guardOutput, parseArguments, validateElf, validateOutput,
} from "./e5-t26f-observer-build.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const sourceBytes = Buffer.from("/* injected test source; this is not cross-build evidence */\n");
const sourceSha256 = sha256(sourceBytes);

async function scratch(t) {
  const repo = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "e5-t26f-observer-build-test-")));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  await fs.mkdir(path.join(repo, "tools/guest"), { recursive: true });
  await fs.writeFile(path.join(repo, SOURCE), sourceBytes);
  return repo;
}

function elfFixture({ interpreter = false, dynamic = false, rve = false, badLoadRange = false } = {}) {
  const phnum = 1 + Number(interpreter) + Number(dynamic);
  const codeOffset = 0x100;
  const size = 0x180;
  const bytes = Buffer.alloc(size);
  bytes.writeUInt32LE(0x464c457f, 0);
  bytes[4] = 2; bytes[5] = 1; bytes[6] = 1;
  bytes.writeUInt16LE(2, 16); bytes.writeUInt16LE(243, 18); bytes.writeUInt32LE(1, 20);
  bytes.writeBigUInt64LE(0x1000n + BigInt(codeOffset), 24);
  bytes.writeBigUInt64LE(64n, 32); bytes.writeBigUInt64LE(0n, 40);
  bytes.writeUInt32LE((rve ? 0x8 : 0) | 0x4 | 0x1, 48);
  bytes.writeUInt16LE(64, 52); bytes.writeUInt16LE(56, 54); bytes.writeUInt16LE(phnum, 56);
  bytes.writeUInt16LE(64, 58); bytes.writeUInt16LE(0, 60); bytes.writeUInt16LE(0, 62);
  let index = 0;
  const ph = (type, flags, offset, fileSize, memorySize) => {
    const at = 64 + index * 56; index += 1;
    bytes.writeUInt32LE(type, at); bytes.writeUInt32LE(flags, at + 4);
    bytes.writeBigUInt64LE(BigInt(offset), at + 8); bytes.writeBigUInt64LE(0x1000n, at + 16);
    bytes.writeBigUInt64LE(0x1000n, at + 24); bytes.writeBigUInt64LE(BigInt(fileSize), at + 32);
    bytes.writeBigUInt64LE(BigInt(memorySize), at + 40); bytes.writeBigUInt64LE(0x1000n, at + 48);
  };
  ph(1, 5, 0, badLoadRange ? size + 1 : size, size);
  if (interpreter) ph(3, 4, 0, 1, 1);
  if (dynamic) ph(2, 4, 0, 1, 1);
  return bytes;
}

async function fixture(t, options = {}) {
  const repo = await scratch(t);
  const out = "target/e5-t26f/injected";
  const destination = path.join(repo, out);
  await fs.mkdir(path.join(repo, "toolchain"), { recursive: true });
  const compiler = path.join(repo, "toolchain/zig");
  await fs.writeFile(compiler, "fake zig 0.16.0");
  const compilerSha256 = sha256(await fs.readFile(compiler));
  const calls = [];
  const run = async (command, args, runOptions) => {
    calls.push({ command, args, options: runOptions });
    if (options.fail) throw new Error("injected compiler failure");
    if (options.mutateSource) await fs.writeFile(path.join(repo, SOURCE), Buffer.from("mutated source\n"));
    const outputArg = args[args.indexOf("-o") + 1];
    await fs.mkdir(path.dirname(path.join(repo, outputArg)), { recursive: true });
    if (options.invalid) await fs.writeFile(path.join(repo, outputArg), elfFixture(options.invalid));
    else await fs.writeFile(path.join(repo, outputArg), elfFixture());
    return { stdout: "", stderr: "" };
  };
  const resolveCompiler = async () => ({ realpath: compiler, sha256: compilerSha256, version: ZIG_VERSION });
  return { repo, out, destination, compiler, calls, run, resolveCompiler };
}

test("CLI pins only --out and --source-sha256", () => {
  assert.deepEqual(parseArguments(["--out", "target/e5-t26f/run", "--source-sha256", sourceSha256]),
    { out: "target/e5-t26f/run", sourceSha256 });
  for (const args of [[], ["--out", "x"], ["--source-sha256", sourceSha256],
    ["--out", "x", "--source-sha256", sourceSha256.toUpperCase()],
    ["--out", "x", "--out", "y", "--source-sha256", sourceSha256],
    ["--out", "x", "--source-sha256", sourceSha256, "--source", SOURCE]]) assert.throws(() => parseArguments(args));
});

test("output guard refuses root, escape, nonempty, and symlink directories without writing", async t => {
  const repo = await scratch(t), root = path.join(repo, "target/e5-t26f");
  await fs.mkdir(root, { recursive: true });
  await guardOutput(repo, "target/e5-t26f/empty");
  await fs.mkdir(path.join(root, "nonempty"));
  await fs.writeFile(path.join(root, "nonempty/keep"), "keep");
  for (const out of [root, "target/e5-t26f/../escape", "target/e5-t26f/nonempty"])
    await assert.rejects(guardOutput(repo, out));
  await fs.symlink(path.join(root, "nonempty"), path.join(root, "link"));
  await assert.rejects(guardOutput(repo, "target/e5-t26f/link"), /symlink/u);
  assert.equal(await fs.readFile(path.join(root, "nonempty/keep"), "utf8"), "keep");
});

test("ELF validator accepts bounded static RV64GC-compatible ET_EXEC and rejects dynamic/RVE/range variants", () => {
  const valid = validateElf(elfFixture());
  assert.deepEqual({ class: valid.class, data: valid.data, machine: valid.machine, static: valid.static },
    { class: "ELF64", data: "little-endian", machine: "RISC-V", static: true });
  for (const options of [{ interpreter: true }, { dynamic: true }, { rve: true }, { badLoadRange: true }])
    assert.throws(() => validateElf(elfFixture(options)));
  assert.throws(() => validateElf(Buffer.alloc(64)), /ELF/u);
});

test("injected compiler orchestration records exact provenance, sanitizes env, and hashes outputs", async t => {
  const f = await fixture(t);
  const info = await buildObserver({ repo: f.repo, out: f.out, sourceSha256 }, {
    run: f.run, resolveCompiler: f.resolveCompiler,
  });
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.equal(call.command, f.compiler);
  assert.equal(call.options.cwd, f.repo);
  assert.equal(call.options.env.SOURCE_DATE_EPOCH, String(EPOCH));
  assert.equal(call.options.env.ZIG_GLOBAL_CACHE_DIR, path.join(f.destination, ".zig-global-cache"));
  assert.equal(call.options.env.ZIG_LOCAL_CACHE_DIR, path.join(f.destination, ".zig-local-cache"));
  for (const key of ["CFLAGS", "CPATH", "LIBRARY_PATH", "RUSTFLAGS", "RUST_LOG", "CARGO_HOME"])
    assert.equal(Object.hasOwn(call.options.env, key), false, `${key} leaked into compiler env`);
  assert.deepEqual(info.source, { path: SOURCE, sha256: sourceSha256, size: sourceBytes.length });
  assert.equal(info.target, TARGET);
  assert.equal(info.cpu, CPU);
  assert.equal(info.abi, ABI);
  assert.equal(info.epoch, EPOCH);
  assert.deepEqual(info.binary, {
    path: "target/e5-t26f/injected/e5t26f-observe",
    sha256: sha256(await fs.readFile(path.join(f.destination, OUTPUT))),
    size: (await fs.stat(path.join(f.destination, OUTPUT))).size,
  });
  assert.equal(info.compiler.path, f.compiler);
  assert.equal(info.compiler.version, ZIG_VERSION);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.destination, "build-info.json"), "utf8")), info);
  assert.match(await fs.readFile(path.join(f.destination, "SHA256SUMS"), "utf8"), new RegExp(`${info.binary.sha256}  ${OUTPUT}`));
  await assert.rejects(buildObserver({ repo: f.repo, out: f.out, sourceSha256 }, {
    run: f.run, resolveCompiler: f.resolveCompiler,
  }), /nonempty/u);
});

test("source preflight rejects symlink/empty/hash drift before output ownership", async t => {
  for (const scenario of ["symlink", "empty", "hash"]) {
    const f = await fixture(t);
    const source = path.join(f.repo, SOURCE);
    if (scenario === "symlink") {
      await fs.rename(source, `${source}.real`); await fs.symlink(`${source}.real`, source);
    } else if (scenario === "empty") await fs.writeFile(source, "");
    else await fs.writeFile(source, "different\n");
    await assert.rejects(buildObserver({ repo: f.repo, out: f.out, sourceSha256 }, {
      run: f.run, resolveCompiler: f.resolveCompiler,
    }), /source|symlink|SHA256/u);
    assert.equal(f.calls.length, 0);
    await assert.rejects(fs.stat(f.destination), { code: "ENOENT" });
  }
});

test("compiler/validation/source failures retain owned failure records without success metadata", async t => {
  for (const options of [{ fail: true }, { invalid: { dynamic: true } }, { mutateSource: true }]) {
    const f = await fixture(t, options);
    await assert.rejects(buildObserver({ repo: f.repo, out: f.out, sourceSha256 }, {
      run: f.run, resolveCompiler: f.resolveCompiler,
    }));
    const failure = JSON.parse(await fs.readFile(path.join(f.destination, "build-failure.json"), "utf8"));
    assert.equal(failure.acceptance, false);
    await assert.rejects(fs.stat(path.join(f.destination, "build-info.json")), { code: "ENOENT" });
    await assert.rejects(fs.stat(path.join(f.destination, "SHA256SUMS")), { code: "ENOENT" });
    assert.equal(await fs.stat(path.join(f.destination, ".e5-t26f-observer-owner")).then(stat => stat.isFile()), true);
  }
});

test("validateOutput applies the same file-type, nonempty, and ELF checks used by the builder", async t => {
  const f = await fixture(t);
  await fs.mkdir(f.destination, { recursive: true });
  const output = path.join(f.destination, OUTPUT);
  await fs.writeFile(output, elfFixture());
  const result = await validateOutput(output);
  assert.equal(result.size, (await fs.stat(output)).size);
  await fs.unlink(output);
  await fs.symlink(path.join(f.repo, SOURCE), output);
  await assert.rejects(validateOutput(output), /symlink|regular/u);
});

// The injected compiler above intentionally proves orchestration and refusal paths only. It is
// not cross-build evidence; the parent task must run the frozen C source through Zig after merge.

#!/usr/bin/env node
// Offline, pinned R3 checkpoint inspection. Never boots or mutates a machine.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const hex = value => `0x${BigInt(value).toString(16)}`;
const RAM_BASE = 0x80000000n;
const MASK64 = (1n << 64n) - 1n;
export const pins = Object.freeze({
  snapshot: "2231a21eb8ebc8d3965d1352a3523501faebc87bda31e2c8dc184320219235f5",
  layout: "0ee696d2e47cf290bf57d1648a7cbe99144f2dff95e4aa3b2a7844e0bd405d82",
});

export function pinned(bytes, expected, label) {
  assert.equal(sha(bytes), expected, `${label} identity mismatch`);
  return bytes;
}

export function sections(raw) {
  assert.ok(raw.length >= 84 && raw.subarray(0, 8).equals(Buffer.from("WVMRESU1")), "snapshot header");
  assert.equal(raw.readUInt32LE(8), 1, "snapshot version");
  const result = new Map();
  let at = 84;
  while (at < raw.length) {
    assert.ok(at + 8 <= raw.length, "truncated section header");
    const tag = raw.readUInt32LE(at), length = raw.readUInt32LE(at + 4);
    at += 8;
    assert.ok(tag >= 1 && tag <= 16 && !result.has(tag), "unknown or duplicate section");
    assert.ok(at + length <= raw.length, "truncated section body");
    result.set(tag, raw.subarray(at, at + length));
    at += length;
  }
  assert.ok(result.has(1) && result.has(2), "missing CPU/RAM section");
  return result;
}

export function decodeRam(payload, size) {
  assert.ok(Number.isSafeInteger(size) && size > 0 && size <= 1024 ** 3, "RAM bound");
  const ram = Buffer.alloc(size);
  let at = 0, written = 0;
  while (at < payload.length) {
    assert.ok(at + 5 <= payload.length, "truncated sparse header");
    const kind = payload[at], length = payload.readUInt32LE(at + 1);
    at += 5;
    assert.ok(written + length <= size, "sparse RAM overflow");
    if (kind === 1) {
      assert.ok(at + length <= payload.length, "truncated sparse data");
      payload.copy(ram, written, at, at + length);
      at += length;
    } else assert.equal(kind, 0, "unknown sparse kind");
    written += length;
  }
  assert.equal(written, size, "sparse RAM length");
  return ram;
}

function cpuContext(cpu) {
  assert.ok(cpu.length >= 536, "short CPU section");
  assert.ok(cpu[512] <= 1, "invalid reservation marker");
  let at = 513 + (cpu[512] ? 9 : 0);
  const mode = cpu[at];
  assert.ok([0, 1, 3].includes(mode), "invalid privilege");
  at += 19; // privilege, mstatus, mcause, fflags, frm
  const count = cpu.readUInt32LE(at); at += 4;
  assert.ok(count <= 4096 && at + count * 10 <= cpu.length, "short CSR table");
  const csrs = new Map();
  for (let i = 0; i < count; i++, at += 10) {
    const key = cpu.readUInt16LE(at);
    assert.ok(!csrs.has(key), "duplicate CSR");
    csrs.set(key, cpu.readBigUInt64LE(at + 2));
  }
  assert.ok(csrs.has(0x180), "missing saved SATP");
  const satp = csrs.get(0x180), pagingMode = Number(satp >> 60n);
  assert.ok([8, 9, 10].includes(pagingMode), "unsupported saved SATP mode");
  // In this U-mode checkpoint, sscratch is the kernel's current task pointer.
  assert.equal(mode, 0, "this pinned inspector requires a saved user-mode CPU");
  assert.ok(csrs.has(0x140), "missing sscratch");
  return { pc: cpu.readBigUInt64LE(0), mode, satp, pagingMode,
    root: (satp & ((1n << 44n) - 1n)) << 12n, currentTask: csrs.get(0x140) };
}

export class Memory {
  constructor(ram, root, mode, base = RAM_BASE) {
    assert.ok([8, 9, 10].includes(mode), "unsupported paging mode");
    this.ram = ram; this.root = root; this.mode = mode; this.base = base;
  }
  physical(address, length) {
    assert.ok(address >= this.base && address + BigInt(length) <= this.base + BigInt(this.ram.length), "physical RAM bounds");
    const offset = Number(address - this.base);
    return this.ram.subarray(offset, offset + length);
  }
  translate(address, root = this.root, { user = false, execute = false } = {}) {
    const levels = this.mode - 5, width = BigInt(12 + 9 * levels);
    assert.ok(address >= 0n && address <= MASK64, "virtual address width");
    const lowMask = (1n << width) - 1n;
    const canonical = address & (1n << (width - 1n)) ? (address & lowMask) | (MASK64 ^ lowMask) : address & lowMask;
    assert.equal(address, canonical, "noncanonical virtual address");
    assert.equal(root & 4095n, 0n, "unaligned page table root");
    let table = root;
    const walk = [];
    for (let level = levels - 1; level >= 0; level--) {
      const entry = table + ((address >> BigInt(12 + 9 * level)) & 511n) * 8n;
      const pte = this.physical(entry, 8).readBigUInt64LE();
      walk.push({ level, physical: hex(entry), pte: hex(pte) });
      assert.ok(pte & 1n, "invalid PTE");
      // This diagnostic fails closed on unsupported PBMT/NAPOT and reserved bits.
      assert.equal(pte >> 54n, 0n, "unsupported/reserved PTE bits");
      assert.ok(!(pte & 4n) || (pte & 2n), "write-only PTE");
      const ppn = (pte >> 10n) & ((1n << 44n) - 1n);
      if (pte & 10n) {
        const shift = BigInt(12 + 9 * level), mask = (1n << shift) - 1n;
        assert.equal((ppn << 12n) & mask, 0n, "misaligned superpage");
        if (user) assert.ok(pte & 16n, "not a user PTE");
        if (execute) assert.ok(pte & 8n, "not an executable PTE");
        else assert.ok(pte & 2n, "not a readable PTE");
        const physical = (ppn << 12n) | (address & mask);
        this.physical(physical, 1);
        return { physical, walk, pte };
      }
      assert.equal(pte & 208n, 0n, "reserved non-leaf PTE flags");
      table = ppn << 12n;
    }
    throw Error("page table has no leaf");
  }
  read(address, length, root = this.root, options = {}) {
    assert.ok(Number.isSafeInteger(length) && length > 0 && length <= 4096, "bounded memory read");
    const buffers = [];
    for (let done = 0; done < length;) {
      const va = address + BigInt(done), size = Math.min(length - done, 4096 - Number(va & 4095n));
      const translated = this.translate(va, root, options);
      buffers.push(this.physical(translated.physical, size)); done += size;
    }
    return Buffer.concat(buffers);
  }
  u64(address) { return this.read(address, 8).readBigUInt64LE(); }
  u32(address) { return this.read(address, 4).readUInt32LE(); }
  witness(address, length = 8, root = this.root, options = {}) {
    assert.ok(Number(address & 4095n) + length <= 4096, "witness crosses page");
    const { physical, walk } = this.translate(address, root, options);
    const bytes = this.read(address, length, root, options);
    return { virtual: hex(address), physical: hex(physical), ramOffset: Number(physical - this.base),
      bytes: bytes.toString("hex"), value: length === 8 ? hex(bytes.readBigUInt64LE()) : length === 4 ? hex(bytes.readUInt32LE()) : null,
      translation: walk };
  }
}

export function walkList(memory, head, bound = 4096) {
  assert.equal(head & 7n, 0n, "unaligned list head");
  const nodes = [], visited = new Set([head]);
  let previous = head, current = memory.u64(head);
  while (current !== head) {
    assert.ok(nodes.length < bound && !visited.has(current), "list bound/cycle");
    assert.equal(current & 7n, 0n, "unaligned list node");
    visited.add(current);
    const next = memory.u64(current), prev = memory.u64(current + 8n);
    assert.equal(prev, previous, "nonreciprocal list previous");
    assert.equal(memory.u64(next + 8n), current, "nonreciprocal list next");
    nodes.push({ address: current, next, previous: prev,
      physical: memory.translate(current).physical });
    previous = current; current = next;
  }
  assert.equal(memory.u64(head + 8n), previous, "nonreciprocal sentinel");
  return nodes;
}

function symbolsFrom(text) {
  const symbols = text.trim().split("\n").map(line => {
    const [address, type, name] = line.trim().split(/\s+/u);
    return { address: BigInt(`0x${address}`), type, name };
  }).sort((a, b) => a.address < b.address ? -1 : a.address > b.address ? 1 : 0);
  const named = name => {
    const match = symbols.find(symbol => symbol.name === name);
    assert.ok(match, `missing kernel symbol ${name}`); return match.address;
  };
  const at = pc => {
    assert.ok(pc >= named("_start") && pc < named("_etext"), "PC outside kernel text");
    let lo = 0, hi = symbols.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (symbols[mid].address <= pc) lo = mid + 1; else hi = mid; }
    const symbol = symbols[lo - 1];
    assert.ok(symbol && /[tT]/u.test(symbol.type), "PC without executable symbol");
    return { name: symbol.name, start: hex(symbol.address), end: hex(symbols[lo].address), offset: hex(pc - symbol.address) };
  };
  return { named, at };
}

export function unwind(memory, { sp, fp, pc, stack, size, trapSize, exceptionReturn }, symbolAt) {
  const top = stack + BigInt(size), trapAddress = top - BigInt((trapSize + 15) & ~15);
  assert.equal(stack & 4095n, 0n, "unaligned kernel stack");
  assert.ok(sp >= stack && sp < trapAddress && !(sp & 7n), "saved SP outside stack");
  const result = [{ pc: hex(pc), symbol: symbolAt(pc), source: "saved task.thread.ra (switch context)" }];
  for (let depth = 0; depth < 64; depth++) {
    assert.ok(fp >= sp + 16n && fp <= top && !(fp & 7n), "invalid kernel frame pointer");
    const prev = memory.u64(fp - 16n), nextPc = memory.u64(fp - 8n);
    result.push({ pc: hex(nextPc), symbol: symbolAt(nextPc), framePointer: hex(fp),
      savedPreviousFp: memory.witness(fp - 16n), savedReturn: memory.witness(fp - 8n) });
    if (nextPc === exceptionReturn) {
      assert.equal(fp, trapAddress, "exception boundary is not the top saved user trap");
      return { frames: result, termination: "ret_from_exception; user context reported separately", trapAddress };
    }
    sp = fp; fp = prev; pc = nextPc;
  }
  throw Error("kernel frame count bound");
}

export function inspect(ram, cpu, image, map, layout) {
  const context = cpuContext(cpu), m = new Memory(ram, context.root, context.pagingMode);
  const o = layout.offsets, symbols = symbolsFrom(map), kernelStart = symbols.named("_start");
  const anchors = ["_start", "__get_task_comm", "__switch_to", "__get_wchan", "__schedule",
    "futex_wait_queue", "futex_wait", "__riscv_sys_futex", "do_trap_ecall_u", "ret_from_exception"].map(name => {
    const address = symbols.named(name), length = 32, offset = Number(address - kernelStart);
    assert.ok(offset + length <= image.length, "anchor image bounds");
    assert.deepEqual(m.read(address, length, m.root, { execute: true }), image.subarray(offset, offset + length), `kernel code anchor ${name}`);
    return { name, imageOffset: offset, ...m.witness(address, length, m.root, { execute: true }) };
  });
  const initTask = symbols.named("init_task"), leaderList = walkList(m, initTask + BigInt(o.TASK_TASKS));
  const leaders = [initTask, ...leaderList.map(node => node.address - BigInt(o.TASK_TASKS))];
  const allPids = new Set(), records = [], groups = [];
  const field = (task, key) => task + BigInt(o[key]);
  for (const leader of leaders) {
    const pid = m.u32(field(leader, "TASK_PID")), signal = m.u64(field(leader, "TASK_SIGNAL"));
    assert.equal(m.u32(field(leader, "TASK_TGID")), pid, "leader PID/TGID mismatch");
    assert.equal(m.u64(field(leader, "TASK_GROUP_LEADER")), leader, "leader identity mismatch");
    const head = signal + BigInt(o.SIGNAL_THREAD_HEAD), threads = walkList(m, head);
    assert.ok(threads.some(node => node.address - BigInt(o.TASK_THREAD_NODE) === leader), "leader absent from its thread list");
    groups.push({ leader: hex(leader), pid, head: hex(head), threads });
    for (const node of threads) {
      const task = node.address - BigInt(o.TASK_THREAD_NODE), tid = m.u32(field(task, "TASK_PID"));
      assert.ok(tid <= 4194304 && !allPids.has(tid), "invalid/duplicate task PID"); allPids.add(tid);
      assert.equal(m.u32(field(task, "TASK_TGID")), pid, "thread TGID mismatch");
      assert.equal(m.u64(field(task, "TASK_GROUP_LEADER")), leader, "thread group-leader mismatch");
      assert.equal(m.u64(field(task, "TASK_SIGNAL")), signal, "thread signal mismatch");
      const name = m.read(field(task, "TASK_COMM"), 16), end = name.indexOf(0);
      assert.ok(end >= 0, "unterminated task comm");
      records.push({ task, pid: tid, tgid: pid, comm: name.subarray(0, end).toString("utf8"),
        state: m.u32(field(task, "TASK_STATE")), onCpu: m.u32(field(task, "TASK_ON_CPU")),
        startBoottimeNs: m.u64(field(task, "TASK_START_BOOTTIME")),
        utimeNs: m.u64(field(task, "TASK_UTIME")), stimeNs: m.u64(field(task, "TASK_STIME")) });
    }
  }
  const current = records.find(record => record.task === context.currentTask);
  assert.ok(current, "saved current task absent from lists");
  const compositors = records.filter(record => record.pid === record.tgid && record.comm === "Hyprland");
  assert.equal(compositors.length, 1, "ambiguous compositor identity");
  const compositor = compositors[0];
  const renderers = records.filter(record => record.tgid === compositor.pid && /^llvmpipe-[0-9]+$/u.test(record.comm));
  assert.equal(renderers.length, 1, "ambiguous renderer identity");
  const targets = [compositor, renderers[0]].map(record => {
    assert.notEqual(record.task, context.currentTask, "current task has no authoritative saved switch stack");
    assert.equal(record.onCpu, 0, "target marked on-CPU; saved switch context may be stale");
    const fields = Object.fromEntries(["TASK_PID", "TASK_TGID", "TASK_GROUP_LEADER", "TASK_STATE", "TASK_ON_CPU",
      "TASK_COMM", "TASK_STACK", "TASK_MM", "TASK_START_BOOTTIME", "TASK_THREAD_RA", "TASK_THREAD_SP", "TASK_THREAD_S0"]
      .map(key => [key, m.witness(field(record.task, key), ["TASK_PID", "TASK_TGID", "TASK_STATE", "TASK_ON_CPU"].includes(key) ? 4 : key === "TASK_COMM" ? 16 : 8)]));
    const chain = unwind(m, { sp: BigInt(fields.TASK_THREAD_SP.value), fp: BigInt(fields.TASK_THREAD_S0.value),
      pc: BigInt(fields.TASK_THREAD_RA.value), stack: BigInt(fields.TASK_STACK.value), size: o.THREAD_SIZE_BYTES,
      trapSize: o.PT_SIZE, exceptionReturn: symbols.named("ret_from_exception") }, symbols.at);
    const trap = Object.fromEntries(Object.keys(o).filter(key => key.startsWith("PT_") && key !== "PT_SIZE")
      .map(key => [key, m.witness(chain.trapAddress + BigInt(o[key]))]));
    assert.equal(BigInt(trap.PT_STATUS.value) & 0x100n, 0n, "saved trap is not userspace");
    const mm = BigInt(fields.TASK_MM.value), pgd = m.witness(mm + BigInt(o.MM_PGD));
    const root = m.translate(BigInt(pgd.value)).physical;
    const userPc = m.witness(BigInt(trap.PT_EPC.value), 16, root, { user: true, execute: true });
    let wait = null;
    if (chain.frames.some(frame => frame.symbol.name === "__riscv_sys_futex")) {
      assert.equal(BigInt(trap.PT_CAUSE.value), 8n, "futex stack without saved user ECALL");
      wait = { meaning: "saved Linux futex system call; userspace caller and wake dependency not identified",
        address: trap.PT_ORIG_A0.value, operation: trap.PT_A1.value, expectedValue: trap.PT_A2.value,
        word: m.witness(BigInt(trap.PT_ORIG_A0.value), 4, root, { user: true }) };
    }
    return { ...record, stateMeaning: record.state === 0 ? "runnable at checkpoint; not the current task" : "saved non-running state; raw flags retained",
      fields, ...chain, trap, userAddressSpace: { pgd, physicalRoot: hex(root) }, userPc, wait };
  });
  return { context, current, anchors, leaderList, groups, tasks: records, targets,
    limitation: "R3 boot checkpoint predates T03m input. Saved switch/trap contexts are not live execution samples. No userspace caller, futex owner, later wait persistence, latency improvement, or input success is proven.",
    nextProbe: "Observe the same PID/starttime, stack and wait address during the later failed input interval; bind the userspace caller and renderer work before selecting a remedy." };
}

export async function main(output) {
  assert.ok(output, "usage: omarchy-wait-checkpoint.mjs NEW_OUTPUT_DIRECTORY");
  const out = path.resolve(output);
  assert.ok(!fs.existsSync(out), "output directory already exists");
  const layoutPath = "evidence/omarchy-profile/checkpoint-wait-layout/layout.json";
  const layoutBytes = pinned(fs.readFileSync(path.join(repo, layoutPath)), pins.layout, "layout");
  const layout = JSON.parse(layoutBytes);
  const inputPaths = { snapshot: "target/omarchy-sdr-r3-snapshot/omarchy-ready.snap.gz",
    image: "releases/kernel/6.6.63/Image", map: "releases/kernel/6.6.63/System.map", config: "releases/kernel/6.6.63/config",
    source: "tools/verify/omarchy-kernel-layout.c" };
  const files = Object.fromEntries(Object.entries(inputPaths).map(([key, file]) => [key, fs.readFileSync(path.join(repo, file))]));
  pinned(files.snapshot, pins.snapshot, "snapshot");
  for (const [key, label] of [["image", "arch/riscv/boot/Image"], ["map", "System.map"], ["config", ".config"]]) {
    pinned(files[key], layout.kernelFiles[label], key);
  }
  pinned(files.source, layout.sourceSha256, "layout source");
  const parsed = sections(gunzipSync(files.snapshot, { maxOutputLength: 2 * 1024 ** 3 }));
  const ram = decodeRam(parsed.get(2), 1024 ** 3);
  const result = inspect(ram, parsed.get(1), files.image, files.map.toString("utf8"), layout);
  const receipt = { purpose: "offline pinned Omarchy checkpoint wait inspection",
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    command: [process.execPath, "tools/verify/omarchy-wait-checkpoint.mjs", output],
    inputs: Object.fromEntries(Object.entries(files).map(([key, bytes]) => [key, { path: inputPaths[key], bytes: bytes.length, sha256: sha(bytes) }])),
    layout: { path: layoutPath, sha256: pins.layout },
    ram: { bytes: ram.length, sha256: sha(ram) },
    cpu: { bytes: parsed.get(1).length, sha256: sha(parsed.get(1)) }, result };
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "checkpoint.json"), JSON.stringify(receipt, (_, value) => typeof value === "bigint" ? hex(value) : value, 2) + "\n");
  console.log(JSON.stringify({ tasks: result.tasks.length, currentPid: result.current.pid,
    targets: result.targets.map(target => ({ pid: target.pid, name: target.comm, state: target.state,
      stack: target.frames.map(frame => frame.symbol.name), wait: target.wait?.address ?? null })),
    limitation: result.limitation }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main(process.argv[2]);

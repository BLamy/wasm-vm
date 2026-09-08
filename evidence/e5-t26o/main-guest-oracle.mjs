// Independent fixture expectation derived from the declared RV64 guest words.
// No emulator, worker fixture import, test output, or observed trace is read.
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const setup = [0x00000297, 0x10028293, 0x30529073, 0x80000313,
  0x30432073, 0x00800313, 0x30032073, 0x0c0002b7,
  0x00700313, 0x0662ae23, 0x0c0022b7, 0x80000337,
  0x0062a023, 0x0c2002b7, 0x0002a023, 0x0000006f];
const handler = [0x0c2002b7, 0x0042a503, 0x00a2a223, 0x00050593, 0x30200073];
const ram = Buffer.alloc(65536);
setup.forEach((word, i) => ram.writeUInt32LE(word, i * 4));
handler.forEach((word, i) => ram.writeUInt32LE(word, 0x100 + i * 4));
// MMIO writes leave guest RAM unchanged; CSR writes with rd=x0 do not log an rd.
const effects = [
  " x5 0x0000000080000000", " x5 0x0000000080000100", "",
  " x6 0xfffffffffffff800", "", " x6 0x0000000000000008", "",
  " x5 0x000000000c000000", " x6 0x0000000000000007",
  " mem 0x000000000c00007c 0x00000007", " x5 0x000000000c002000",
  " x6 0xffffffff80000000", " mem 0x000000000c002000 0x80000000",
  " x5 0x000000000c200000", " mem 0x000000000c200000 0x00000000", "",
  " x5 0x000000000c200000", " x10 0x000000000000001f mem 0x000000000c200004",
  " mem 0x000000000c200004 0x0000001f", " x11 0x000000000000001f", "",
];
assert.equal(effects.length, setup.length + handler.length);
const words = [...setup, ...handler];
const pcs = [...setup.map((_, i) => 0x80000000 + 4 * i),
  ...handler.map((_, i) => 0x80000100 + 4 * i)];
const trace = words.map((word, i) => `core 0: 0x${pcs[i].toString(16).padStart(16, "0")} (0x${word.toString(16).padStart(8, "0")})${effects[i]}\n`).join("");
const memorySha256 = createHash("sha256").update(ram).digest("hex");
console.log(JSON.stringify({ setup: setup.map(w => w.toString(16).padStart(8, "0")),
  handler: handler.map(w => w.toString(16).padStart(8, "0")), trace, memorySha256,
  retired: 21, trap: { pc: "0x80000100", mepc: "0x8000003c", mcause: "0x800000000000000b",
    mstatus: "0x0000000a00001880", retired: 16 },
  final: { pc: "0x8000003c", mstatus: "0x0000000a00000088", x10: 31, x11: 31,
    source31ClaimCount: 1, pendingAfterDeassertAndComplete: false } }, null, 2));

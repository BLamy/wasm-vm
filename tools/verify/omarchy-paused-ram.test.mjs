import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { inspect, inspectPausedRam, pins, pinned } from "./omarchy-wait-checkpoint.mjs";

test("pinned RAM adapter preserves the earlier decoder and excludes current-task stale registers", () => {
  const ram = pinned(fs.readFileSync("target/omarchy-wait-inspection/ram.bin"),
    "7b4695440b7bb6bfaa07b19e90afb758692627bd571fa2d6dd40d2e68e37616b", "earlier decoded RAM");
  const cpu = pinned(fs.readFileSync("target/omarchy-wait-inspection/cpu.bin"),
    "08163a0031aadce50be25156dfb71f517dc9d6c1e18be9494c555e88143bcf94", "earlier CPU");
  const layout = JSON.parse(pinned(fs.readFileSync("evidence/omarchy-profile/checkpoint-wait-layout/layout.json"), pins.layout, "layout"));
  const image = pinned(fs.readFileSync("releases/kernel/6.6.63/Image"), layout.kernelFiles["arch/riscv/boot/Image"], "Image");
  const map = pinned(fs.readFileSync("releases/kernel/6.6.63/System.map"), layout.kernelFiles["System.map"], "map").toString();
  const expected = JSON.parse(pinned(fs.readFileSync("evidence/omarchy-profile/checkpoint-wait-r1/checkpoint.json"),
    "1278b8bdd81471590bbb37cccdf6c392c09132fd0bfc24f274b26981cfb1b49a", "earlier evidence")).result;
  const stringify = value => JSON.stringify(value, (_, v) => typeof v === "bigint" ? `0x${v.toString(16)}` : v);
  assert.equal(stringify(inspect(ram, cpu, image, map, layout)), JSON.stringify(expected));
  const result = inspectPausedRam(ram, image, map, layout);
  assert.equal(result.current.pid, 174);
  assert.equal(result.targets[0].wait.address, "0x55555efbb948");
  assert.equal(result.context.pc, undefined);
  const flag = Number(BigInt(result.context.pagingFlags[0].physical) - 0x80000000n);
  ram[flag] = 0; assert.throws(() => inspectPausedRam(ram, image, map, layout), /not the pinned Sv57/u); ram[flag] = 1;
  const bashCpu = Number(result.current.task - 0xff60000000000000n) + layout.offsets.TASK_ON_CPU;
  const renderCpu = result.targets[1].fields.TASK_ON_CPU.ramOffset;
  ram.writeUInt32LE(1, renderCpu);
  assert.throws(() => inspectPausedRam(ram, image, map, layout), /ambiguous/u);
  ram.writeUInt32LE(0, bashCpu);
  const currentRenderer = inspectPausedRam(ram, image, map, layout).targets[1];
  assert.equal(currentRenderer.pid, 462); assert.equal(currentRenderer.trap, undefined);
  assert.equal(currentRenderer.frames, undefined); assert.match(currentRenderer.contextKind, /omitted/u);
  ram.writeUInt32LE(1, bashCpu); ram.writeUInt32LE(0, renderCpu);
  pinned(ram, "7b4695440b7bb6bfaa07b19e90afb758692627bd571fa2d6dd40d2e68e37616b", "restored test input");
});

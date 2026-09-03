import { parentPort, workerData } from "node:worker_threads";

import {
  attachControlBlock,
  irqCount,
  mmioRequest,
  wfiPark,
} from "../../cpu-control-block.js";

const cells = attachControlBlock(workerData.controlSab);
const data = new Int32Array(workerData.dataSab);

parentPort.on("message", (message) => {
  if (message?.op === "park") {
    const seen = Number.isInteger(message.seen) ? message.seen : irqCount(cells);
    parentPort.postMessage({ type: "waiting", seen });
    const status = wfiPark(cells, seen, 5_000);
    parentPort.postMessage({ type: "woke", status, irq: irqCount(cells), value: Atomics.load(data, 0) });
    return;
  }

  if (message?.op === "park-loop") {
    const seen = Number.isInteger(message.seen) ? message.seen : irqCount(cells);
    parentPort.postMessage({ type: "waiting", seen });
    let wakeups = 0;
    let status;
    for (;;) {
      status = wfiPark(cells, seen, 5_000);
      wakeups += 1;
      if (irqCount(cells) !== seen) break;
      parentPort.postMessage({ type: "spurious", wakeups });
    }
    parentPort.postMessage({ type: "loop-woke", status, wakeups, irq: irqCount(cells), value: Atomics.load(data, 0) });
    return;
  }

  if (message?.op === "mmio") {
    parentPort.postMessage({ type: "mmio-start" });
    const first = mmioRequest(cells, {
      addr: 0x1_0000_0004n,
      width: 8,
      write: false,
      value: 0n,
    });
    parentPort.postMessage({ type: "mmio-result", req: 1, value: first.toString(16).padStart(16, "0") });
    mmioRequest(cells, {
      addr: 0x1_0000_0010n,
      width: 4,
      write: true,
      value: 0xaabb_ccddn,
    });
    parentPort.postMessage({ type: "mmio-done", req: 2 });
  }
});

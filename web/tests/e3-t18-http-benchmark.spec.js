import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTROL_URL = process.env.E3_T18_CONTROL_URL ?? "";
const AUTH_KEY = process.env.E3_T18_AUTH_KEY ?? "";
const PEER_IP = process.env.E3_T18_PEER_IP ?? "";
const FETCH_URL = process.env.E3_T18_FETCH_URL ?? "";
const BYTES = Number(process.env.E3_T18_BYTES ?? 1024 * 1024 * 1024);

test("E3-T18 compares generic TCP, browser fetch, and streaming Tailscale HTTP", async ({ page }) => {
  test.skip(!CONTROL_URL || !AUTH_KEY || !PEER_IP || !FETCH_URL,
    "set the live Headscale fixture and loopback fetch environment");
  test.setTimeout(7_200_000);
  await page.goto("/");

  const result = await page.evaluate(async ({ controlUrl, authKey, peerIp, fetchUrl, bodyBytes }) => {
    const { createTailscaleRuntime } = await import("./tailscale-runtime.js");
    const { createHttpFastPathEvaluator } = await import("./http-fast-path-eval.js");
    let running;
    const ready = new Promise((resolve) => { running = resolve; });
    const runtime = await createTailscaleRuntime({
      wasmUrl: "./tailscale-connect/main.wasm",
      controlUrl,
      hostname: "wasm-vm-e3-t18-benchmark",
      authKey,
      state: {},
      acceptDns: true,
    }, {
      status: (status) => { if (status?.state === "Running") running(); },
      storageUpdate: () => {},
    });
    await runtime.start();
    await Promise.race([
      ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Tailscale benchmark login timed out")), 180_000)),
    ]);

    const maxQueueBytes = 256 * 1024;
    const evaluator = createHttpFastPathEvaluator({
      enabled: true,
      allowlist: [fetchUrl, `http://${peerIp}:18000`],
      dialTCP: runtime.dialTCP,
      maxQueueBytes,
    });
    const percentile = (values, fraction) => {
      if (!values.length) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
    };
    const consume = () => {
      let offset = 0;
      let last = performance.now();
      let stalled = false;
      const gaps = [];
      let peakHeap = performance.memory?.usedJSHeapSize ?? 0;
      const baselineHeap = peakHeap;
      return {
        onChunk: async (chunk) => {
          if (chunk.byteLength > maxQueueBytes) throw new Error("consumer received an oversized chunk");
          const now = performance.now();
          gaps.push(now - last);
          last = now;
          for (let index = 0; index < chunk.byteLength; index += 1) {
            if (chunk[index] !== ((offset + index) & 255)) {
              throw new Error(`body mismatch at ${offset + index}`);
            }
          }
          offset += chunk.byteLength;
          peakHeap = Math.max(peakHeap, performance.memory?.usedJSHeapSize ?? 0);
          if (!stalled && offset >= maxQueueBytes) {
            stalled = true;
            await new Promise((resolve) => setTimeout(resolve, 250));
            peakHeap = Math.max(peakHeap, performance.memory?.usedJSHeapSize ?? 0);
          }
        },
        summary: (elapsedMs) => ({
          bytes: offset,
          elapsedMs,
          mibPerSecond: (offset / (1024 * 1024)) / (elapsedMs / 1000),
          chunkGapP50Ms: percentile(gaps, 0.50),
          chunkGapP99Ms: percentile(gaps, 0.99),
          peakIncrementalHeapBytes: Math.max(0, peakHeap - baselineHeap),
          stalledConsumer: stalled,
        }),
      };
    };
    const rawTcp = async () => {
      const consumer = consume();
      const conn = await runtime.dialTCP(peerIp, 18000, 10_000);
      let header = new Uint8Array();
      let headersDone = false;
      const started = performance.now();
      try {
        const request = new TextEncoder().encode(
          `GET /e3-t18/fixed?bytes=${bodyBytes} HTTP/1.1\r\nHost: ${peerIp}\r\nConnection: close\r\n\r\n`,
        );
        await conn.write(request);
        for (;;) {
          const chunk = await conn.read(Math.min(maxQueueBytes, 64 * 1024));
          if (chunk === null) break;
          if (!headersDone) {
            const joined = new Uint8Array(header.byteLength + chunk.byteLength);
            joined.set(header);
            joined.set(chunk, header.byteLength);
            if (joined.byteLength > 64 * 1024 + maxQueueBytes) throw new Error("raw HTTP header exceeded bound");
            let boundary = -1;
            for (let index = 0; index + 3 < joined.byteLength; index += 1) {
              if (joined[index] === 13 && joined[index + 1] === 10 &&
                  joined[index + 2] === 13 && joined[index + 3] === 10) {
                boundary = index + 4;
                break;
              }
            }
            if (boundary < 0) {
              header = joined;
              continue;
            }
            const text = new TextDecoder().decode(joined.subarray(0, boundary));
            if (!text.startsWith("HTTP/1.1 200") || !new RegExp(`content-length: ${bodyBytes}`, "i").test(text)) {
              throw new Error(`unexpected raw response headers: ${text}`);
            }
            headersDone = true;
            header = new Uint8Array();
            if (joined.byteLength > boundary) await consumer.onChunk(joined.subarray(boundary));
          } else {
            await consumer.onChunk(chunk);
          }
        }
      } finally {
        await conn.close().catch(() => {});
      }
      return consumer.summary(performance.now() - started);
    };
    const fetchCandidate = async () => {
      const consumer = consume();
      const started = performance.now();
      const response = await evaluator.request({ url: `${fetchUrl}/e3-t18/fixed?bytes=${bodyBytes}` }, {
        path: "browser-fetch", onChunk: consumer.onChunk,
      });
      if (response.status !== 200 || response.bodyBytes !== bodyBytes) throw new Error("browser fetch length mismatch");
      return consumer.summary(performance.now() - started);
    };
    const tailscaleCandidate = async () => {
      const consumer = consume();
      const started = performance.now();
      const response = await evaluator.request({ url: `http://${peerIp}:18000/e3-t18/fixed?bytes=${bodyBytes}` }, {
        path: "tailscale-http", onChunk: consumer.onChunk,
      });
      if (response.status !== 200 || response.bodyBytes !== bodyBytes) throw new Error("Tailscale HTTP length mismatch");
      return consumer.summary(performance.now() - started);
    };

    const runners = { "generic-tcp": rawTcp, "browser-fetch": fetchCandidate, "tailscale-http": tailscaleCandidate };
    const orders = [
      ["generic-tcp", "browser-fetch", "tailscale-http"],
      ["browser-fetch", "tailscale-http", "generic-tcp"],
      ["tailscale-http", "generic-tcp", "browser-fetch"],
    ];
    const runs = [];
    for (const order of orders) {
      for (const path of order) runs.push({ path, ...await runners[path]() });
    }
    return { bodyBytes, maxQueueBytes, orders, runs };
  }, { controlUrl: CONTROL_URL, authKey: AUTH_KEY, peerIp: PEER_IP, fetchUrl: FETCH_URL, bodyBytes: BYTES });

  for (const pathName of ["generic-tcp", "browser-fetch", "tailscale-http"]) {
    const runs = result.runs.filter(({ path }) => path === pathName);
    expect(runs).toHaveLength(3);
    expect(runs.every(({ bytes, stalledConsumer }) => bytes === BYTES && stalledConsumer)).toBe(true);
  }
  if (BYTES === 1024 * 1024 * 1024) {
    const evidence = path.resolve(WEB, "../evidence/e3-t18");
    fs.mkdirSync(evidence, { recursive: true });
    fs.writeFileSync(path.join(evidence, "benchmark.json"), `${JSON.stringify(result, null, 2)}\n`);
  }
});

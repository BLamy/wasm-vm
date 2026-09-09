#!/usr/bin/env node
/**
 * Portable Node-compatible system workload benchmark.
 *
 * The same script is intended to run in native Node and in the Node-alpine
 * guest shipped by wasm-vm. It deliberately uses only Node built-ins so an
 * adapter can run it without a project-specific harness. Every timed sample
 * verifies its result after the operation, and the JSON output retains the
 * individual samples instead of publishing only a headline number.
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile as readFileAsync, rm, stat, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Transform, pipeline as pipelineCallback } from "node:stream";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";

const pipeline = promisify(pipelineCallback);

export const BENCHMARK_SCHEMA = 1;
export const BENCHMARK_KIND = "node-system-workload-benchmark-v1";
export const FIXTURE_ID = "runtime-workloads-v1";

const BYTES_PER_MIB = 1024 * 1024;
const DEFAULTS = Object.freeze({
  samples: 7,
  warmups: 2,
  payloadKib: 1024,
  streamChunkKib: 64,
  httpRequests: 8,
});

const WORKLOAD_INFO = Object.freeze([
  {
    id: "file-read",
    label: "File read",
    operation: "fs.promises.readFile + SHA-256 verification",
  },
  {
    id: "file-write",
    label: "File write",
    operation: "fs.promises.writeFile + stat + SHA-256 verification",
  },
  {
    id: "stream-read",
    label: "Stream read",
    operation: "fs.createReadStream + incremental SHA-256",
  },
  {
    id: "stream-copy",
    label: "Stream copy",
    operation: "pipeline(readable, Transform, writable)",
  },
  {
    id: "server-lifecycle",
    label: "Server lifecycle",
    operation: "http.createServer + listen + close",
  },
  {
    id: "http-roundtrip",
    label: "HTTP round trip",
    operation: "local HTTP server + sequential requests + close",
  },
]);

function round(value) {
  return Number(value.toFixed(3));
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) return null;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1),
  );
  return sortedValues[index];
}

function summarize(samples) {
  const elapsed = samples.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
  const bytes = samples.map((sample) => sample.bytes ?? 0);
  const total = elapsed.reduce((sum, value) => sum + value, 0);
  const mean = total / elapsed.length;
  const variance =
    elapsed.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    elapsed.length;
  const medianMs = percentile(elapsed, 0.5);
  const byteCount = bytes.every((value) => value === bytes[0])
    ? bytes[0]
    : Math.max(...bytes);

  return {
    sampleCount: elapsed.length,
    minMs: elapsed[0],
    maxMs: elapsed[elapsed.length - 1],
    meanMs: round(mean),
    medianMs,
    p95Ms: percentile(elapsed, 0.95),
    stdevMs: round(Math.sqrt(variance)),
    bytes: byteCount,
    throughputMiBPerSec:
      byteCount > 0 && medianMs > 0
        ? round(byteCount / BYTES_PER_MIB / (medianMs / 1000))
        : null,
  };
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, received ${value}`);
  }
  return parsed;
}

function parseArguments(argv) {
  const options = { ...DEFAULTS, environment: "unknown-node", only: null };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      throw new Error(`unexpected argument: ${argument}`);
    }

    const separator = argument.indexOf("=");
    const key = separator === -1 ? argument.slice(2) : argument.slice(2, separator);
    const value = separator === -1 ? argv[++index] : argument.slice(separator + 1);
    if (value === undefined || value === "") {
      throw new Error(`missing value for --${key}`);
    }

    switch (key) {
      case "environment":
        options.environment = value;
        break;
      case "samples":
        options.samples = parsePositiveInteger(value, "--samples");
        break;
      case "warmups":
        options.warmups = parsePositiveInteger(value, "--warmups");
        break;
      case "payload-kib":
        options.payloadKib = parsePositiveInteger(value, "--payload-kib");
        break;
      case "stream-chunk-kib":
        options.streamChunkKib = parsePositiveInteger(value, "--stream-chunk-kib");
        break;
      case "http-requests":
        options.httpRequests = parsePositiveInteger(value, "--http-requests");
        break;
      case "only":
        options.only = value.split(",").map((item) => item.trim()).filter(Boolean);
        break;
      case "output":
        options.output = value;
        break;
      case "workdir":
        options.workdir = value;
        break;
      case "keep":
        options.keep = value === "true" || value === "1";
        break;
      default:
        throw new Error(`unknown option: --${key}`);
    }
  }

  return options;
}

function helpText() {
  return `Usage: node web/bench-runtime-workloads.mjs [options]

Runs the portable Node system workload suite and writes a detailed JSON result.

Options:
  --environment=ID       Environment label stored in the result (default: unknown-node)
  --samples=N             Measured samples per workload (default: ${DEFAULTS.samples})
  --warmups=N             Warmup samples per workload (default: ${DEFAULTS.warmups})
  --payload-kib=N         Deterministic fixture size (default: ${DEFAULTS.payloadKib})
  --stream-chunk-kib=N    Read-stream highWaterMark (default: ${DEFAULTS.streamChunkKib})
  --http-requests=N       Requests per HTTP sample (default: ${DEFAULTS.httpRequests})
  --only=ID,ID            Run a subset of workload IDs
  --output=PATH            Write JSON to PATH; otherwise print the full JSON
  --workdir=PATH           Parent directory for the temporary workload directory
  --keep=true              Keep the temporary workload directory for inspection
  --help                   Show this help

Workloads: ${WORKLOAD_INFO.map((workload) => workload.id).join(", ")}
`;
}

function makeFixture(payloadBytes, httpBodyBytes, streamChunkBytes) {
  const payload = Buffer.alloc(payloadBytes);
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] = (index * 31 + (index >>> 8) * 17 + 0x5a) & 0xff;
  }
  const httpBody = payload.subarray(0, Math.min(payload.length, httpBodyBytes));
  return {
    id: FIXTURE_ID,
    payload,
    payloadBytes: payload.length,
    payloadSha256: sha256(payload),
    streamChunkBytes,
    httpBody,
    httpBodyBytes: httpBody.length,
    httpBodySha256: sha256(httpBody),
  };
}

async function timed(operation) {
  const started = performance.now();
  const details = await operation();
  return { ...details, elapsedMs: round(performance.now() - started) };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: "127.0.0.1", port: 0 });
  });
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function requestBody(port, expectedBody) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const clientRequest = request(
      {
        host: "127.0.0.1",
        port,
        path: "/runtime-bench",
        method: "GET",
        headers: { connection: "close" },
      },
      (response) => {
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.once("error", reject);
        response.once("aborted", () => reject(new Error("HTTP response aborted")));
        response.once("end", () => {
          const body = Buffer.concat(chunks);
          if (response.statusCode !== 200) {
            reject(new Error(`HTTP response status ${response.statusCode}`));
            return;
          }
          if (body.length !== expectedBody.length || sha256(body) !== sha256(expectedBody)) {
            reject(new Error("HTTP response body failed checksum verification"));
            return;
          }
          resolve(body.length);
        });
      },
    );
    clientRequest.once("error", reject);
    clientRequest.end();
  });
}

function createWorkloads({ fixture, scratchDirectory, options }) {
  const sourcePath = path.join(scratchDirectory, "fixture.bin");
  return [
    {
      ...WORKLOAD_INFO[0],
      run: async () => {
        const sample = await timed(async () => {
          const contents = await readFileAsync(sourcePath);
          const digest = sha256(contents);
          if (contents.length !== fixture.payloadBytes || digest !== fixture.payloadSha256) {
            throw new Error("file read failed checksum verification");
          }
          return { bytes: contents.length, sha256: digest };
        });
        return { ...sample, verification: "passed" };
      },
    },
    {
      ...WORKLOAD_INFO[1],
      run: async (_, sampleIndex) => {
        const destinationPath = path.join(scratchDirectory, `write-${sampleIndex}.bin`);
        const sample = await timed(async () => {
          await writeFile(destinationPath, fixture.payload);
          return { bytes: fixture.payloadBytes };
        });
        const metadata = await stat(destinationPath);
        const contents = await readFileAsync(destinationPath);
        const digest = sha256(contents);
        if (
          metadata.size !== fixture.payloadBytes ||
          contents.length !== fixture.payloadBytes ||
          digest !== fixture.payloadSha256
        ) {
          throw new Error("file write failed size or checksum verification");
        }
        return { ...sample, sha256: digest, verification: "passed" };
      },
    },
    {
      ...WORKLOAD_INFO[2],
      run: async () => {
        const sample = await timed(async () => {
          const digest = createHash("sha256");
          let bytes = 0;
          const stream = createReadStream(sourcePath, {
            highWaterMark: fixture.streamChunkBytes,
          });
          for await (const chunk of stream) {
            bytes += chunk.length;
            digest.update(chunk);
          }
          return { bytes, sha256: digest.digest("hex") };
        });
        if (sample.bytes !== fixture.payloadBytes || sample.sha256 !== fixture.payloadSha256) {
          throw new Error("stream read failed checksum verification");
        }
        return { ...sample, verification: "passed" };
      },
    },
    {
      ...WORKLOAD_INFO[3],
      run: async (_, sampleIndex) => {
        const destinationPath = path.join(scratchDirectory, `copy-${sampleIndex}.bin`);
        const digest = createHash("sha256");
        let bytes = 0;
        const transform = new Transform({
          transform(chunk, encoding, callback) {
            bytes += chunk.length;
            digest.update(chunk);
            callback(null, chunk);
          },
        });
        const sample = await timed(async () => {
          await pipeline(
            createReadStream(sourcePath, { highWaterMark: fixture.streamChunkBytes }),
            transform,
            createWriteStream(destinationPath),
          );
          return { bytes, sha256: digest.digest("hex") };
        });
        const metadata = await stat(destinationPath);
        if (
          bytes !== fixture.payloadBytes ||
          sample.sha256 !== fixture.payloadSha256 ||
          metadata.size !== fixture.payloadBytes
        ) {
          throw new Error("stream copy failed size or checksum verification");
        }
        return { ...sample, verification: "passed" };
      },
    },
    {
      ...WORKLOAD_INFO[4],
      run: async () => {
        const server = createServer((_request, response) => {
          response.statusCode = 204;
          response.end();
        });
        const sample = await timed(async () => {
          const listenStarted = performance.now();
          await listen(server);
          const listenMs = performance.now() - listenStarted;
          const closeStarted = performance.now();
          await closeServer(server);
          const closeMs = performance.now() - closeStarted;
          return { listenMs: round(listenMs), closeMs: round(closeMs), bytes: 0 };
        });
        return { ...sample, verification: "passed" };
      },
    },
    {
      ...WORKLOAD_INFO[5],
      run: async () => {
        const server = createServer((requestMessage, response) => {
          if (requestMessage.method !== "GET" || requestMessage.url !== "/runtime-bench") {
            response.statusCode = 404;
            response.end();
            return;
          }
          response.writeHead(200, {
            "content-type": "application/octet-stream",
            "content-length": fixture.httpBodyBytes,
          });
          response.end(fixture.httpBody);
        });
        let listened = false;
        try {
          const sample = await timed(async () => {
            const listenStarted = performance.now();
            await listen(server);
            listened = true;
            const listenMs = performance.now() - listenStarted;
            const address = server.address();
            if (!address || typeof address === "string") {
              throw new Error("HTTP server did not expose a TCP port");
            }
            const requestStarted = performance.now();
            let responseBytes = 0;
            for (let index = 0; index < options.httpRequests; index += 1) {
              responseBytes += await requestBody(address.port, fixture.httpBody);
            }
            const requestMs = performance.now() - requestStarted;
            const closeStarted = performance.now();
            await closeServer(server);
            listened = false;
            const closeMs = performance.now() - closeStarted;
            return {
              bytes: responseBytes,
              requests: options.httpRequests,
              responseBytes,
              listenMs: round(listenMs),
              requestMs: round(requestMs),
              closeMs: round(closeMs),
            };
          });
          return { ...sample, verification: "passed" };
        } finally {
          if (listened) await closeServer(server);
        }
      },
    },
  ];
}

function isUnsupportedError(error) {
  return [
    "ERR_MODULE_NOT_FOUND",
    "ERR_NOT_SUPPORTED",
    "ERR_UNSUPPORTED_BUILTIN_MODULE",
    "ENOSYS",
  ].includes(error?.code);
}

async function environmentMetadata(environment) {
  const cpus = typeof os.cpus === "function" ? os.cpus() : [];
  return {
    id: environment,
    nodeVersion: process.version ?? null,
    versions: process.versions ?? {},
    platform: process.platform ?? null,
    arch: process.arch ?? null,
    osRelease: typeof os.release === "function" ? os.release() : null,
    execPath: process.execPath ?? null,
    logicalCpus: cpus.length || null,
  };
}

export async function runBenchmark(rawOptions = {}) {
  const options = { ...DEFAULTS, environment: "unknown-node", ...rawOptions };
  const selectedIds = options.only ? new Set(options.only) : null;
  const unknownIds = selectedIds
    ? [...selectedIds].filter((id) => !WORKLOAD_INFO.some((workload) => workload.id === id))
    : [];
  if (unknownIds.length > 0) {
    throw new Error(`unknown workload ID(s): ${unknownIds.join(", ")}`);
  }

  const payloadBytes = options.payloadKib * 1024;
  const streamChunkBytes = options.streamChunkKib * 1024;
  const httpBodyBytes = Math.min(payloadBytes, 64 * 1024);
  const fixture = makeFixture(payloadBytes, httpBodyBytes, streamChunkBytes);
  const scriptPath = fileURLToPath(import.meta.url);
  const scriptSha256 = sha256(await readFileAsync(scriptPath));
  const scratchParent = options.workdir ? path.resolve(options.workdir) : os.tmpdir();
  const scratchDirectory = await mkdtemp(path.join(scratchParent, "wasm-vm-runtime-"));
  const startedAt = new Date().toISOString();

  try {
    await writeFile(path.join(scratchDirectory, "fixture.bin"), fixture.payload);
    const workloads = createWorkloads({ fixture, scratchDirectory, options });
    const results = [];

    for (const workload of workloads) {
      if (selectedIds && !selectedIds.has(workload.id)) continue;
      try {
        for (let index = 0; index < options.warmups; index += 1) {
          await workload.run("warmup", index);
        }
        const samples = [];
        for (let index = 0; index < options.samples; index += 1) {
          samples.push(await workload.run("sample", index));
        }
        results.push({
          id: workload.id,
          label: workload.label,
          operation: workload.operation,
          status: "measured",
          samples,
          summary: summarize(samples),
          verification: {
            sampleCount: samples.length,
            passed: samples.every((sample) => sample.verification === "passed"),
          },
        });
      } catch (error) {
        if (!isUnsupportedError(error)) {
          throw new Error(`${workload.id}: ${error.message}`, { cause: error });
        }
        results.push({
          id: workload.id,
          label: workload.label,
          operation: workload.operation,
          status: "unsupported",
          reason: error.message,
          samples: [],
          summary: null,
          verification: { sampleCount: 0, passed: false },
        });
      }
    }

    return {
      schema: BENCHMARK_SCHEMA,
      kind: BENCHMARK_KIND,
      status: results.every((workload) => workload.status === "measured") ? "measured" : "partial",
      generatedAt: startedAt,
      environment: await environmentMetadata(options.environment),
      runner: {
        source: "web/bench-runtime-workloads.mjs",
        scriptSha256,
        command: ["node", "web/bench-runtime-workloads.mjs", ...process.argv.slice(2)],
      },
      fixture: {
        id: fixture.id,
        payloadBytes: fixture.payloadBytes,
        payloadSha256: fixture.payloadSha256,
        streamChunkBytes: fixture.streamChunkBytes,
        httpBodyBytes: fixture.httpBodyBytes,
        httpBodySha256: fixture.httpBodySha256,
      },
      policy: {
        samples: options.samples,
        warmups: options.warmups,
        httpRequests: options.httpRequests,
      },
      workloads: results,
    };
  } finally {
    if (!options.keep) await rm(scratchDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  const result = await runBenchmark(options);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) {
    await writeFile(path.resolve(options.output), serialized);
    const summary = {
      schema: result.schema,
      kind: result.kind,
      status: result.status,
      environment: result.environment,
      fixture: result.fixture,
      workloads: result.workloads.map((workload) => ({
        id: workload.id,
        status: workload.status,
        summary: workload.summary,
        verification: workload.verification,
      })),
      output: path.resolve(options.output),
    };
    process.stdout.write(`RUNTIME_WORKLOAD_RESULT=${JSON.stringify(summary)}\n`);
  } else {
    process.stdout.write(serialized);
  }
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}

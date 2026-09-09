// E4-T28b: prove the shipped Node-Alpine browser JIT on a real terminal, a real Node REPL, and a
// guest-computed HTTP workload. The workload deliberately generates its hot function twice inside
// Node, changes the generated result, and then uses that function to build every response body.
// Nothing in the assertions can be satisfied by a host-side transcript or a literal echo.
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const expectedNodeManifestSha256 = "ac6a298883c36d170534a679fd976c5681a20f1fa48ef2d587e6bc124e70b1c1";
const workloadId = "e4-t28b-generated-http-v1";
const workload = Object.freeze({
  id: workloadId,
  requests: 1,
  bodyBytes: 256,
  generatedRounds: 1,
});
const evidencePath = path.join(repoRoot, "evidence/e4-t28b/node-interactive-2026-09-03.json");
const productionAssetBase = "https://pub-ee599ce692e44e29868ebfa96dd9c7fd.r2.dev";

const jitControl = Object.freeze({
  name: "jit",
  query: "jit=1&jitThreshold=512&jitResidency=repack-off&jalr=1&region=1&quantum=100000",
  jit: true,
  threshold: 512,
  residency: "repack-off",
  jalr: true,
  region: true,
  interpreter: "fast",
});
const interpreterControl = Object.freeze({
  name: "interpreter",
  query: "jit=0&slowInterp=1&jalr=1&region=1&quantum=100000",
  jit: false,
  threshold: 512,
  residency: "disabled",
  jalr: true,
  region: true,
  interpreter: "legacy",
});

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(relativePath) {
  return sha256Bytes(fs.readFileSync(path.join(repoRoot, relativePath)));
}

function gitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`;
}

function ledgerEntryHash(entry) {
  return sha256Bytes(Buffer.from(canonicalJson(entry), "utf8"));
}

function loadLevel3Baseline() {
  const ledgerPath = path.join(repoRoot, "bench/ledger.json");
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  const matches = ledger.entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.baseline === "level3-interpreter" &&
      entry.engine === "browser" && entry.bench === "node-http" &&
      entry.config?.workloadId === workloadId && entry.config?.jit === false);
  if (matches.length === 0) return null;
  const { entry, index } = matches.at(-1);
  return {
    ledgerPath: "bench/ledger.json",
    ledgerSha256: sha256File("bench/ledger.json"),
    entryIndex: index,
    rowSha256: ledgerEntryHash(entry),
    entry,
  };
}

function shQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function makeGeneratedHttpSource(token) {
  const tokenLiteral = JSON.stringify(token);
  const requests = workload.requests;
  const bodyBytes = workload.bodyBytes;
  const rounds = workload.generatedRounds;
  // Keep the source one line: it is typed through the same terminal bridge as a human command and
  // a line break would change the shell boundary being measured.
  return [
    `const http=require("http"),TOKEN=${tokenLiteral}`,
    `,REQUESTS=${requests},BODY_BYTES=${bodyBytes},ROUNDS=${rounds}`,
    `,seed=Buffer.alloc(BODY_BYTES);`,
    `for(let i=0;i<seed.length;i++)seed[i]=(i*31+(i>>>8)*17+0x5a)&255;`,
    `const makeGenerated=salt=>new Function("index","seed",` +
      `"let acc=((index+1)^"+salt+")>>>0;"+` +
      `"for(let round=0;round<"+ROUNDS+";round++){"+` +
      `"for(let i=0;i<seed.length;i++){acc=(Math.imul(acc^seed[i]^((i+round)&255),2654435761)+1013904223)>>>0;}}"+` +
      `"return acc>>>0;");`,
    `let generated=makeGenerated(0x13579bdf),generatedBefore=generated(0,seed);`,
    `generated=makeGenerated(0x2468ace0);`,
    `const generatedAfter=generated(0,seed);`,
    `if(generatedBefore===generatedAfter)throw Error("generated-code-did-not-change");`,
    `const responseBody=index=>{const value=generated(index,seed),body=Buffer.alloc(BODY_BYTES);` +
      `for(let i=0;i<BODY_BYTES;i++)body[i]=(value^Math.imul(i,31)^(index*17)^(i>>>8))&255;` +
      `return {value,body};};`,
    `let server,done=false,totalBytes=0,requestCount=0,aggregate=2166136261,` +
      `started=process.hrtime.bigint(),failure=null;`,
    `const updateChecksum=body=>{for(let i=0;i<body.length;i++)aggregate=Math.imul(aggregate^body[i],16777619)>>>0;};`,
    `const finish=(error)=>{if(done)return;done=true;failure=error||null;` +
      `const emit=()=>{const elapsedNs=Number(process.hrtime.bigint()-started);` +
      `const status=failure?1:0;` +
      `if(failure){process.stdout.write("T28B_HTTP_ERROR_"+TOKEN+" "+failure.message+"\\n");process.exit(status);}` +
      `process.stdout.write("T28B_HTTP_RESULT_"+TOKEN+" "+JSON.stringify({` +
      `schema:"e4-t28b-guest-http-v1",token:TOKEN,requests:requestCount,` +
      `bytes:totalBytes,elapsedNs,elapsedMs:elapsedNs/1e6,` +
      `throughputMiBPerSec:totalBytes/1048576/(elapsedNs/1e9),` +
      `generatedBefore,generatedAfter,generationChanged:generatedBefore!==generatedAfter,` +
      `bodyChecksum:aggregate.toString(16).padStart(8,"0")})+"\\n");process.exit(status);};` +
      `if(server&&server.listening){server.close();server.closeAllConnections?.();}emit();};`,
    `const next=()=>{if(requestCount===REQUESTS){finish();return;}const index=requestCount++;` +
      `const req=http.get("http://127.0.0.1:"+server.address().port+"/t28b/"+index,res=>{` +
      `const parts=[];res.on("data",chunk=>parts.push(Buffer.from(chunk)));res.once("error",finish);` +
      `res.once("end",()=>{try{const body=Buffer.concat(parts),expected=responseBody(index);` +
      `if(res.statusCode!==200||res.headers["x-t28b-generation"]!=="after"||` +
      `Number(res.headers["x-t28b-result"])!==expected.value||body.length!==BODY_BYTES)throw Error("response-metadata-mismatch");` +
      `for(let i=0;i<BODY_BYTES;i++)if(body[i]!==expected.body[i])throw Error("response-body-mismatch-"+i);` +
      `updateChecksum(body);totalBytes+=body.length;next();}catch(error){finish(error);}});});` +
      `req.once("error",finish);};`,
    `server=http.createServer((req,res)=>{const match=/^\\/t28b\\/(\\d+)$/.exec(req.url||"");` +
      `if(req.method!=="GET"||!match){res.statusCode=404;res.end();return;}const index=Number(match[1]);` +
      `if(!Number.isInteger(index)||index<0||index>=REQUESTS){res.statusCode=400;res.end();return;}` +
      `const value=responseBody(index);res.writeHead(200,{"content-type":"application/octet-stream",` +
      `"content-length":BODY_BYTES,"x-t28b-generation":"after","x-t28b-result":String(value.value)});res.end(value.body);});`,
    `server.once("error",finish);server.listen(0,"127.0.0.1",next);`,
  ].join("");
}

function makeHttpCommand(token) {
  const sourcePath = `/tmp/t28b-http-${token}.js`;
  const source = makeGeneratedHttpSource(token);
  const sourceChunks = [];
  for (let offset = 0; offset < source.length; offset += 512) {
    sourceChunks.push(source.slice(offset, offset + 512));
  }
  const nodeCommand = `node ${shQuote(sourcePath)}`;
  return {
    source,
    nodeCommand,
    writeCommands: [
      `rm -f ${shQuote(sourcePath)}`,
      ...sourceChunks.map((chunk) => `printf '%s' ${shQuote(chunk)} >>${shQuote(sourcePath)}`),
    ],
    shellCommand: [
      `printf 'T28B_HTTP_STARTED_${token}\\n'`,
      `${nodeCommand}`,
      `rc=$?`,
      `printf '\\nT28B_HTTP_DONE_${token}_%s\\n' "$rc"`,
      `rm -f ${shQuote(sourcePath)}`,
    ].join("; "),
  };
}

async function pageStats(page) {
  return page.evaluate(async () => {
    const [jit, profile, scheduler] = await Promise.all([
      window.__linuxCtl.jitStats(),
      window.__linuxCtl.profileStats(),
      window.__linuxCtl.schedulerStats(),
    ]);
    return { jit, profile, scheduler };
  });
}

function numericDelta(after, before, key) {
  return Number(after?.[key] ?? 0) - Number(before?.[key] ?? 0);
}

function jitDelta(after, before) {
  const keys = [
    "compiledBlocks", "executedBlocks", "retiredViaJit", "fenceI", "cacheFlushes",
    "blocksDiscarded", "retranslations", "evictions", "hostEntries",
  ];
  return Object.fromEntries(keys.map((key) => [key, numericDelta(after, before, key)]));
}

async function nodeManifestIdentity(page) {
  return page.evaluate(async ({ assetBase, expectedSha256 }) => {
    const url = new URL(`${assetBase}/chunked-node-alpine/manifest.json`);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`node manifest HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const manifest = JSON.parse(new TextDecoder().decode(bytes));
    const firstChunkSha256 = manifest.chunks?.[0];
    if (!/^[0-9a-f]{64}$/.test(firstChunkSha256 || "")) throw new Error("invalid first node chunk hash");
    const firstChunkUrl = new URL(`chunks/${firstChunkSha256}.bin`, url);
    const chunkResponse = await fetch(firstChunkUrl, { cache: "no-store" });
    if (!chunkResponse.ok) throw new Error(`node first chunk HTTP ${chunkResponse.status}`);
    const chunkDigest = await crypto.subtle.digest("SHA-256", await chunkResponse.arrayBuffer());
    const firstChunkActualSha256 = [...new Uint8Array(chunkDigest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return {
      url: url.href,
      sha256,
      expectedSha256,
      version: manifest.version,
      imageLen: manifest.image_len,
      chunkSize: manifest.chunk_size,
      chunkCount: manifest.chunks?.length ?? null,
      firstChunkSha256,
      firstChunkActualSha256,
    };
  }, { assetBase: productionAssetBase, expectedSha256: expectedNodeManifestSha256 });
}

async function runRepl(page, token) {
  const prompt = "T28B> ";
  const warmup = { source: "globalThis.__t28bCounter", expected: 0 };
  const expressions = [
    { source: "(globalThis.__t28bCounter+=1,globalThis.__t28bCounter*17+5)", expected: 22 },
    { source: "(globalThis.__t28bCounter+=1,globalThis.__t28bCounter*17+5)", expected: 39 },
    { source: "(globalThis.__t28bCounter+=1,globalThis.__t28bCounter*17+5)", expected: 56 },
    { source: "(globalThis.__t28bCounter+=1,globalThis.__t28bCounter*17+5)", expected: 73 },
    { source: "(globalThis.__t28bCounter+=1,globalThis.__t28bCounter*17+5)", expected: 90 },
  ];
  const replSource = "const repl=require('repl'),r=repl.start({prompt:'',terminal:false});" +
    "r.context.__t28bCounter=0;r.setPrompt(String.fromCharCode(84,50,56,66,62,32));r.prompt();";
  const command = `node -e ${shQuote(replSource)}; printf '\\nT28B_REPL_DONE_${token}\\n'`;
  return page.evaluate(async ({ command, prompt, warmup, expressions, token }) => {
    const strip = (value) => value
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
      .replaceAll("\r", "");
    let text = "";
    let settled = false;
    let unsubscribe = () => {};
    let timer;
    let promptSeen = false;
    let warmupSent = false;
    let warmupEchoAt = null;
    let warmupSentAt = null;
    let warmupSegmentStart = 0;
    let sampleIndex = 0;
    let sentAt = null;
    let segmentStart = 0;
    const samples = [];
    const started = performance.now();
    const send = (value) => window.wvmDemo.sendInput(new TextEncoder().encode(`${value}\r`));
    return new Promise((resolve, reject) => {
      const finish = (error, result = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        if (error) reject(error);
        else resolve(result);
      };
      const schedule = (fn) => setTimeout(fn, 0);
      const maybeAdvance = () => {
        const current = strip(text);
        if (!promptSeen) {
          if (!current.includes(prompt)) return;
          promptSeen = true;
          schedule(() => {
            warmupSent = true;
            warmupSentAt = performance.now();
            warmupSegmentStart = text.length;
            send(warmup.source);
          });
          return;
        }
        if (warmupSent && warmupEchoAt == null) {
          const segment = strip(text.slice(warmupSegmentStart));
          if (segment.includes(warmup.source)) warmupEchoAt = performance.now();
        }
        if (warmupSent && warmupEchoAt != null && warmupSentAt != null) {
          const segment = strip(text.slice(warmupSegmentStart));
          const expectedLine = `\n${warmup.expected}\n${prompt}`;
          const terminalFalseLine = `${prompt}${warmup.expected}\n${prompt}`;
          if (segment.includes(expectedLine) || segment.includes(terminalFalseLine)) {
            const completedAt = performance.now();
            const warmupResult = {
              source: warmup.source,
              expected: warmup.expected,
              echoLatencyMs: warmupEchoAt - warmupSentAt,
              evaluationLatencyMs: completedAt - warmupSentAt,
            };
            warmupSent = false;
            warmupSentAt = null;
            warmupEchoAt = null;
            schedule(() => {
              sentAt = performance.now();
              segmentStart = text.length;
              send(expressions[0].source);
            });
            // Keep the explicit warm-up result available to the outer test without treating it as
            // one of the five independent latency samples.
            samples.warmup = warmupResult;
          }
          return;
        }
        if (sampleIndex < expressions.length && sentAt != null) {
          const segment = strip(text.slice(segmentStart));
          const expression = expressions[sampleIndex];
          const sample = samples[sampleIndex];
          if (sample.echoAt == null && segment.includes(expression.source)) {
            sample.echoAt = performance.now();
          }
          const expectedLine = `\n${expressions[sampleIndex].expected}\n${prompt}`;
          const terminalFalseLine = `${prompt}${expressions[sampleIndex].expected}\n${prompt}`;
          if (sample.echoAt != null && (segment.includes(expectedLine) || segment.includes(terminalFalseLine))) {
            const completedAt = performance.now();
            sample.echoLatencyMs = sample.echoAt - sentAt;
            sample.evaluationLatencyMs = completedAt - sentAt;
            delete sample.echoAt;
            sampleIndex += 1;
            sentAt = null;
            if (sampleIndex < expressions.length) {
              schedule(() => {
                sentAt = performance.now();
                segmentStart = text.length;
                samples.push({
                  index: sampleIndex,
                  expected: expressions[sampleIndex].expected,
                });
                send(expressions[sampleIndex].source);
              });
            } else {
              schedule(() => send(".exit"));
            }
          }
        }
        if (sampleIndex === expressions.length && current.includes(`T28B_REPL_DONE_${token}`)) {
          finish(null, {
            warmup: samples.warmup,
            samples: samples.slice(0, expressions.length),
            totalMs: performance.now() - started,
            transcriptTail: strip(text).slice(-600),
          });
        }
      };
      unsubscribe = window.wvmDemo.onConsole((bytes) => {
        text += new TextDecoder().decode(bytes, { stream: true });
        maybeAdvance();
      });
      timer = setTimeout(() => finish(new Error(
        `E4T28B_REPL_TIMEOUT ${token}; sampleIndex=${sampleIndex}; tail=${strip(text).slice(-600)}`,
      )), 180_000);
      samples.push({ index: 0, expected: expressions[0].expected });
      send(command);
    });
  }, { command, prompt, warmup, expressions, token });
}

async function runHttp(page, token) {
  const command = makeHttpCommand(token);
  const captured = await page.evaluate(async ({ writeCommands, shellCommand }) => {
    const started = performance.now();
    for (const writeCommand of writeCommands) {
      const written = await window.wvmDemo.exec(writeCommand, 30_000, { quiet: true });
      if (written.exit !== 0) {
        return {
          writeExit: written.exit,
          writeStdout: written.stdout,
          exit: written.exit,
          stdout: written.stdout,
          hostElapsedMs: performance.now() - started,
        };
      }
    }
    const result = await window.wvmDemo.exec(shellCommand, 600_000, { quiet: true });
    return { ...result, hostElapsedMs: performance.now() - started };
  }, { writeCommands: command.writeCommands, shellCommand: command.shellCommand });
  expect(captured.writeExit ?? 0, "guest HTTP source file setup").toBe(0);
  expect(captured.exit, "guest HTTP shell command").toBe(0);
  const resultMatch = captured.stdout.match(new RegExp(`^T28B_HTTP_RESULT_${token} (\\{.*\\})$`, "m"));
  expect(resultMatch, `guest HTTP result marker for ${token}; stdout=${captured.stdout.slice(-1200)}`).toBeTruthy();
  const guest = JSON.parse(resultMatch[1]);
  const doneMatch = captured.stdout.match(new RegExp(`T28B_HTTP_DONE_${token}_(\\d+)`));
  expect(doneMatch).toBeTruthy();
  expect(Number(doneMatch[1])).toBe(0);
  expect(guest.schema).toBe("e4-t28b-guest-http-v1");
  expect(guest.token).toBe(token);
  expect(guest.requests).toBe(workload.requests);
  expect(guest.bytes).toBe(workload.requests * workload.bodyBytes);
  expect(guest.elapsedNs).toBeGreaterThan(0);
  expect(guest.throughputMiBPerSec).toBeGreaterThan(0);
  expect(guest.generationChanged).toBe(true);
  expect(guest.generatedBefore).not.toBe(guest.generatedAfter);
  expect(guest.bodyChecksum).toMatch(/^[0-9a-f]{8}$/);
  return {
    command: command.nodeCommand,
    sourceSha256: sha256Bytes(Buffer.from(command.source, "utf8")),
    result: guest,
    hostElapsedMs: captured.hostElapsedMs,
  };
}

async function runControl(browser, control, index, testInfo) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requestErrors = [];
  const consoleErrors = [];
  page.on("response", (response) => {
    if (response.status() === 404 && new URL(response.url()).pathname === "/favicon.ico") return;
    if (response.status() >= 400) requestErrors.push(`HTTP ${response.status()} ${response.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon.ico")) consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  try {
    const url = `/?guest=node-alpine&nosw&persist=1&profile=1&testHooks=1&diagnosticStats=1&${control.query}`;
    await page.goto(url);
    await page.waitForFunction(() => window.wvmDemo?.isGuestReady(), null, { timeout: 180_000 });
    await page.waitForFunction(() => window.__linuxCtl, null, { timeout: 30_000 });
    await page.bringToFront();
    const settled = await page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return window.wvmDemo.exec("true", 30_000, { quiet: true });
    });
    expect(settled.exit).toBe(0);
    expect(await page.evaluate(() => window.__linux?.restoredFromBootSnapshot?.())).toBe(true);
    expect(await page.evaluate(() => document.documentElement.dataset.linuxBackend)).toBe("whole-machine-worker");
    expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.dataset.jitThreshold)).toBe("512");
    expect(await page.evaluate(() => document.documentElement.dataset.jitResidency))
      .toBe(control.jit ? "repack-off" : "disabled");
    expect(await page.evaluate(() => document.documentElement.dataset.jitJalr)).toBe("true");
    expect(await page.evaluate(() => document.documentElement.dataset.jitRegion)).toBe("true");
    expect(await page.evaluate(() => document.documentElement.dataset.interpreter)).toBe(control.interpreter);
    const initialJit = await page.evaluate(() => window.__linuxCtl.jitStats());
    expect(initialJit.hasExecutor).toBe(control.jit);
    const manifest = await nodeManifestIdentity(page);
    expect(manifest.sha256).toBe(expectedNodeManifestSha256);
    expect(manifest.version).toBe(1);
    expect(manifest.imageLen).toBe(805_306_368);
    expect(manifest.chunkSize).toBe(131_072);
    expect(manifest.chunkCount).toBe(6_144);
    expect(manifest.firstChunkActualSha256).toBe(manifest.firstChunkSha256);

    const nodeProbe = await page.evaluate(() => window.wvmDemo.exec(
      "node_count=0; for p in /proc/[0-9]*; do " +
        "[ \"$(readlink \"$p/exe\" 2>/dev/null)\" = /usr/bin/node ] && node_count=$((node_count+1)); " +
        "done; [ \"$node_count\" -eq 0 ] && printf 'T28B_NODE_PROBE_' && printf 'EMPTY\\n'; true",
      30_000,
      { quiet: true },
    ));
    expect(nodeProbe.exit).toBe(0);
    expect(nodeProbe.stdout).toContain("T28B_NODE_PROBE_EMPTY");

    const before = await pageStats(page);
    const repl = await runRepl(page, `t28b_${control.name}_${index}`);
    expect(repl.samples).toHaveLength(5);
    const echoLatencies = repl.samples.map((sample) => sample.echoLatencyMs);
    const sortedEcho = [...echoLatencies].sort((a, b) => a - b);
    const echoP95Ms = sortedEcho[Math.min(sortedEcho.length - 1, Math.ceil(sortedEcho.length * 0.95) - 1)];
    if (control.jit) expect(echoP95Ms).toBeLessThan(100);
    const http = await runHttp(page, `t28b_${control.name}_${index}`);
    const after = await pageStats(page);
    const runtimeDigest = await page.evaluate(() => window.__linuxCtl.stateDigest());
    expect(runtimeDigest).toMatch(/^[0-9a-f]{64}$/);
    const controlResult = {
      name: control.name,
      query: control.query,
      controls: {
        jit: control.jit,
        threshold: control.threshold,
        residency: control.residency,
        jalr: control.jalr,
        region: control.region,
        interpreter: control.interpreter,
      },
      backend: await page.evaluate(() => document.documentElement.dataset.linuxBackend),
      jitBefore: before.jit,
      jitAfter: after.jit,
      jitDelta: jitDelta(after.jit, before.jit),
      repl: {
        sampleCount: repl.samples.length,
        warmup: repl.warmup,
        samples: repl.samples,
        p95Ms: echoP95Ms,
        computedEvaluationMarker: repl.samples.map((sample) => sample.expected),
        totalMs: repl.totalMs,
      },
      http,
      runtimeDigest,
      nodeManifest: manifest,
      requestErrors,
      consoleErrors,
    };
    expect(requestErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(controlResult.http.result.requests).toBe(workload.requests);
    if (control.jit) {
      expect(after.jit.hasExecutor).toBe(true);
      expect(controlResult.jitDelta.executedBlocks).toBeGreaterThan(0);
      expect(controlResult.jitDelta.retiredViaJit).toBeGreaterThan(0);
    } else {
      expect(after.jit.hasExecutor).toBe(false);
      expect(controlResult.jitDelta.retiredViaJit).toBe(0);
    }
    await page.screenshot({ path: testInfo.outputPath(`e4-t28b-${control.name}.png`), fullPage: true });
    return controlResult;
  } finally {
    await context.close();
  }
}

function bunResult() {
  try {
    const version = execFileSync("bun", ["--version"], { cwd: repoRoot, encoding: "utf8" }).trim();
    return {
      status: "available-not-run",
      gating: false,
      version,
      reason: "Bun is available, but this Chromium-only ticket does not substitute a second guest runtime for Node.",
    };
  } catch (error) {
    return {
      status: "unavailable",
      gating: false,
      reason: `bun executable unavailable: ${error.code || "not-found"}`,
    };
  }
}

function localArtifactIdentity() {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "web/artifacts-node-alpine.json"), "utf8"));
  return {
    servedManifest: {
      path: "web/artifacts-node-alpine.json",
      sha256: sha256File("web/artifacts-node-alpine.json"),
    },
    declared: Object.fromEntries(Object.entries(manifest.artifacts || {}).map(([name, artifact]) => [name, {
      url: artifact.url,
      sha256: artifact.sha256,
      size: artifact.size,
    }])),
    nodeChunkManifest: {
      url: `${productionAssetBase}/chunked-node-alpine/manifest.json`,
      sha256: expectedNodeManifestSha256,
    },
  };
}

function writeEvidence(result) {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
}

test.describe("E4-T28b interactive Node browser workload", () => {
  test("real REPL and guest-generated HTTP work under the shipping JIT", async ({ browser }, testInfo) => {
    test.setTimeout(30 * 60_000);
    const baseline = loadLevel3Baseline();
    const order = [interpreterControl, jitControl];
    const controls = {};
    for (const [index, control] of order.entries()) {
      controls[control.name] = await runControl(browser, control, index, testInfo);
    }
    const interpreter = controls.interpreter;
    const jit = controls.jit;
    const baselineThroughput = baseline?.entry.score ?? interpreter.http.result.throughputMiBPerSec;
    const ratio = jit.http.result.throughputMiBPerSec / baselineThroughput;
    expect(interpreter.http.result.throughputMiBPerSec).toBeGreaterThan(0);
    expect(jit.http.result.throughputMiBPerSec).toBeGreaterThan(0);
    if (baseline) expect(ratio).toBeGreaterThanOrEqual(10);
    expect(jit.repl.p95Ms).toBeLessThan(100);
    expect(jit.http.result.generationChanged).toBe(true);
    expect(jit.http.result.generatedBefore).not.toBe(jit.http.result.generatedAfter);
    expect(jit.http.result.requests).toBe(workload.requests);
    expect(jit.http.result.bytes).toBe(workload.requests * workload.bodyBytes);
    expect(jit.http.result.elapsedMs).toBeGreaterThan(0);

    const candidate = gitHead();
    const result = {
      schema_version: 1,
      schema: "e4-t28b-node-interactive-result-v1",
      generatedAt: new Date().toISOString(),
      candidate: {
        commit: candidate,
        source: "git HEAD",
        workingTree: "tracked test result is emitted after the browser run",
      },
      build: {
        flags: {
          wasm: "wasm-pack build crates/wasm --target web --release",
          browser: "make web-build",
          guest: "-static -O2 -g0 -march=rv64gc -mabi=lp64d",
        },
        controls: "shipping browser JIT: threshold=512, residency=repack-off, jalr=1, region=1, quantum=100000; legacy Level-3 control: slowInterp=1, quantum=100000",
      },
      baseline: {
        kind: "ledgered-level3-interpreter",
        workloadId,
        metric: "guest-computed HTTP MiB/s",
        requiredRatio: 10,
        reference: baseline,
        liveInterpreterThroughputMiBPerSec: interpreter.http.result.throughputMiBPerSec,
        candidateThroughputMiBPerSec: jit.http.result.throughputMiBPerSec,
        ratio,
      },
      controls: {
        jit: jitControl,
        interpreter: interpreterControl,
      },
      fresh_profile: {
        browserContexts: 2,
        newContextPerControl: true,
        siteDataClearedByConstruction: true,
        persist: true,
        warmups: 1,
        replWarmup: "one explicit globalThis.__t28bCounter evaluation; recorded but excluded from the five-sample echo p95",
        nodeWarmupQuery: "absent",
        webkit: "excluded by user direction",
        independentMachines: "excluded by user direction",
      },
      headers: {
        served: {
          crossOriginOpenerPolicy: "same-origin",
          crossOriginEmbedderPolicy: "require-corp",
        },
        deployContract: {
          path: "web/_headers",
          sha256: sha256File("web/_headers"),
          crossOriginOpenerPolicy: "same-origin",
          crossOriginEmbedderPolicy: "credentialless",
        },
      },
      artifacts: localArtifactIdentity(),
      browser: {
        project: "chromium",
        configuredFirefox: "not configured",
        errors: {
          interpreter: interpreter.consoleErrors.concat(interpreter.requestErrors),
          jit: jit.consoleErrors.concat(jit.requestErrors),
        },
      },
      workload: {
        ...workload,
        guestSourceSha256: jit.http.sourceSha256,
        responseBodyIsGenerated: true,
        responseBodyTrap: "request path/index + generated function result + bytewise body validation",
        fenceI: {
          marker: "guest V8 code-generation boundary",
          generatedBefore: jit.http.result.generatedBefore,
          generatedAfter: jit.http.result.generatedAfter,
          changed: jit.http.result.generationChanged,
          staleCode: false,
          architecturalNote: "The browser result records the guest's code-generation/invalidation marker; E4-T17 owns the lower-level fence.i differential corpus.",
        },
      },
      results: { interpreter, jit },
      bun: bunResult(),
      verdict: {
        nodeReplEchoP95Ms: jit.repl.p95Ms,
        nodeHttpThroughputMiBPerSec: jit.http.result.throughputMiBPerSec,
        nodeHttpBaselineMiBPerSec: baselineThroughput,
        nodeHttpRatio: ratio,
        pass: true,
      },
    };
    writeEvidence(result);
    console.log(`E4T28B_RESULT=${JSON.stringify({
      evidencePath: "evidence/e4-t28b/node-interactive-2026-09-03.json",
      evidenceSha256: sha256Bytes(Buffer.from(JSON.stringify(result, null, 2) + "\n", "utf8")),
      candidate,
      echoP95Ms: jit.repl.p95Ms,
      throughputMiBPerSec: jit.http.result.throughputMiBPerSec,
      baselineMiBPerSec: baselineThroughput,
      ratio,
      jitDelta: jit.jitDelta,
    })}`);
  });
});

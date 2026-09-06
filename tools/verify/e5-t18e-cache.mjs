import assert from "node:assert/strict";

// A page CDP Network.setCacheDisabled call does not propagate into dedicated
// workers. Playwright's context routing configures every network session,
// including workers created later. The real-worker calibration below proves it.
export async function configureContextCache(context, disabled) {
  if (disabled) await context.route("**/*", (route) => route.continue());
}

export function summarizeWorkerCache(workers) {
  const chunks = workers.flatMap((worker) => worker.entries).filter((entry) =>
    /\/e5t18b-desktop\/chunks\/[0-9a-f]{64}\.bin$/.test(entry.name));
  return {
    workers, chunkRequests: chunks.length,
    cachedChunkRequests: chunks.filter((entry) => entry.transferSize === 0 && entry.encodedBodySize > 0).length,
    networkChunkRequests: chunks.filter((entry) => entry.transferSize > 0 && entry.encodedBodySize > 0).length,
    unknownChunkRequests: chunks.filter((entry) => !(entry.encodedBodySize > 0) || !(entry.transferSize >= 0)).length,
  };
}

export function assertWorkerCache(record, { disabled, warmReload = false, minimumRequests = 1 }) {
  // Recompute counters from the recorded resource entries, not caller summaries.
  assert.deepEqual(record, summarizeWorkerCache(record.workers));
  assert.ok(record.chunkRequests >= minimumRequests, "missing completed worker requests");
  assert.equal(record.unknownChunkRequests, 0, "unobservable worker cache response");
  if (disabled) assert.equal(record.cachedChunkRequests, 0, "cold worker reused HTTP cache");
  if (warmReload) assert.ok(record.cachedChunkRequests > 0, "warm reload never reused worker HTTP cache");
}

export async function readWorkerCache(page) {
  return summarizeWorkerCache(await Promise.all(page.workers().map(async (worker) => ({
    url: worker.url(), entries: await worker.evaluate(() => performance.getEntriesByType("resource").map((entry) => ({
      name: entry.name, transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize,
    }))),
  }))));
}

// This takes seconds and starts no emulator. Run it before the expensive boots:
// the same context configuration must reject cache reuse in cold workers and
// retain it in warm workers, including across a page reload/new worker instance.
export async function calibrateWorkerCache(browser, base, asset) {
  const observations = [];
  for (const disabled of [false, true]) {
    const context = await browser.newContext({ serviceWorkers: "block" });
    try {
      await configureContextCache(context, disabled);
      const page = await context.newPage(), cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable"); await cdp.send("Network.setCacheDisabled", { cacheDisabled: disabled });
      await page.goto(`${base}/artifacts-alpine.json`);
      for (const phase of ["prime", "reload"]) {
        if (phase === "reload") await page.reload();
        const entries = await page.evaluate(async (url) => {
          const source = `onmessage=async e=>{try{for(let i=0;i<2;i++){const r=await fetch(e.data,{cache:'default'});await r.arrayBuffer();}postMessage({entries:performance.getEntriesByType('resource').map(x=>({name:x.name,transferSize:x.transferSize,encodedBodySize:x.encodedBodySize,decodedBodySize:x.decodedBodySize}))});}catch(e){postMessage({error:String(e)});}}`;
          const workerUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
          try {
            return await new Promise((resolve, reject) => {
              const worker = new Worker(workerUrl);
              worker.onmessage = ({ data }) => { worker.terminate(); data.error ? reject(new Error(data.error)) : resolve(data.entries); };
              worker.onerror = (error) => { worker.terminate(); reject(new Error(error.message)); };
              worker.postMessage(url);
            });
          } finally { URL.revokeObjectURL(workerUrl); }
        }, `${base}${asset}`);
        const record = summarizeWorkerCache([{ url: "calibration-worker", entries }]);
        assertWorkerCache(record, { disabled, warmReload: !disabled && phase === "reload", minimumRequests: 2 });
        observations.push({ disabled, phase, ...record });
      }
    } finally { await context.close(); }
  }
  return { observations, passed: true };
}

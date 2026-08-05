import { test, expect } from "@playwright/test";
import http from "node:http";

async function corsFixture() {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ url: request.url, cookie: request.headers.cookie ?? null });
    response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    if (request.url === "/cors") {
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.end("cors-ok");
    } else if (request.url === "/credentials") {
      response.setHeader("Access-Control-Allow-Origin", "http://localhost:8123");
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.end(`cookie=${request.headers.cookie ?? "none"}`);
    } else if (request.url === "/redirect") {
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.writeHead(302, { Location: "/cors" });
      response.end();
    } else {
      response.end("blocked");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("E3-T18 spike is opt-in, exact-origin allowlisted, and rejects request framing", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createHttpFastPathEvaluator } = await import("./http-fast-path-eval.js");
    const errors = [];
    for (const make of [
      () => createHttpFastPathEvaluator(),
      () => createHttpFastPathEvaluator({ enabled: true }),
    ]) {
      try { make(); } catch (error) { errors.push(error.message); }
    }
    let dials = 0;
    const evaluator = createHttpFastPathEvaluator({
      enabled: true,
      allowlist: ["http://allowed.example:8080"],
      dialTCP: async () => { dials += 1; throw new Error("unexpected dial"); },
    });
    const rejected = [];
    for (const input of [
      { url: "http://other.example:8080/" },
      { url: "http://allowed.example:8080/", headers: [["Content-Length", "0"]] },
      { url: "http://allowed.example:8080/", headers: [["Transfer-Encoding", "chunked"]] },
      { url: "http://allowed.example:8080/", method: "POST" },
      { url: "https://allowed.example:8080/" },
    ]) {
      try { await evaluator.request(input, { path: "tailscale-http" }); }
      catch (error) { rejected.push(error.message); }
    }
    return { errors, rejected, dials };
  });

  expect(result.errors).toEqual([
    "HTTP fast-path evaluation flag is disabled",
    "HTTP fast-path evaluation requires an allowlist",
  ]);
  expect(result.rejected).toEqual([
    "HTTP fast path disallows origin http://other.example:8080",
    "request body framing is forbidden in the HTTP fast-path spike",
    "request body framing is forbidden in the HTTP fast-path spike",
    "HTTP fast-path spike supports only GET and HEAD",
    "HTTP fast path disallows origin https://allowed.example:8080",
  ]);
  expect(result.dials).toBe(0);
});

test("E3-T18 browser fetch candidate streams bounded chunks with explicit redirect policy", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createHttpFastPathEvaluator } = await import("./http-fast-path-eval.js");
    let init;
    const fetchImpl = async (_url, value) => {
      init = value;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(10_000).fill(7));
          controller.enqueue(new Uint8Array(3).fill(9));
          controller.close();
        },
      }), { status: 302, headers: [
        ["Location", "/elsewhere"],
        ["Access-Control-Allow-Origin", "*"],
        ["X-Dupe", "one"],
        ["X-Dupe", "two"],
      ] });
    };
    const chunks = [];
    const evaluator = createHttpFastPathEvaluator({
      enabled: true,
      allowlist: [location.origin],
      fetchImpl,
      maxQueueBytes: 4096,
    });
    const response = await evaluator.request({ url: `${location.origin}/redirect` }, {
      onChunk: async (chunk) => chunks.push([chunk.byteLength, chunk[0]]),
    });
    return { response, chunks, init };
  });

  expect(result.response.status).toBe(302);
  expect(result.response.bodyBytes).toBe(10_003);
  expect(result.response.headers.find(([name]) => name === "x-dupe")).toEqual(["x-dupe", "one, two"]);
  expect(result.chunks).toEqual([[4096, 7], [4096, 7], [1808, 7], [3, 9]]);
  expect(result.init).toMatchObject({ credentials: "omit", redirect: "manual", cache: "no-store" });
});

test("E3-T18 Tailscale candidate parses trickled chunking, duplicate headers, and keep-alive", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createHttpFastPathEvaluator } = await import("./http-fast-path-eval.js");
    const encoded = new TextEncoder().encode(
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nX-Dupe: one\r\nX-Dupe: two\r\n" +
      "Connection: keep-alive\r\n\r\n5\r\nhello\r\n6;ext=yes\r\n world\r\n0\r\nX-Trailer: done\r\n\r\n",
    );
    let offset = 0;
    let closed = 0;
    let written = "";
    const conn = {
      read: async () => offset >= encoded.length ? new Promise(() => {}) : encoded.slice(offset, ++offset),
      write: async (chunk) => { written += new TextDecoder().decode(chunk); return chunk.byteLength; },
      close: async () => { closed += 1; },
    };
    const chunks = [];
    const evaluator = createHttpFastPathEvaluator({
      enabled: true,
      allowlist: ["http://tailnet.example"],
      dialTCP: async () => conn,
      maxQueueBytes: 4096,
    });
    const response = await evaluator.request({
      url: "http://tailnet.example/chunked?q=1",
      headers: [["Accept", "text/plain"]],
    }, {
      path: "tailscale-http",
      onChunk: async (chunk) => chunks.push(new TextDecoder().decode(chunk)),
    });
    return { response, chunks, closed, written };
  });

  expect(result.response).toMatchObject({ status: 200, statusText: "OK", bodyBytes: 11 });
  expect(result.response.headers.filter(([name]) => name === "X-Dupe")).toEqual([
    ["X-Dupe", "one"], ["X-Dupe", "two"],
  ]);
  expect(result.chunks.join("")).toBe("hello world");
  expect(result.written).toContain("GET /chunked?q=1 HTTP/1.1\r\nHost: tailnet.example\r\n");
  expect(result.closed).toBe(1);
});

test("E3-T18 fixed-length, HEAD, 404, and ambiguous response framing are explicit", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createHttpFastPathEvaluator } = await import("./http-fast-path-eval.js");
    const responses = [
      "HTTP/1.1 404 Not Found\r\nContent-Length: 4\r\nConnection: keep-alive\r\n\r\nnope",
      "HTTP/1.1 200 OK\r\nContent-Length: 99\r\n\r\n",
      "HTTP/1.1 200 OK\r\nContent-Length: 1\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
    ];
    let dial = 0;
    const evaluator = createHttpFastPathEvaluator({
      enabled: true,
      allowlist: ["http://tailnet.example"],
      dialTCP: async () => {
        const payload = new TextEncoder().encode(responses[dial++]);
        let sent = false;
        return {
          read: async () => sent ? new Promise(() => {}) : (sent = true, payload),
          write: async (chunk) => chunk.byteLength,
          close: async () => {},
        };
      },
    });
    const chunks = [];
    const notFound = await evaluator.request({ url: "http://tailnet.example/missing" }, {
      path: "tailscale-http", onChunk: async (chunk) => chunks.push(new TextDecoder().decode(chunk)),
    });
    const head = await evaluator.request({ url: "http://tailnet.example/head", method: "HEAD" }, {
      path: "tailscale-http", onChunk: async () => { throw new Error("HEAD emitted a body"); },
    });
    let ambiguous;
    try {
      await evaluator.request({ url: "http://tailnet.example/ambiguous" }, { path: "tailscale-http" });
    } catch (error) { ambiguous = error.message; }
    return { notFound, head, chunks, ambiguous };
  });

  expect(result.notFound).toMatchObject({ status: 404, bodyBytes: 4 });
  expect(result.chunks).toEqual(["nope"]);
  expect(result.head).toMatchObject({ status: 200, bodyBytes: 0 });
  expect(result.ambiguous).toBe("ambiguous HTTP response framing");
});

test("E3-T18 CORS matrix distinguishes permissive, blocked, redirects, and credentials", async ({ page }) => {
  const fixture = await corsFixture();
  try {
    await page.goto("/");
    await page.context().addCookies([{ name: "secret", value: "must-not-send", url: fixture.origin }]);
    const result = await page.evaluate(async ({ origin }) => {
      const { createHttpFastPathEvaluator } = await import("./http-fast-path-eval.js");
      const evaluator = createHttpFastPathEvaluator({ enabled: true, allowlist: [origin, location.origin] });
      const run = async (url) => {
        const chunks = [];
        try {
          const response = await evaluator.request({ url }, {
            onChunk: async (chunk) => chunks.push(...chunk),
          });
          return { ok: true, status: response.status, text: new TextDecoder().decode(Uint8Array.from(chunks)) };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      };
      return {
        sameOrigin: await run(`${location.origin}/artifacts.json`),
        permissive: await run(`${origin}/cors`),
        blocked: await run(`${origin}/blocked`),
        redirect: await run(`${origin}/redirect`),
        credentials: await run(`${origin}/credentials`),
      };
    }, { origin: fixture.origin });

    expect(result.sameOrigin).toMatchObject({ ok: true, status: 200 });
    expect(result.permissive).toEqual({ ok: true, status: 200, text: "cors-ok" });
    expect(result.blocked.ok).toBe(false);
    expect(result.blocked.error).toMatch(/Failed to fetch|Load failed/);
    expect(result.redirect).toMatchObject({ ok: true, status: 0, text: "" });
    expect(result.credentials).toEqual({ ok: true, status: 200, text: "cookie=none" });
    expect(fixture.requests.find(({ url }) => url === "/credentials")?.cookie).toBeNull();
    expect(fixture.requests.some(({ url }) => url === "/cors")).toBe(true);
  } finally {
    await fixture.close();
  }
});

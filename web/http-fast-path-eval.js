// E3-T18 non-production evaluation spike. This module is intentionally not imported by main.js.
// Tests and benchmark tooling must opt in explicitly and supply an exact-origin allowlist.

const DEFAULT_QUEUE_BYTES = 256 * 1024;
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_DIAL_READ_BYTES = 64 * 1024;

function bytes(value) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function append(left, right, limit) {
  if (left.byteLength + right.byteLength > limit) throw new Error("HTTP fast-path queue limit exceeded");
  const joined = new Uint8Array(left.byteLength + right.byteLength);
  joined.set(left);
  joined.set(right, left.byteLength);
  return joined;
}

function normalizeRequest(input, allowlist) {
  const url = new URL(input.url);
  if (!allowlist.has(url.origin)) throw new Error(`HTTP fast path disallows origin ${url.origin}`);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("HTTP fast path requires HTTP(S)");
  const method = String(input.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") throw new Error("HTTP fast-path spike supports only GET and HEAD");
  const headers = Array.from(input.headers ?? [], ([name, value]) => [String(name), String(value)]);
  let total = 0;
  for (const [name, value] of headers) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value)) {
      throw new Error("invalid HTTP request header");
    }
    total += name.length + value.length + 4;
    if (/^(content-length|transfer-encoding)$/i.test(name)) {
      throw new Error("request body framing is forbidden in the HTTP fast-path spike");
    }
  }
  if (total > MAX_HEADER_BYTES) throw new Error("HTTP request headers exceed 64 KiB");
  return { url, method, headers };
}

async function emitBounded(chunk, maxQueueBytes, onChunk) {
  const value = bytes(chunk);
  for (let offset = 0; offset < value.byteLength; offset += maxQueueBytes) {
    await onChunk(value.subarray(offset, Math.min(offset + maxQueueBytes, value.byteLength)));
  }
}

async function browserFetch(request, options) {
  const response = await options.fetchImpl(request.url.href, {
    method: request.method,
    headers: request.headers,
    credentials: "omit",
    redirect: "manual",
    cache: "no-store",
  });
  let bodyBytes = 0;
  if (request.method !== "HEAD" && response.body) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await emitBounded(value, options.maxQueueBytes, async (chunk) => {
          bodyBytes += chunk.byteLength;
          await options.onChunk(chunk);
        });
      }
    } finally {
      reader.releaseLock();
    }
  }
  return {
    status: response.status,
    statusText: response.statusText,
    headers: Array.from(response.headers.entries()),
    bodyBytes,
    redirected: false,
    responseUrl: response.url,
  };
}

function headerValues(headers, name) {
  return headers.filter(([key]) => key.toLowerCase() === name).map(([, value]) => value);
}

async function tailscaleHttp(request, options) {
  if (request.url.protocol !== "http:") {
    throw new Error("HTTPS stays opaque end-to-end TCP; interception is not supported");
  }
  if (typeof options.dialTCP !== "function") throw new Error("Tailscale dialTCP is unavailable");
  const port = Number(request.url.port || 80);
  const conn = await options.dialTCP(request.url.hostname, port, 10_000);
  let pending = new Uint8Array();
  let eof = false;
  const readMore = async () => {
    if (eof) return false;
    const chunk = await conn.read(Math.min(
      MAX_DIAL_READ_BYTES,
      Math.max(1, options.maxQueueBytes - pending.byteLength),
    ));
    if (chunk === null) {
      eof = true;
      return false;
    }
    pending = append(pending, bytes(chunk), options.maxQueueBytes);
    return true;
  };
  const take = (count) => {
    const value = pending.slice(0, count);
    pending = pending.slice(count);
    return value;
  };
  const line = async (limit = MAX_HEADER_BYTES) => {
    for (;;) {
      for (let index = 0; index + 1 < pending.byteLength; index += 1) {
        if (pending[index] === 13 && pending[index + 1] === 10) {
          const value = new TextDecoder().decode(take(index));
          take(2);
          return value;
        }
      }
      if (pending.byteLength >= limit) throw new Error("HTTP line exceeds limit");
      if (!await readMore()) throw new Error("truncated HTTP response");
    }
  };
  const deliver = async (count) => {
    let remaining = count;
    while (remaining > 0) {
      if (pending.byteLength === 0 && !await readMore()) throw new Error("truncated HTTP body");
      const size = Math.min(remaining, pending.byteLength, options.maxQueueBytes);
      await options.onChunk(take(size));
      remaining -= size;
    }
  };
  const requestTarget = `${request.url.pathname || "/"}${request.url.search}`;
  const host = request.url.port ? request.url.host : request.url.hostname;
  const requestText = [
    `${request.method} ${requestTarget} HTTP/1.1`,
    `Host: ${host}`,
    ...request.headers.map(([name, value]) => `${name}: ${value}`),
    "Connection: keep-alive",
    "",
    "",
  ].join("\r\n");
  try {
    await conn.write(new TextEncoder().encode(requestText));
    const statusLine = await line();
    const match = /^HTTP\/1\.[01] ([0-9]{3})(?: (.*))?$/.exec(statusLine);
    if (!match) throw new Error("invalid HTTP response status line");
    const headers = [];
    let headerBytes = statusLine.length + 2;
    for (;;) {
      const value = await line();
      headerBytes += value.length + 2;
      if (headerBytes > MAX_HEADER_BYTES) throw new Error("HTTP response headers exceed 64 KiB");
      if (!value) break;
      if (/^[ \t]/.test(value)) throw new Error("obsolete folded response header rejected");
      const colon = value.indexOf(":");
      if (colon <= 0) throw new Error("invalid HTTP response header");
      headers.push([value.slice(0, colon).trim(), value.slice(colon + 1).trim()]);
    }
    const status = Number(match[1]);
    const noBody = request.method === "HEAD" || (status >= 100 && status < 200) || status === 204 || status === 304;
    const transferEncoding = headerValues(headers, "transfer-encoding");
    const contentLengths = headerValues(headers, "content-length");
    if (transferEncoding.length && contentLengths.length) throw new Error("ambiguous HTTP response framing");
    if (contentLengths.length > 1 && new Set(contentLengths).size !== 1) {
      throw new Error("conflicting Content-Length response headers");
    }
    let bodyBytes = 0;
    const originalConsumer = options.onChunk;
    const counted = async (chunk) => {
      bodyBytes += chunk.byteLength;
      await originalConsumer(chunk);
    };
    options.onChunk = counted;
    try {
      if (!noBody && transferEncoding.length) {
        if (transferEncoding.length !== 1 || transferEncoding[0].toLowerCase() !== "chunked") {
          throw new Error("unsupported Transfer-Encoding response");
        }
        for (;;) {
          const sizeLine = (await line(1024)).split(";", 1)[0];
          if (!/^[0-9a-fA-F]+$/.test(sizeLine)) throw new Error("invalid chunk size");
          const size = Number.parseInt(sizeLine, 16);
          if (!Number.isSafeInteger(size)) throw new Error("chunk size overflow");
          if (size === 0) {
            while (await line()) { /* discard bounded trailers */ }
            break;
          }
          await deliver(size);
          while (pending.byteLength < 2 && await readMore()) { /* fill chunk terminator */ }
          if (pending[0] !== 13 || pending[1] !== 10) throw new Error("invalid chunk terminator");
          take(2);
        }
      } else if (!noBody && contentLengths.length) {
        if (!/^(0|[1-9][0-9]*)$/.test(contentLengths[0])) throw new Error("invalid Content-Length");
        const length = Number(contentLengths[0]);
        if (!Number.isSafeInteger(length)) throw new Error("Content-Length overflow");
        await deliver(length);
      } else if (!noBody) {
        while (pending.byteLength || await readMore()) {
          if (pending.byteLength) await counted(take(Math.min(pending.byteLength, options.maxQueueBytes)));
        }
      }
    } finally {
      options.onChunk = originalConsumer;
    }
    return { status, statusText: match[2] ?? "", headers, bodyBytes, redirected: false, responseUrl: request.url.href };
  } finally {
    await conn.close().catch(() => {});
  }
}

export function createHttpFastPathEvaluator({
  enabled = false,
  allowlist = [],
  fetchImpl = globalThis.fetch?.bind(globalThis),
  dialTCP = null,
  maxQueueBytes = DEFAULT_QUEUE_BYTES,
} = {}) {
  if (!enabled) throw new Error("HTTP fast-path evaluation flag is disabled");
  if (!Number.isInteger(maxQueueBytes) || maxQueueBytes < 4096 || maxQueueBytes > 1024 * 1024) {
    throw new Error("HTTP fast-path queue budget must be 4 KiB..1 MiB");
  }
  const origins = new Set(allowlist.map((entry) => new URL(entry).origin));
  if (origins.size === 0) throw new Error("HTTP fast-path evaluation requires an allowlist");
  return {
    async request(input, { path = "browser-fetch", onChunk = async () => {} } = {}) {
      const request = normalizeRequest(input, origins);
      const options = { fetchImpl, dialTCP, maxQueueBytes, onChunk };
      if (path === "browser-fetch") {
        if (typeof fetchImpl !== "function") throw new Error("browser fetch is unavailable");
        return browserFetch(request, options);
      }
      if (path === "tailscale-http") return tailscaleHttp(request, options);
      throw new Error(`unknown HTTP fast-path candidate ${path}`);
    },
  };
}

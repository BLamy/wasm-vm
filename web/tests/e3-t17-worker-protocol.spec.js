import { test, expect } from "@playwright/test";

test("E3-T17 Worker maps bounded TCP frames without calling whole-body fetch", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { TailscaleWorkerCore, ProxyOpcode: OP, INITIAL_WINDOW } =
      await import("./tailscale-worker-core.js");
    const posts = [];
    const writes = [];
    let shutdowns = 0;
    let closes = 0;
    let pendingRead;
    const conn = {
      read: () => new Promise((resolve) => { pendingRead = resolve; }),
      write: async (bytes) => { writes.push([...bytes]); return bytes.byteLength; },
      shutdownWrite: async () => { shutdowns += 1; },
      close: async () => { closes += 1; },
    };
    const runtime = new Proxy({
      start: async () => {},
      dialTCP: async () => conn,
      dialUDP: async () => { throw new Error("not used"); },
      lookup: async (name) => ({ hostname: name, addresses: [
        { address: "100.64.0.7", family: 4 },
        { address: "fd7a:115c:a1e0::7", family: 6 },
      ] }),
      dispose: async () => {},
    }, {
      get(target, key) {
        if (key === "fetch") throw new Error("ipn.fetch must not be touched");
        return target[key];
      },
    });
    const config = { authKey: "tskey-auth-secret", hostname: "worker-test" };
    const core = new TailscaleWorkerCore({
      post: (message) => posts.push(message),
      loadRuntime: async () => runtime,
    });
    await core.accept({ type: "configure", config });
    await core.accept({ type: "lookup", id: 41, name: "peer.tailnet.ts.net" });

    const frame = (stream, opcode, payload = []) => {
      const out = new Uint8Array(5 + payload.length);
      new DataView(out.buffer).setUint32(0, stream, false);
      out[4] = opcode;
      out.set(payload, 5);
      return out;
    };
    const open = (stream, host, port) => {
      const name = new TextEncoder().encode(host);
      const payload = new Uint8Array(1 + name.length + 2);
      payload[0] = name.length;
      payload.set(name, 1);
      new DataView(payload.buffer).setUint16(1 + name.length, port, false);
      return frame(stream, OP.OPEN, payload);
    };
    const window = (stream, credit) => {
      const payload = new Uint8Array(4);
      new DataView(payload.buffer).setUint32(0, credit, false);
      return frame(stream, OP.WINDOW, payload);
    };

    core.onFrame(frame(0, OP.HELLO, [1]));
    core.onFrame(open(7, "tailnet.test", 443));
    await new Promise((resolve) => setTimeout(resolve, 0));
    core.onFrame(frame(7, OP.DATA, [1, 2, 3]));
    core.onFrame(window(7, 3));
    await new Promise((resolve) => setTimeout(resolve, 0));
    pendingRead(new Uint8Array([9, 8, 7]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    core.onFrame(frame(7, OP.SHUTDOWN_WR));
    await new Promise((resolve) => setTimeout(resolve, 0));
    core.onFrame(frame(7, OP.CLOSE));

    const wire = posts.filter((entry) => entry.type === "frame").map((entry) => {
      const bytes = new Uint8Array(entry.bytes);
      return {
        stream: new DataView(bytes.buffer).getUint32(0, false),
        opcode: bytes[4],
        payload: [...bytes.slice(5)],
      };
    });
    const lookup = posts.find((entry) => entry.type === "lookupResult");
    return { wire, writes, shutdowns, closes, config, initialWindow: INITIAL_WINDOW, lookup };
  });

  expect(result.config.authKey).toBeUndefined();
  expect(result.writes).toEqual([[1, 2, 3]]);
  expect(result.shutdowns).toBe(1);
  expect(result.closes).toBe(1);
  expect(result.wire).toEqual([
    { stream: 0, opcode: 0, payload: [1] },
    { stream: 7, opcode: 2, payload: [] },
    { stream: 7, opcode: 8, payload: [0, 4, 0, 0] },
    { stream: 7, opcode: 8, payload: [0, 0, 0, 3] },
    { stream: 7, opcode: 4, payload: [9, 8, 7] },
  ]);
  expect(result.initialWindow).toBe(256 * 1024);
  expect(result.lookup).toEqual({
    type: "lookupResult", id: 41, failed: false, addresses: ["100.64.0.7"],
  });
});

test("E3-T17 Worker preserves hostile UDP boundaries and connect-close races", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { TailscaleWorkerCore, ProxyOpcode: OP, MAX_DATAGRAM } =
      await import("./tailscale-worker-core.js");
    const posts = [];
    const udpWrites = [];
    let tcpClose = 0;
    let resolveTCP;
    const tcpPromise = new Promise((resolve) => { resolveTCP = resolve; });
    const udpReadResolvers = [];
    const runtime = {
      start: async () => {},
      dialTCP: () => tcpPromise,
      dialUDP: async () => ({
        read: () => new Promise((resolve) => udpReadResolvers.push(resolve)),
        write: async (bytes) => { udpWrites.push(bytes.byteLength); return bytes.byteLength; },
        close: async () => {},
      }),
      dispose: async () => {},
    };
    const core = new TailscaleWorkerCore({ post: (message) => posts.push(message), loadRuntime: async () => runtime });
    await core.accept({ type: "configure", config: {} });
    const frame = (stream, opcode, payload = new Uint8Array(0)) => {
      const out = new Uint8Array(5 + payload.byteLength);
      new DataView(out.buffer).setUint32(0, stream, false);
      out[4] = opcode;
      out.set(payload, 5);
      return out;
    };
    const open = (stream, opcode) => {
      const host = new TextEncoder().encode("peer");
      const payload = new Uint8Array(1 + host.length + 2);
      payload[0] = host.length;
      payload.set(host, 1);
      new DataView(payload.buffer).setUint16(1 + host.length, 7, false);
      return frame(stream, opcode, payload);
    };
    core.onFrame(frame(0, OP.HELLO, new Uint8Array([1])));
    core.onFrame(open(9, OP.OPEN));
    core.onFrame(frame(9, OP.CLOSE));
    resolveTCP({ close: async () => { tcpClose += 1; } });

    core.onFrame(open(0x80000001, OP.UDP_OPEN));
    await new Promise((resolve) => setTimeout(resolve, 0));
    core.onFrame(frame(0x80000001, OP.UDP_DATA, new Uint8Array(0)));
    core.onFrame(frame(0x80000001, OP.UDP_DATA, new Uint8Array(MAX_DATAGRAM)));
    core.onFrame(frame(0x80000001, OP.UDP_DATA, new Uint8Array([1, 2])));
    await new Promise((resolve) => setTimeout(resolve, 0));
    udpReadResolvers.shift()(new Uint8Array(0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    udpReadResolvers.shift()(new Uint8Array([4]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    udpReadResolvers.shift()(new Uint8Array([5, 6]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    udpReadResolvers.shift()(null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const wire = posts.filter((entry) => entry.type === "frame").map((entry) => {
      const bytes = new Uint8Array(entry.bytes);
      return { stream: new DataView(bytes.buffer).getUint32(0, false), opcode: bytes[4], length: bytes.byteLength - 5 };
    });
    return { wire, udpWrites, tcpClose };
  });

  expect(result.tcpClose).toBe(1);
  expect(result.wire).not.toContainEqual({ stream: 9, opcode: 2, length: 0 });
  expect(result.udpWrites).toEqual([0, 65_507, 2]);
  expect(result.wire).toContainEqual({ stream: 0x80000001, opcode: 10, length: 0 });
  expect(result.wire).toContainEqual({ stream: 0x80000001, opcode: 12, length: 0 });
  expect(result.wire).toContainEqual({ stream: 0x80000001, opcode: 12, length: 1 });
  expect(result.wire).toContainEqual({ stream: 0x80000001, opcode: 12, length: 2 });
});

test("E3-T17 Worker fails closed on malformed frames and redacts auth keys", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { TailscaleWorkerCore } = await import("./tailscale-worker-core.js");
    const posts = [];
    const core = new TailscaleWorkerCore({
      post: (message) => posts.push(message),
      loadRuntime: async () => { throw new Error("rejected tskey-auth-supersecret"); },
    });
    const config = { authKey: "tskey-auth-supersecret" };
    await core.accept({ type: "configure", config });
    return { posts, config };
  });
  expect(result.config.authKey).toBeUndefined();
  expect(JSON.stringify(result.posts)).not.toContain("supersecret");
  expect(result.posts).toContainEqual({
    type: "failed",
    error: { code: "runtime_unavailable", message: "rejected [redacted]" },
  });
});

test("E3-T17 Worker bounds hostile queues and reaps 500 concurrent flows", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const {
      TailscaleWorkerCore,
      ProxyOpcode: OP,
      INITIAL_WINDOW,
      MAX_DATAGRAM,
    } = await import("./tailscale-worker-core.js");
    const posts = [];
    const tcpConnections = [];
    const udpConnections = [];
    let runtimeDisposals = 0;
    const never = () => new Promise(() => {});
    const runtime = {
      start: async () => {},
      dialTCP: async () => {
        const connection = {
          closes: 0,
          read: never,
          write: async (bytes) => bytes.byteLength,
          shutdownWrite: async () => {},
          close: async () => { connection.closes += 1; },
        };
        tcpConnections.push(connection);
        return connection;
      },
      dialUDP: async () => {
        const connection = {
          closes: 0,
          read: never,
          // Deliberately stall writes so queuedBytes, rather than completed IO, enforces the cap.
          write: never,
          close: async () => { connection.closes += 1; },
        };
        udpConnections.push(connection);
        return connection;
      },
      dispose: async () => { runtimeDisposals += 1; },
    };
    const core = new TailscaleWorkerCore({
      post: (message) => posts.push(message),
      loadRuntime: async () => runtime,
    });
    await core.accept({ type: "configure", config: {} });

    const frame = (stream, opcode, payload = new Uint8Array()) => {
      const bytes = new Uint8Array(5 + payload.byteLength);
      new DataView(bytes.buffer).setUint32(0, stream, false);
      bytes[4] = opcode;
      bytes.set(payload, 5);
      return bytes;
    };
    const open = (stream, opcode) => {
      const host = new TextEncoder().encode("peer");
      const payload = new Uint8Array(3 + host.byteLength);
      payload[0] = host.byteLength;
      payload.set(host, 1);
      new DataView(payload.buffer).setUint16(1 + host.byteLength, 7, false);
      return frame(stream, opcode, payload);
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const decoded = () => posts.filter((entry) => entry.type === "frame").map((entry) => {
      const bytes = new Uint8Array(entry.bytes);
      return {
        stream: new DataView(bytes.buffer).getUint32(0, false),
        opcode: bytes[4],
      };
    });

    core.onFrame(frame(0, OP.HELLO, Uint8Array.of(1)));

    // DATA before OPEN and a write larger than the advertised receive credit both fail closed.
    core.onFrame(frame(700, OP.DATA, Uint8Array.of(1)));
    core.onFrame(open(701, OP.OPEN));
    await settle();
    core.onFrame(frame(701, OP.DATA, new Uint8Array(INITIAL_WINDOW + 1)));

    // Four maximum datagrams fit exactly. One more byte must close the flow while every write is
    // stalled, proving the queue cap is based on admitted bytes rather than completed writes.
    core.onFrame(open(0x800002be, OP.UDP_OPEN));
    await settle();
    for (let index = 0; index < 4; index += 1) {
      core.onFrame(frame(0x800002be, OP.UDP_DATA, new Uint8Array(MAX_DATAGRAM)));
    }
    core.onFrame(frame(0x800002be, OP.UDP_DATA, Uint8Array.of(1)));

    // Use distinct IDs so the hostile flows above cannot make the concurrency count ambiguous.
    for (let stream = 1; stream <= 500; stream += 1) {
      core.onFrame(open(stream, OP.OPEN));
    }
    await settle();
    const activeBeforeDispose = core.flowCount();
    const postsBeforeDispose = posts.length;
    await core.dispose();
    await settle();

    const wire = decoded();
    return {
      activeBeforeDispose,
      activeAfterDispose: core.flowCount(),
      runtimeDisposals,
      tcpConnections: tcpConnections.length,
      tcpCloses: tcpConnections.reduce((sum, connection) => sum + connection.closes, 0),
      udpConnections: udpConnections.length,
      udpCloses: udpConnections.reduce((sum, connection) => sum + connection.closes, 0),
      callbacksAfterDispose: posts.length - postsBeforeDispose,
      dataBeforeOpenReset: wire.some((item) => item.stream === 700 && item.opcode === OP.RST),
      creditOverflowReset: wire.some((item) => item.stream === 701 && item.opcode === OP.RST),
      udpQueueClosed: wire.some((item) => item.stream === 0x800002be && item.opcode === OP.UDP_CLOSE),
      opened500: wire.filter((item) => item.opcode === OP.OPEN_OK && item.stream >= 1 && item.stream <= 500).length,
    };
  });

  expect(result).toEqual({
    activeBeforeDispose: 500,
    activeAfterDispose: 0,
    runtimeDisposals: 1,
    tcpConnections: 501,
    tcpCloses: 501,
    udpConnections: 1,
    udpCloses: 1,
    callbacksAfterDispose: 0,
    dataBeforeOpenReset: true,
    creditOverflowReset: true,
    udpQueueClosed: true,
    opened500: 500,
  });
});

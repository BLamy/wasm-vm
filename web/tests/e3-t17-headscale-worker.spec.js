// Opt-in real-control-plane proof for E3-T17. The orchestration wrapper supplies a same-origin
// Headscale proxy and a single-use key; this spec owns only the browser Worker lifecycle so the
// recorded requests and structured-clone messages remain directly inspectable by the critic.
import { test, expect } from "@playwright/test";

const CONTROL_URL = process.env.E3_T17_CONTROL_URL;
const AUTH_KEY = process.env.E3_T17_AUTH_KEY;
const HOSTNAME = process.env.E3_T17_HOSTNAME ?? "wasm-vm-browser-live";
const PEER_IP = process.env.E3_T17_PEER_IP;
const PEER_NAME = process.env.E3_T17_PEER_NAME;
const PEER_PORT = Number(process.env.E3_T17_PEER_PORT ?? 0);
const PEER_UDP_PORT = Number(process.env.E3_T17_PEER_UDP_PORT ?? 0);
const EXIT_NODE_ID = process.env.E3_T17_EXIT_NODE_ID ?? "";
const PUBLIC_HOST = process.env.E3_T17_PUBLIC_HOST ?? "";
const PUBLIC_PORT = Number(process.env.E3_T17_PUBLIC_PORT ?? 0);
const PUBLIC_NAME = process.env.E3_T17_PUBLIC_NAME ?? "";
const USE_EXIT_NODE = process.env.E3_T17_USE_EXIT_NODE === "0"
  ? false
  : Boolean(EXIT_NODE_ID || PUBLIC_HOST);
const EXPECT_PUBLIC_FAIL = process.env.E3_T17_EXPECT_PUBLIC_FAIL === "1";

test("real Headscale registration survives Worker restart without retaining the auth key", async ({ page }) => {
  test.skip(!CONTROL_URL || !AUTH_KEY, "set E3_T17_CONTROL_URL and E3_T17_AUTH_KEY for the live proof");
  test.setTimeout(360_000);

  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/");

  const result = await page.evaluate(async ({
    controlUrl, authKey, hostname, peerIp, peerName, peerPort, peerUdpPort,
    exitNodeId, publicHost, publicPort, publicName, useExitNode, expectPublicFail,
  }) => {
    const waitForMessage = (session, predicate, timeoutMs = 30_000) => new Promise((resolve, reject) => {
      const started = performance.now();
      const inspect = () => {
        const found = session.messages.find(predicate);
        if (found) return resolve(found);
        if (performance.now() - started >= timeoutMs) {
          const tail = session.messages.slice(-12).map((message) => {
            if (message?.type !== "frame") return message;
            const bytes = new Uint8Array(message.bytes);
            return {
              type: "frame",
              stream: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false),
              opcode: bytes[4],
              length: bytes.byteLength - 5,
            };
          });
          reject(new Error(`Worker message timeout: ${JSON.stringify(tail)}`));
          return;
        }
        setTimeout(inspect, 20);
      };
      inspect();
    });
    const frame = (stream, opcode, payload = new Uint8Array()) => {
      const bytes = new Uint8Array(5 + payload.byteLength);
      new DataView(bytes.buffer).setUint32(0, stream, false);
      bytes[4] = opcode;
      bytes.set(payload, 5);
      return bytes;
    };
    const openFrame = (stream, host, port, openOpcode = 1) => {
      const encoded = new TextEncoder().encode(host);
      const payload = new Uint8Array(3 + encoded.byteLength);
      payload[0] = encoded.byteLength;
      payload.set(encoded, 1);
      new DataView(payload.buffer).setUint16(1 + encoded.byteLength, port, false);
      return frame(stream, openOpcode, payload);
    };
    const opcode = (message) => message?.type === "frame"
      ? new Uint8Array(message.bytes)[4]
      : -1;
    const streamId = (message) => message?.type === "frame"
      ? new DataView(message.bytes).getUint32(0, false)
      : -1;
    const start = (config) => new Promise((resolve, reject) => {
      const worker = new Worker("./tailscale-worker.js", {
        type: "module",
        name: "e3-t17-live-headscale",
      });
      const messages = [];
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error(`Headscale Worker timeout: ${JSON.stringify(messages.slice(-8))}`));
      }, 180_000);
      worker.onmessage = (event) => {
        const message = event.data;
        messages.push(message);
        if (message?.type === "failed") {
          clearTimeout(timer);
          worker.terminate();
          reject(new Error(`Headscale Worker failed: ${JSON.stringify(message)}`));
          return;
        }
        if (message?.type === "status" && message.status?.state === "Running") {
          clearTimeout(timer);
          const state = messages
            .filter((item) => item?.type === "storageUpdate")
            .at(-1)?.snapshot ?? {};
          resolve({ worker, messages, state, status: message.status });
        }
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        reject(new Error(`Headscale Worker script error: ${event.message}`));
      };
      worker.postMessage({ type: "configure", config });
    });
    const httpRequest = async (session, stream, host = peerIp, port = peerPort) => {
      const before = session.messages.length;
      session.worker.postMessage({ type: "frame", bytes: openFrame(stream, host, port).buffer });
      await waitForMessage(session, (message, index) => (
        index >= before && streamId(message) === stream && opcode(message) === 2
      ));
      await waitForMessage(session, (message, index) => (
        index >= before && streamId(message) === stream && opcode(message) === 8
      ));
      const credit = new Uint8Array(4);
      new DataView(credit.buffer).setUint32(0, 1024 * 1024, false);
      session.worker.postMessage({ type: "frame", bytes: frame(stream, 8, credit).buffer });
      const request = new TextEncoder().encode(
        `GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`,
      );
      session.worker.postMessage({ type: "frame", bytes: frame(stream, 4, request).buffer });
      session.worker.postMessage({ type: "frame", bytes: frame(stream, 5).buffer });
      await waitForMessage(session, (message, index) => (
        index >= before && streamId(message) === stream && opcode(message) === 4
      ));
      const responseBytes = session.messages
        .slice(before)
        .filter((message) => streamId(message) === stream && opcode(message) === 4)
        .map((message) => new Uint8Array(message.bytes).subarray(5));
      const size = responseBytes.reduce((total, bytes) => total + bytes.byteLength, 0);
      const joined = new Uint8Array(size);
      let offset = 0;
      for (const bytes of responseBytes) {
        joined.set(bytes, offset);
        offset += bytes.byteLength;
      }
      session.worker.postMessage({ type: "frame", bytes: frame(stream, 6).buffer });
      return new TextDecoder().decode(joined);
    };
    const udpRoundtrip = async (session, stream) => {
      const before = session.messages.length;
      session.worker.postMessage({
        type: "frame",
        bytes: openFrame(stream, peerIp, peerUdpPort, 9).buffer,
      });
      const opened = await waitForMessage(session, (message, index) => (
        index >= before && (
          (streamId(message) === stream && opcode(message) === 10) ||
          (message?.type === "flowError" && message.transport === "udp" && message.stream === stream)
        )
      ));
      if (opened.type === "flowError") throw new Error(`UDP open failed: ${opened.message}`);
      const expected = [
        Uint8Array.of(1, 2, 3),
        Uint8Array.of(9, 8, 7, 6, 5),
        new Uint8Array(),
        new Uint8Array(1_252).fill(0xa5),
      ];
      for (const payload of expected) {
        session.worker.postMessage({ type: "frame", bytes: frame(stream, 12, payload).buffer });
      }
      await waitForMessage(session, (_message, _index) => (
        session.messages.slice(before)
          .filter((item) => streamId(item) === stream && opcode(item) === 12).length === expected.length
      ));
      const actual = session.messages.slice(before)
        .filter((message) => streamId(message) === stream && opcode(message) === 12)
        .map((message) => Array.from(new Uint8Array(message.bytes).subarray(5)));
      session.worker.postMessage({ type: "frame", bytes: frame(stream, 13).buffer });
      return { expected: expected.map((payload) => Array.from(payload)), actual };
    };
    const expectTcpOpenFailure = async (session, stream, host, port) => {
      const before = session.messages.length;
      const started = performance.now();
      session.worker.postMessage({ type: "frame", bytes: openFrame(stream, host, port).buffer });
      await waitForMessage(session, (message, index) => index >= before && (
        (streamId(message) === stream && opcode(message) === 3) ||
        (message?.type === "flowError" && message.transport === "tcp" && message.stream === stream)
      ), 20_000);
      return performance.now() - started;
    };

    const first = await start({
      wasmUrl: "./tailscale-connect/main.wasm",
      controlUrl,
      hostname,
      authKey,
      state: {},
      acceptDns: true,
      useExitNode,
      exitNodeId: exitNodeId || null,
    });
    const firstState = structuredClone(first.state);
    const firstIdentity = first.status.netMap?.self ?? null;
    let lookupAddresses = null;
    let publicLookupAddresses = null;
    let peerResponse = null;
    let publicResponse = null;
    let publicFailureMs = null;
    let selectedExitNodeId = null;
    let udp = null;
    if (useExitNode) {
      const selected = await waitForMessage(first, (message) => (
        message?.type === "status" && message.status?.netMap?.selectedExitNodeId
      ));
      selectedExitNodeId = selected.status.netMap.selectedExitNodeId;
    }
    if (peerName) {
      first.worker.postMessage({ type: "lookup", id: 17, name: peerName });
      const lookup = await waitForMessage(first, (message) => (
        message?.type === "lookupResult" && message.id === 17
      ));
      if (lookup.failed) throw new Error(`MagicDNS lookup failed for ${peerName}`);
      lookupAddresses = lookup.addresses;
    }
    if (publicName) {
      first.worker.postMessage({ type: "lookup", id: 18, name: publicName });
      const lookup = await waitForMessage(first, (message) => (
        message?.type === "lookupResult" && message.id === 18
      ));
      if (lookup.failed) throw new Error(`public DNS fallback failed for ${publicName}`);
      publicLookupAddresses = lookup.addresses;
    }
    if (peerIp && peerPort) {
      first.worker.postMessage({ type: "frame", bytes: frame(0, 0, Uint8Array.of(1)).buffer });
      await waitForMessage(first, (message) => opcode(message) === 0);
      peerResponse = await httpRequest(first, 1);
      if (peerUdpPort) udp = await udpRoundtrip(first, 0x80000001);
    }
    if (publicHost && publicPort) {
      if (!peerIp || !peerPort) {
        first.worker.postMessage({ type: "frame", bytes: frame(0, 0, Uint8Array.of(1)).buffer });
        await waitForMessage(first, (message) => opcode(message) === 0);
      }
      if (expectPublicFail) {
        publicFailureMs = await expectTcpOpenFailure(first, 3, publicHost, publicPort);
      } else {
        publicResponse = await httpRequest(first, 3, publicHost, publicPort);
      }
    }
    first.worker.terminate();

    if (Object.keys(firstState).length === 0) {
      throw new Error("Headscale registration reached Running without persisted identity state");
    }

    const second = await start({
      wasmUrl: "./tailscale-connect/main.wasm",
      controlUrl,
      hostname,
      state: firstState,
      acceptDns: true,
      useExitNode,
      exitNodeId: exitNodeId || null,
    });
    const secondIdentity = second.status.netMap?.self ?? null;
    let peerResponseAfterRestart = null;
    if (peerIp && peerPort) {
      second.worker.postMessage({ type: "frame", bytes: frame(0, 0, Uint8Array.of(1)).buffer });
      await waitForMessage(second, (message) => opcode(message) === 0);
      peerResponseAfterRestart = await httpRequest(second, 2);
    }
    const beforeLogout = second.messages.length;
    second.worker.postMessage({ type: "logout" });
    await waitForMessage(second, (message, index) => (
      index >= beforeLogout && message?.type === "storageUpdate" &&
      Object.keys(message.snapshot ?? {}).length === 0
    ));
    await waitForMessage(second, (message, index) => (
      index >= beforeLogout && message?.type === "status" && message.status?.state === "NeedsLogin"
    ));
    second.worker.terminate();
    return {
      firstIdentity,
      secondIdentity,
      stateKeys: Object.keys(firstState).sort(),
      lookupAddresses,
      publicLookupAddresses,
      peerResponse,
      peerResponseAfterRestart,
      publicResponse,
      publicFailureMs,
      selectedExitNodeId,
      udp,
      loggedOut: true,
      messages: [...first.messages, ...second.messages],
    };
  }, {
    controlUrl: CONTROL_URL,
    authKey: AUTH_KEY,
    hostname: HOSTNAME,
    peerIp: PEER_IP,
    peerName: PEER_NAME,
    peerPort: PEER_PORT,
    peerUdpPort: PEER_UDP_PORT,
    exitNodeId: EXIT_NODE_ID,
    publicHost: PUBLIC_HOST,
    publicPort: PUBLIC_PORT,
    publicName: PUBLIC_NAME,
    useExitNode: USE_EXIT_NODE,
    expectPublicFail: EXPECT_PUBLIC_FAIL,
  });

  expect(result.stateKeys.length).toBeGreaterThan(0);
  expect(result.secondIdentity).toEqual(result.firstIdentity);
  expect(result.loggedOut).toBe(true);
  expect(JSON.stringify(result.messages)).not.toContain(AUTH_KEY);
  expect(requests.some((url) => url.endsWith("/tailscale-connect/main.wasm"))).toBe(true);
  expect(requests.every((url) => !url.includes(AUTH_KEY))).toBe(true);
  if (PEER_NAME) expect(result.lookupAddresses).toContain(PEER_IP);
  if (PUBLIC_NAME) expect(result.publicLookupAddresses.length).toBeGreaterThan(0);
  if (PEER_IP && PEER_PORT) {
    expect(result.peerResponse).toMatch(/^HTTP\/1\.[01] /);
    expect(result.peerResponseAfterRestart).toMatch(/^HTTP\/1\.[01] /);
  }
  if (PEER_IP && PEER_UDP_PORT) expect(result.udp.actual).toEqual(result.udp.expected);
  if (EXIT_NODE_ID) expect(result.selectedExitNodeId).toBe(EXIT_NODE_ID);
  if (EXPECT_PUBLIC_FAIL) {
    expect(result.publicFailureMs).toBeLessThan(20_000);
  } else if (PUBLIC_HOST && PUBLIC_PORT) {
    expect(result.publicResponse).toMatch(/^HTTP\/1\.[01] /);
  }
});

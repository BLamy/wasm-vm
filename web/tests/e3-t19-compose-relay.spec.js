import { test, expect } from "@playwright/test";

const RELAY_TOKEN = process.env.E3_T19_RELAY_TOKEN ?? "";

test("E3-T19 composed relay reaches a public endpoint only after explicit selection", async ({ page }) => {
  test.skip(!RELAY_TOKEN, "set E3_T19_RELAY_TOKEN from the composed relay issuer");
  await page.goto("/");
  await page.selectOption("#network-provider", "relay");
  await page.fill("#network-relay-url", "ws://localhost:18081");
  await page.fill("#network-relay-token", RELAY_TOKEN);

  const result = await page.evaluate(async (token) => {
    const frame = (stream, opcode, payload = new Uint8Array()) => {
      const bytes = new Uint8Array(5 + payload.byteLength);
      new DataView(bytes.buffer).setUint32(0, stream, false);
      bytes[4] = opcode;
      bytes.set(payload, 5);
      return bytes;
    };
    const open = (stream, host, port) => {
      const encoded = new TextEncoder().encode(host);
      const payload = new Uint8Array(3 + encoded.byteLength);
      payload[0] = encoded.byteLength;
      payload.set(encoded, 1);
      new DataView(payload.buffer).setUint16(1 + encoded.byteLength, port, false);
      return frame(stream, 1, payload);
    };
    const ws = new WebSocket("ws://localhost:18081");
    ws.binaryType = "arraybuffer";
    const messages = [];
    ws.onmessage = (event) => messages.push(new Uint8Array(event.data));
    const waitFor = (predicate, phase, timeoutMs = 15_000) => new Promise((resolve, reject) => {
      const started = performance.now();
      const poll = () => {
        const found = messages.find(predicate);
        if (found) return resolve(found);
        if (performance.now() - started > timeoutMs) {
          const observed = messages.map((bytes) => ({ stream: new DataView(bytes.buffer).getUint32(0, false), opcode: bytes[4] }));
          return reject(new Error(`relay ${phase} timeout: ${JSON.stringify(observed)}`));
        }
        setTimeout(poll, 10);
      };
      poll();
    });
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error("relay websocket failed"));
    });
    await waitFor((bytes) => bytes[4] === 0, "HELLO");
    const tokenBytes = new TextEncoder().encode(token);
    const hello = new Uint8Array(1 + tokenBytes.length);
    hello[0] = 1;
    hello.set(tokenBytes, 1);
    ws.send(frame(0, 0, hello));
    ws.send(open(1, "1.1.1.1", 80));
    await waitFor((bytes) => new DataView(bytes.buffer).getUint32(0, false) === 1 && bytes[4] === 2, "OPEN_OK");
    await waitFor((bytes) => new DataView(bytes.buffer).getUint32(0, false) === 1 && bytes[4] === 8, "WINDOW");
    const credit = new Uint8Array(4);
    new DataView(credit.buffer).setUint32(0, 64 * 1024, false);
    ws.send(frame(1, 8, credit));
    ws.send(frame(1, 4, new TextEncoder().encode(
      "GET / HTTP/1.1\r\nHost: one.one.one.one\r\nConnection: close\r\n\r\n",
    )));
    ws.send(frame(1, 5));
    const data = await waitFor((bytes) => (
      new DataView(bytes.buffer).getUint32(0, false) === 1 && bytes[4] === 4
    ), "public DATA");
    ws.close();
    return {
      response: new TextDecoder().decode(data.subarray(5)),
      relayUrl: ws.url,
      stored: Object.values(localStorage).join("\n") + Object.values(sessionStorage).join("\n"),
    };
  }, RELAY_TOKEN);

  expect(result.response).toMatch(/^HTTP\/1\.[01] /);
  expect(result.relayUrl).toBe("ws://localhost:18081/");
  expect(result.relayUrl).not.toContain(RELAY_TOKEN);
  expect(result.stored).not.toContain(RELAY_TOKEN);
});

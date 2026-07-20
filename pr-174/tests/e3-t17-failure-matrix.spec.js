// Opt-in production-runtime failure oracle. The shell harness supplies a deliberately invalid
// credential/control/state combination; this test proves the Worker reaches an actionable,
// unauthenticated state and cannot open a tailnet flow without leaking provisioning material.
import { test, expect } from "@playwright/test";

const KIND = process.env.E3_T17_FAILURE_KIND;
const CONTROL_URL = process.env.E3_T17_CONTROL_URL;
const AUTH_KEY = process.env.E3_T17_AUTH_KEY ?? "";
const PEER_IP = process.env.E3_T17_PEER_IP ?? "100.64.0.25";

test("E3-T17 production Worker fails closed for hostile provisioning and control state", async ({ page }) => {
  test.skip(!KIND || !CONTROL_URL, "set E3_T17_FAILURE_KIND and E3_T17_CONTROL_URL");
  test.setTimeout(90_000);
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/");

  const result = await page.evaluate(async ({ kind, controlUrl, authKey, peerIp }) => {
    const messages = [];
    const worker = new Worker("./tailscale-worker.js", {
      type: "module",
      name: `e3-t17-failure-${kind}`,
    });
    const config = {
      wasmUrl: "./tailscale-connect/main.wasm",
      controlUrl,
      hostname: `wasm-vm-failure-${kind}`,
      authKey,
      state: kind === "corrupt-state" ? { _machinekey: "not-a-valid-machine-state" } : {},
      acceptDns: true,
    };
    const terminal = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no terminal status: ${JSON.stringify(messages.slice(-8))}`)), 45_000);
      worker.onerror = (event) => {
        clearTimeout(timer);
        reject(new Error(event.message));
      };
      worker.onmessage = (event) => {
        messages.push(event.data);
        const state = event.data?.type === "status" ? event.data.status?.state : null;
        if (event.data?.type === "failed" || state === "NeedsLogin" || state === "Stopped" || state === "error") {
          clearTimeout(timer);
          resolve(event.data);
        }
      };
      worker.postMessage({ type: "configure", config });
    });

    const frame = (stream, opcode, payload = new Uint8Array()) => {
      const bytes = new Uint8Array(5 + payload.byteLength);
      new DataView(bytes.buffer).setUint32(0, stream, false);
      bytes[4] = opcode;
      bytes.set(payload, 5);
      return bytes;
    };
    const host = new TextEncoder().encode(peerIp);
    const openPayload = new Uint8Array(3 + host.byteLength);
    openPayload[0] = host.byteLength;
    openPayload.set(host, 1);
    new DataView(openPayload.buffer).setUint16(1 + host.byteLength, 18000, false);
    const beforeOpen = messages.length;
    worker.postMessage({ type: "frame", bytes: frame(0, 0, Uint8Array.of(1)).buffer });
    worker.postMessage({ type: "frame", bytes: frame(9, 1, openPayload).buffer });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const afterOpen = messages.slice(beforeOpen).map((message) => {
      if (message?.type !== "frame") return message;
      const bytes = new Uint8Array(message.bytes);
      return {
        type: "frame",
        stream: new DataView(bytes.buffer).getUint32(0, false),
        opcode: bytes[4],
      };
    });
    worker.terminate();
    return {
      terminal,
      afterOpen,
      serializedMessages: JSON.stringify(messages),
    };
  }, { kind: KIND, controlUrl: CONTROL_URL, authKey: AUTH_KEY, peerIp: PEER_IP });

  const terminalState = result.terminal?.type === "failed"
    ? result.terminal.error?.code
    : result.terminal?.status?.state;
  console.log("E3_T17_FAILURE_RESULT", JSON.stringify({
    kind: KIND,
    terminalState,
    afterOpen: result.afterOpen,
  }));
  expect(["NeedsLogin", "Stopped", "error", "runtime_unavailable", "lifecycle"]).toContain(terminalState);
  expect(result.afterOpen).not.toContainEqual({ type: "frame", stream: 9, opcode: 2 });
  if (AUTH_KEY) expect(result.serializedMessages).not.toContain(AUTH_KEY);
  expect(requests.every((url) => !AUTH_KEY || !url.includes(AUTH_KEY))).toBe(true);
});

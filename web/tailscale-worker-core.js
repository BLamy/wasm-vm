// E3-T17 provider-neutral server half of the E3-T16 ws-proxy protocol. This module has no Worker
// globals so the adversarial protocol suite can drive it directly with a fake Tailscale runtime.

export const INITIAL_WINDOW = 256 * 1024;
export const MAX_STREAMS = 1024;
export const MAX_BRIDGE_CHUNK = 64 * 1024;
// Tailscale's default safe TUN MTU (1,280) includes the inner IPv4 (20) and UDP (8) headers.
export const MAX_DATAGRAM = 1_252;
const MAX_UDP_QUEUE = 4 * MAX_DATAGRAM;

const OP = Object.freeze({
  HELLO: 0, OPEN: 1, OPEN_OK: 2, OPEN_FAIL: 3, DATA: 4, SHUTDOWN_WR: 5,
  CLOSE: 6, RST: 7, WINDOW: 8, UDP_OPEN: 9, UDP_OPEN_OK: 10,
  UDP_OPEN_FAIL: 11, UDP_DATA: 12, UDP_CLOSE: 13,
});

const asBytes = (value) => value instanceof Uint8Array
  ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  : value instanceof ArrayBuffer ? new Uint8Array(value) : null;

function header(stream, opcode, payloadLength = 0) {
  const bytes = new Uint8Array(5 + payloadLength);
  new DataView(bytes.buffer).setUint32(0, stream, false);
  bytes[4] = opcode;
  return bytes;
}

function simple(stream, opcode) {
  return header(stream, opcode);
}

function failFrame(stream, opcode, code = 1) {
  const bytes = header(stream, opcode, 1);
  bytes[5] = code;
  return bytes;
}

function windowFrame(stream, credit) {
  const bytes = header(stream, OP.WINDOW, 4);
  new DataView(bytes.buffer).setUint32(5, credit, false);
  return bytes;
}

function dataFrame(stream, opcode, payload) {
  const bytes = header(stream, opcode, payload.byteLength);
  bytes.set(payload, 5);
  return bytes;
}

function parseOpen(bytes) {
  if (bytes.byteLength < 8) return null;
  const hostLength = bytes[5];
  if (bytes.byteLength !== 8 + hostLength) return null;
  let host;
  try {
    host = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(6, 6 + hostLength));
  } catch {
    return null;
  }
  if (!host) return null;
  const port = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getUint16(6 + hostLength, false);
  return port ? { host, port } : null;
}

export function decodeProxyFrame(value) {
  const bytes = asBytes(value);
  if (!bytes || bytes.byteLength < 5 || bytes.byteLength > 1024 * 1024) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stream = view.getUint32(0, false);
  const opcode = bytes[4];
  const payload = bytes.subarray(5);
  if (opcode === OP.HELLO) {
    return stream === 0 && payload.byteLength >= 1
      ? { stream, opcode, version: payload[0] }
      : null;
  }
  if (stream === 0) return null;
  switch (opcode) {
    case OP.OPEN:
    case OP.UDP_OPEN: {
      const destination = parseOpen(bytes);
      return destination && { stream, opcode, ...destination };
    }
    case OP.DATA:
      return { stream, opcode, payload: payload.slice() };
    case OP.UDP_DATA:
      return payload.byteLength <= MAX_DATAGRAM
        ? { stream, opcode, payload: payload.slice() }
        : null;
    case OP.WINDOW:
      return payload.byteLength === 4
        ? { stream, opcode, credit: view.getUint32(5, false) }
        : null;
    case OP.SHUTDOWN_WR:
    case OP.CLOSE:
    case OP.RST:
    case OP.UDP_CLOSE:
      return payload.byteLength === 0 ? { stream, opcode } : null;
    default:
      return null;
  }
}

function redactError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/tskey-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 300);
}

export class TailscaleWorkerCore {
  constructor({ post, loadRuntime }) {
    this.post = post;
    this.loadRuntime = loadRuntime;
    this.runtime = null;
    this.configuring = false;
    this.ready = false;
    this.hello = false;
    this.disposed = false;
    this.tcp = new Map();
    this.udp = new Map();
    this.lookups = 0;
  }

  async accept(message) {
    if (!message || typeof message !== "object" || this.disposed) return;
    if (message.type === "configure") return this.configure(message.config);
    if (message.type === "frame") return this.onFrame(message.bytes);
    if (message.type === "login") return this.lifecycle("login");
    if (message.type === "logout") return this.lifecycle("logout");
    if (message.type === "lookup") return this.lookup(message);
    if (message.type === "dispose") return this.dispose();
    this.fail("protocol", "unknown Worker message");
  }

  async configure(config) {
    if (this.configuring || this.runtime || !config || typeof config !== "object") {
      return this.fail("configuration", "Worker may be configured exactly once");
    }
    this.configuring = true;
    const runtimeConfig = { ...config };
    try {
      this.runtime = await this.loadRuntime(runtimeConfig, {
        status: (status) => this.post({ type: "status", status }),
        storageUpdate: (snapshot) => this.post({ type: "storageUpdate", snapshot }),
      });
      // The runtime copied this provisioning input into Go. Erase the Worker-side copies now; the
      // Go bridge clears its copy immediately before LocalBackend.Start.
      delete runtimeConfig.authKey;
      delete config.authKey;
      this.ready = true;
      this.post({ type: "status", status: { state: "starting" } });
      await this.runtime.start?.();
    } catch (error) {
      delete runtimeConfig.authKey;
      delete config.authKey;
      this.fail("runtime_unavailable", redactError(error));
    }
  }

  onFrame(value) {
    if (!this.ready || !this.runtime) return this.fail("not_ready", "Tailscale runtime not ready");
    const frame = decodeProxyFrame(value);
    if (!frame) return this.fail("protocol", "malformed proxy frame");
    if (!this.hello) {
      if (frame.opcode !== OP.HELLO || frame.version !== 1) {
        return this.fail("protocol", "expected protocol v1 HELLO");
      }
      this.hello = true;
      const reply = header(0, OP.HELLO, 1);
      reply[5] = 1;
      return this.sendFrame(reply);
    }
    if (frame.opcode === OP.HELLO) return this.fail("protocol", "duplicate HELLO");
    switch (frame.opcode) {
      case OP.OPEN: return void this.openTCP(frame);
      case OP.DATA: return this.writeTCP(frame);
      case OP.WINDOW: return this.grantTCP(frame);
      case OP.SHUTDOWN_WR: return this.shutdownTCP(frame.stream);
      case OP.CLOSE: return this.closeTCP(frame.stream, false);
      case OP.RST: return this.closeTCP(frame.stream, false);
      case OP.UDP_OPEN: return void this.openUDP(frame);
      case OP.UDP_DATA: return this.writeUDP(frame);
      case OP.UDP_CLOSE: return this.closeUDP(frame.stream);
      default: return this.fail("protocol", "frame is invalid for Worker server role");
    }
  }

  async openTCP({ stream, host, port }) {
    if (this.flowCount() >= MAX_STREAMS || this.tcp.has(stream) || this.udp.has(stream)) {
      return this.sendFrame(failFrame(stream, OP.OPEN_FAIL));
    }
    const flow = {
      stream, conn: null, cancelled: false, recvCredit: INITIAL_WINDOW, sendCredit: 0,
      wakeCredit: null, writeChain: Promise.resolve(), remoteEof: false,
    };
    this.tcp.set(stream, flow);
    try {
      const conn = await this.runtime.dialTCP(host, port, 10_000);
      if (this.disposed || flow.cancelled || this.tcp.get(stream) !== flow) {
        await conn.close().catch(() => {});
        return;
      }
      flow.conn = conn;
      this.sendFrame(simple(stream, OP.OPEN_OK));
      this.sendFrame(windowFrame(stream, INITIAL_WINDOW));
      void this.readTCP(flow);
    } catch (error) {
      if (this.tcp.get(stream) === flow) this.tcp.delete(stream);
      this.post({ type: "flowError", transport: "tcp", stream, message: redactError(error) });
      if (!flow.cancelled) this.sendFrame(failFrame(stream, OP.OPEN_FAIL));
    }
  }

  writeTCP({ stream, payload }) {
    const flow = this.tcp.get(stream);
    if (!flow?.conn || flow.cancelled || payload.byteLength > flow.recvCredit) {
      return this.resetTCP(stream);
    }
    flow.recvCredit -= payload.byteLength;
    flow.writeChain = flow.writeChain.then(async () => {
      const written = await flow.conn.write(payload);
      if (written !== payload.byteLength) throw new Error("short Tailscale TCP write");
      if (!flow.cancelled) {
        flow.recvCredit += payload.byteLength;
        this.sendFrame(windowFrame(stream, payload.byteLength));
      }
    }).catch((error) => {
      this.post({ type: "flowError", transport: "tcp", stream, phase: "write", message: redactError(error) });
      this.resetTCP(stream);
    });
  }

  grantTCP({ stream, credit }) {
    const flow = this.tcp.get(stream);
    if (!flow || credit === 0 || flow.sendCredit + credit > 0xffff_ffff) {
      return this.resetTCP(stream);
    }
    flow.sendCredit += credit;
    flow.wakeCredit?.();
    flow.wakeCredit = null;
  }

  shutdownTCP(stream) {
    const flow = this.tcp.get(stream);
    if (!flow?.conn || flow.cancelled) return this.resetTCP(stream);
    flow.writeChain = flow.writeChain
      .then(() => flow.conn.shutdownWrite())
      .catch((error) => {
        this.post({ type: "flowError", transport: "tcp", stream, phase: "shutdown", message: redactError(error) });
        this.resetTCP(stream);
      });
  }

  async readTCP(flow) {
    try {
      while (!flow.cancelled && !this.disposed) {
        if (flow.sendCredit === 0) {
          await new Promise((resolve) => { flow.wakeCredit = resolve; });
          continue;
        }
        const bytes = await flow.conn.read(Math.min(MAX_BRIDGE_CHUNK, flow.sendCredit));
        if (bytes === null) {
          flow.remoteEof = true;
          this.sendFrame(simple(flow.stream, OP.SHUTDOWN_WR));
          return;
        }
        const payload = asBytes(bytes);
        if (!payload || payload.byteLength === 0 || payload.byteLength > flow.sendCredit) {
          throw new Error("invalid Tailscale TCP read");
        }
        flow.sendCredit -= payload.byteLength;
        this.sendFrame(dataFrame(flow.stream, OP.DATA, payload));
      }
    } catch (error) {
      this.post({
        type: "flowError", transport: "tcp", stream: flow.stream, phase: "read",
        message: redactError(error),
      });
      this.resetTCP(flow.stream);
    }
  }

  closeTCP(stream, reset) {
    const flow = this.tcp.get(stream);
    if (!flow) return;
    flow.cancelled = true;
    flow.wakeCredit?.();
    this.tcp.delete(stream);
    void flow.conn?.close().catch(() => {});
    if (reset) this.sendFrame(simple(stream, OP.RST));
  }

  resetTCP(stream) {
    this.closeTCP(stream, false);
    this.sendFrame(simple(stream, OP.RST));
  }

  async openUDP({ stream, host, port }) {
    if (this.flowCount() >= MAX_STREAMS || this.tcp.has(stream) || this.udp.has(stream)) {
      return this.sendFrame(failFrame(stream, OP.UDP_OPEN_FAIL));
    }
    const flow = { stream, conn: null, cancelled: false, queuedBytes: 0, writeChain: Promise.resolve() };
    this.udp.set(stream, flow);
    try {
      const conn = await this.runtime.dialUDP(host, port, 10_000);
      if (this.disposed || flow.cancelled || this.udp.get(stream) !== flow) {
        await conn.close().catch(() => {});
        return;
      }
      flow.conn = conn;
      this.sendFrame(simple(stream, OP.UDP_OPEN_OK));
      void this.readUDP(flow);
    } catch (error) {
      if (this.udp.get(stream) === flow) this.udp.delete(stream);
      this.post({ type: "flowError", transport: "udp", stream, message: redactError(error) });
      if (!flow.cancelled) this.sendFrame(failFrame(stream, OP.UDP_OPEN_FAIL));
    }
  }

  writeUDP({ stream, payload }) {
    const flow = this.udp.get(stream);
    if (!flow?.conn || flow.cancelled || flow.queuedBytes + payload.byteLength > MAX_UDP_QUEUE) {
      return this.closeUDP(stream, true);
    }
    flow.queuedBytes += payload.byteLength;
    flow.writeChain = flow.writeChain.then(async () => {
      const written = await flow.conn.write(payload);
      if (written !== payload.byteLength) throw new Error("short Tailscale UDP write");
      flow.queuedBytes -= payload.byteLength;
    }).catch(() => this.closeUDP(stream, true));
  }

  async readUDP(flow) {
    try {
      while (!flow.cancelled && !this.disposed) {
        const bytes = await flow.conn.read(MAX_DATAGRAM);
        if (bytes === null) break;
        const payload = asBytes(bytes);
        if (!payload || payload.byteLength > MAX_DATAGRAM) throw new Error("invalid UDP datagram");
        this.sendFrame(dataFrame(flow.stream, OP.UDP_DATA, payload));
      }
      this.closeUDP(flow.stream, false);
    } catch {
      this.closeUDP(flow.stream, true);
    }
  }

  closeUDP(stream, notify = false) {
    const flow = this.udp.get(stream);
    if (!flow) return;
    flow.cancelled = true;
    this.udp.delete(stream);
    void flow.conn?.close().catch(() => {});
    if (notify) this.sendFrame(simple(stream, OP.UDP_CLOSE));
  }

  async lifecycle(method) {
    if (!this.runtime || typeof this.runtime[method] !== "function") {
      return this.fail("not_ready", `runtime cannot ${method}`);
    }
    try {
      await this.runtime[method]();
    } catch (error) {
      this.fail("lifecycle", redactError(error));
    }
  }

  async lookup(message) {
    const id = message?.id;
    const name = typeof message?.name === "string" ? message.name.trim() : "";
    if (!this.runtime || !Number.isInteger(id) || id < 0 || id > 0xffff_ffff ||
        !name || name.length > 253 || this.lookups >= 64) {
      this.post({ type: "lookupResult", id, failed: true, addresses: [] });
      return;
    }
    this.lookups += 1;
    try {
      const result = await this.runtime.lookup(name);
      const addresses = Array.isArray(result?.addresses)
        ? result.addresses
          .filter((entry) => entry?.family === 4 && typeof entry.address === "string")
          .map((entry) => entry.address)
        : [];
      this.post({ type: "lookupResult", id, failed: false, addresses });
    } catch {
      this.post({ type: "lookupResult", id, failed: true, addresses: [] });
    } finally {
      this.lookups -= 1;
    }
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const stream of [...this.tcp.keys()]) this.closeTCP(stream, false);
    for (const stream of [...this.udp.keys()]) this.closeUDP(stream, false);
    await this.runtime?.dispose?.();
    this.runtime = null;
    this.ready = false;
  }

  flowCount() { return this.tcp.size + this.udp.size; }

  sendFrame(bytes) {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    this.post({ type: "frame", bytes: copy }, [copy]);
  }

  fail(code, message) {
    this.post({ type: "failed", error: { code, message: redactError(message) } });
    void this.dispose();
  }
}

export const ProxyOpcode = OP;

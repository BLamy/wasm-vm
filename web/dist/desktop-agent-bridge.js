// E5-T26f: page-owned transport adapter for the T23d Channel over the worker-safe
// sendAgentInput/onAgentOutput controller seam.

import { Channel } from "./agent-channel.js";

function ownedBytes(value) {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  return Uint8Array.from(value || []);
}

/**
 * Build one reconnectable agent Channel whose transport is the live WasmLinux controller.
 * Guest output is delivered by `receive`; the returned object deliberately owns the copy so the
 * worker's transferred buffer cannot be reused by a decoder or a later restore attempt.
 */
export function createDesktopAgentBridge(controller, { onError = null } = {}) {
  if (!controller || typeof controller.sendAgentInput !== "function") {
    throw new TypeError("desktop agent bridge requires sendAgentInput");
  }

  let active = null;
  const pending = [];
  let bytesReceived = 0;
  let bytesSent = 0;
  let started = false;

  const channel = new Channel({
    reconnect: true,
    onError,
    connect: () => ({
      send(bytes) {
        const copy = ownedBytes(bytes);
        return Promise.resolve(controller.sendAgentInput(copy)).then((accepted) => {
          if (Number(accepted) !== copy.byteLength) {
            throw new Error(`agent input backpressure accepted ${Number(accepted)}/${copy.byteLength} bytes`);
          }
          bytesSent += copy.byteLength;
          return true;
        });
      },
      subscribe(handlers) {
        const transport = { handlers };
        active = transport;
        const queued = pending.splice(0);
        for (const bytes of queued) handlers.data(bytes);
        return () => {
          if (active === transport) active = null;
        };
      },
      close() {
        // Channel owns the reconnect lifecycle. The next connector attempt installs a fresh
        // `active` record; queued guest bytes are flushed only by that fresh listener.
      },
    }),
  });

  return {
    channel,
    start() {
      if (!started) {
        started = true;
        channel.start();
      }
      return channel;
    },
    receive(value) {
      const bytes = ownedBytes(value);
      if (!bytes.byteLength) return 0;
      bytesReceived += bytes.byteLength;
      if (active) active.handlers.data(bytes);
      else pending.push(bytes);
      return bytes.byteLength;
    },
    close(reason = "desktop agent bridge closed") {
      pending.length = 0;
      return channel.close(reason);
    },
    stats() {
      return {
        state: channel.state,
        negotiatedVersion: channel.negotiatedVersion,
        transportGeneration: channel.transportGeneration ?? null,
        bytesReceived,
        bytesSent,
        pendingBytes: pending.reduce((total, bytes) => total + bytes.byteLength, 0),
      };
    },
  };
}

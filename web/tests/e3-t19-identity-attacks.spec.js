import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";

const CONTROL_URL = process.env.E3_T19_CONTROL_URL ?? "";
const COPIED_KEY = process.env.E3_T19_COPIED_KEY ?? "";
const COLLISION_A_KEY = process.env.E3_T19_COLLISION_A_KEY ?? "";
const COLLISION_B_KEY = process.env.E3_T19_COLLISION_B_KEY ?? "";

test("copied state and colliding hostnames preserve explicit control-plane identities", async ({ page }) => {
  test.skip(
    !CONTROL_URL || !COPIED_KEY || !COLLISION_A_KEY || !COLLISION_B_KEY,
    "set the composed E3-T19 identity-attack keys",
  );
  test.setTimeout(360_000);

  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/");

  const observed = await page.evaluate(async ({ controlUrl, copiedKey, collisionAKey, collisionBKey }) => {
    const start = (hostname, authKey, state = {}) => new Promise((resolve, reject) => {
      const worker = new Worker("./tailscale-worker.js", { type: "module" });
      const messages = [];
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error(`identity Worker timeout: ${JSON.stringify(messages.slice(-8))}`));
      }, 180_000);
      worker.onmessage = (event) => {
        messages.push(event.data);
        if (event.data?.type === "failed") {
          clearTimeout(timer);
          worker.terminate();
          reject(new Error(`identity Worker failed: ${JSON.stringify(event.data)}`));
        }
        if (event.data?.type === "status" && event.data.status?.state === "Running") {
          clearTimeout(timer);
          const snapshot = messages
            .filter((message) => message?.type === "storageUpdate")
            .at(-1)?.snapshot ?? {};
          resolve({ worker, messages, snapshot, identity: event.data.status.netMap?.self });
        }
      };
      worker.onerror = (event) => reject(new Error(`identity Worker script error: ${event.message}`));
      worker.postMessage({
        type: "configure",
        config: {
          wasmUrl: "./tailscale-connect/main.wasm",
          controlUrl,
          hostname,
          authKey: authKey || undefined,
          state,
          acceptDns: true,
          useExitNode: false,
        },
      });
    });

    const copiedPrimary = await start("wasm-vm-copied-state", copiedKey);
    const copiedClone = await start(
      "wasm-vm-copied-state-clone",
      "",
      structuredClone(copiedPrimary.snapshot),
    );

    const [collisionA, collisionB] = await Promise.all([
      start("wasm-vm-hostname-collision", collisionAKey),
      start("wasm-vm-hostname-collision", collisionBKey),
    ]);

    const result = {
      copiedPrimary: copiedPrimary.identity,
      copiedClone: copiedClone.identity,
      copiedStateKeys: Object.keys(copiedPrimary.snapshot).sort(),
      collisionA: collisionA.identity,
      collisionB: collisionB.identity,
      messages: [
        ...copiedPrimary.messages,
        ...copiedClone.messages,
        ...collisionA.messages,
        ...collisionB.messages,
      ],
      storage: Object.values(localStorage).join("\n") + Object.values(sessionStorage).join("\n"),
    };
    copiedPrimary.worker.terminate();
    copiedClone.worker.terminate();
    collisionA.worker.terminate();
    collisionB.worker.terminate();
    return result;
  }, {
    controlUrl: CONTROL_URL,
    copiedKey: COPIED_KEY,
    collisionAKey: COLLISION_A_KEY,
    collisionBKey: COLLISION_B_KEY,
  });

  const nodes = JSON.parse(execFileSync(
    "docker",
    ["compose", "exec", "-T", "headscale", "headscale", "-c", "/etc/headscale/config.yaml",
      "nodes", "list", "--output", "json"],
    { cwd: path.resolve(process.cwd(), ".."), encoding: "utf8" },
  ));
  const byAddress = (identity) => nodes.find((node) => (
    node.ip_addresses?.includes(identity.addresses[0])
  ));
  const copiedNode = byAddress(observed.copiedPrimary);
  const collisionNodeA = byAddress(observed.collisionA);
  const collisionNodeB = byAddress(observed.collisionB);

  expect(observed.copiedStateKeys.length).toBeGreaterThan(0);
  // Copied state must preserve the node identity (keys, addresses, authorization); the
  // clone's differing requested hostname is honored as a rename of that same node, never
  // as a second identity.
  const identityCore = ({ name, ...core }) => core;
  expect(identityCore(observed.copiedClone)).toEqual(identityCore(observed.copiedPrimary));
  expect(observed.copiedClone.name).toBe("wasm-vm-copied-state-clone.wasm-vm.test.");
  expect(copiedNode).toBeTruthy();
  expect(nodes.filter((node) => (
    node.ip_addresses?.includes(observed.copiedPrimary.addresses[0])
  ))).toHaveLength(1);

  expect(observed.collisionA.machineKey).not.toBe(observed.collisionB.machineKey);
  expect(observed.collisionA.nodeKey).not.toBe(observed.collisionB.nodeKey);
  expect(observed.collisionA.addresses[0]).not.toBe(observed.collisionB.addresses[0]);
  expect(collisionNodeA).toBeTruthy();
  expect(collisionNodeB).toBeTruthy();
  expect(collisionNodeA.id).not.toBe(collisionNodeB.id);

  const secrets = [COPIED_KEY, COLLISION_A_KEY, COLLISION_B_KEY];
  const serialized = JSON.stringify(observed.messages) + observed.storage;
  for (const secret of secrets) {
    expect(serialized).not.toContain(secret);
    expect(requests.every((url) => !url.includes(secret))).toBe(true);
  }
  // Evidence output is diagnostics, so never serialize IPN machine/node/disco keys or the
  // (Headscale-masked but still credential-shaped) pre-auth-key record into the log.
  console.log("E3_T19_IDENTITY_ATTACKS", JSON.stringify({
    copied: {
      sameIdentity: identityCore(observed.copiedClone).addresses[0] ===
        identityCore(observed.copiedPrimary).addresses[0],
      nodeCount: nodes.filter((node) => (
        node.ip_addresses?.includes(observed.copiedPrimary.addresses[0])
      )).length,
      primaryName: observed.copiedPrimary.name,
      cloneName: observed.copiedClone.name,
    },
    collision: {
      distinctNodes: collisionNodeA.id !== collisionNodeB.id,
      distinctAddresses: observed.collisionA.addresses[0] !== observed.collisionB.addresses[0],
      names: [observed.collisionA.name, observed.collisionB.name],
    },
  }));
});

/** Resolve the exact warm-release namespace for a destructive disk reset. */
export async function resolveOverlayResetSeedIdentity(controller) {
  if (typeof controller?.overlaySeedIdentity !== "function") {
    throw new Error("active disk identity is unavailable; reload before resetting");
  }
  const identity = await controller.overlaySeedIdentity();
  if (identity === null) return null;
  if (!/^[0-9a-f]{64}$/.test(identity ?? "")) {
    throw new Error("active disk identity is invalid; refusing reset");
  }
  return identity;
}

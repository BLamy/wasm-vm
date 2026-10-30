// E9-T22m: fail closed before allocating a long local session and its export.
// Inputs are actual origin estimate() and statfs() receipts, never payload counters.
const safe = value => Number.isSafeInteger(value) && value >= 0;

export class CapacityPreflightError extends Error {
  constructor(code, detail) { super(`${code}: ${detail}`); this.name = 'CapacityPreflightError'; this.code = code; }
}

export function checkRetentionCapacity({quota, usage, hostFreeBytes, localBytes,
  hostLocalBytes = localBytes, exportBytes = 0, reserveBytes}) {
  if (![quota, usage, hostFreeBytes, localBytes, hostLocalBytes, exportBytes, reserveBytes].every(safe)
    || usage > quota || hostLocalBytes < localBytes
    || !safe(hostLocalBytes + exportBytes + reserveBytes)
    || !safe(localBytes + reserveBytes)) {
    throw new CapacityPreflightError('InvalidReceipt', 'unsafe or inconsistent capacity input');
  }
  const browserAvailable = quota - usage;
  const browserRequired = localBytes + reserveBytes;
  const hostRequired = hostLocalBytes + exportBytes + reserveBytes;
  const receipt = {quota, usage, browserAvailable, browserRequired, hostFreeBytes,
    hostRequired, localBytes, hostLocalBytes, exportBytes, reserveBytes};
  if (browserAvailable < browserRequired) {
    throw new CapacityPreflightError('BrowserQuota', JSON.stringify(receipt));
  }
  if (hostFreeBytes < hostRequired) {
    throw new CapacityPreflightError('HostSpace', JSON.stringify(receipt));
  }
  return Object.freeze(receipt);
}

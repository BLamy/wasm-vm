import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const LOCK_VERSION = 1;

export class NodeLedgerStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "NodeLedgerStoreError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(code, message, details) {
  throw new NodeLedgerStoreError(code, message, details);
}

function canonicalJson(value, label = "value", seen = new Set()) {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        fail("EINVALIDJSON", `${label} contains a non-finite number`);
      }
      return JSON.stringify(value);
    case "object": {
      if (seen.has(value)) fail("EINVALIDJSON", `${label} contains a cycle`);
      const prototype = Object.getPrototypeOf(value);
      if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
        fail("EINVALIDJSON", `${label} must contain only plain JSON objects`);
      }
      seen.add(value);
      const encoded = Array.isArray(value)
        ? `[${value.map((entry, index) => canonicalJson(entry, `${label}[${index}]`, seen)).join(",")}]`
        : `{${Object.keys(value).sort().map((key) => (
          `${JSON.stringify(key)}:${canonicalJson(value[key], `${label}.${key}`, seen)}`
        )).join(",")}}`;
      seen.delete(value);
      return encoded;
    }
    default:
      fail("EINVALIDJSON", `${label} contains unsupported ${typeof value}`);
  }
}

const cloneJson = (value, label = "value") => JSON.parse(canonicalJson(value, label));
const sameJson = (left, right) => canonicalJson(left) === canonicalJson(right);
const serializedJson = (value) => `${canonicalJson(value)}\n`;

async function syncDirectory(directoryPath) {
  const handle = await open(directoryPath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ignoreMissingUnlink(path) {
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function tempPathFor(targetPath) {
  return join(
    dirname(targetPath),
    `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
}

async function callPhaseHook(options, phase, context) {
  if (options?.onPhase !== undefined && typeof options.onPhase !== "function") {
    fail("EINVALIDOPTION", "onPhase must be a function");
  }
  await options?.onPhase?.(phase, context);
}

async function stageJson(targetPath, value, options) {
  const directoryPath = dirname(targetPath);
  await mkdir(directoryPath, { recursive: true });
  const tempPath = tempPathFor(targetPath);
  const handle = await open(tempPath, "wx", 0o600);
  try {
    await handle.writeFile(serializedJson(value), "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await ignoreMissingUnlink(tempPath).catch(() => {});
    throw error;
  }
  await handle.close();
  const context = Object.freeze({ targetPath, tempPath, directoryPath });
  try {
    await callPhaseHook(options, "temp-synced", context);
  } catch (error) {
    await ignoreMissingUnlink(tempPath).catch(() => {});
    throw error;
  }
  return context;
}

/**
 * Replace targetPath with complete, canonical JSON. The target name always
 * identifies either the previous synced inode or the complete new one.
 *
 * onPhase is a deterministic crash-test seam. It may observe temp-synced,
 * target-published, and directory-synced; callers must not use it in a run.
 */
export async function atomicReplaceJson(targetPath, value, options = {}) {
  const json = cloneJson(value);
  const context = await stageJson(targetPath, json, options);
  let published = false;
  try {
    await rename(context.tempPath, targetPath);
    published = true;
    await callPhaseHook(options, "target-published", context);
    await syncDirectory(context.directoryPath);
    await callPhaseHook(options, "directory-synced", context);
    return cloneJson(json);
  } catch (error) {
    if (!published) await ignoreMissingUnlink(context.tempPath).catch(() => {});
    throw error;
  }
}

/**
 * Publish complete JSON only if targetPath does not exist. link(2) supplies
 * the atomic no-replace step after the temporary inode has been synced.
 */
export async function writeJsonExclusiveAtomic(targetPath, value, options = {}) {
  const json = cloneJson(value);
  const context = await stageJson(targetPath, json, options);
  let published = false;
  try {
    await link(context.tempPath, targetPath);
    published = true;
    await callPhaseHook(options, "target-published", context);
    await syncDirectory(context.directoryPath);
    await ignoreMissingUnlink(context.tempPath);
    await syncDirectory(context.directoryPath);
    await callPhaseHook(options, "directory-synced", context);
    return cloneJson(json);
  } catch (error) {
    await ignoreMissingUnlink(context.tempPath).catch(() => {});
    if (published) await syncDirectory(context.directoryPath).catch(() => {});
    throw error;
  }
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

/**
 * Finish an idempotent artifact publication. A target left visible by a
 * publisher that crashed after link(2) is accepted only when its parsed JSON
 * exactly matches expectedValue (or the supplied comparator accepts it).
 */
export async function ensureJsonArtifact(path, expectedValue, comparator = null) {
  if (comparator !== null && typeof comparator !== "function") {
    fail("EINVALIDOPTION", "artifact comparator must be a function");
  }
  const expected = cloneJson(expectedValue, "expected artifact");
  let created = false;
  try {
    await writeJsonExclusiveAtomic(path, expected);
    created = true;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }

  const actual = await readJson(path);
  const matches = comparator === null
    ? sameJson(actual, expected)
    : await comparator(cloneJson(actual, "actual artifact"), cloneJson(expected, "expected artifact"));
  if (matches !== true) {
    fail("EARTIFACTMISMATCH", `existing JSON artifact does not match ${path}`, {
      path,
      actual,
      expected,
    });
  }
  return { created, value: cloneJson(actual, "actual artifact") };
}

function validateOwner(owner) {
  const copy = cloneJson(owner, "lock owner");
  if (!copy || typeof copy !== "object" || Array.isArray(copy)) {
    fail("EINVALIDOWNER", "lock owner must be a JSON object");
  }
  if (!Number.isSafeInteger(copy.pid) || copy.pid <= 0) {
    fail("EINVALIDOWNER", "lock owner.pid must be a positive safe integer");
  }
  return copy;
}

function validateLockRecord(value, lockPath) {
  const record = cloneJson(value, "lock record");
  if (
    !record || typeof record !== "object" || Array.isArray(record) ||
    record.version !== LOCK_VERSION ||
    typeof record.token !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(record.token) ||
    !Number.isFinite(record.acquiredAtMs) || record.acquiredAtMs < 0
  ) {
    fail("ELOCKCORRUPT", `invalid writer lock at ${lockPath}`, { lockPath });
  }
  record.owner = validateOwner(record.owner);
  return record;
}

async function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

async function readLockRecord(lockPath) {
  return validateLockRecord(await readJson(lockPath), lockPath);
}

async function assertStale(record, lockPath, isProcessAlive) {
  if (await isProcessAlive(record.owner.pid, cloneJson(record.owner))) {
    fail("ELOCKED", `writer lock is held by live pid ${record.owner.pid}`, {
      lockPath,
      existingOwner: cloneJson(record.owner),
    });
  }
}

function newLockRecord(owner, { now, randomId }) {
  return validateLockRecord({
    version: LOCK_VERSION,
    token: randomId(),
    acquiredAtMs: now(),
    owner: validateOwner(owner),
  }, "new writer lock");
}

function stalePathFor(path, record, now, randomId) {
  return `${path}.stale-${Math.trunc(now())}-${record.token}-${randomId()}.json`;
}

async function releaseExactLock(lockPath, record) {
  let current;
  try {
    current = await readLockRecord(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail("ELOCKOWNERSHIP", `writer lock no longer exists at ${lockPath}`, { lockPath });
    }
    throw error;
  }
  if (!sameJson(current, record)) {
    fail("ELOCKOWNERSHIP", `writer lock at ${lockPath} belongs to another acquisition`, {
      lockPath,
      existingOwner: cloneJson(current.owner),
    });
  }
  await unlink(lockPath);
  await syncDirectory(dirname(lockPath));
}

function lockHandle(lockPath, record, recoveredLockPath) {
  let released = false;
  return Object.freeze({
    lockPath,
    owner: Object.freeze(cloneJson(record.owner)),
    record: Object.freeze(cloneJson(record)),
    recoveredLockPath,
    async release() {
      if (released) return false;
      await releaseExactLock(lockPath, record);
      released = true;
      return true;
    },
  });
}

function successorGuardPath(lockPath, token) {
  const digest = createHash("sha256").update(token).digest("hex").slice(0, 24);
  return `${lockPath}.recovery-${digest}`;
}

async function acquireRecoveryGuardAt(lockPath, guardPath, owner, options, depth = 0) {
  if (depth > 64) {
    fail("ELOCKRECOVERYDEPTH", `too many abandoned recovery records for ${lockPath}`, { lockPath });
  }
  const guardRecord = newLockRecord(owner, options);
  try {
    await writeJsonExclusiveAtomic(guardPath, guardRecord);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readLockRecord(guardPath);
    await assertStale(existing, lockPath, options.isProcessAlive);
    return acquireRecoveryGuardAt(
      lockPath,
      successorGuardPath(lockPath, existing.token),
      owner,
      options,
      depth + 1,
    );
  }
  return {
    guardPath,
    async release() {
      await releaseExactLock(guardPath, guardRecord);
    },
  };
}

const acquireRecoveryGuard = (lockPath, owner, options) => acquireRecoveryGuardAt(
  lockPath,
  `${lockPath}.recovery`,
  owner,
  options,
);

/**
 * Acquire a durable single-writer lease. A dead owner's record is renamed,
 * never deleted, before a fresh exact-token record is published. The returned
 * release method unlinks only that exact acquisition record.
 */
export async function acquireSingleWriterLock(
  lockPath,
  owner,
  {
    isProcessAlive = defaultIsProcessAlive,
    now = Date.now,
    randomId = randomUUID,
  } = {},
) {
  if (typeof isProcessAlive !== "function" || typeof now !== "function" || typeof randomId !== "function") {
    fail("EINVALIDOPTION", "lock callbacks must be functions");
  }
  const options = { isProcessAlive, now, randomId };
  const record = newLockRecord(owner, options);
  const guard = await acquireRecoveryGuard(lockPath, owner, options);
  let recoveredLockPath = null;
  try {
    let current;
    try {
      current = await readLockRecord(lockPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (current) {
      await assertStale(current, lockPath, isProcessAlive);
      recoveredLockPath = stalePathFor(lockPath, current, now, randomId);
      await rename(lockPath, recoveredLockPath);
      await syncDirectory(dirname(lockPath));
    }
    await writeJsonExclusiveAtomic(lockPath, record);
  } finally {
    await guard.release();
  }
  return lockHandle(lockPath, record, recoveredLockPath);
}

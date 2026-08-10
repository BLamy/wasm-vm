export class NodeProductRefutationError extends Error {
  constructor(phase, cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`E4T32 product failure during ${phase}: ${message}`);
    this.name = "NodeProductRefutationError";
    this.code = "E4T32_PRODUCT_REFUTATION";
    this.phase = phase;
    this.original = serializeNodeFailure(cause);
  }
}

export function serializeNodeFailure(error) {
  if (error == null) return null;
  if (!(error instanceof Error)) {
    return { name: typeof error, message: String(error), stack: null, code: null };
  }
  return {
    name: error.name || "Error",
    message: error.message || String(error),
    stack: error.stack || null,
    code: typeof error.code === "string" ? error.code : null,
    phase: typeof error.phase === "string" ? error.phase : null,
    original: error.original ?? null,
    priorFailure: error.e4t32PriorFailure ?? null,
  };
}

export function markNodeProductFailure(phase, error) {
  if (error instanceof NodeProductRefutationError) return error;
  return new NodeProductRefutationError(phase, error);
}

export function isIgnorableFaviconConsoleError({ type, text, url }) {
  if (type !== "error" || !text.startsWith("Failed to load resource:")) return false;
  try {
    return new URL(url).pathname === "/favicon.ico";
  } catch {
    return false;
  }
}

export function classifyNodeSessionFailure(error) {
  const sessionError = serializeNodeFailure(error);
  if (error instanceof NodeProductRefutationError || error?.code === "E4T32_PRODUCT_REFUTATION") {
    return { sessionError, harnessError: null };
  }
  return {
    sessionError,
    harnessError: {
      ...sessionError,
      code: sessionError.code || "E4T32_SESSION_HARNESS_ERROR",
      classification: "unexpected-browser-or-harness-error",
    },
  };
}

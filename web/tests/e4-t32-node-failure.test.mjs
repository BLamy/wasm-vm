import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  NodeProductRefutationError,
  classifyNodeSessionFailure,
  isIgnorableFaviconConsoleError,
  markNodeProductFailure,
  serializeNodeFailure,
} from "./helpers/e4-t32-node-failure.mjs";

test("only an explicitly typed product failure can become a clean product refutation", () => {
  const browserFailure = new Error("Target page, context or browser has been closed");
  const unknown = classifyNodeSessionFailure(browserFailure);
  assert.equal(unknown.sessionError.message, browserFailure.message);
  assert.equal(unknown.harnessError.code, "E4T32_SESSION_HARNESS_ERROR");

  const product = markNodeProductFailure("fresh-node-process", new Error("runtime marker timed out"));
  assert.ok(product instanceof NodeProductRefutationError);
  const deliberate = classifyNodeSessionFailure(product);
  assert.equal(deliberate.sessionError.code, "E4T32_PRODUCT_REFUTATION");
  assert.equal(deliberate.sessionError.phase, "fresh-node-process");
  assert.equal(deliberate.harnessError, null);
});

test("page-close failure dominates a prior product failure as harness evidence", () => {
  const product = markNodeProductFailure("product-assertion", new Error("expected exit 0"));
  const closeFailure = new Error("page.close protocol failure");
  closeFailure.e4t32PriorFailure = serializeNodeFailure(product);
  const classified = classifyNodeSessionFailure(closeFailure);
  assert.equal(classified.harnessError.classification, "unexpected-browser-or-harness-error");
  assert.equal(classified.sessionError.priorFailure.code, "E4T32_PRODUCT_REFUTATION");
});

test("marking an already typed product failure is idempotent", () => {
  const failure = markNodeProductFailure("node", new Error("boom"));
  assert.equal(markNodeProductFailure("other", failure), failure);
});

test("only the exact favicon resource failure is waived; another 404 still refutes", () => {
  const text = "Failed to load resource: the server responded with a status of 404 (File not found)";
  assert.equal(isIgnorableFaviconConsoleError({
    type: "error",
    text,
    url: "http://localhost:8123/favicon.ico",
  }), true);
  assert.equal(isIgnorableFaviconConsoleError({
    type: "error",
    text,
    url: "http://localhost:8123/missing-runtime.js",
  }), false);
  assert.equal(isIgnorableFaviconConsoleError({
    type: "error",
    text: "Uncaught Error: favicon runtime failure",
    url: "http://localhost:8123/favicon.ico",
  }), false);

  const nonFavicon = markNodeProductFailure("product-assertion", new Error(text));
  const classified = classifyNodeSessionFailure(nonFavicon);
  assert.equal(classified.sessionError.code, "E4T32_PRODUCT_REFUTATION");
  assert.equal(classified.harnessError, null);
});

test("the acceptance environment pins a headed browser in Playwright config", () => {
  const source = [
    "import config from './playwright.config.js';",
    "if (config.use?.headless !== false) throw new Error('benchmark is not pinned headed');",
  ].join("\n");
  execFileSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, E4T32_NODE_BENCH: "1" },
    stdio: "pipe",
  });
});

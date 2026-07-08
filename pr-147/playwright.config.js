// E2-T21: Playwright config for the browser boot verification. Auto-starts the dev server
// (tools/serve-dev.sh) so `npx playwright test` reproduces the exact cold-start path a user
// hits: streamed fetch → sha256 integrity → wasm instantiate → boot unmodified Linux to the
// busybox shell. Prerequisites (fail loudly if missing, they are NOT built here):
//   1. web/pkg/  — `wasm-pack build crates/wasm --target web` then `cp -r crates/wasm/pkg web/pkg`
//   2. releases/kernel/6.6.63/Image and releases/initramfs/initramfs.cpio.gz (Epic 2 artifacts)
//   3. web/artifacts.json — `bash tools/gen-web-manifest.sh`
import { defineConfig } from "@playwright/test";

const PORT = 8123;

export default defineConfig({
  testDir: "./tests",
  // The in-browser wasm interpreter boots to the shell in ~1–2 min; give the whole spec room.
  timeout: 240_000,
  expect: { timeout: 180_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `bash ../tools/serve-dev.sh ${PORT}`,
    url: `http://localhost:${PORT}/artifacts.json`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});

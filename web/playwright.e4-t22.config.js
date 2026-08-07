// E4-T22: cross-browser (Chrome + Firefox) matrix for the CPU-worker / SharedArrayBuffer specs.
// Kept SEPARATE from playwright.config.js so the threaded-worker matrix (which needs the shared pkg
// + COOP/COEP server and runs on the Linux `dev` box) does not perturb the default single-browser
// boot suite. On dev:
//   bash tools/build-web-shared.sh && cp -r crates/wasm/pkg-shared web/pkg-shared
//   npx playwright test -c web/playwright.e4-t22.config.js
import { defineConfig, devices } from "@playwright/test";

const PORT = 8124;

export default defineConfig({
  testDir: "./tests",
  testMatch: /e4-t22-.*\.spec\.js/,
  timeout: 240_000,
  expect: { timeout: 180_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  // COOP/COEP-serving dev server (tools/serve-dev.sh sends the isolation headers). The header-LESS
  // fallback spec targets its own server via E4T22_NOHEADERS_URL and is skipped otherwise.
  webServer: {
    command: `bash ../tools/serve-dev.sh ${PORT}`,
    url: `http://localhost:${PORT}/artifacts.json`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
  // The Chrome + Firefox matrix the ticket calls for.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
});

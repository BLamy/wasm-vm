// E3.5-T05f6 acceptance entry point. The repository's Node 24 + Playwright test runner can hang
// before discovering a spec on this host, so the checked-in command delegates to the direct
// Chromium harness used for the recorded evidence.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const verifier = path.join(repo, "tools", "verify", "e3-t05f6-browser-proof.mjs");
const child = spawn(process.execPath, [verifier], { cwd: repo, env: process.env, stdio: "inherit" });
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`E3.5-T05f6 verifier terminated by ${signal}`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});

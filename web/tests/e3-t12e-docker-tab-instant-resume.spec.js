// E3-T12e acceptance entry point. The long guest boot/reload proof is kept in a direct Chromium
// harness because the repository Playwright Test runner can deadlock before discovery on Node 24.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const verifier = path.join(repo, "tools", "verify", "e3-t12e-browser-proof.mjs");
const child = spawn(process.execPath, [verifier], { cwd: repo, env: process.env, stdio: "inherit" });
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`E3-T12e verifier terminated by ${signal}`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});

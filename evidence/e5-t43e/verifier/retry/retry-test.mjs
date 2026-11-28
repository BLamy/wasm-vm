// Exercise tools/replay-desktop/native-shell.mjs sh()'s new retry branch against fake-cli.mjs.
import { bootNative } from "../../../../tools/replay-desktop/native-shell.mjs";
import path from "node:path"; import { fileURLToPath } from "node:url"; import { rmSync, writeFileSync } from "node:fs";
const here = path.dirname(fileURLToPath(import.meta.url));
const out = [];
async function run(mangle, cmd) {
  process.env.FAKE_MANGLE = mangle;
  const m = await bootNative({ image: "/dev/null", out: path.join(here, "out-" + (mangle || "none").replace(/,/g, "_")),
    cli: path.join(here, "fake-cli.mjs"), timeoutMin: 1 });
  let r;
  try { r = { ok: true, value: await m.sh(cmd, "probe") }; } catch (e) { r = { ok: false, error: e.message }; }
  m.stop(); return r;
}
const counter = "/private/tmp/claude-501/-Users-blamy-Documents-Codex-wasm-vm/358f3812-2a26-47fa-96c6-985caf0a6f11/scratchpad/retry-counter";
const cmd = `echo x >> ${counter}; wc -l < ${counter} | tr -d ' '; mv ${counter} ${counter}.away 2>&1 || echo MV_FAILED; mv ${counter}.away ${counter}`;
for (const mangle of ["", "1", "1,2"]) {
  rmSync(counter, { force: true }); rmSync(counter + ".away", { force: true });
  const r = await run(mangle, cmd);
  out.push({ mangle, ...r });
}
// A non-idempotent command that fails on its second run: only the second run's output is returned.
rmSync(counter, { force: true }); writeFileSync(counter, "x\n");
out.push({ mangle: "1", case: "mv-twice", ...(await run("1", `mv ${counter} ${counter}.gone && echo MOVED || echo MV_FAILED`)) });
console.log(JSON.stringify(out, null, 1));
writeFileSync(path.join(here, "result.json"), JSON.stringify(out, null, 1) + "\n");

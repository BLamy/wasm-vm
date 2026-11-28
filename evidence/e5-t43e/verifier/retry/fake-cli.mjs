#!/usr/bin/env node
// Verifier fake "wasm-vm": a real /bin/sh behind the harness's stdin, which mangles the leading
// `printf` of the commands numbered in FAKE_MANGLE (comma list of sh() sequence numbers) the way
// the slow guest did: `[1;1R` typed in front of the command line.
import { spawn } from "node:child_process";
const mangle = new Set((process.env.FAKE_MANGLE || "").split(",").filter(Boolean));
const sh = spawn("/bin/sh", [], { stdio: ["pipe", "inherit", "inherit"] });
let buf = "";
process.stdin.on("data", (b) => {
  buf += b.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    let line = buf.slice(0, i); buf = buf.slice(i + 1);
    const m = line.match(/^printf '%s%s\\n' 'WVM_BEGIN_' '(\d+)'/);
    if (m && mangle.has(m[1])) line = "[1;1R" + line;
    sh.stdin.write(line + "\n");
  }
});
process.stdin.on("end", () => sh.stdin.end());

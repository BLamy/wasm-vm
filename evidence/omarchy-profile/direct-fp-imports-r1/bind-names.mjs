import { readFile, writeFile } from "node:fs/promises";
import { bindNames } from "../../../tools/verify/e5-t22c-symbolize-cpu.mjs";
const binding = bindNames(await readFile("web/dist/pkg/wasm_vm_wasm_bg.wasm"),
  await readFile("target/omarchy-direct-fp-symbols/named.wasm"));
await writeFile(new URL("./name-binding.json", import.meta.url), JSON.stringify({ ...binding,
  names: Object.fromEntries(binding.names) }, null, 2) + "\n");
console.log(JSON.stringify({ releaseSha256: binding.releaseSha256, namedSha256: binding.namedSha256,
  names: binding.names.size, sections: binding.sections.length }));

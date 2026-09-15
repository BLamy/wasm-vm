// Fresh-critic attacks against a copy of the actual profile; never changes source evidence.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { recountProfile } from "../../../tools/verify/omarchy-renderer-opcodes.mjs";
const filename = new URL("../renderer-opcodes-r1/profile.json", import.meta.url);
const raw = fs.readFileSync(filename), source = JSON.parse(raw);
const result = { profileSha256: createHash("sha256").update(raw).digest("hex"), attacks: [] };
for (const name of ["balanced-opcode-drift", "negative-region-drop", "negative-pair-drop"]) {
  const profile = structuredClone(source);
  if (name === "balanced-opcode-drift") { profile.opcode7["0x53"]++; profile.opcode7["0x13"]--; }
  else if (name === "negative-region-drop") { profile.fp_region64[0].total++; profile.fp_region64_dropped = -1; }
  else profile.pair_hist_dropped = -1;
  try {
    const output = recountProfile(profile);
    result.attacks.push({ name, outcome: "ACCEPTED", truncation: output.truncation });
  } catch (error) { result.attacks.push({ name, outcome: "REJECTED", error: String(error) }); }
}
console.log(JSON.stringify(result, null, 2));

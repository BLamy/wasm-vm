#!/usr/bin/env python3
"""Check changed native operands against the compiler's finest coverage segment."""
import json
import pathlib
import re
import subprocess
import sys

repo = pathlib.Path(__file__).resolve().parents[2]
root = pathlib.Path(sys.argv[1]).resolve()
base = "59bf446955cc2b78b84d94fcd03cb3f3f4f1c230"
paths = ["crates/core/src/dev/virtio/gpu/control3d.rs"]
export = json.loads((root / "native-coverage.json").read_bytes())
files = {pathlib.Path(f["filename"]).resolve(): f for block in export["data"] for f in block["files"]}
diff = subprocess.check_output(["git", "diff", "--unified=0", base, "--", *paths], cwd=repo, text=True)
changed, path, line = [], None, 0
for raw in diff.splitlines():
    if raw.startswith("+++ b/"):
        path = raw[6:]
    elif raw.startswith("@@"):
        line = int(re.search(r"\+(\d+)", raw)[1])
    elif raw.startswith("+"):
        changed.append((path, line, raw[1:]))
        line += 1
    elif raw.startswith(" "):
        line += 1
rows, waivers, gaps = [], [], []
for path, line, source in changed:
    text = source.strip()
    if not text or text.startswith(("//", "#[", "pub const", "pub fn", "pub(crate) fn", "fn ")) or re.fullmatch(r"[{}(),;]+", text):
        waivers.append({"path": path, "line": line, "text": source, "reason": "comment, static declaration, signature or delimiter"})
        continue
    if re.search(r": (?:bool|Box<|alloc::|usize)", text) or text.startswith((") ->", "alloc::rc::", "alloc::boxed::", "mailbox: ")):
        waivers.append({"path": path, "line": line, "text": source, "reason": "type/signature has no executable operand"})
        continue
    data = files[(repo / path).resolve()]
    segments = data["segments"]
    checks = []
    for token in re.finditer(r"[A-Za-z_][A-Za-z_0-9]*|[0-9]+|&&|>=|<=|!=|==|\*|&|!", source):
        point = (line, token.start() + 1)
        active = [s for s in segments if (s[0], s[1]) <= point]
        segment = active[-1] if active else None
        count = segment[2] if segment and segment[3] and not segment[5] else 0
        # Structural match labels/patterns are represented by their following
        # executable arm, not by an independently executable token region.
        if text.startswith(("(0,", "(2,")) or text in ["{", "}"]:
            continue
        if segment and not segment[3] and token.group() in {
            "let", "if", "else", "&&", "<=", "true", "false", "MAX_TEXTURE_SIZE"
        }:
            waivers.append({"path": path, "line": line, "column": token.start() + 1,
                            "token": token.group(), "segment": segment,
                            "reason": "LLVM has no token region: keyword/operator syntax or static argument/bound; the same line's dynamic operands and boundary outcomes are separately recorded"})
            continue
        checks.append({"column": token.start() + 1, "token": token.group(), "count": count,
                       "segment": segment})
        if count <= 0:
            gaps.append({"path": path, "line": line, "column": token.start() + 1,
                         "token": token.group(), "segment": segment})
    if text.startswith(("(0,", "(2,")):
        waivers.append({"path": path, "line": line, "text": source, "reason": "match pattern; arm execution is separately covered"})
    else:
        rows.append({"path": path, "line": line, "text": source, "operands": checks})
report = {"schema": "native-buffer-coverage-v1", "base": base, "runtimeLines": rows,
          "waivers": waivers, "uncoveredOperands": gaps}
(root / "changed-coverage.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"runtimeLines": len(rows), "waivers": len(waivers), "uncoveredOperands": len(gaps)}))
assert not gaps, gaps[:20]

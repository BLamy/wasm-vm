#!/usr/bin/env python3
"""Generate Replay Node's driver source with NO embedded recording driver (E5-T33).

Replay's node build.js downloads linux-recordreplay from static.replay.io and embeds it
as src/node_record_replay_driver.cc. That driver is built from Replay's private backend
(src/cpp) and must never ship in wasm-vm's client images, so this writes the empty stub
instead: gRecordReplayDriverSize = 0. At runtime Node then runs normally (set
RECORD_REPLAY_DONT_RECORD=1 to skip the attempted load), and an externally supplied
driver can still be named with RECORD_REPLAY_DRIVER.
"""
import os
import subprocess
from pathlib import Path

src = Path(os.environ.get("NODE_SOURCE_DIR", "/opt/replay-node-26"))
try:
    rev = subprocess.check_output(["git", "-C", str(src), "rev-parse", "--short=12", "HEAD"],
                                  text=True).strip()
except (OSError, subprocess.CalledProcessError):
    rev = os.environ["NODE_SOURCE_REVISION"][:12]
build_id = f"linux-riscv64-node-{rev}-unbundled-driver"
text = ("// Generated for a build without a bundled recording driver.\n"
        "namespace node {\n"
        '  char gRecordReplayDriver[] = "";\n'
        "  int gRecordReplayDriverSize = 0;\n"
        f'  char gBuildId[] = "{build_id}";\n'
        "}\n")
out = src / "src/node_record_replay_driver.cc"
if not out.exists() or out.read_text() != text:
    out.write_text(text)
print("Build ID:", build_id)

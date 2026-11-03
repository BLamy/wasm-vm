#!/usr/bin/env python3
"""Generate Replay build metadata for a browser without an embedded driver.

The fork's build.js only fetches x86/ARM recording drivers. These generated
symbols retain the existing external-driver loading path, without embedding a
foreign-architecture library or claiming RISC-V recording support.
"""
from pathlib import Path
import subprocess
import os

src = Path(os.environ.get('CHROMIUM_SOURCE_DIR', '/work/src'))
revision = subprocess.check_output(['git', '-C', str(src), 'rev-parse', '--short=12', 'HEAD'], text=True).strip()
build_id = 'linux-riscv64-chromium-' + revision + '-unbundled-driver'
cc = src / 'base/record_replay_driver.cc'
header = src / 'base/record_replay_driver.h'
cc_text = ('// Generated for a local build without a bundled recording driver.\n'
              'namespace recordreplay {\n'
              'char gRecordReplayDriver[] = "";\n'
              'int gRecordReplayDriverSize = 0;\n'
              'char gBuildId[] = "' + build_id + '";\n'
              '}\n')
header_text = ('#ifndef BASE_RECORD_REPLAY_DRIVER_H_\n'
                  '#define BASE_RECORD_REPLAY_DRIVER_H_\n'
                  '#define RECORD_REPLAY_BUILD_ID "' + build_id + '"\n'
                  '#endif\n')
for output, content in ((cc, cc_text), (header, header_text)):
    if not output.exists() or output.read_text() != content:
        output.write_text(content)
print('Build ID:', build_id)
print('No bundled recording driver: normal browsing only until a matching RISC-V driver is supplied.')

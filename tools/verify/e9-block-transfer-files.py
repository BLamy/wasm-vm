#!/usr/bin/env python3
"""Independently check the built-browser RV64 block-transfer trace and asset receipts."""
import argparse
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--directory', type=Path, required=True)
args = parser.parse_args()
directory = args.directory.resolve()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_artifact(reference):
    payload = (directory / reference['file']).read_bytes()
    assert len(payload) == reference['bytes']
    assert sha(payload) == reference['sha256']
    return payload


report = json.loads((directory / 'report.json').read_text())
probe = json.loads((directory / 'probe.json').read_text())
guest = probe['largeBlock']
metadata = json.loads((root / 'web/assets/e9-block-transfer.json').read_text())
elf = (root / 'web/assets/e9-block-transfer.elf').read_bytes()
assert report['status'] == 'passed' and report['errors'] == []
assert report['checks']['suite'] == {'passed': 127, 'failed': 0}
assert guest['status'] == 'passed' and guest['guest'] == metadata
assert sha(elf[120:]) == metadata['sha256'] and len(elf[120:]) == metadata['bytes']
for name in ['assets/e9-block-transfer.elf', 'assets/e9-block-transfer.json',
             'session-block-transfer-probe.js', 'pkg/wasm_vm_wasm_bg.wasm']:
    asset = next(item for item in report['assets'] if item['name'] == name)
    assert sha((root / 'web/dist' / name).read_bytes()) == asset['sha256']
assert guest['statusWrite'] == guest['statusRead'] == 0
assert guest['used'] == 2 and int(guest['transition']) > 0
assert guest['readbackSha256'] == sha(bytes(metadata['length']))

trace = read_artifact(guest['trace']).decode().splitlines()
assert len(trace) == int(guest['transition'])
notifications = [i for i, line in enumerate(trace) if 'mem 0x0000000010001050 0x00000000' in line]
write_status = [i for i, line in enumerate(trace) if 'mem 0x0000000080015000 0x00000000' in line]
read_status = [i for i, line in enumerate(trace) if 'mem 0x0000000080015004 0x00000000' in line]
markers = [i for i, line in enumerate(trace) if 'mem 0x0000000080015008 0x0000b10c' in line]
lengths = [line for line in trace if ('mem 0x0000000080010018 0x00090000' in line
                                     or 'mem 0x0000000080010028 0x00090000' in line)]
assert len(notifications) == 2 and len(write_status) == len(read_status) == len(markers) == 1
assert len(lengths) == 4
assert notifications[0] < write_status[0] < notifications[1] < read_status[0] < markers[0]
assert report['checks']['largeBlock']['trace'] == guest['trace']
print(json.dumps({'status': 'passed', 'traceLines': len(trace), 'notifications': notifications,
                  'writeStatusLine': write_status[0], 'readStatusLine': read_status[0],
                  'markerLine': markers[0], 'readbackSha256': guest['readbackSha256']}))

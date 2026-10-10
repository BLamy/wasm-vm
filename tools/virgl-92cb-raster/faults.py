#!/usr/bin/env python3
"""Sabotage authenticated raster evidence without editing the original capture."""
import hashlib
import json
from pathlib import Path
import shutil
import struct
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import receipt  # noqa: E402


def main(source, scratch, fault):
    scratch.mkdir(parents=True, exist_ok=True)
    for name in ('raster.json', 'geometry.bin', 'native.out', 'wasm.out'):
        shutil.copyfile(source / name, scratch / name)
    report = json.loads((scratch / 'raster.json').read_text())
    if fault == 'viewport':
        report['viewportWords'][1] ^= 1
        (scratch / 'raster.json').write_text(json.dumps(report) + '\n')
        receipt.main(scratch)  # must fail against the live original packet
    elif fault == 'bank':
        binary = bytearray((scratch / 'geometry.bin').read_bytes())
        struct.pack_into('<f', binary, 200, 311.0)  # used bank-0 CONST[4].x
        (scratch / 'geometry.bin').write_bytes(binary)
        report['geometryBinarySha256'] = hashlib.sha256(binary).hexdigest()
        (scratch / 'raster.json').write_text(json.dumps(report) + '\n')
        receipt.main(scratch)  # must fail against predecessor packet proof
    elif fault == 'sample':
        row = report['drawCitations'][0]
        handle, rid = row['color']['handle'], row['color']['resourceId']
        raw = {'seq': row['color']['resourceCreateEvent'], 'target': 2,
               'format': 67, 'width': 1024, 'height': 768,
               'nrSamples': 4, 'flags': 0}
        objects = {('SURFACE', handle):
                   ((0, handle, rid, 67, 0, 0), row['color']['surfaceCreate'])}
        receipt.surface(handle, objects, {rid: raw}, (2, 67, 1024, 768, 0, 0))
    elif fault == 'omit-bank':
        report['banks'] = report['banks'][:2]
        (scratch / 'raster.json').write_text(json.dumps(report) + '\n')
        receipt.main(scratch)
    elif fault == 'omit-axis':
        report['banks'][0]['axis'] = report['banks'][0]['axis'][:1]
        (scratch / 'raster.json').write_text(json.dumps(report) + '\n')
        receipt.main(scratch)
    else:
        raise ValueError('viewport|bank|sample|omit-bank|omit-axis fault required')
    raise AssertionError('raster fault unexpectedly passed')


if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3])

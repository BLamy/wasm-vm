#!/usr/bin/env python3
"""Repeat native proof forgeries after faithfully updating cross-linked Wasm digests."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile

HEAD = 'a7be954c1f3bea9dd1e96522e890fa012197c6fe'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--clone', required=True, type=Path)
    p.add_argument('--evidence', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    p.add_argument('--expect-rejected', action='store_true')
    args = p.parse_args()
    sys.path.insert(0, str(args.clone / 'tools/virgl-raw-equality'))
    import receipt
    native = json.loads((args.evidence / 'native/native-report.json').read_bytes())
    wasm = json.loads((args.evidence / 'wasm/report.json').read_bytes())
    clean = receipt.verify(args.evidence, HEAD)
    assert clean == json.loads((args.evidence / 'receipt.json').read_bytes())
    attacks = []
    mutations = [
        ('maxima-boolean-with-propagated-native-binding',
         lambda r: r['recordedMaxima'].__setitem__('stageGlslBytes', True)),
        ('maxima-incorrect-integer-with-propagated-native-binding',
         lambda r: r['recordedMaxima'].__setitem__('stageGlslBytes', 1)),
        ('maxima-float-with-propagated-native-binding',
         lambda r: r['recordedMaxima'].__setitem__('stageGlslBytes', 58201.0)),
        ('empty-native-source-inventory-with-propagated-binding',
         lambda r: r.__setitem__('sources', [])),
        ('empty-coverage-source-inventory-with-propagated-binding',
         lambda r: r['coverage'].__setitem__('sources', [])),
        ('incorrect-coverage-source-summary-with-propagated-binding',
         lambda r: r['coverage']['sources'][0]['summary']['lines'].__setitem__('covered', 0)),
        ('invented-coverage-source-digest-with-propagated-binding',
         lambda r: r['coverage']['sources'][0].__setitem__('sha256', '0' * 64)),
    ]
    for name, mutate in mutations:
        with tempfile.TemporaryDirectory(prefix='equality-critic-propagated-') as temporary:
            folder = Path(temporary)
            for child in args.evidence.iterdir():
                if child.name in ('native', 'wasm'):
                    (folder / child.name).mkdir()
                    for path in child.iterdir():
                        if path.name not in ('native-report.json', 'report.json'):
                            (folder / child.name / path.name).symlink_to(path)
                else:
                    (folder / child.name).symlink_to(child)
            forged_native, forged_wasm = copy.deepcopy(native), copy.deepcopy(wasm)
            mutate(forged_native)
            raw = (json.dumps(forged_native, indent=2) + '\n').encode()
            (folder / 'native/native-report.json').write_bytes(raw)
            forged_wasm['nativeReport'].update(bytes=len(raw), sha256=sha(raw))
            (folder / 'wasm/report.json').write_text(json.dumps(forged_wasm, indent=2) + '\n')
            try:
                forged = receipt.verify(folder, HEAD)
            except Exception as error:
                attacks.append({'name': name, 'rejected': True, 'error': str(error)})
            else:
                attacks.append({'name': name, 'rejected': False,
                                'sourceEvidenceSha256': sha((args.evidence / 'receipt.json').read_bytes()),
                                'observedMaxima': forged['native']['recordedMaxima'],
                                'nativeReportBinding': forged_wasm['nativeReport'],
                                'recordedTranscriptAndProfileUnchanged': True})
    result = {'schema': 'fresh-equality-propagated-forgeries-v1', 'head': HEAD,
              'cleanControl': 'passed', 'attacks': attacks,
              'accepted': sum(not item['rejected'] for item in attacks)}
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    if args.expect_rejected:
        assert all(item['rejected'] for item in attacks), 'full receipt accepted a propagated proof forgery'


if __name__ == '__main__':
    main()

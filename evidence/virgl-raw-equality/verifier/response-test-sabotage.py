#!/usr/bin/env python3
"""Demonstrate that the promoted worker gate fails when a proof guard is removed."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--head', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root, evidence = args.root.resolve(), args.evidence.resolve()
    sys.path.insert(0, str(root / 'tools/virgl-raw-equality'))
    source = root / 'tools/virgl-raw-equality/receipt_attacks.py'
    raw = source.read_bytes()
    assert raw == subprocess.check_output(['git', 'show', args.head + ':' +
        str(source.relative_to(root))], cwd=root)
    counts = {}

    def trace(frame, event, arg):
        if frame.f_code.co_filename != str(source):
            return None
        if event == 'line':
            line = str(frame.f_lineno)
            counts[line] = counts.get(line, 0) + 1
        return trace

    sys.settrace(trace)
    import receipt_attacks
    import native_receipt
    import receipt
    original = json.loads((evidence / 'receipt.json').read_bytes())
    assert original['gitHead'] == args.head
    saved, argv = native_receipt.verify_maxima, sys.argv[:]
    try:
        native_receipt.verify_maxima = lambda *_: None
        with tempfile.TemporaryDirectory(prefix='raw-equality-promoted-sabotage-') as temporary:
            output = Path(temporary) / 'must-not-pass.json'
            sys.argv = [str(source), '--evidence', str(evidence), '--output', str(output)]
            try:
                receipt_attacks.main()
            except ValueError as error:
                observed = str(error)
                assert observed == 'promoted proof forgery escaped: recordedMaxima-singleResultBytes-bool'
                assert not output.exists(), 'no false passed negative receipt'
            else:
                raise AssertionError('promoted gate did not catch removed proof guard')
    finally:
        native_receipt.verify_maxima, sys.argv = saved, argv
    assert receipt.verify(evidence, args.head) == original, 'restored exact clean control'
    sys.settrace(None)
    assert source.read_bytes() == raw
    args.output.write_text(json.dumps(dict(schema='fresh-equality-promoted-test-sabotage-v1',
        status='passed', head=args.head, mutation='in-memory native_receipt.verify_maxima disabled',
        promotedSource=dict(path=str(source.relative_to(root)), bytes=len(raw),
                            sha256=hashlib.sha256(raw).hexdigest()),
        observed=observed, noFalsePassedReceipt=True, restoredCleanControl='passed',
        tracedLines=counts), indent=2) + '\n')
    print(observed + '; restored clean control passes.')


if __name__ == '__main__':
    main()

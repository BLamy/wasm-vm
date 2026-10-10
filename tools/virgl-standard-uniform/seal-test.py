#!/usr/bin/env python3
"""Reject altered logs; admit only the receipt's exact final stdout append."""
import importlib.util
from pathlib import Path

path = Path(__file__).with_name('seal.py')
spec = importlib.util.spec_from_file_location('uniform_seal', path)
seal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seal)

prefix = b'original completed GPU fence\nSTANDARD_UNIFORM_RECORDING_COMPLETE\n'
digest = seal.sha(prefix)
assert seal.authenticated_record('acceptance.log', prefix, digest) == (prefix, None)
complete = prefix + seal.RECEIPT_CONFIRMATION
assert seal.authenticated_record('acceptance.log', complete, digest) == (prefix, complete)
assert seal.authenticated_record('some-other.log', prefix, digest) == (prefix, None)
for name, raw in [
    ('acceptance.log', b'altered' + complete),
    ('acceptance.log', complete + b'unknown appended bytes\n'),
    ('acceptance.log', complete + seal.RECEIPT_CONFIRMATION),
    ('some-other.log', complete),
    ('acceptance.log', prefix[:-1] + seal.RECEIPT_CONFIRMATION),
]:
    try:
        seal.authenticated_record(name, raw, digest)
    except ValueError:
        pass
    else:
        raise AssertionError('unrecorded log mutation admitted: ' + name)
print('Exact receipt-prefix authentication and five tamper rejections passed.')

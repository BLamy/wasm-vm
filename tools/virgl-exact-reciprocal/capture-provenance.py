#!/usr/bin/env python3
"""Replay original compositor packets to bind c580's RCP divisor to DRAW banks."""
from pathlib import Path
import gzip
import hashlib
import json
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
CAPTURE = ROOT / 'evidence/virgl-workload-inventory/captures/es2gears'
SHADER = 'c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f'
sys.path.insert(0, str(ROOT / 'tools/virgl-capture'))
from validate import COMMANDS  # noqa: E402


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(yes, reason):
    if not yes:
        raise AssertionError(reason)


def main():
    out = Path(sys.argv[1])
    summary = json.loads((CAPTURE / 'summary.json').read_text())
    inventory = json.loads((ROOT / 'evidence/virgl-workload-inventory/es2gears-inventory.json').read_text())
    events_bytes = (CAPTURE / 'events.jsonl').read_bytes()
    require(sha(events_bytes) == inventory['eventsSha256'], 'authenticated original event stream')
    text = (CAPTURE / 'shaders' / (SHADER + '.tgsi')).read_bytes()
    require(sha(text) == SHADER, 'unchanged original fragment bytes')
    occurrences = summary['shaders'][SHADER]['occurrences']
    require(len(occurrences) == 1 and occurrences[0]['context'] == 5 and
            occurrences[0]['subcontext'] == 2 and occurrences[0]['handle'] == 445,
            'captured original shader identity')
    require(b'34:   RCP TEMP[48].x, CONST[30].xxxx' in text and
            b'35:   POW TEMP[49].x, TEMP[47].xxxx, TEMP[48].xxxx' in text,
            'exact original divisor/exponent chain')
    subcontext = 0
    fragment_handle = None
    bank = None
    draws = []
    blob_digests = set()
    for line in events_bytes.splitlines():
        event = json.loads(line)
        if event['type'] != 'submit_cmd' or event.get('phase') != 'enter' or event.get('ctxId') != 5:
            continue
        ref = event['blobs'][0]
        compressed = CAPTURE / 'blobs' / (ref['sha256'] + '.bin.gz')
        raw = gzip.decompress(compressed.read_bytes())
        require(len(raw) == ref['bytes'] and sha(raw) == ref['sha256'], 'authentic command blob')
        blob_digests.add(ref['sha256'])
        offset = 0
        while offset < len(raw):
            require(offset + 4 <= len(raw), 'bounded original packet header')
            header, = struct.unpack_from('<I', raw, offset)
            opcode, length = header & 255, header >> 16
            end = offset + 4 * (length + 1)
            require(opcode in COMMANDS and end <= len(raw), 'bounded original packet')
            words = struct.unpack_from('<' + 'I' * (length + 1), raw, offset)
            name = COMMANDS[opcode]
            if name == 'SET_SUB_CTX':
                require(length == 1, 'subcontext packet shape')
                subcontext = words[1]
            elif name == 'DESTROY_SUB_CTX' and words[1] == 2:
                fragment_handle = None
                bank = None
            elif subcontext == 2 and name == 'BIND_SHADER' and words[2] == 1:
                fragment_handle = words[1]
            elif subcontext == 2 and name == 'SET_CONSTANT_BUFFER' and words[1:3] == (1, 0):
                bank_words = words[3:]
                bank = {'event': event['seq'], 'byteOffset': offset,
                        'packetSha256': sha(raw[offset:end]), 'blobSha256': ref['sha256'],
                        'words': len(bank_words),
                        'const30x': bank_words[120] if len(bank_words) > 120 else None}
            elif subcontext == 2 and name.startswith('DRAW') and fragment_handle == 445:
                require(bank is not None and bank['words'] == 136,
                        'complete 34-register fragment bank at original draw')
                require(bank['const30x'] == 0x40000000,
                        'every original c580 draw binds exact binary32 2.0')
                draws.append({'event': event['seq'], 'byteOffset': offset,
                              'packetSha256': sha(raw[offset:end]), 'bank': bank.copy()})
            offset = end
        require(offset == len(raw), 'complete original submission')
    require(len(draws) > 0, 'observed original compositor draws')
    result = {'schema': 'virgl-exact-reciprocal-original-provenance-v1',
              'shader': SHADER, 'context': 5, 'subcontext': 2, 'handle': 445,
              'eventsSha256': sha(events_bytes), 'originalTextSha256': sha(text),
              'draws': len(draws), 'uniqueConst30x': [0x40000000],
              'sampleCitations': draws[:3] + draws[-3:],
              'commandBlobsRead': len(blob_digests)}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2) + '\n')
    print(f"{len(draws)} original c580 draws bind CONST[30].x = 0x40000000")


if __name__ == '__main__':
    main()

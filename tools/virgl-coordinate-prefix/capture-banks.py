#!/usr/bin/env python3
"""Extract every original c580 draw's complete FS bank from authenticated packets."""
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


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, reason):
    if not condition:
        raise AssertionError(reason)


def main():
    output = Path(sys.argv[1])
    events = (CAPTURE / 'events.jsonl').read_bytes()
    inventory = json.loads((ROOT / 'evidence/virgl-workload-inventory/es2gears-inventory.json').read_text())
    require(sha(events) == inventory['eventsSha256'], 'original event stream digest')
    shader = (CAPTURE / 'shaders' / (SHADER + '.tgsi')).read_bytes()
    require(sha(shader) == SHADER, 'original c580 source digest')
    instructions = [line.strip().decode() for line in shader.splitlines()
                    if line.strip()[:1].isdigit() and b':' in line]
    require(len(instructions) >= 28 and all(instructions[pc].startswith(f'{pc}: ')
            for pc in range(28)), 'complete original pc0..27 source prefix')
    summary = json.loads((CAPTURE / 'summary.json').read_text())
    occurrences = summary['shaders'][SHADER]['occurrences']
    require(len(occurrences) == 1 and occurrences[0]['context'] == 5 and
            occurrences[0]['subcontext'] == 2 and occurrences[0]['handle'] == 445,
            'original fragment shader identity')

    subcontext = 0
    fragment = None
    bank = None
    draws = 0
    unique = {}
    citations = {}
    blobs = set()
    for line in events.splitlines():
        event = json.loads(line)
        if event['type'] != 'submit_cmd' or event.get('phase') != 'enter' or event.get('ctxId') != 5:
            continue
        ref = event['blobs'][0]
        data = gzip.decompress((CAPTURE / 'blobs' / (ref['sha256'] + '.bin.gz')).read_bytes())
        require(len(data) == ref['bytes'] and sha(data) == ref['sha256'], 'command blob digest')
        blobs.add(ref['sha256'])
        offset = 0
        while offset < len(data):
            require(offset + 4 <= len(data), 'complete packet header')
            header, = struct.unpack_from('<I', data, offset)
            opcode, length = header & 255, header >> 16
            end = offset + 4 * (length + 1)
            require(opcode in COMMANDS and end <= len(data), 'complete known packet')
            words = struct.unpack_from('<' + 'I' * (length + 1), data, offset)
            name = COMMANDS[opcode]
            if name == 'SET_SUB_CTX':
                require(length == 1, 'subcontext shape')
                subcontext = words[1]
            elif name == 'DESTROY_SUB_CTX' and words[1] == 2:
                fragment, bank = None, None
            elif subcontext == 2 and name == 'BIND_SHADER' and words[2] == 1:
                fragment = words[1]
            elif subcontext == 2 and name == 'SET_CONSTANT_BUFFER' and words[1:3] == (1, 0):
                bank = (words[3:], event['seq'], ref['sha256'], offset, sha(data[offset:end]))
            elif subcontext == 2 and name.startswith('DRAW') and fragment == 445:
                require(bank is not None and len(bank[0]) == 136, 'complete c580 slot-zero bank')
                bank_words = bank[0]
                require(bank_words[29 * 4] == 0 and bank_words[30 * 4] == 0x40000000,
                        'original zero cap and power exponent')
                raw = struct.pack('<136I', *bank_words)
                digest = sha(raw)
                unique[digest] = raw
                citations.setdefault(digest, {
                    'drawEvent': event['seq'], 'drawOffset': offset,
                    'bankEvent': bank[1], 'bankBlobSha256': bank[2],
                    'bankOffset': bank[3], 'bankPacketSha256': bank[4]})
                draws += 1
            offset = end
        require(offset == len(data), 'complete command submission')
    require(draws == 2271 and len(unique) == 3, 'three complete original banks over 2271 draws')
    ordered = sorted(unique)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(struct.pack('<II', 0x50435231, len(ordered)) +
                       b''.join(unique[digest] for digest in ordered))
    provenance = {'schema': 'virgl-c580-prefix-banks-v1', 'eventsSha256': sha(events),
                  'shaderSha256': sha(shader), 'prefix': instructions[:28],
                  'draws': draws, 'commandBlobsRead': len(blobs),
                  'banks': [{'sha256': digest, **citations[digest]} for digest in ordered],
                  'binarySha256': sha(output.read_bytes())}
    output.with_suffix('.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print(f'{draws} original draws, {len(ordered)} authenticated complete banks')


if __name__ == '__main__':
    main()

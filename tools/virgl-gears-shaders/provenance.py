#!/usr/bin/env python3
"""Reassemble the six new G1 shader bodies from authenticated command packets.

G1 already proved the complete capture lifecycle. This boundary binds those
unchanged events and command blobs to the new physical shader probes.
"""
import argparse
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'evidence/virgl-workload-inventory'
CAPTURE = BASE / 'captures/es2gears'
INDEX_SHA = 'a3c6974bdf3e19b17d2150af66337bd36040191b6f23599f7ce1a3990927189f'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(value, label):
    if not value:
        raise ValueError(label)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    output = parser.parse_args().output
    inputs = {}

    def bound(file, expected=None, size=None):
        raw = file.read_bytes()
        digest = sha(raw)
        require(expected is None or digest == expected, f'digest mismatch: {file}')
        require(size is None or len(raw) == size, f'length mismatch: {file}')
        name = str(file.relative_to(ROOT))
        inputs[name] = {'path': name, 'bytes': len(raw), 'sha256': digest}
        return raw

    index = json.loads(bound(BASE / 'index.json', INDEX_SHA))
    inventory = json.loads(bound(BASE / index['gearsInventory']['path'],
                                 index['gearsInventory']['sha256'], index['gearsInventory']['bytes']))
    require(inventory['clientShaderSha256'] == index['additionalClientShaders'], 'G1 client source partition')
    manifest = json.loads(bound(BASE / index['capture']['path'],
                                index['capture']['sha256'], index['capture']['bytes']))
    require(manifest['result']['complete'] and manifest['result']['guestExitCode'] == 0,
            'unchanged G1 completed capture')
    events = [json.loads(line) for line in bound(CAPTURE / manifest['events']['path'],
                                                manifest['events']['sha256'], manifest['events']['bytes']).splitlines()]
    require(len(events) == 52809 and events[-1]['complete'] and events[-1]['normalExit'], 'G1 complete event stream')
    spec = importlib.util.spec_from_file_location('gears_capture_decoder', ROOT / 'tools/virgl-capture/validate.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    decoder, blobs = module.CommandDecoder(), {}
    for line, event in enumerate(events, 1):
        require(event['seq'] == line, 'G1 event ordering')
        if event['type'] != 'submit_cmd' or event['phase'] != 'enter':
            continue
        refs = [ref for ref in event['blobs'] if ref['role'] == 'command']
        require(len(refs) == 1, f'one command blob at event {line}')
        ref = refs[0]
        if ref['sha256'] not in blobs:
            file = CAPTURE / 'blobs' / (ref['sha256'] + '.bin')
            if file.exists():
                raw = bound(file, ref['sha256'], ref['bytes'])
            else:
                raw = gzip.decompress(bound(file.with_suffix('.bin.gz')))
                require(sha(raw) == ref['sha256'] and len(raw) == ref['bytes'], 'expanded command blob')
            blobs[ref['sha256']] = raw
        require(len(blobs[ref['sha256']]) == event['ndw'] * 4, 'submit length agrees with recorded API')
        decoder.submit(blobs[ref['sha256']], event['ctxId'], event['seq'])
    decoder.finish()
    declared = json.loads(bound(ROOT / 'renderer/virgl-shader/tests/gears-originals.json'))
    require([e['sha256'] for e in declared['originals']] ==
            index['additionalClientShaders'] + index['additionalSupportingShaders'], 'all six new G1 originals')
    originals = []
    for entry in declared['originals']:
        body = bound(ROOT / entry['path'], entry['sha256'], entry['bytes'])
        assembled = decoder.shaders[entry['sha256']]
        require(assembled['text'] == body, 'source equals original reassembled CREATE_OBJECT payload')
        require(assembled['stage'] == ('VERT' if entry['stage'] == 'vertex' else 'FRAG'), 'source stage')
        occurrence = assembled['occurrences'][0]
        citations = []
        for item in occurrence['packets']:
            event = events[item['event'] - 1]
            ref = next(ref for ref in event['blobs'] if ref['role'] == 'command')
            raw = blobs[ref['sha256']]
            start = item['byteOffset']
            length = int.from_bytes(raw[start:start + 4], 'little') >> 16
            packet = raw[start:start + (length + 1) * 4]
            citations.append({**item, 'line': item['event'], 'contextId': event['ctxId'],
                              'commandSha256': ref['sha256'], 'packetBytes': len(packet),
                              'packetSha256': sha(packet)})
        originals.append({**entry, 'text': body.decode('ascii'), 'occurrence': occurrence,
                          'citations': citations, 'occurrenceCount': len(assembled['occurrences'])})
    retained = []
    old_manifest = json.loads(bound(ROOT / 'renderer/virgl-shader/tests/original-corpus.json'))
    for entry in declared['retainedPartners']:
        body = bound(ROOT / entry['path'], entry['sha256'], entry['bytes'])
        require(bound(ROOT / entry['retainedPath'], entry['sha256'], entry['bytes']) == body,
                'retained F6 partner is byte-identical in G1')
        old = next(e for e in old_manifest['originals'] if e['sha256'] == entry['sha256'])
        require(old['metadata'] == entry['metadata'], 'retained partner metadata unchanged')
        require(decoder.shaders[entry['sha256']]['text'] == body, 'retained partner from captured commands')
        retained.append({**entry, 'text': body.decode('ascii')})
    # Bind the two tested programs to actual original DRAW_VBO packets. Track
    # only shader/subcontext identity here; G1's full lifecycle proof is retained.
    completed = {}
    for digest, shader in decoder.shaders.items():
        for occurrence in shader['occurrences']:
            last = occurrence['packets'][-1]
            completed[(last['event'], last['byteOffset'])] = (occurrence, digest)
    wanted = {(originals[0]['sha256'], originals[1]['sha256']): 'gears',
              (retained[0]['sha256'], originals[4]['sha256']): 'compositor-texture',
              (originals[2]['sha256'], originals[3]['sha256']): 'unsupported-compositor-program',
              (retained[0]['sha256'], originals[5]['sha256']): 'unsupported-texture-program'}
    subcontexts, objects, bindings, pairs = {}, {}, {}, {}
    for event in events:
        if event['type'] != 'submit_cmd' or event['phase'] != 'enter':
            continue
        ctx = event['ctxId']
        ref = next(ref for ref in event['blobs'] if ref['role'] == 'command')
        raw, offset = blobs[ref['sha256']], 0
        while offset < len(raw):
            header = struct.unpack_from('<I', raw, offset)[0]
            length, opcode, kind = header >> 16, header & 255, (header >> 8) & 255
            packet = raw[offset:offset + (length + 1) * 4]
            words = struct.unpack('<' + 'I' * (length + 1), packet)
            name = module.COMMANDS[opcode]
            sub = subcontexts.get(ctx, 0)
            key = (ctx, sub)
            if name == 'SET_SUB_CTX':
                subcontexts[ctx] = words[1]
            if (event['seq'], offset) in completed:
                occurrence, digest = completed[(event['seq'], offset)]
                objects[(ctx, sub, occurrence['handle'])] = digest
            if name == 'DESTROY_OBJECT' and module.OBJECTS[kind] == 'SHADER':
                objects.pop((*key, words[1]), None)
            if name == 'BIND_SHADER':
                bindings[(*key, words[2])] = objects.get((*key, words[1]))
            if name == 'DRAW_VBO':
                pair = (bindings.get((*key, 0)), bindings.get((*key, 1)))
                if pair in wanted and wanted[pair] not in pairs:
                    pairs[wanted[pair]] = {'name': wanted[pair], 'vertex': pair[0], 'fragment': pair[1],
                                           'contextId': ctx, 'subcontext': sub, 'event': event['seq'],
                                           'line': event['seq'], 'byteOffset': offset,
                                           'commandSha256': ref['sha256'], 'packetBytes': len(packet),
                                           'packetSha256': sha(packet)}
            offset += len(packet)
    require(set(pairs) == set(wanted.values()), 'all admitted and unsupported original programs bound to captured draws')
    report = {'schema': 1, 'task': 'E6-T12g6a', 'status': 'passed',
              'gitHead': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'guestExecution': False, 'productionNegotiation': False,
              'captureEvents': len(events), 'submissions': len(decoder.submissions),
              'originals': originals, 'retainedPartners': retained,
              'pairs': list(pairs.values()), 'inputs': list(inputs.values())}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + '\n')
    print('Six literal new G1 sources authenticated; four admitted, two explicitly rejected')


if __name__ == '__main__':
    main()

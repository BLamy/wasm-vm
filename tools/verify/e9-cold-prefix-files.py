#!/usr/bin/env python3
"""Independent byte oracle for every retained cold-prefix GPU checkpoint."""
import argparse
import hashlib
import json
import pathlib
import struct


def sha(data):
    return hashlib.sha256(data).hexdigest()


def u32(data, at):
    return struct.unpack_from('<I', data, at)[0]


def u64(data, at):
    return struct.unpack_from('<Q', data, at)[0]


def renderer_epoch(payload):
    """Walk the renderer's canonical data encoding without using its JS decoder."""
    def string(at):
        assert payload[at] == 4
        length = u32(payload, at+1)
        return payload[at+5:at+5+length].decode(), at+5+length

    def skip(at, depth=0):
        assert depth <= 64 and at < len(payload)
        tag = payload[at]
        at += 1
        if tag in (0, 1, 2):
            return at
        if tag == 3:
            return at+8
        if tag in (4, 5):
            return at+4+u32(payload, at)
        if tag == 6:
            count = u32(payload, at)
            at += 4
            for _ in range(count):
                at = skip(at, depth+1)
            return at
        assert tag == 7
        count = u32(payload, at)
        at += 4
        for _ in range(count):
            at = skip(at, depth+1)
            at = skip(at, depth+1)
        return at

    assert payload[0] == 7
    at, epoch = 5, None
    for _ in range(u32(payload, 1)):
        key, at = string(at)
        if key == 'logical':
            assert payload[at] == 7
            count = u32(payload, at+1)
            at += 5
            for _ in range(count):
                child, at = string(at)
                if child == 'epoch':
                    epoch, at = string(at)
                else:
                    at = skip(at)
        else:
            at = skip(at)
    assert at == len(payload) and epoch is not None
    return epoch


def inspect(directory):
    browser = json.loads((directory / 'report.json').read_bytes())
    assert browser['task'] == 'E9-T22r'
    assert browser['status'] in ('cold-prefix-frame', 'cold-prefix-frontier')
    archive = json.loads((directory / 'saved/storage.json').read_bytes())
    objects = {row['key']: row['value'] for row in archive['stores']['objects']}

    def read(ref):
        descriptor = objects[ref['sha256']]
        assert str(descriptor['length']) == str(ref['length'])
        pieces = []
        for part in descriptor['parts']:
            payload = (directory / 'saved/chunks' / (part['sha256'] + '.bin')).read_bytes()
            assert len(payload) == int(part['length']) and sha(payload) == part['sha256']
            pieces.append(payload)
        data = b''.join(pieces)
        assert len(data) == int(ref['length']) and sha(data) == ref['sha256']
        return data

    session = next(row for row in archive['stores']['sessions']
                   if row['key'] == browser['result']['sessionId'])
    manifest_bytes = bytes(session['value']['manifest'])
    assert sha(manifest_bytes) == browser['result']['authenticatedHistory']['manifestSha256']
    manifest = json.loads(manifest_bytes)
    extension = next(row for row in manifest['extensions']
                     if row['kind'] == 'e9-exact-witness-pages-v2')
    commitment = json.loads(bytes(extension['bytes']))
    assert commitment['finished'] is True
    cursor = commitment['tail']
    witness = {}
    while cursor:
        page = json.loads(read(cursor))
        for row in page['rows']:
            key = (row['transition'], row['retired'], row['sequence'], row['phase'], row['ordinal'])
            assert key not in witness
            witness[key] = bytes(row['digest']).hex()
        cursor = page['previous']
    assert len(witness) == commitment['count']
    live = [browser['result']['initial'], *browser['result']['checkpoints']]
    assert len(live) >= 3 and len(live) == len(manifest['checkpoints'])
    checkpoints = []
    for index, point in enumerate(manifest['checkpoints']):
        captured = live[index]
        machine = read(point['machine'])
        if machine.startswith(b'WVKEYF01'):
            machine = read(json.loads(machine[8:])['frame'])
        assert machine[:8] in (b'WVGPUB01', b'WVGPUD01') and u32(machine, 8) == 1
        header, native_length, pending_length, output_length = (u32(machine, 12), u64(machine, 16),
                                                                 u32(machine, 24), u32(machine, 28))
        assert 32 + header + native_length + pending_length + output_length == len(machine)
        meta = json.loads(machine[32:32 + header])
        native = machine[32 + header:32 + header + native_length]
        assert native[:8] == b'WVMRESU1' and native[-84:-76] == b'WVGRESU1'
        assert u32(native, len(native)-76) == 1
        assert u64(native, len(native)-72) == len(native)-84
        assert sha(native[:-32]) == native[-32:].hex()
        assert meta['position'] == point['position']
        assert meta['rendererSha256'] == point['gpu']['sha256']
        position = point['position']
        key = (position['transition'], position['retired'], position['sequence'],
               position['phase'], position['ordinal'])
        assert meta['stateSha256'] == witness[key]
        assert position == {name: captured[name] for name in position}
        assert meta['stateSha256'] == captured['digest'] == captured['independentDigest'], \
            'saved keyframe differs from independently computed live logical witness'
        sections = {}
        at = 84
        while at < len(native)-84:
            tag, length = u32(native, at), u32(native, at+4)
            at += 8
            assert tag not in sections and at+length <= len(native)-84
            sections[tag] = native[at:at+length]
            at += length
        assert at == len(native)-84 and 12 in sections
        gpu = sections[12]
        inner = gpu.index(b'WVGPU3D1')
        assert u32(gpu, inner+8) == 3, 'old v2 GPU result checkpoint is not an exact prefix'
        assert sha(gpu[inner:-32]) == gpu[-32:].hex()
        assert gpu[inner+16:inner+48].hex() == meta['rendererSha256'], \
            'saved v3 GPU checkpoint differs from bound physical renderer object'
        latches = tuple(gpu[inner+48:inner+50])
        assert len(latches) == 2 and all(value in (0, 1) for value in latches)
        assert list(latches) == captured['logicalLatches'], \
            'saved v3 latch bytes differ from live logical GPU at this keyframe'
        renderer = read(point['gpu'])
        assert sha(renderer) == meta['rendererSha256']
        assert renderer[:8] == b'WVGJRN01' and u32(renderer, 8) == 1
        assert 16 + u32(renderer, 12) + 32 == len(renderer)
        assert sha(renderer[:-32]) == renderer[-32:].hex()
        assert renderer_epoch(renderer[16:-32]) == meta['rendererEpoch'], \
            'physical renderer epoch differs from machine checkpoint binding'
        checkpoints.append({'id': point['id'], 'position': position,
                            'latches': list(latches), 'rendererEpoch': meta['rendererEpoch'],
                            'stateSha256': meta['stateSha256']})

    initial_artifact = browser['result']['initial']['state']
    initial_state = (directory / initial_artifact['file']).read_bytes()
    assert len(initial_state) == initial_artifact['bytes'] and sha(initial_state) == initial_artifact['sha256']
    initial_witness = sha(b'wasm-vm-gpu-guest-state-v1\0' + struct.pack('<Q', len(initial_state))
                          + initial_state + bytes.fromhex(browser['result']['initial']['ramDigest']))
    assert initial_witness == browser['result']['initial']['digest']
    final_artifact = browser['result']['final']['state']
    final_state = (directory / final_artifact['file']).read_bytes()
    assert len(final_state) == final_artifact['bytes'] and sha(final_state) == final_artifact['sha256']
    logical = final_state.index(b'WVGPULG2')
    final_latches = list(final_state[logical+9:logical+11])
    assert len(final_latches) == 2 and all(value in (0, 1) for value in final_latches)
    final_witness = sha(b'wasm-vm-gpu-guest-state-v1\0' + struct.pack('<Q', len(final_state))
                        + final_state + bytes.fromhex(browser['result']['final']['ramDigest']))
    assert final_witness == browser['result']['final']['digest']
    assert len(checkpoints) >= 3
    windows = browser['result']['replay']['windows']
    assert len(windows) == 2 and windows[0]['requestId'] != windows[1]['requestId']
    for row in windows:
        artifact = row['stateArtifact']
        raw = (directory / artifact['file']).read_bytes()
        assert len(raw) == artifact['bytes'] and sha(raw) == artifact['sha256']
        source = next(point for point in browser['result']['checkpoints']
                      if point['transition'] == row['position']['transition']
                      and point['sequence'] == row['position']['sequence'])
        independent = sha(b'wasm-vm-gpu-guest-state-v1\0' + struct.pack('<Q', len(raw))
                          + raw + bytes.fromhex(source['ramDigest']))
        assert independent == row['digest'], 'replayed raw state differs from committed witness'
    assert [row['logicalLatches'] for row in windows] == [row['latches'] for row in checkpoints[-2:]], \
        'replayed logical latch witness differs from saved exact v3 bytes'
    assert checkpoints[-1]['stateSha256'] == windows[-1]['digest']
    terminal = browser['result']['replay'].get('terminal')
    assert final_latches == (terminal['logicalLatches'] if terminal else windows[-1]['logicalLatches'])
    report = {'task': 'E9-T22r', 'status': 'exact-v3-prefix-passed',
              'browserSha256': sha((directory / 'report.json').read_bytes()),
              'manifestSha256': sha(manifest_bytes), 'checkpoints': len(checkpoints),
              'allV3': True, 'lastThree': checkpoints[-3:], 'finalLogicalLatches': final_latches,
              'finalWitness': browser['result']['final']['digest']}
    proof = directory / 'cold-prefix-byte-oracle'
    proof.mkdir(exist_ok=False)
    (proof / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', required=True)
    arguments = parser.parse_args()
    result = inspect(pathlib.Path(arguments.directory).resolve())
    print(json.dumps({key: result[key] for key in ('status', 'checkpoints', 'lastThree')}))

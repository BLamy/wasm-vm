#!/usr/bin/env python3
"""Independently read literal files from full Omarchy native COW captures.

Only authenticated base chunks the guest fetched are materialized into a sparse
12 GiB image. Every file read must succeed against those exact bytes plus the
captured native COW sectors; absent unused base chunks remain holes. This oracle
does not import the emulator's snapshot or disk codecs.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys

if sys.flags.optimize:
    raise SystemExit('desktop literal oracle requires assertions enabled')

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--directory', required=True, type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
out = args.directory.resolve()
proof = out / 'literal-files-oracle'
proof.mkdir(exist_ok=False)
sha = lambda data: hashlib.sha256(data).hexdigest()
u32 = lambda data, at: struct.unpack_from('<I', data, at)[0]
u64 = lambda data, at: struct.unpack_from('<Q', data, at)[0]
builder = 'sha256:0d1ead8c1106a838e478676dff113f21cdd91eb9456232ff9f6c24679a87d0eb'
browser_bytes = (out / 'report.json').read_bytes()
browser = json.loads(browser_bytes)
contract_bytes = (out / 'contract.json').read_bytes()
contract = json.loads(contract_bytes)
image_bytes = (out / 'image.json').read_bytes()
image = json.loads(image_bytes)
source = Path(__file__).read_bytes()
(proof / 'executed-oracle.py').write_bytes(source)
report = {'task':'E9-T22c', 'phase':'desktop', 'status':'running',
          'scope':'Independent original Omarchy literal files from authenticated sparse base plus native COW; no timing/task verdict',
          'browserSha256':sha(browser_bytes),'contractSha256':sha(contract_bytes),
          'imageSha256':sha(image_bytes),'oracleSourceSha256':sha(source),'builder':builder,
          'points':{},'failures':[]}


def native_sections(raw):
    assert raw[:12] == b'WVMRESU1\1\0\0\0'
    at, result = 84, {}
    while at < len(raw):
        tag, size = struct.unpack_from('<II', raw, at)
        at += 8
        assert tag not in result and size <= len(raw) - at
        result[tag] = raw[at:at + size]
        at += size
    assert at == len(raw)
    return result


def cow_sectors(device, identity):
    length = u32(device, 0)
    assert length <= len(device) - 4
    hub = device[4:4 + length]
    assert hub[:8] == b'WVDEVST1'
    config_length = u32(hub, 8)
    config = hub[12:12 + config_length]
    assert config[2] == 1 and config[3:35] == identity
    assert u64(config, 35) * 512 == image['image_len']
    at = 12 + config_length + 32
    assert u32(hub, at) == 0, 'unsettled original block requests'
    at += 4
    queue = u32(hub, at)
    at += 4
    for _ in range(queue):
        at += 12
        size = u32(hub, at)
        at += 4 + size
        assert at <= len(hub)
    failed = u32(hub, at)
    at += 4 + failed * 5
    reads = u32(hub, at)
    at += 4
    for _ in range(reads):
        at += 12
        count = u32(hub, at)
        at += 4 + count * 4
        assert at <= len(hub)
    count = u32(hub, at)
    at += 4
    sectors = {}
    for _ in range(count):
        index = u64(hub, at)
        at += 8
        assert index < image['image_len'] // 512 and index not in sectors
        sectors[index] = hub[at:at + 512]
        assert len(sectors[index]) == 512
        at += 512
    assert at + 9 == len(hub) and u64(hub, at) == 0 and hub[at + 8] == 0
    return sectors


def read_guest_file(disk_name, guest_path, output_name):
    command = ['docker','run','--rm','--network','none','-v',str(proof)+':/proof:ro',
               '--entrypoint','/usr/sbin/debugfs',builder,'-n','-R','cat '+guest_path,'/proof/'+disk_name]
    result = subprocess.run(command, capture_output=True)
    (proof / (output_name + '.debugfs.log')).write_bytes(result.stderr)
    (proof / output_name).write_bytes(result.stdout)
    assert result.returncode == 0, result.stderr.decode(errors='replace')
    return {'bytes':len(result.stdout),'hex':result.stdout.hex(),'sha256':sha(result.stdout),
            'command':command,'source':'authenticated sparse base plus native COW'}


try:
    assert browser['task'] == 'E9-T22c' and browser['phase'] == 'desktop'
    assert browser['status'] == 'desktop-full-workload-replay-passed', 'browser wrapper did not pass'
    assert browser['result']['status'] == 'desktop-full-workload-replay-passed'
    assert next(row['sha256'] for row in browser['executedSources']
                if row['path'] == 'tools/verify/e9-workload-desktop-files.py') == report['oracleSourceSha256']
    assert sha(contract_bytes) == '646899bea0da60ba13020a2015f6214236526082a8e34952cca91481cb89dba1'
    assert sha(image_bytes) == '8a793846f109a08242688fa32d531f230d7a3e2a7bdb3c694dbfc1abb70367a8'
    assert image['image_len'] == 12884901888 and image['chunk_size'] == 262144
    profile_bytes = (out / 'executed-source/docs/design/session-workload-qualification-v4.json').read_bytes()
    assert sha(profile_bytes) == 'a191b05860be6f32bcc356953ecd4e969eebd47426689d27f643b7bcde13c2c8'
    retention = json.loads(profile_bytes)['retention']
    assert browser['result']['retention'] == {
        'before':{'maxBytes':retention['defaultMaxBytes'],'maxCheckpoints':retention['maxCheckpoints']},
        'after':{'maxBytes':retention['maxBytes'],'maxCheckpoints':retention['maxCheckpoints']}}
    tool = json.loads(profile_bytes)['auxiliaryDesktopTool']
    assert browser['result']['toolTransfer']['source'] == {'bytes':tool['sourceBytes'],'sha256':tool['sourceSha256']}
    assert browser['result']['toolTransfer']['transport'] == {'bytes':tool['transportBytes'],'sha256':tool['transportSha256']}
    saved = json.loads((out / 'saved/storage.json').read_bytes())
    saved_chunks = {row['key']:row for row in saved['stores']['chunks']}
    base_chunks = {}
    for id in set(image['chunks']) & saved_chunks.keys():
        file = out / 'saved/chunks' / (id + '.bin')
        data = file.read_bytes()
        assert len(data) == image['chunk_size'] and sha(data) == id
        base_chunks[id] = data
    assert base_chunks, 'no authenticated materialized Omarchy base'
    report['materializedBase'] = {'uniqueChunks':len(base_chunks),
                                  'occurrences':sum(id in base_chunks for id in image['chunks']),
                                  'ids':sorted(base_chunks)}
    entropy_lines = [line for line in browser['result']['setup']['stdout'].splitlines()
                     if line.endswith('  /root/e9-session/entropy')]
    assert len(entropy_lines) == 1
    entropy_hash = entropy_lines[0].split('  ')[0]
    raw_ledger = {row['file']:row for row in browser['raw']}
    cow_digests = {}
    def inspect_point(label):
        file = out / (label + '.state')
        raw = file.read_bytes()
        retained = raw_ledger[file.name]
        assert retained['bytes'] == len(raw) and retained['sha256'] == sha(raw)
        sections = native_sections(raw)
        sectors = cow_sectors(sections[20], raw[44:76])
        cow_hash = hashlib.sha256()
        for index, data in sorted(sectors.items()):
            cow_hash.update(struct.pack('<Q',index));cow_hash.update(data)
        cow_digests[label] = cow_hash.hexdigest()
        disk = proof / (label + '.ext4')
        with disk.open('wb') as output:
            output.truncate(image['image_len'])
        with disk.open('r+b') as output:
            for index, id in enumerate(image['chunks']):
                data = base_chunks.get(id)
                if data is not None:
                    output.seek(index * image['chunk_size']);output.write(data)
            for index, data in sectors.items():
                output.seek(index * 512);output.write(data)
        names = ['state'] + ([] if label == 'before' else ['entropy']) + (['http'] if label in ('final','replay') else [])
        files = {}
        staged = read_guest_file(disk.name,tool['guestPath'],label+'.busybox')
        assert staged['bytes'] == tool['sourceBytes'] and staged['sha256'] == tool['sourceSha256'], label + ' original static RV64 BusyBox'
        files['busybox'] = staged
        for name in names:
            result = read_guest_file(disk.name,'/root/e9-session/'+name,label+'.'+name)
            data = bytes.fromhex(result['hex'])
            if name == 'state':
                expected = bytes.fromhex(contract['workload']['before_hex' if label=='before' else 'after_hex'])
                assert data == expected, label + ' literal state'
            elif name == 'entropy':
                assert len(data) == 32 and result['sha256'] == entropy_hash, label + ' literal entropy'
            else:
                assert data == bytes([27]) * 1024, label + ' literal tenth HTTP response'
            files[name] = result
        point = browser['result'][label]
        position = point.get('position',point)
        assert str(u64(sections[18],12)) == position['transition']
        assert str(u64(sections[18],36)) == position['sequence']
        report['points'][label] = {'status':'passed','nativeSha256':sha(raw),'cowSha256':cow_digests[label],
                                   'cowSectors':len(sectors),'position':position,'files':files}
    for label in ['before','origin','final','replay']:
        try:
            inspect_point(label)
        except Exception as error:
            report['points'][label] = {'status':'failed','error':repr(error)}
            report['failures'].append(label + ': ' + repr(error))
    if report['points']['final']['status'] == 'passed' and report['points']['replay']['status'] == 'passed':
        try:
            assert cow_digests['final'] == cow_digests['replay'], 'native COW sectors differ'
            assert all(report['points']['final']['files'][name]['hex'] == report['points']['replay']['files'][name]['hex']
                       for name in ['busybox','state','entropy','http'])
            report['finalReplayEquality'] = 'passed'
        except Exception as error:
            report['finalReplayEquality'] = 'failed'
            report['failures'].append('final/replay equality: ' + repr(error))
    assert not report['failures'], report['failures']
    report['status'] = 'literal-desktop-files-passed'
except Exception as error:
    report['status'] = 'failed'
    report['error'] = repr(error)
    report['failures'].append(repr(error))
    raise
finally:
    inputs = {'oracleSource':(Path(__file__),report['oracleSourceSha256']),
              'browserReport':(out / 'report.json',report['browserSha256']),
              'contract':(out / 'contract.json',report['contractSha256']),
              'image':(out / 'image.json',report['imageSha256']),
              'qualificationV3':(out / 'executed-source/docs/design/session-workload-qualification-v3.json',
                                 '5802635c6c7a9c7e1746e1da5b7b4c7460c5c2c2564c6e7492b69456d8492082'),
              'qualificationV4':(out / 'executed-source/docs/design/session-workload-qualification-v4.json',
                                 'a191b05860be6f32bcc356953ecd4e969eebd47426689d27f643b7bcde13c2c8'),
              'busyboxSource':(root / 'releases/initramfs/busybox',
                               '9958179c84ee901615fef183214b90ec2306b5579d0640f520790105f4d79f30')}
    report['immutableInputs'] = {}
    for name,(file,expected) in inputs.items():
        try:
            actual = sha(file.read_bytes())
            report['immutableInputs'][name] = {'sha256':actual,'unchanged':actual == expected}
            assert actual == expected
        except Exception as error:
            report['status'] = 'failed'
            report['failures'].append(name + ' integrity: ' + repr(error))
    for id in report.get('materializedBase',{}).get('ids',[]):
        file = out / 'saved/chunks' / (id + '.bin')
        try:
            assert sha(file.read_bytes()) == id
        except Exception as error:
            report['status'] = 'failed'
            report['failures'].append('base chunk ' + id + ': ' + repr(error))
    (proof / 'report.json').write_text(json.dumps(report,indent=2)+'\n')
if report['status'] != 'literal-desktop-files-passed':
    raise SystemExit(1)
print(json.dumps({'status':report['status'],'points':list(report['points'])}))

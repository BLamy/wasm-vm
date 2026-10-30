#!/usr/bin/env python3
"""Reconstruct the pinned immutable Alpine base in a fresh checkout, without inherited cache."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import time
import subprocess

ROOT = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--output', required=True, type=Path)
p.add_argument('--require-fresh', action='store_true')
a = p.parse_args()
out = a.output.resolve()
out.mkdir(parents=True, exist_ok=False)
report = {'task': 'E9-T22a', 'status': 'running', 'started': time.time(), 'chunks': []}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def write():
    (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')


try:
    fixture_bytes = (ROOT / 'web/session-software-fixture.json').read_bytes()
    fixture = json.loads(fixture_bytes)
    manifest_bytes = (ROOT / 'web/session-alpine-image.json').read_bytes()
    assert sha(manifest_bytes) == fixture['image_manifest_sha256'] == 'bf6a2c61eb5292f5d1901bced572c51db4f63a18a85bf673b5871bccc46c8c46'
    assert fixture['raw_image_sha256'] == 'ebcd6b7a3569f6280f901b9697f3b8f06a11dd800b2410b540fb6bbdea8c60f8'
    assert fixture['base_url'] == 'https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/chunked-alpine/'
    manifest = json.loads(manifest_bytes)
    assert manifest['version'] == 1 and manifest['layout'] == 'split'
    assert manifest['image_len'] == fixture['raw_image_bytes'] == 536870912
    assert manifest['chunk_size'] == 131072 and len(manifest['chunks']) == 4096
    assert all(re.fullmatch('[a-f0-9]{64}', key) for key in manifest['chunks'])
    report.update(fixtureSha256=sha(fixture_bytes), manifestSha256=sha(manifest_bytes),
                  uniqueChunks=len(set(manifest['chunks'])), rawBytes=manifest['image_len'])
    (out / 'fixture.json').write_bytes(fixture_bytes)
    (out / 'image.json').write_bytes(manifest_bytes)
    target = ROOT / 'releases/rootfs/alpine-rootfs.ext4'
    report['rawPath'] = str(target)
    if target.exists():
        assert not a.require_fresh, 'fresh checkout inherited an ignored rootfs'
        assert target.stat().st_size == fixture['raw_image_bytes']
        report.update(mode='verify-existing-pinned-base', rawSha256=file_sha(target))
    else:
        report['mode'] = 'fresh-public-content-addressed-reconstruction'
        target.parent.mkdir(parents=True, exist_ok=True)
        chunks = out / 'chunks'
        chunks.mkdir()
        zero = bytes(manifest['chunk_size'])
        zero_sha = sha(zero)

        def fetch(key):
            if key == zero_sha:
                return {'sha256': key, 'bytes': len(zero), 'source': 'authenticated-zero-sparse-hole'}
            url = fixture['base_url'] + 'chunks/' + key + '.bin'
            attempts = []
            for number in range(1, 4):
                try:
                    partial_chunk = chunks / (key + '.attempt' + str(number) + '.bin')
                    # --disable is first: never inherit ~/.curlrc, auth, cookies or custom TLS policy.
                    result = subprocess.run(['curl', '--disable', '--proto', '=https', '--silent', '--show-error',
                                             '--fail', '--max-time', '45', '--max-filesize', str(manifest['chunk_size']),
                                             '--output', str(partial_chunk), '--write-out', '%{http_code}', url],
                                            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=50)
                    assert result.returncode == 0 and result.stdout == '200', \
                        f'HTTP status={result.stdout}, exit={result.returncode}, error={result.stderr[:4096]}'
                    body = partial_chunk.read_bytes()
                    assert len(body) == manifest['chunk_size'] and sha(body) == key, 'chunk length/digest'
                    partial_chunk.rename(chunks / (key + '.bin'))
                    return {'sha256': key, 'bytes': len(body), 'url': url, 'attempts': attempts + [{'attempt': number, 'status': 200}]}
                except Exception as error:
                    attempts.append({'attempt': number, 'error': repr(error)})
            raise RuntimeError({'chunk': key, 'attempts': attempts})

        write()
        with ThreadPoolExecutor(max_workers=4) as pool:
            for row in pool.map(fetch, sorted(set(manifest['chunks']))):
                report['chunks'].append(row)
                write()
        partial = target.with_suffix('.e9-partial')
        with partial.open('xb') as stream:
            stream.truncate(manifest['image_len'])
            for index, key in enumerate(manifest['chunks']):
                if key == zero_sha:
                    continue
                body = (chunks / (key + '.bin')).read_bytes()
                assert sha(body) == key
                stream.seek(index * manifest['chunk_size'])
                assert stream.write(body) == len(body)
        report['rawSha256'] = file_sha(partial)
        assert report['rawSha256'] == fixture['raw_image_sha256'], 'complete reconstructed base differs'
        assert not target.exists(), 'rootfs appeared during independent reconstruction'
        partial.rename(target)
    assert report['rawSha256'] == fixture['raw_image_sha256']
    report['status'] = 'passed'
except BaseException as error:
    report['status'] = 'failed'
    report['failure'] = repr(error)
    raise
finally:
    report['finished'] = time.time()
    write()

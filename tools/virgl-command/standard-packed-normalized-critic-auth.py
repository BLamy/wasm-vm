#!/usr/bin/env python3
"""Fresh D35 critic: authenticate complete custody and derive fields from primary Mesa."""
import argparse
import hashlib
import json
import re
import subprocess
import tarfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
BASE = 'b57c3ae04e0bd306e6bb5877ff94c5d8f4d6df06'
RECORDED = 'b6434e33c9e5399f48fc191656e02f318cd78075'
SUBMISSION = '1398a86992e0575a29c56a9a93bd5e9d11d80e11'
RUNTIME = '2acc572aaea2368f1c2f2aad0def5c2d08ecc2d8'
WORKER = 'evidence/virgl-standard-packed-normalized-images/worker'
IDS = [5, 6, 7, 8, 122, 131, 135, 308, 319, 320, 321, 407, 409]
PIN = {
    'recording.tar.gz': 'c8e12f7832dfbfc94b5cab8a7d196e56409544e3a218eb493d919babcf9e07dc',
    'records.json': '784a390eea7213a797b0881ef8911847771429a1f9fe27b2a8249dca73bedbfd',
    'manifest.json': '3f099fb484d1529e1848d6f2ee80587cdd100d38412fda58de1f9221b454960e',
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def file_digest(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def git(*arguments):
    return subprocess.check_output(['git', *arguments], cwd=ROOT)


def git_digest(head, name):
    process = subprocess.Popen(['git', 'show', head + ':' + name], cwd=ROOT, stdout=subprocess.PIPE)
    h = hashlib.sha256()
    for block in iter(lambda: process.stdout.read(1024 * 1024), b''):
        h.update(block)
    require(process.wait() == 0, 'missing committed dependency ' + name)
    return h.hexdigest()


def authenticate(folder, expected_head, destination=None):
    files = {}
    for name in ('manifest.json', 'records.json', 'recording.tar.gz'):
        files[name] = file_digest(ROOT / folder / name)
        require(files[name] == git_digest(expected_head, folder + '/' + name), 'seal differs from commit ' + folder + '/' + name)
        if folder == WORKER:
            require(files[name] == PIN[name], 'worker submitted pin differs: ' + name)
    manifest = json.loads((ROOT / folder / 'manifest.json').read_text())
    index = json.loads((ROOT / folder / 'records.json').read_text())
    require(files['recording.tar.gz'] == manifest['archiveSha256'], 'archive manifest pin ' + folder)
    require(files['records.json'] == manifest['recordIndexSha256'], 'index manifest pin ' + folder)
    require((ROOT / folder / 'recording.tar.gz').stat().st_size == manifest['archiveBytes'], 'archive bytes ' + folder)
    members = {row['path']: row for row in index['records']}
    require(len(members) == len(index['records']) == manifest['records'] == manifest['reopenedMembers'], 'index duplicates/count ' + folder)
    seen, byte_count = set(), 0
    with tarfile.open(ROOT / folder / 'recording.tar.gz', mode='r|gz') as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            require(member.isfile() and not path.is_absolute() and '..' not in path.parts, 'unsafe/nonregular member ' + member.name)
            require(member.name in members and member.name not in seen, 'missing/duplicate member ' + member.name)
            raw = archive.extractfile(member).read()
            saved = members[member.name]
            require(len(raw) == saved['bytes'] and digest(raw) == saved['sha256'], 'member differs ' + folder + '/' + member.name)
            seen.add(member.name)
            byte_count += len(raw)
            if destination:
                target = destination.joinpath(*path.parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(raw)
    require(seen == set(members), 'unopened member ' + folder)
    result = dict(folder=folder, committedAt=expected_head, members=len(seen), uncompressedBytes=byte_count,
                  digests=files, sourceHead=index.get('sourceHead', index.get('runtimeSourceHead', index.get('runtimeHead'))))
    print(json.dumps(dict(folder=folder, members=len(seen), status='authenticated')), flush=True)
    return result


def primary(output, archive_path):
    archive_hash = file_digest(archive_path)
    require(archive_hash == 'eeb29ca7e56cfaa8e8a79538dcf834e3b18e501c31bef5145e959ea437cc4216', 'primary Mesa archive pin')
    wanted = ('src/util/format/u_format.yaml', 'src/mesa/state_tracker/st_extensions.c', 'src/mesa/main/version.c')
    contents = {}
    with tarfile.open(archive_path, 'r:xz') as archive:
        for member in archive:
            for name in wanted:
                if member.name.endswith('/' + name):
                    require(name not in contents and member.isfile(), 'primary source duplicate')
                    contents[name] = archive.extractfile(member).read()
            if len(contents) == len(wanted):
                break
    pins = json.loads((ROOT / 'evidence/virgl-production-readiness/standard-packed-normalized-primary-pins.json').read_text())
    for row in pins['sources']:
        require(digest(contents[row['path']]) == row['sha256'] and len(contents[row['path']]) == row['bytes'], 'primary source digest ' + row['path'])
    header = (ROOT / 'renderer/virgl-shader/vendor/src/virgl_hw.h').read_bytes()
    table = json.loads((ROOT / 'tools/virgl-command/standard-packed-normalized-formats.json').read_text())
    require(table['originalHeaderSha256'] == digest(header), 'original enum pin')
    require(table['sourceArchiveSha256'] == archive_hash, 'table primary archive')
    require([row['originalFormat'] for row in table['records']] == IDS, 'format family identity/order')
    text = contents[wanted[0]].decode()
    formats, excerpts = [], []
    for row in table['records']:
        name, fmt = row['originalName'], row['originalFormat']
        require(re.search(r'\bVIRGL_FORMAT_' + re.escape(name) + r'\s*=\s*' + str(fmt) + r'\b', header.decode()), 'literal enum ' + name)
        match = re.search(r'^- name: ' + re.escape(name) + r'\n(?:(?!^- name:).)*', text, re.M | re.S)
        require(match is not None, 'primary Mesa format ' + name)
        block = match.group(0)
        lines = block.splitlines()
        excerpt = '\n'.join(lines[:6]) + '\n'
        require(lines[1:4] == ['  layout: plain', '  colorspace: RGB', '  block: {width: 1, height: 1, depth: 1}'], 'original block layout ' + name)
        channels = re.search(r'^  channels: \[(.*?)\]$', block, re.M)[1].split(', ')
        swizzles = re.search(r'^  swizzles: \[(.*?)\]$', block, re.M)[1].split(', ')
        require(channels == row['channels'] and swizzles == [str(x) for x in row['swizzles']], 'original channels/swizzles ' + name)
        offsets, widths, cursor = [], [], 0
        for channel in channels:
            require(re.fullmatch(r'(?:UN|X)\d+', channel), 'UNORM/X channel ' + name)
            width = int(re.search(r'\d+', channel)[0])
            offsets.append(cursor)
            widths.append(width)
            cursor += width
        fields = []
        for lane, swizzle in enumerate(swizzles):
            if swizzle == '1':
                require(lane == 3, 'only alpha is implicit ' + name)
                field = dict(bits=widths[3] if len(widths) == 4 else 0,
                             offset=offsets[3] if len(widths) == 4 else 0, implicit=True)
                if field['bits']:
                    require(channels[3].startswith('X'), 'ignored original channel ' + name)
                    field['ignored'] = True
            else:
                channel = 'XYZW'.index(swizzle)
                require(channels[channel].startswith('UN'), 'defined unsigned normalized channel ' + name)
                field = dict(bits=widths[channel], offset=offsets[channel], ignored=False)
            fields.append(field)
        require(fields == row['rgbaFields'], 'independently derived original fields ' + name)
        bits = [field['bits'] for field in fields]
        if bits[:3] == [5, 6, 5]:
            internal, upload, dtype, native_offsets = 'RGB565', 'RGB', 'UNSIGNED_SHORT_5_6_5', [11, 5, 0, 0]
        elif bits[:3] == [4, 4, 4]:
            internal, upload, dtype, native_offsets = 'RGBA4', 'RGBA', 'UNSIGNED_SHORT_4_4_4_4', [12, 8, 4, 0]
        elif bits[:3] == [5, 5, 5]:
            internal, upload, dtype, native_offsets = 'RGB5_A1', 'RGBA', 'UNSIGNED_SHORT_5_5_5_1', [11, 6, 1, 0]
        else:
            require(bits == [10, 10, 10, 2], '1010102 original field widths')
            internal, upload, dtype, native_offsets = 'RGB10_A2', 'RGBA', 'UNSIGNED_INT_2_10_10_10_REV', [0, 10, 20, 30]
        independently = dict(originalFormat=fmt, originalName=name, rgbaFields=fields, guestPixelBytes=cursor // 8,
                             plannedNativePixelBytes=cursor // 8, plannedNativeInternal=internal, plannedUploadFormat=upload,
                             plannedUploadType=dtype, nativeOffsets=native_offsets, implicitAlpha=swizzles[3] == '1',
                             readPixelBytes=4, plannedReadType='UNSIGNED_BYTE' if cursor == 16 else 'UNSIGNED_INT_2_10_10_10_REV',
                             plannedReadFormat='RGBA', channels=channels, swizzles=swizzles,
                             primaryLine=text[:match.start()].count('\n') + 1)
        require(all(row[key] == value for key, value in independently.items() if key != 'primaryLine'), 'derived native descriptor ' + name)
        formats.append(independently)
        excerpts.append(excerpt)
    excerpt_bytes = ''.join(excerpts).encode()
    require(excerpt_bytes == (ROOT / 'tools/virgl-command/standard-packed-normalized-mesa-formats.yaml').read_bytes(), 'verbatim excerpt independent full-source extraction')
    require(table['mesaExcerptSha256'] == digest(excerpt_bytes), 'excerpt table digest')
    extension = contents[wanted[1]].decode().splitlines()
    points = [dict(line=i + 1, text=line) for i, line in enumerate(extension) if 'texture_type_2_10_10_10_REV' in line or 'PIPE_FORMAT_R10G10B10A2_UNORM' in line or 'PIPE_FORMAT_B10G10R10A2_UNORM' in line]
    result = dict(schema='d35-primary-derived-fields-v1', status='passed', archiveSha256=archive_hash,
                  sourceDigests={name: digest(raw) for name, raw in contents.items()}, headerSha256=digest(header),
                  excerptSha256=digest(excerpt_bytes), records=formats, extensionPoints=points,
                  nativeFormatSource='https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf tables3.2/3.7/3.8, printed pages111/118/119')
    (output / 'primary-derived.json').write_text(json.dumps(result, indent=2) + '\n')
    # Preserve the bounded primary sections, not the whole upstream archive.
    (output / 'primary-mesa-excerpt.yaml').write_bytes(excerpt_bytes)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--mesa', type=Path, default=Path('/tmp/wasmvm-production-api-plan/mesa-26.2.2.tar.xz'))
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    require(git('rev-parse', 'HEAD').decode().strip() == SUBMISSION, 'exclusive review submission head')
    require((ROOT / 'evidence/virgl-standard-packed-normalized-images/verifier/predictions.json').is_file(), 'predictions first')
    worker = authenticate(WORKER, SUBMISSION, output / 'worker-reopened')
    predecessors = [authenticate('evidence/' + family + '/' + role, BASE)
                    for family in ('virgl-standard-integer-images', 'virgl-multiple-color') for role in ('worker', 'verifier')]
    require(worker['members'] == 28896 and sum(row['members'] for row in predecessors) == 223159, 'complete submitted member totals')
    for name in ('resources.mjs', 'packed-normalized-images.mjs'):
        file = 'renderer/virgl-command/' + name
        raw = (ROOT / file).read_bytes()
        require(all(raw == git('show', head + ':' + file) for head in (RUNTIME, RECORDED, SUBMISSION)), 'runtime freeze/current/recorded equality ' + file)
    primaries = primary(output, args.mesa)
    result = dict(schema='d35-fresh-critic-custody-v1', status='passed', worker=worker, predecessors=predecessors,
                  predecessorReopenedMembers=sum(row['members'] for row in predecessors), sourceHead=SUBMISSION,
                  recordedHead=RECORDED, runtimeHead=RUNTIME, primaryDerivedSha256=file_digest(output / 'primary-derived.json'))
    (output / 'custody.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(dict(status='passed', workerMembers=worker['members'], predecessorMembers=result['predecessorReopenedMembers'], originalPrimaryFormats=len(primaries['records']))), flush=True)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Fresh D31 critic: raw original enum/Mesa words, full native planes, and custody.

This proof imports neither product conversion code nor the worker's format/value oracle.
The original enum and Mesa channel descriptors determine the signed lane interpretation.
"""
import argparse
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import struct
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
BASE = '131f7ec39a56b747e4107f9b2e5077e8215434f0'
FROZEN = 'ba735c389ca9db84de76f5ee042035edbccf0a99'
SUBMISSION = '1b909d203dad37d384e7a2f8439dadd0b82c308a'
ARCHIVE = 'ee9d19ac6f0fbbce842fb0c416731e6770a61e05bf77c84d6a6840fb2cc21fb2'
INDEX = '98e2767f99f9d7c1acb8bf1dfa8cab36a1d009517c99d171dad994653d4f3da5'
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def need(value, point):
    if not value:
        raise AssertionError(point)


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def descriptors():
    header = (ROOT/'renderer/virgl-shader/vendor/src/virgl_hw.h').read_bytes()
    mesa = (ROOT/'tools/virgl-command/standard-float-image-mesa-formats.yaml').read_bytes()
    need(sha(header) == '191ca5cea527949a29e9753b1e31d550f2fed922895d78dabc5c5c3585aa2ff7', 'original enum pin')
    need(sha(mesa) == 'f0fef33544456468def10d5dffc72a61e8b0e7acc599b700fc65366e6f495a10', 'original Mesa pin')
    blocks = {m[1]: m[2] for m in re.finditer(r'^- name: (\S+)\n(.*?)(?=^- name: |\Z)', mesa.decode(), re.M | re.S)}
    formats = {}
    for m in re.finditer(r'VIRGL_FORMAT_(R(?:8|16|32)(?:G(?:8|16|32))?(?:B(?:8|16|32))?(?:A(?:8|16|32))?_(?:UINT|SINT))\s*=\s*(\d+)', header.decode()):
        name, ident = m[1], int(m[2])
        if not 177 <= ident <= 200:
            continue
        lanes = re.findall(r'([RGBA])(8|16|32)', name)
        channels = re.search(r'channels: \[(.*?)\]', blocks[name])[1].split(', ')
        signed = name.endswith('_SINT')
        bits, count = int(lanes[0][1]), len(lanes)
        need(channels == [('SP' if signed else 'UP')+str(bits)]*count, 'Mesa integer channels '+name)
        need([x[0] for x in lanes] == list('RGBA'[:count]) and all(int(x[1]) == bits for x in lanes), 'original lanes '+name)
        need(re.search(r'block: \{width: 1, height: 1, depth: 1\}', blocks[name]), 'original uncompressed texel '+name)
        native = 4 if count == 3 else count
        formats[ident] = dict(name=name, bits=bits, signed=signed, count=count, size=bits//8,
                              pixel=count*bits//8, native=native*bits//8,
                              internal=['R','RG','RGB','RGBA'][native-1]+str(bits)+('I' if signed else 'UI'),
                              upload=['RED_INTEGER','RG_INTEGER','RGB_INTEGER','RGBA_INTEGER'][native-1],
                              type=({8:'BYTE',16:'SHORT',32:'INT'} if signed else {8:'UNSIGNED_BYTE',16:'UNSIGNED_SHORT',32:'UNSIGNED_INT'})[bits])
    need(set(formats) == set(range(177, 201)), '24 literal original integer enums')
    return formats


FORMATS = descriptors()


def native_words(fmt, original):
    f = FORMATS[fmt]
    need(len(original) % f['pixel'] == 0, 'whole original texels')
    words = []
    for texel in range(len(original)//f['pixel']):
        values = [int.from_bytes(original[texel*f['pixel']+lane*f['size']:texel*f['pixel']+(lane+1)*f['size']], 'little', signed=f['signed']) for lane in range(f['count'])]
        words.extend(values + [1 if lane == 3 else 0 for lane in range(f['count'], 4)])
    return struct.pack('<'+('i' if f['signed'] else 'I')*len(words), *words)


def expanded_upload(fmt, original):
    f = FORMATS[fmt]
    if f['count'] != 3:
        return original
    return b''.join(original[at:at+f['pixel']] + (1).to_bytes(f['size'], 'little') for at in range(0, len(original), f['pixel']))


def declared_source(fmt, width, height, last, seed):
    """Regenerate the reviewed input declaration without using observed GPU values."""
    f = FORMATS[fmt]
    maximum, middle = (1 << f['bits'])-1, 1 << (f['bits']-1)
    edge = (0, 1, maximum, middle, middle-1, middle+1, maximum-1, 17, 63)
    planes, offset, state = [], 5, seed & 0xffffffff
    for level in range(last+1):
        original = bytearray()
        for texel in range(width*height):
            for lane in range(f['count']):
                if texel < len(edge):
                    value = edge[(texel+lane+level) % len(edge)]
                else:
                    state = (state ^ (state << 13)) & 0xffffffff
                    state ^= state >> 17
                    state = (state ^ (state << 5)) & 0xffffffff
                    value = state & maximum
                original += value.to_bytes(f['size'], 'little')
        stride = width*f['pixel']+7
        planes.append(dict(level=level, width=width, height=height, stride=stride, offset=offset, raw=bytes(original)))
        offset += (height-1)*stride+width*f['pixel']+11
        width, height = max(1, width//2), max(1, height//2)
    backing = bytearray([0xa7]*(offset+9))
    for plane in planes:
        row = plane['width']*f['pixel']
        for y in range(plane['height']):
            start = plane['offset']+y*plane['stride']
            backing[start:start+row] = plane['raw'][y*row:(y+1)*row]
    return planes, bytes(backing)


def reopen(capture):
    worker = ROOT/'evidence/virgl-standard-integer-images/worker'
    index = (worker/'records.json').read_bytes()
    archive = (worker/'recording.tar.gz').read_bytes()
    need(sha(index) == INDEX and sha(archive) == ARCHIVE, 'exact worker packet pins')
    document = json.loads(index)
    expected = {row['path']: row for row in document['records']}
    need(len(expected) == len(document['records']) == 48653 and document['sourceHead'] == FROZEN, 'exact member/source identity')
    seen, total = set(), 0
    with tarfile.open(worker/'recording.tar.gz', 'r:gz') as tar:
        for member in tar:
            path = PurePosixPath(member.name)
            need(member.isfile() and not path.is_absolute() and '..' not in path.parts and member.name not in seen and member.name in expected, 'regular unique indexed member '+member.name)
            raw = tar.extractfile(member).read()
            row = expected[member.name]
            need(len(raw) == row['bytes'] and sha(raw) == row['sha256'], 'reopened member '+member.name)
            destination = capture/'worker'/member.name
            destination.parent.mkdir(parents=True, exist_ok=True)
            # This critic-owned extraction only contains authenticated regular members.
            destination.write_bytes(raw)
            seen.add(member.name)
            total += len(raw)
    need(seen == expected.keys(), 'every archive/index member reopened')
    return dict(status='passed', reopenedMembers=len(seen), unpackedBytes=total, archiveSha256=sha(archive), indexSha256=sha(index), frozenHead=FROZEN)


def closure(capture, fetch_specs):
    root = capture/'worker'
    receipts = [json.loads((root/p/'receipt.json').read_bytes()) for p in ['hot','cold']]
    citations = []
    for prefix, receipt in zip(['hot','cold'], receipts):
        need(receipt['status'] == 'passed' and receipt['gitHead'] == FROZEN and receipt['historicalEvidenceHead'] == BASE, prefix+' frozen receipt')
        for path, digest in receipt['sources'].items():
            raw = git('show', FROZEN+':'+path)
            need(sha(raw) == digest, prefix+' frozen source '+path)
            if not path.startswith('evidence/'):
                need((root/'source'/path).read_bytes() == raw, 'sealed full source closure '+path)
        for path, digest in receipt['generated'].items():
            need(sha((root/(prefix+'-generated')/path).read_bytes()) == digest, 'actual compiler artifacts '+prefix+'/'+path)
        need(receipt['generated'] == {
            'renderer/virgl-shader/build/wasm/virgl-shader.mjs':'509aaeb879c95b90acd26de08a310b23991779cf3564f174bbc1702c9b68a021',
            'renderer/virgl-shader/build/wasm/virgl-shader.wasm':'41d5c79624d7799cb9339b3fb754bfb4b744ee959b70d8cc2daedfb0a1fb4ac8'}, 'unchanged real generated compiler')
        need(len(receipt['carriedVerifiedEvidence']) == 30, 'ten complete predecessor seals')
        for path, digest in receipt['carriedVerifiedEvidence'].items():
            raw = (ROOT/path).read_bytes()
            need(sha(raw) == digest and raw == git('show', BASE+':'+path), 'unchanged HELD predecessor seal '+path)
        for path, digest in receipt['carriedUnchangedBoundaries'].items():
            need(sha((ROOT/path).read_bytes()) == digest and git('show', BASE+':'+path) == (ROOT/path).read_bytes(), 'unchanged HELD runtime boundary '+path)
        for path, digest in receipt['files'].items():
            need(sha((root/prefix/path).read_bytes()) == digest, 'receipt full record '+prefix+'/'+path)
        citations.append(dict(path=prefix+'/receipt.json', sha256=sha((root/prefix/'receipt.json').read_bytes()), sourceMembers=len(receipt['sources']), recordMembers=len(receipt['files'])))
    cold = json.loads((root/'cold/report.json').read_bytes())
    need(cold['status'] == 'passed' and cold['exitCode'] == 0 and cold['gitHead'] == cold['cloneHead'] == FROZEN and not cold['statusBefore'] and not cold['statusAfter'] and cold['command'] == ['make','verify-E6-T11d31'], 'one pristine final exact-head acceptance')
    need(cold['receiptSha256'] == sha((root/'cold/receipt.json').read_bytes()) and cold['logSha256'] == sha((root/'cold/cold.log').read_bytes()), 'complete cold command custody')
    # The scrubber removes every present named override; an absent override is already scrubbed.
    need('RUST_LOG' in cold['removedEnvironmentNames'], 'cold log override scrubbed')
    serving = json.loads((ROOT/'tools/virgl-command/standard-integer-image-serving-boundary.json').read_bytes())
    need(len(serving['changes']) == 27 and serving['predecessor'] == BASE, '27 serving declaration changes')
    for row in serving['changes']:
        text = (ROOT/row['path']).read_text()
        need(text.count(row['after']) == 1 and text.replace(row['after'],row['before'],1).encode() == git('show',BASE+':'+row['path']), 'unchanged historical server algorithm '+row['path'])
    specmap = json.loads((ROOT/'tools/virgl-command/standard-integer-image-formats.json').read_bytes())['normativeSource']
    spec_pins = []
    for name, row in specmap['records'].items():
        raw = (root/'source'/row['path']).read_bytes()
        need(sha(raw) == row['sha256'], 'primary reference bytes '+name)
        if fetch_specs:
            fetched = urllib.request.urlopen(row['url'], timeout=30).read()
            need(fetched == raw, 'exact Khronos primary commit '+name)
        spec_pins.append(dict(name=name, **row, upstreamReopened=fetch_specs))
    need(git('diff','--name-only',BASE,FROZEN,'--','crates','web','renderer/virgl-shader','tools/guest') == b'', 'no production/compiler/guest changes')
    for path in ['renderer/virgl-command/resources.mjs','renderer/virgl-command/integer-images.mjs']:
        need((ROOT/path).read_bytes() == git('show', FROZEN+':'+path), 'unchanged runtime during critic '+path)
    return dict(status='passed', receipts=citations, carriedSeals=10, carriedBoundaries=len(receipts[0]['carriedUnchangedBoundaries']), servingAlgorithms=27, specs=spec_pins, coldCloneCarried=True)


def audit_wire(path):
    envelope = json.loads(path.read_bytes())
    need(envelope['status'] == 'passed', str(path)+' wire status')
    wire = envelope['wire']
    counts = Counter(row['kind'] for row in wire['records'])
    need(counts['old-owner'] == 1296 and counts['old-layout'] == 1152, 'all historical integer gates remain closed')
    for index, row in enumerate(wire['records']):
        result = row['result']
        point = str(path)+':records/'+str(index)
        if row['kind'] == 'layout':
            m, fields, layout = row['metadata'], row['fields'], result['layout']
            f = FORMATS[m['format']]
            area = fields['box']['width']*fields['box']['height']
            read = fields['direction'] == 2
            need(result['ok'] and layout['tightBytes'] == area*f['pixel'] and layout['scratchBytes'] == area*(16 if read else f['native']) and layout['stagingBytes'] == (area*16 if read else 0), point+' original/native/read charges')
        elif row['kind'] in ('allocation-bound','transfer-bound'):
            short = result['ok'] is False
            if row['kind'] == 'allocation-bound':
                need(row['allocations'] == (0 if short else 1), point+' preflight allocation refusal')
                m, f = row['metadata'], FORMATS[row['metadata']['format']]
                sizes = [(max(1,m['width']//(2**l)),max(1,m['height']//(2**l))) for l in range(m['lastLevel']+1)]
                physical = sum(w*h*f['native'] for w,h in sizes)
                bound = row['limits'].get('gpuBytes',row['limits'].get('resourceBytes'))
                need(result['ok'] == (physical <= bound), point+' exact physical mip bound')
        elif row['kind'] == 'default-scratch-bound':
            need(result['ok'] == (row['metadata']['height'] == 32), point+' exact 8MiB integer read bound')
        else:
            need(not result['ok'], point+' malformed/old owner refuses')
            if 'calls' in row:
                need(row['calls'] == 0, point+' accessor never invoked')
    need(all(row['held'] for row in wire['predictions']), 'wire reviewed direct assertions')
    return dict(path=str(path), sha256=sha(path.read_bytes()), counts=dict(counts), status='passed')


def audit_native(path, checks):
    report_bytes = path.read_bytes()
    report_digest = sha(report_bytes)
    envelope = json.loads(report_bytes)
    fault = envelope.get('fault')
    expected_status = 'failed' if fault else 'passed'
    need(envelope['status'] == expected_status and envelope['browserErrors'] == dict(console=[],page=[],requests=[]), str(path)+' native/bounded-control status')
    need(not envelope['browser']['headless'] and not any(re.search('headless|swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu',a,re.I) for a in envelope['browser']['commandLine']), str(path)+' actual headed native GPU')
    report = envelope.get('partial') if fault else envelope['browserResult']['result']
    need('M4' in report['gpu'] and 'Metal' in report['gpu'] and not any(report[k] for k in ('guestExecution','productionNegotiation','productionDrawAuthority')), str(path)+' native-only authority')
    blobs = {b['key']: b for b in report['blobs']}
    need(len(blobs) == len(report['blobs']), 'unique original/native blobs')
    def blob(row):
        item = blobs[row['key']]
        compressed = (path.parent/item['path']).read_bytes()
        raw = gzip.decompress(compressed)
        need(sha(compressed) == item['gzipSha256'] and sha(raw) == item['sha256'] and len(raw) == item['bytes'], str(path)+' blob '+item['key'])
        return raw
    for b in report['blobs']:
        blob(b)
    totals = dict(runs=0,nativeComponents=0,publicBytes=0,paddingBytes=0,physicalCompletionPoints=0,wrongPixelControls=0)
    def equal(actual, expected, run, point, native=False):
        if native:
            totals['nativeComponents'] += len(expected)//4
        held = actual == expected
        checks.append(dict(file=str(path), reportSha256=report_digest, run=run, point=point,
                           observedSha256=sha(actual), expectedSha256=sha(expected), bytes=len(actual), held=held))
        return held
    for index, run in enumerate(report['runs']):
        totals['runs'] += 1
        point = str(path)+':runs/'+str(index)
        f, fmt = FORMATS[run['metadata']['format']], run['metadata']['format']
        events = run['events']
        def completed(fence):
            need(fence in events and fence['name'] == 'clientWaitSync' and fence['actual'] in (37146,37148) and fence['delivered'] in (37146,37148), point+' physically completed '+str(fence))
            made = [e for e in events if e['name'] == 'fenceSync' and e['sync'] == fence['sync']]
            need(len(made) == 1 and made[0]['turn'] < fence['turn'], point+' same actual sync and later-task completion')
            totals['physicalCompletionPoints'] += 1
        need(all(value == 0 for value in run['final']['budgets'].values()) and all(obj['deleted'] == 1 for obj in run['nativeObjects']), point+' terminal native ownership')
        for made in [e for e in events if e['name'] == 'fenceSync']:
            need(sum(e['name'] == 'deleteSync' and e['sync'] == made['sync'] for e in events) == 1, point+' every sync retires exactly once')
        kind = run.get('kind','matrix')
        if kind == 'matrix':
            m = run['metadata']
            planes, backing = declared_source(fmt,m['width'],m['height'],m['lastLevel'],run['seed'])
            need(len(run['planes']) == len(planes), point+' every original mip declaration')
            need(equal(blob(run['backing']),backing,index,'backing/input'), point+' full declared SG')
            expected = [p['raw'] for p in planes]
            for p, saved in zip(planes,run['planes']):
                need(all(saved[key] == p[key] for key in ('level','width','height','stride','offset')) and equal(blob(saved['input']),p['raw'],index,'planes/'+str(p['level'])+'/input'), point+' pre-GPU input declarations')
            completed(run['uploadFence'])
            need(run['initializationState']['before'] == run['initializationState']['after'], point+' original initialization caller state')
            if f['count'] == 3:
                completed(run['initialFence'])
                need(equal(blob(run['initialNative']),native_words(fmt,bytes(len(expected[0]))),index,'initialNative',True), point+' actual RGB typed integer alpha1')
            wrong = []
            for p, saved in zip(planes,run['planes']):
                if 'observed' in saved:
                    if not equal(blob(saved['observed']['native']),native_words(fmt,p['raw']),index,'planes/'+str(p['level'])+'/observed/native',True):
                        wrong.append('upload')
                elif not fault:
                    need(False, point+' missing native mip')
            if wrong:
                need(fault == 'upload-lane', point+' unrequested physical wrong pixels')
                totals['wrongPixelControls'] += 1
                continue
            for patch in run['patches']:
                prepared, _ = declared_source(fmt,patch['width'],patch['height'],0,run['seed'] ^ 0x987612)
                raw = blob(patch['input'])
                need(equal(raw,prepared[0]['raw'],index,'patch/input'), point+' independent original subrect declaration')
                p = planes[patch['level']]
                changed = bytearray(expected[p['level']])
                count = patch['width']*f['pixel']
                for y in range(patch['height']):
                    at = ((patch['y']+y)*p['width']+patch['x'])*f['pixel']
                    changed[at:at+count] = raw[y*count:(y+1)*count]
                expected[p['level']] = bytes(changed)
                completed(patch['fence'])
                need(equal(blob(run['afterPatchNative']),native_words(fmt,expected[0]),index,'afterPatchNative',True), point+' whole native patched/untouched plane')
            clear_cursor = 0
            for view_index, view in enumerate(run['views']):
                completed(view['fence'])
                need(view['callerState']['before'] == view['callerState']['after'], point+' range caller FBO/scissor restoration')
                need(0 < len(view['planes']) <= view['lastLevel']-view['firstLevel']+1 if fault else len(view['planes']) == view['lastLevel']-view['firstLevel']+1, point+' complete retained range or failing partial control')
                if view['firstLevel']:
                    need(view['texture'] != run['planes'][0]['observed']['texture'], point+' nonzero range owns private storage')
                for p in view['planes']:
                    if not equal(blob(p['native']),native_words(fmt,expected[p['original']]),index,'views/'+str(view_index)+'/planes/'+str(p['local']),True):
                        wrong.append('copy')
                if 'refresh' in view:
                    clear = run['clears'][clear_cursor]
                    clear_cursor += 1
                    values = [-3,7,-11,1] if f['signed'] else [17,31,63,1]
                    need(clear['values'] == values and blob(clear['backingBefore']) == backing, point+' GPU clear never supplies CPU pixels/changes backing')
                    completed(clear['fence'])
                    pixel = b''.join((v % (1 << f['bits'])).to_bytes(f['size'],'little') for v in values[:f['count']])
                    p = planes[clear['level']]
                    expected[clear['level']] = pixel*(p['width']*p['height'])
                    completed(view['refresh']['fence'])
                    for p in view['refresh']['planes']:
                        need(equal(blob(p['native']),native_words(fmt,expected[p['original']]),index,'views/'+str(view_index)+'/refresh/'+str(p['local']),True), point+' GPU clear and adjacent whole private planes')
            if wrong:
                need(fault == 'copy-level', point+' unrequested private wrong pixels')
                totals['wrongPixelControls'] += 1
                continue
            need(not fault, point+' physical corruption was not caught by independent unchanged inverse')
            need(not any(r['label'] == 'original-integer-range-copy' for r in run['readbacks']), point+' GPU copy has no CPU pixel download')
            for event in run['nativeEvents']:
                if event['name'] == 'blitFramebuffer':
                    need(event['args'][-1] == 9728 and event['args'][-2] == 16384, point+' integer color NEAREST GPU blit')
                if event['name'] == 'bufferData' and event['args'][0] == 35051:
                    count = event['args'][1]
                    need(event['budgets']['scratchBytes'] >= count and event['budgets']['gpuBytes'] >= count, point+' precharged actual 16-byte PBO scratch/staging')
            uploads = [u for u in run['uploads'] if u['label'].startswith('original-integer-upload-')]
            need(len(uploads) == len(planes), point+' native upload of every original mip')
            for upload in uploads:
                level = int(upload['label'].rsplit('-',1)[1])
                need(equal(blob(upload['bytes']),expanded_upload(fmt,planes[level]['raw']),index,'uploads/'+str(level)), point+' exact actual typed native upload representation')
                need(upload['args'][6] == report['nativeEnums'][f['upload']] and upload['args'][7] == report['nativeEnums'][f['type']], point+' matching native integer format/type')
            final, staging = bytearray(backing), bytearray([0x2e]*len(backing))
            need(blob(run['stagingBacking']) == bytes(staging) and len(run['transfers']) == len(planes), point+' original SG output declaration')
            for p, transfer in zip(planes,run['transfers']):
                raw, level = expected[p['level']], p['level']
                need(equal(blob(transfer['sync']),raw,index,'transfers/'+str(level)+'/sync'), point+' original public sync bytes')
                totals['publicBytes'] += len(raw)
                need(len(transfer['reads']) == 2, point+' both attached/staging original PBO outputs')
                for read in transfer['reads']:
                    completed(read['fence'])
                    need(equal(blob(read['nativeBytes']),raw,index,'transfers/'+str(level)+'/PBO/'+str(read['opcode'])), point+' exact compact public PBO output')
                    totals['publicBytes'] += len(raw)
                # Audit actual full 16-byte native sync and PBO planes BEFORE product narrowing.
                native_reads = [r for r in run['readbacks'] if r['label'] in ('original-integer-sync-read-'+str(level),'original-integer-staged-43-'+str(level),'original-integer-staged-45-'+str(level))]
                need(len(native_reads) == 5, point+' one sync, two issue and two native PBO collect records')
                for read in native_reads:
                    if read['bytes']:
                        need(equal(blob(read['bytes']),native_words(fmt,raw),index,'readbacks/'+read['label'],True), point+' full native read plane before narrowing')
                    if read['name'] == 'readPixels':
                        need(read['args'][4] == 36249 and read['args'][5] == (5124 if f['signed'] else 5125), point+' guaranteed RGBA_INTEGER/INT-or-UI read')
                count = p['width']*f['pixel']
                for y in range(p['height']):
                    at = p['offset']+y*p['stride']
                    final[at:at+count] = staging[at:at+count] = raw[y*count:(y+1)*count]
            need(equal(blob(run['finalBacking']),bytes(final),index,'finalBacking') and equal(blob(run['finalStagingBacking']),bytes(staging),index,'finalStagingBacking'), point+' complete original/output SG, every untouched byte')
            totals['paddingBytes'] += 2*(len(backing)-sum(len(p['raw']) for p in planes))
        elif kind == 'generation-context-held-range':
            m = run['metadata']
            planes, backing = declared_source(fmt,m['width'],m['height'],m['lastLevel'],report['seed'] ^ fmt)
            need(blob(run['backing']) == backing and len(run['heldPlanes']) == 3, point+' original held SG and complete private range')
            for fence in ['uploadFence','copyFence']:
                completed(run[fence])
            completed(run['discarded']['fence'])
            need(run['sourceGeneration'] == run['privateGeneration'] != run['replacementGeneration'] and len({run['sourceTexture'],run['privateTexture'],run['replacementTexture']}) == 3, point+' exact retained/native generation identities')
            for p in run['heldPlanes']:
                need(equal(blob(p['native']),native_words(fmt,planes[p['original']]['raw']),index,'heldPlanes/'+str(p['local']),True), point+' whole old private planes after source/context reuse')
        elif kind == 'queued-complete':
            completed(run['uploadFence']); completed(run['fence'])
            planes, _ = declared_source(fmt,run['metadata']['width'],run['metadata']['height'],0,report['seed'] ^ len('complete'))
            need(blob(run['input']) == planes[0]['raw'] and equal(blob(run['output']),planes[0]['raw'],index,'queued/output'), point+' exact old retained public words')
            totals['publicBytes'] += len(planes[0]['raw'])
        elif kind.startswith('native-error-'):
            need(not run['result']['ok'] and run['result']['error']['code'] == 'backend-error' and run['faultEvents'], point+' actual native error cannot publish success')
        elif kind == 'actual-context-loss':
            need(run['actualLost'] and not run['result']['ok'] and run['result']['error']['code'] == 'backend-error', point+' actual lost context has no authority')
        elif kind.startswith('queued-'):
            need(kind in ['queued-cancel-before-begin','queued-cancel-after-begin','queued-dispose-owner','queued-dispose-backend'], point+' named cancellation schedule')
        else:
            need(False, point+' unknown native behavior')
    if fault:
        need(totals['wrongPixelControls'] > 0 and report['sabotage']['fenceCompleted'] and not report['sabotage']['held'], str(path)+' unchanged oracle sees real completed wrong pixels')
    else:
        need(all(p['held'] for p in report['predictions']), str(path)+' native direct predictions')
        if report.get('mode') == 'matrix':
            keys = {(r['metadata']['format'],r['metadata']['bind'],r['metadata']['width'],r['metadata']['height'],r['metadata']['lastLevel']) for r in report['runs']}
            wanted = {(fmt,bind,w,h,last) for fmt in FORMATS for bind in (8,2,10) for w,h,last in ((17,9,4),(13,7,2),(1,31,4),(29,1,4))}
            need(keys == wanted and len(report['runs']) == 288, str(path)+' complete independent24*3*4 matrix')
        else:
            need(len(report['runs']) == 19 and Counter(r['kind'] for r in report['runs'])['generation-context-held-range'] == 4, str(path)+' complete varied19-case retained/native-failure schedule')
    return dict(path=str(path), sha256=report_digest, status='passed', seed=report['seed'], **totals)


def coverage(directory, carried_directories=()):
    added, name, line = {}, None, 0
    for row in git('diff','--unified=0',BASE,FROZEN,'--','renderer/virgl-command/resources.mjs','renderer/virgl-command/integer-images.mjs').decode().splitlines():
        if row.startswith('+++ b/'):
            name = row[6:]
        elif row.startswith('@@'):
            line = int(re.search(r'\+(\d+)', row)[1])
        elif row.startswith('+') and name:
            added.setdefault(name,[]).append(line); line += 1
        elif row.startswith(' '):
            line += 1
    scripts, records = [], []
    source_pins = {name: sha(git('show',FROZEN+':'+name)) for name in added}
    for name, digest in source_pins.items():
        need(sha((ROOT/name).read_bytes()) == digest, 'unchanged coverage boundary '+name)
    for origin in [directory, *carried_directories]:
        carried = origin != directory
        if carried:
            receipt = json.loads((origin/'receipt.json').read_bytes())
            need(receipt['status'] == 'passed' and receipt['gitHead'] == FROZEN,
                 'incremental carry must be independently authenticated frozen full acceptance')
        paths = sorted(origin.rglob('browser-coverage.json')) + sorted((origin/'node-coverage').glob('coverage-*.json'))
        for path in paths:
            if any(x.startswith(('fault-','fresh-fault-','sabotage-')) for x in path.parts):
                continue
            raw = path.read_bytes()
            point = dict(record=str(path),recordSha256=sha(raw),carried=carried)
            if carried:
                relative = path.relative_to(origin).as_posix()
                need(receipt['files'].get(relative) == sha(raw), 'unchanged HELD nested ranges '+relative)
                point['heldReceiptSha256'] = sha((origin/'receipt.json').read_bytes())
            records.append(point)
            if path.name == 'browser-coverage.json':
                for script in json.loads(raw)['scripts']:
                    if script['source'] in added:
                        need(script['sha256'] == source_pins[script['source']], str(path)+' full native V8 source')
                        scripts.append(dict(**point, **script))
            else:
                for script in json.loads(raw)['result']:
                    name = next((name for name in added if script['url'].endswith('/'+name)),None)
                    if name:
                        scripts.append(dict(**point,source=name,sha256=source_pins[name],coverage=script))
    intervals, hunks = [], []
    for name, lines in added.items():
        source = (ROOT/name).read_text().splitlines(keepends=True)
        offsets = [0]
        for text in source:
            offsets.append(offsets[-1]+len(text.encode('utf-16-le'))//2)
        observed = [s for s in scripts if s['source'] == name]
        for line in lines:
            start, end = offsets[line-1], offsets[line]
            boundaries = {start,end}
            for script in observed:
                for fn in script['coverage']['functions']:
                    for region in fn['ranges']:
                        boundaries.update(x for x in (region['startOffset'],region['endOffset']) if start < x < end)
            points = sorted(boundaries)
            for a,b in zip(points,points[1:]):
                governing = []
                for script in observed:
                    candidates = [(r['endOffset']-r['startOffset'],fn['functionName'],r) for fn in script['coverage']['functions'] for r in fn['ranges'] if r['startOffset'] <= a and b <= r['endOffset']]
                    if candidates:
                        span = min(x[0] for x in candidates)
                        # Every equally smallest governing partition is retained; no parent masks zero.
                        governing.extend(dict(record=script['record'],recordSha256=script['recordSha256'],carried=script['carried'],function=fn,**r) for size,fn,r in candidates if size == span)
                held = any(r['count'] > 0 for r in governing)
                carried_only = held and not any(r['count'] > 0 and not r['carried'] for r in governing)
                text = source[line-1].strip()
                waiver = 'comment/import/declarative syntax; source closure independently authenticated' if not held and (not text or text.startswith(('/**','//','import '))) else None
                intervals.append(dict(source=name,line=line,startOffset=a,endOffset=b,held=held,carriedOnly=carried_only,waiver=waiver,governing=governing))
            hunks.append(dict(source=name,line=line,classification='executed' if all(x['held'] for x in intervals if x['source']==name and x['line']==line) else 'waived' if all(x['held'] or x['waiver'] for x in intervals if x['source']==name and x['line']==line) else 'needs-evidence'))
    zero = [r for r in intervals if not r['held'] and not r['waiver']]
    return dict(status='passed' if not zero else 'needs-evidence', predecessor=BASE,runtimeHead=FROZEN, sourcePins=source_pins,addedLines=added, intervals=intervals,hunks=hunks,zero=zero,scripts=scripts,records=records,positive=sum(r['held'] for r in intervals),carriedOnly=sum(r['carriedOnly'] for r in intervals),fullNestedRangesAreAuthority=True)


def declaration():
    cases = []
    for fmt in (195,199):
        f = FORMATS[fmt]
        planes, offset, width, height = [], 3, 9, 5
        edges = [0x80000000,0xffffffff,0,0x7fffffff,0x80000001,0xdeadbeef,1,0xfffffff0,0x01234567]
        for level in range(4):
            raw = b''.join(((edges[(x+2*y+lane+level)%len(edges)] ^ ((x*y+level)*0x10101)) & 0xffffffff).to_bytes(4,'little') for y in range(height) for x in range(width) for lane in range(3))
            stride = width*12+5
            planes.append(dict(level=level,width=width,height=height,stride=stride,offset=offset,inputHex=raw.hex()))
            offset += (height-1)*stride+width*12+9
            width,height = max(1,width//2),max(1,height//2)
        backing = bytearray([0x93]*(offset+7))
        for p in planes:
            raw = bytes.fromhex(p['inputHex']); count = p['width']*12
            for y in range(p['height']):
                at = p['offset']+y*p['stride']; backing[at:at+count] = raw[y*count:(y+1)*count]
        cases.append(dict(metadata=dict(id=6,target=2,format=fmt,bind=10,width=9,height=5,depth=1,arraySize=1,lastLevel=3,nrSamples=0,flags=0),
                          signed=f['signed'],planes=planes,backingHex=backing.hex(),clearLevel=2,
                          clearValues=[-2147483648,2147483647,-1,1] if f['signed'] else [4294967295,2147483648,3735928559,1],
                          readBox=dict(x=1,y=1,z=0,width=3,height=2,depth=1)))
    return dict(schema='d31-independent-input-declaration-v1',declaredBeforeNativeRun=True,cases=cases)


def declare(output):
    document = declaration()
    output.write_text(json.dumps(document,indent=2)+'\n')
    return sha(output.read_bytes())


def audit_novel(capture, fault):
    path = capture/('sabotage-post-fence' if fault else 'novel-native')/'report.json'
    envelope = json.loads(path.read_bytes())
    inputs = (path.parent/'inputs.json').read_bytes()
    need(inputs == (capture/'novel-input-declaration.json').read_bytes() and sha(inputs) == envelope['inputs']['sha256'] and json.loads(inputs) == declaration(), 'independent native input declaration was fixed before GPU execution')
    need(envelope['status'] == ('failed' if fault else 'passed') and envelope['browserErrors'] == dict(console=[],page=[],requests=[]), 'critic native proof/control result')
    report = envelope['partial'] if fault else envelope['browserResult']['result']
    need('M4' in report['gpu'] and 'Metal' in report['gpu'] and not envelope['browser']['headless'], 'novel actual physical GPU')
    if fault:
        need(envelope['browserResult']['error']['message'].startswith('critic independent whole integer plane sabotage-post-fence:'), 'sabotage must fail unchanged pixel oracle, not setup/native error')
    else:
        need(len(report['runs']) == 2 and all(row['held'] for row in report['predictions']), 'both signed and unsigned novel native attacks')
    checks = []
    blobs = {b['key']: b for b in report['blobs']}
    def blob(row):
        b = blobs[row['key']]; compressed = (path.parent/b['path']).read_bytes(); raw = gzip.decompress(compressed)
        need(sha(compressed) == b['gzipSha256'] and sha(raw) == b['sha256'] and len(raw) == b['bytes'], 'full novel native/public blob '+b['key'])
        return raw
    for b in report['blobs']:
        blob(b)
    for index, run in enumerate(report['runs']):
        spec = declaration()['cases'][index]; fmt = spec['metadata']['format']
        need(run['inputDeclaration'] == spec and run['metadata'] == spec['metadata'], 'fixed original signed/unsigned native fields')
        original = [bytes.fromhex(p['inputHex']) for p in spec['planes']]
        expected = original[:]
        p = spec['planes'][spec['clearLevel']]
        pixel = b''.join((v & 0xffffffff).to_bytes(4,'little') for v in spec['clearValues'][:3])
        expected[spec['clearLevel']] = pixel*(p['width']*p['height'])
        def completed(point):
            need(point in run['events'] and point['name'] == 'clientWaitSync' and point['actual'] in (37146,37148) and point['delivered'] == point['actual'], 'novel actual original physical fence '+str(point))
            need(any(e['name'] == 'fenceSync' and e['sync'] == point['sync'] and e['turn'] < point['turn'] for e in run['events']), 'novel retained exact physical sync identity')
        for name in ['originalFence','copyFence','clearFence','refreshFence']:
            completed(run[name])
        need(blob(run['backing']) == bytes.fromhex(spec['backingHex']) and blob(run['backingAfterGPUClear']) == bytes.fromhex(spec['backingHex']), 'novel every original SG byte survives host input mutation/GPU-only clear')
        misses = 0
        for observation in run['observations']:
            label = observation['label']
            level = observation['level'] if label.startswith('source-') else observation['level']+1
            words = original[level] if '-before-clear-' in label else expected[level]
            want, actual = native_words(fmt,words), blob(observation['native'])
            need(blob(observation['original']) == words and sha(want) == observation['expectedNativeSha256'], 'novel unchanged original-word expected plane '+label)
            completed(observation['fence'])
            held = actual == want; misses += not held
            checks.append(dict(file=str(path),reportSha256=sha(path.read_bytes()),run=index,point=label,expectedSha256=sha(want),observedSha256=sha(actual),nativeComponents=len(want)//4,held=held))
            need(held or fault and label == 'sabotage-post-fence', 'novel whole native integer plane '+label)
        if fault:
            completed(run['sabotageFence']); need(misses == 1 and run['sabotage']['originalPixelsPhysicallyCompleted'] and run['sabotage']['wrongPrivatePixelsPhysicallyCompleted'], 'one actual native wrong-plane sabotage after original physical completion')
        else:
            need(misses == 0 and len(run['observations']) == 13, 'complete before/after/retained old planes')
            ids = run['identities']; need(ids['originalGeneration'] == ids['privateGeneration'] != ids['replacementGeneration'] and len({ids['originalTexture'],ids['privateTexture'],ids['replacementTexture']}) == 3, 'novel exact original/private/replacement native identities')
            box = spec['readBox']; count = box['width']*12
            selected = b''.join(original[0][((box['y']+y)*9+box['x'])*12:((box['y']+y)*9+box['x'])*12+count] for y in range(box['height']))
            need(blob(run['oldRead']) == selected and run['readLayout']['scratchBytes'] == run['readLayout']['stagingBytes'] == box['width']*box['height']*16, 'novel compact subrect PBO from exact old retained source')
            completed(run['oldReadFence'])
            need(run['beforeHoldRelease']['budgets']['imageHolds'] == 1 and run['afterHoldRelease']['budgets']['imageHolds'] == 0 and run['afterHoldRelease']['budgets']['gpuBytes'] == 896, 'last hold retires exact old source/private physical allocations')
            need(len(run['malformed']) == 8, 'novel getter/config/inline/attachment angles')
            for row in run['malformed']:
                if 'result' in row:
                    need(not row['result']['ok'] and row['calls'] == 0, 'novel hostile own record accessor')
                else:
                    need(not row['validation']['ok'] and not row['issue']['ok'], 'novel stale backing/membership cannot issue native read')
        need(all(value == 0 for value in run['final']['budgets'].values()) and all(obj['deleted'] == 1 for obj in run['nativeObjects']), 'novel each native object retires once and all terminal budgets zero')
        for made in [e for e in run['events'] if e['name'] == 'fenceSync']:
            need(sum(e['name'] == 'deleteSync' and e['sync'] == made['sync'] for e in run['events']) == 1, 'novel every original physical sync retires once')
        for event in run['events']:
            if event['label'] == 'critic-GPU-range-copy':
                need(event['name'] not in ['readPixels','getBufferSubData'], 'novel native integer range copy never downloads CPU pixels')
                if event['name'] == 'blitFramebuffer':
                    need(event['args'][-2:] == [16384,9728], 'novel integer native NEAREST color blit')
    return dict(path=str(path),sha256=sha(path.read_bytes()),status='passed',nativeCases=len(report['runs']),postFenceSabotage=fault,checks=checks)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture',type=Path,required=True)
    parser.add_argument('--reopen',action='store_true')
    parser.add_argument('--fetch-specs',action='store_true')
    parser.add_argument('--declare',action='store_true')
    args = parser.parse_args(); capture = args.capture.resolve(); capture.mkdir(parents=True,exist_ok=True)
    if args.declare:
        print(declare(capture/'novel-input-declaration.json')); return
    custody = reopen(capture) if args.reopen else json.loads((capture/'custody.json').read_bytes())
    (capture/'custody.json').write_text(json.dumps(custody,indent=2)+'\n')
    boundaries = closure(capture,args.fetch_specs)
    checks, records, wires, audits = [], [], [], []
    for prefix in ['worker/hot','worker/cold','fresh']:
        directory = capture/prefix
        if not directory.exists():
            continue
        wires.append(audit_wire(directory/'wire/report.json'))
        for path in sorted(directory.glob('hardware-*/report.json'))+sorted(directory.glob('fault-*/report.json')):
            records.append(audit_native(path,checks))
        carried = [capture/'worker/hot',capture/'worker/cold'] if prefix == 'fresh' else []
        audits.append(dict(record=prefix,**coverage(directory,carried)))
    need(all(a['status'] == 'passed' for a in audits), 'every changed runtime hunk/partition exercised or explicitly waived')
    novel = [audit_novel(capture,fault) for fault in [False,True]] if (capture/'novel-native/report.json').exists() else []
    result = dict(schema='d31-independent-critic-v1',status='passed',taskCorrectness='HELD',workerSubmission=SUBMISSION,runtimeHead=FROZEN,
                  custody=custody,closure=boundaries,wire=wires,native=records,wholePlanes=checks,
                  nativeComponents=sum(r['nativeComponents'] for r in records),publicBytes=sum(r['publicBytes'] for r in records),paddingBytes=sum(r['paddingBytes'] for r in records),
                  novel=novel,noProductOracleImports=True,oldAllocatorPreflightCarried=True,allocatorNote='Original/private GPU byte counters publish after atomic successful native allocation, as at predecessor. Costs and remaining ceilings are checked before allocation; integer scratch and PBO staging reservations publish before their allocations.')
    (capture/'audit.json').write_text(json.dumps(result,indent=2)+'\n')
    (capture/'coverage.json').write_text(json.dumps(dict(status='passed',audits=audits),indent=2)+'\n')
    print(json.dumps({k:result[k] for k in ['status','nativeComponents','publicBytes','paddingBytes','noProductOracleImports']}))


if __name__ == '__main__':
    main()

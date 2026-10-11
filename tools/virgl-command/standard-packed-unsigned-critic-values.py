#!/usr/bin/env python3
"""Complete primary-field inverse for the promoted opposite-alias critic attack."""
import argparse
import gzip
import hashlib
import importlib.util
import json
import struct
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FROZEN = 'c7c66c54482566f76b2f49af5a5e5721bd69d3f7'
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def need(value, message):
    if not value:
        raise ValueError(message)


def load(name):
    path = ROOT/'tools/virgl-command'/name
    spec = importlib.util.spec_from_file_location(name.removesuffix('.py').replace('-', '_'), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def pattern(fmt, width, height, salt, level, offsets):
    raw = bytearray()
    for i in range(width*height):
        lanes = [(salt+i*67+level*31) & 1023, ((salt >> 7)+i*149+level*11) & 1023,
                 (1023-((salt >> 13)+i*37+level*59)) & 1023, ((salt >> 29)+i+level) & 3]
        word = sum(lane << offsets[fmt][j][0] for j, lane in enumerate(lanes))
        raw.extend(struct.pack('<I', word))
    return bytes(raw)


def crop(raw, width, box):
    return b''.join(raw[((box['y']+y)*width+box['x'])*4:
                       ((box['y']+y)*width+box['x']+box['width'])*4] for y in range(box['height']))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    directory = args.directory.resolve()
    audit = load('standard-packed-unsigned-critic-audit.py')
    fields = audit.original_fields()
    inverse = load('standard-packed-unsigned-values.py')
    inverse_path = ROOT/'tools/virgl-command/standard-packed-unsigned-values.py'
    frozen = subprocess.check_output(['git','show',FROZEN+':'+inverse_path.relative_to(ROOT).as_posix()],cwd=ROOT)
    need(inverse_path.read_bytes() == frozen, 'complete inverse must remain unchanged')
    envelope = json.loads((directory/'report.json').read_bytes())
    need(envelope['status'] == envelope['browserResult']['status'] == 'passed' and envelope['verifier'], 'fresh critic run passed')
    report = envelope['browserResult']['result']
    need(not envelope['browser']['headless'] and all(n in report['gpu'] for n in ('Apple','M4','Metal')) and
         envelope['browserErrors'] == dict(console=[],page=[],requests=[]), 'headed real Apple Metal with zero browser errors')
    need(not any(any(s in a.lower() for s in ('swiftshader','llvmpipe','softpipe','lavapipe','--disable-gpu'))
                 for a in envelope['browser']['commandLine']), 'hardware authority')
    for key in ('browserCoverage','screenshot'):
        item = envelope[key]
        need(sha((directory/item['path']).read_bytes()) == item['sha256'], 'complete '+key+' custody')
    blobs = {b['key']:b for b in report['blobs']}
    need(len(blobs) == len(report['blobs']), 'all blob IDs unique')
    def blob(record):
        row = blobs[record['key']]
        packed = (directory/row['path']).read_bytes()
        raw = gzip.decompress(packed)
        need(sha(packed) == row['gzipSha256'] and sha(raw) == row['sha256'] and len(raw) == row['bytes'], 'full native/public blob digest')
        return raw
    for b in report['blobs']:
        blob(b)
    for source in envelope['sources']:
        current = (ROOT/source['path']).read_bytes()
        need(sha(current) == source['sha256'] and len(current) == source['bytes'], 'critic exact source pin')
        if not source['path'].endswith('standard-packed-unsigned-critic.mjs'):
            need(current == subprocess.check_output(['git','show',FROZEN+':'+source['path']],cwd=ROOT), 'unchanged exercised runtime/dependency source')
    served = {s['path']:s for s in envelope['servedFiles']}
    for source in envelope['sources']:
        if '/'+source['path'] in served:
            need(served['/'+source['path']]['sha256'] == source['sha256'], 'exact served source')
    coverage = json.loads((directory/envelope['browserCoverage']['path']).read_bytes())
    need({'renderer/virgl-command/resources.mjs','renderer/virgl-command/packed-unsigned-images.mjs',
          'renderer/virgl-command/tests/standard-packed-unsigned-critic.mjs'} <= {s['source'] for s in coverage['scripts']}, 'full native critic V8 records')
    outcomes, components, public, padding = [], 0, 0, 0
    for ordinal, row in enumerate(report['runs']):
        fmt = row['format']
        original, replacement = row['original'], row['replacement']
        need(fmt in fields and original['metadata']['format'] == fmt and replacement['metadata']['format'] == (253 if fmt == 225 else 225), 'original/opposite alias identity')
        expected_sets = []
        for source, salt in [(original,(report['seed']^fmt)&0xffffffff), (replacement,(report['seed']^0xc379de4b)&0xffffffff)]:
            need(source['salt'] == salt and source['metadata'] == dict(id=6,target=2,format=source['metadata']['format'],bind=10,
                 width=11,height=7,depth=1,arraySize=1,lastLevel=3,nrSamples=0,flags=0), 'independent entire original metadata')
            planes, offset = [], 3
            for level, p in enumerate(source['planes']):
                width, height = max(1,11 >> level), max(1,7 >> level)
                need(p['level'] == level and p['width'] == width and p['height'] == height and p['offset'] == offset and
                     p['stride'] == width*4+9, 'complete independently reconstructed original mip descriptors')
                raw = pattern(source['metadata']['format'],width,height,salt,level,fields)
                need(blob(p['input']) == raw, 'all original patterned words')
                planes.append(raw)
                offset += (height-1)*p['stride']+width*4+13
            need(len(planes) == 4, 'full original mip chain')
            backing = bytearray([0xcd]*(offset+17))
            for p, raw in zip(source['planes'],planes):
                for y in range(p['height']):
                    at = p['offset']+y*p['stride']; backing[at:at+p['width']*4] = raw[y*p['width']*4:(y+1)*p['width']*4]
            need(blob(source['backing']) == backing, 'every input/SG padding byte')
            expected_sets.append(planes)
            padding += len(backing)-sum(map(len,planes))
        expected, new_expected = expected_sets
        def native(expected_bytes, saved, label, alias=fmt):
            nonlocal components
            observed = blob(saved)
            need(observed == audit.unpack_native(fields,alias,expected_bytes), label+' complete primary uint lanes')
            inverse.assert_plane(alias,expected_bytes,observed,label)
            components += len(observed)//4
        for p in row['privateBefore']:
            native(expected[p['original']],p['native'],'old private original mip')
        for patch, spec in zip(row['patches'],[(0,2,2,3,2,report['seed']^0x194cd5),(1,1,1,2,1,report['seed']^0xb305ac)]):
            level,x,y,w,h,salt = spec
            need([patch[k] for k in ('level','x','y','width','height','salt')] == [level,x,y,w,h,salt&0xffffffff], 'predicted bounded original subrect')
            raw = pattern(fmt,w,h,salt&0xffffffff,level,fields)
            need(blob(patch['input']) == raw, 'all independent patch words')
            wire = bytes.fromhex(patch['wire']); words = struct.unpack('<'+'I'*(len(wire)//4),wire)
            need(words[0]&255 == 9 and words[0] >> 16 == len(words)-1 and list(words[1:12]) == [6,level,0,w*4+5,0,x,y,0,w,h,1], 'original complete partial-box packet')
            payload = wire[48:]
            packed = bytearray([0x97]*(((h-1)*(w*4+5)+w*4+3)//4*4))
            for py in range(h):packed[py*(w*4+5):py*(w*4+5)+w*4] = raw[py*w*4:(py+1)*w*4]
            need(payload == packed, 'inline whole padded original payload')
            out = bytearray(expected[level]); width = original['planes'][level]['width']
            for py in range(h):
                at = ((y+py)*width+x)*4;out[at:at+w*4] = raw[py*w*4:(py+1)*w*4]
            expected[level] = bytes(out)
            need(patch['layout']['scratchBytes'] == w*h*4 and patch['layout']['stagingBytes'] == 0, 'four-byte patch reservation')
        for point in ('privateAfterRefresh','heldBeforeCorruption'):
            for p in row[point]:native(expected[p['original']],p['native'],point)
        need(blob(row['oldBackingBeforeReuse']) == blob(original['backing']), 'native inline writes leave full old SG backing/padding unchanged')
        source, private, new = row['sourceIdentity'], row['privateIdentity'], row['replacementIdentity']
        need(source['generation'] == private['generation'] != new['generation'] and
             len({source['texture'],private['texture'],new['texture']}) == 3 and new['format'] == replacement['metadata']['format'], 'distinct old/private/opposite-alias native identities')
        need(private['metadata']['width'] == 5 and private['metadata']['height'] == 3 and private['metadata']['lastLevel'] == 1 and
             private['metadata']['byteLength'] == private['metadata']['gpuByteLength'] == 68, 'restricted original [1,2] native range charge')
        need(all(not value['ok'] for value in row['refusals'].values()) and
             row['refusals']['stalePublication']['error']['code'] == 'stale-ticket' and
             row['refusals']['staleView']['error']['code'] == 'stale-context', 'stale public transfer/view authority refuses')
        box = row['readBox']; old_part = crop(expected[0],11,box);new_part = crop(new_expected[0],11,box)
        need(old_part != new_part and blob(row['oldPartialOutput']) == old_part and blob(row['newPartialOutput']) == new_part,
             'full retained old and opposite-alias partial public words')
        public += len(old_part)+len(new_part)
        for p in row['replacementNative']:native(new_expected[p['level']],p['native'],'opposite-alias whole native mip',replacement['metadata']['format'])
        need(blob(row['replacementFinalBacking']) == blob(replacement['backing']), 'all opposite-alias compact output words and untouched SG padding')
        public += len(blob(row['replacementFinalBacking']))
        charge, stale_charge, source_charge, private_charge = 4*3*16,2*1*16,380,68
        b = row['beforeReuse']['budgets']
        need(b['gpuBytes'] == source_charge+private_charge+charge+stale_charge and b['scratchBytes'] == charge+stale_charge and
             b['cpuBytes'] == len(blob(original['backing']))+charge+stale_charge, 'complete overlapping old read reservations')
        need(row['afterReuse']['gpuBytes'] == b['gpuBytes']+source_charge and row['afterReuse']['scratchBytes'] == charge+stale_charge and
             row['afterReuse']['backingBytes'] == len(blob(replacement['backing'])), 'generation reuse keeps old native charges and replaces public backing')
        need(row['afterStaleRelease']['gpuBytes'] == 2*source_charge+private_charge+charge and row['afterStaleRelease']['scratchBytes'] == charge,
             'stale completion releases its own sixteen-byte reservation once')
        need(row['oldReadyBudgets'] == row['afterStaleRelease'] and row['afterOldReadRelease']['gpuBytes'] == 2*source_charge+private_charge and
             row['afterOldReadRelease']['scratchBytes'] == 0, 'old read custody through physical completion')
        for point in ('newReadIssueBudgets','newReadReadyBudgets'):
            b = row[point]
            need(b['gpuBytes'] == 2*source_charge+private_charge+charge and b['scratchBytes'] == charge and
                 b['cpuBytes'] == len(blob(replacement['backing']))+charge, 'sixteen-byte opposite-alias native read at '+point)
        need(row['newReadReleaseBudgets']['gpuBytes'] == 2*source_charge+private_charge and row['newReadReleaseBudgets']['scratchBytes'] == 0,
             'new read once-only reservation release')
        for label, wanted in [('critic-retained-old-partial-read',old_part),('critic-opposite-alias-partial-read',new_part)]:
            reads = [r for r in row['readbacks'] if r['label'] == label]
            issued, collected = [r for r in reads if r['name'] == 'readPixels'],[r for r in reads if r['name'] == 'getBufferSubData']
            need(len(issued) == len(collected) == 1 and issued[0]['type'] == 'PBO' and issued[0]['buffer'] == collected[0]['buffer'] and
                 issued[0]['args'][4:] == [36249,5125], 'original integer partial native PBO identity/format/type')
            alias = fmt if label == 'critic-retained-old-partial-read' else replacement['metadata']['format']
            native(wanted,collected[0]['bytes'],label,alias)
        need(not any(r['name'] == 'getBufferSubData' and r['label'] == 'critic-stale-old-partial-read' for r in row['readbacks']), 'stale public transfer never downloads/publishes')
        for point in ('uploadFence','copyFence','refreshFence','oldReadFence','newReadFence','completedWorkFence','corruptionFence'):
            event = row[point]
            need(event in row['events'] and event['name'] == 'clientWaitSync' and event['actual'] in (37146,37148) and
                 event['delivered'] in (37146,37148), 'actual physical completion at '+point)
        need(row['corruptionFence']['sync'] != row['completedWorkFence']['sync'] and
             row['events'].index(row['corruptionFence']) > row['events'].index(row['completedWorkFence']), 'distinct second physical fence after completed native work')
        first = row['corrupted'][0]; observed = blob(first['native']);expected_native = audit.unpack_native(fields,fmt,expected[1])
        precise = bytearray(expected_native);precise[0] ^= 1
        need(observed == precise, 'actual native private word corruption changes precisely R bit0 at original mip1 pixel0')
        failure = None
        try:inverse.assert_plane(fmt,expected[1],observed,'critic post-completion original private mip')
        except ValueError as error:failure = str(error)
        need(failure and 'pixel 0' in failure, 'unchanged full integer inverse must reject completed native corruption')
        second = row['corrupted'][1];native(expected[2],second['native'],'untouched adjacent private mip after real corruption')
        need(all(v == 0 for v in row['final']['budgets'].values()) and all(o['deleted'] == 1 for o in row['nativeObjects']), 'all native objects retire once and terminal owner budgets zero')
        outcomes.append(dict(format=fmt,status='HELD',inverseSabotage='REJECTED',failure=failure,
                             citation=f'report.json#/browserResult/result/runs/{ordinal}/corrupted/0/native',
                             originalRaw=original['planes'][1]['input'], cleanNative=row['heldBeforeCorruption'][0]['native'],
                             changedNative=first['native'], completedWorkFence=row['completedWorkFence'],secondPhysicalFence=row['corruptionFence']))
    need(len(outcomes) == 2 and all(p['held'] for p in report['predictions']), 'both original alias attacks and all native lifecycle predictions')
    result = dict(schema='packed-unsigned-independent-critic-values-v1',status='passed',outcomes=outcomes,
                  nativeComponents=components,publicBytes=public,untouchedInputPaddingBytes=padding,
                  completeUnchangedInverseSha256=sha(frozen),oracleImportsProductCode=False,
                  reportSha256=sha((directory/'report.json').read_bytes()))
    (directory/'independent-critic-values.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()

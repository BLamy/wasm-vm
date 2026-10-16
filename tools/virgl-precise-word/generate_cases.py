#!/usr/bin/env python3
"""Literal word-operation witnesses and explicit, unchanged-boundary combinations."""
import copy
import hashlib
import json
import re
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASELINE_SHA = '7c6c072899bf3d242ab2e36c12893f009178654d9e5762455f3caecd77e37862'
PROFILE_MAP = {1: 17, 7: 18, 8: 19, 9: 20, 10: 21, 11: 22,
               12: 23, 14: 24, 15: 25, 16: 26}


def held():
    path = ROOT / 'evidence/virgl-radial-domain/worker.tar.gz'
    assert hashlib.sha256(path.read_bytes()).hexdigest() == BASELINE_SHA
    with tarfile.open(path) as archive:
        return json.loads(archive.extractfile('./native/native-report.json').read())


def lookup(report):
    result = {e['name']: e for e in report['cases']}
    for key, entries in report.items():
        if key.endswith('Cases') and isinstance(entries, list) and entries and isinstance(entries[0], dict):
            result.update({key[:-5] + '::' + e['name']: e for e in entries})
    return result


def contract(stage, text):
    operations = sorted(set(re.findall(r'\b(FSEQ|FSNE|MAX|MOV)_PRECISE\b', text)))
    assert operations
    return dict(kind='tgsi-precise-word-local-v1', stage=stage, operations=operations)


def expected(stage, text, profile, count, base=None):
    result = {'profile': f'virgl-webgl2-raw-bits-v{profile}', 'constantCount': count,
              'preciseWordContract': contract(stage, text)}
    if base:
        result.update({key: copy.deepcopy(value) for key, value in base.items()
                       if key.startswith('constant') and key != 'constantCount'})
    return result


def codec(stage, source='TEMP[117]', immediate=1, carrier=0, selector=None):
    i = f'IMM[{immediate}]'
    selector = selector or ('IN[1]' if stage == 'vertex' else 'IN[0]')
    return '\n'.join([f'USHR TEMP[100].x, {selector}.xxxx, {i}.xxxx',
                      f'AND TEMP[100].x, TEMP[100].xxxx, {i}.yyyy',
                      f'UADD TEMP[100].x, TEMP[100].xxxx, {i}.zzzz',
                      f'USHR TEMP[115], {source}, TEMP[100].xxxx',
                      f'AND TEMP[115], TEMP[115], {i}.wwww',
                      f'UCMP TEMP[115], TEMP[115], IMM[{carrier}].yyyy, IMM[{carrier}].xxxx',
                      'MOV OUT[1], TEMP[115]' if stage == 'vertex' else 'MOV OUT[0], TEMP[115]',
                      *(['MOV OUT[0], IN[0]'] if stage == 'vertex' else []), 'END']) + '\n'


def kernel_text(stage, opcode, variant):
    header = ['VERT' if stage == 'vertex' else 'FRAG',
              'DCL IN[0]' if stage == 'vertex' else 'DCL IN[0], GENERIC[0], CONSTANT',
              'DCL IN[1]' if stage == 'vertex' else 'DCL IN[1], GENERIC[1], CONSTANT',
              'DCL IN[2]' if stage == 'vertex' else 'DCL IN[2], GENERIC[2], CONSTANT',
              'DCL OUT[0], POSITION' if stage == 'vertex' else 'DCL OUT[0], COLOR']
    if stage == 'vertex': header += ['DCL OUT[1], GENERIC[0]']
    header += ['DCL TEMP[0..117]', 'DCL CONST[0..5]',
               'IMM[0] UINT32 {0,1065353216,0,0}',
               'IMM[1] UINT32 {23,127,4294967200,1}',
               'IMM[2] UINT32 {17,29,31,43}',
               'IMM[3] FLT32 {0.25,0.5,1,0}', 'IMM[4] UINT32 {65535,16,0,0}',
               'IMM[5] UINT32 {0,2147483648,2143294004,1065353216}',
               'IMM[6] UINT32 {2147483648,0,1065353216,4290795128}']
    # The unchanged command decoder accepts finite floats. Two finite carriers
    # hold the high/low sixteen bits of each arbitrary source word. Unsigned
    # instructions reconstruct the exact word entirely inside the shader.
    body = ['AND TEMP[0], CONST[0], IMM[4].xxxx', 'SHL TEMP[0], TEMP[0], IMM[4].yyyy',
            'AND TEMP[2], CONST[1], IMM[4].xxxx', 'OR TEMP[0], TEMP[0], TEMP[2]',
            'AND TEMP[1], CONST[2], IMM[4].xxxx', 'SHL TEMP[1], TEMP[1], IMM[4].yyyy',
            'AND TEMP[3], CONST[3], IMM[4].xxxx', 'OR TEMP[1], TEMP[1], TEMP[3]']
    if variant == 'computed': body += ['UADD TEMP[0], TEMP[0], IMM[2]', 'NOT TEMP[1], TEMP[1]']
    if variant == 'numeric': body = [f'ADD TEMP[0], IN[{2 if stage == "vertex" else 1}].xyxy, IMM[3].xxxx', 'MOV TEMP[1], IMM[3].yyyy']
    a, b = 'TEMP[0]', 'TEMP[1]'
    if variant == 'swizzle': a, b = 'TEMP[0].wzyx', 'TEMP[1].yxwz'
    if variant == 'negative': a, b = '-TEMP[0]', '-TEMP[1]'
    if variant in ('literal', 'literal-negative'):
        body = []
        a, b = ('IMM[5]', 'IMM[6]') if variant == 'literal' else ('-IMM[5]', '-IMM[6]')
    destination = 'TEMP[0]' if variant == 'alias-left' else 'TEMP[1]' if variant == 'alias-right' else 'TEMP[117]'
    body += [opcode + '_PRECISE ' + destination + ', ' + a + (', ' + b if opcode != 'MOV' else '')]
    if destination != 'TEMP[117]': body += ['MOV_PRECISE TEMP[117], ' + destination]
    return '\n'.join(header + body) + '\n' + codec(stage)


def main():
    report = held(); old = lookup(report); cases = []; kernels = []; pairs = []
    for base, profile in PROFILE_MAP.items():
        for stage in ('vertex', 'fragment'):
            source = old[report['recoverySingles'][base * 2 + int(stage == 'fragment')]]
            text, replacements = re.subn(r'\bMOV\b', 'MOV_PRECISE', source['text'], count=1)
            if not replacements and base == 7:
                text = re.sub(r'^(UCMP TEMP\[117\].*)$', r'\1\nMOV_PRECISE TEMP[117], TEMP[117]', source['text'], count=1, flags=re.M)
                replacements = int(text != source['text'])
            assert replacements == 1
            name = f'profile-{profile}-{stage}'
            metadata = source['result']['metadata']; count = metadata['uniforms'][0]['count'] if metadata['uniforms'] else 0
            cases.append(dict(name=name, stage=stage, text=text, ok=True,
                              expected=expected(stage, text, profile, count, metadata),
                              retainedInput=source['inputSha256']))
            # These historical partners expose the generic lanes consumed by
            # the raw fixtures; a captured straight-line anchor may use g5..7.
            opposite = 'pass-' + ('fragment' if stage == 'vertex' else 'vertex')
            pairs.append(dict(name=name + '-mixed-pair', vertex=name if stage == 'vertex' else opposite,
                              fragment=name if stage == 'fragment' else opposite, ok=True))
    for stage in ('vertex', 'fragment'):
        for opcode in ('MAX', 'FSEQ', 'FSNE', 'MOV'):
            variants = ['direct', 'alias-left', 'alias-right', 'computed']
            if opcode in ('MAX', 'MOV'): variants += ['swizzle']
            if opcode == 'MAX': variants += ['negative', 'numeric', 'literal', 'literal-negative']
            for variant in variants:
                name = f'word-{opcode.lower()}-{variant}-{stage}'; text = kernel_text(stage, opcode, variant)
                cases.append(dict(name=name, stage=stage, text=text, ok=True, expected=expected(stage, text, 17, 6)))
                kernels.append(dict(case=name, stage=stage, name=opcode + '-' + variant, kind='word', count=6,
                                    observation='TEMP[117]', vectorSet='finite' if variant == 'numeric' else 'all'))
    # Continued below: control/domain combinations, hostile modifiers and ports.
    finish(report, old, cases, kernels, pairs)


def finish(report, old, cases, kernels, pairs):
    radial = json.loads((ROOT / 'renderer/virgl-shader/tests/radial-domain-cases.json').read_bytes())
    for stage in ('vertex', 'fragment'):
        for label in ('plain', 'indirect', 'loop'):
            source = next(e for e in radial['cases'] if e['name'] == label + '-' + stage)
            text = source['text'].replace('MAX ', 'MAX_PRECISE ')
            # Preserve the graph, its consumer and all domain obligations. The
            # observer copies the resulting numeric word before bit projection.
            if not re.search(r'^DCL IN\[1\]', text, re.M):
                text = text.replace('DCL IN[0]\n', 'DCL IN[0]\nDCL IN[1]\n') if stage == 'vertex' else text.replace('DCL IN[0], GENERIC[0], CONSTANT\n', 'DCL IN[0], GENERIC[0], CONSTANT\nDCL IN[1], GENERIC[1], CONSTANT\n')
            last = max(map(int, re.findall(r'IMM\[(\d+)\] (?:UINT32|FLT32)', text)))
            first = re.search(r'^(?!VERT|FRAG|DCL|IMM)\S', text, re.M).start()
            text = text[:first] + f'IMM[{last+1}] UINT32 {{23,127,4294967200,1}}\nIMM[{last+2}] UINT32 {{0,1065353216,0,0}}\n' + text[first:]
            output = re.findall(r'MOV OUT\[\d+\], (TEMP\[\d+\])', text)[-1]
            selector = 'IN[1]' if stage == 'vertex' else 'IN[' + re.search(r'DCL IN\[(\d+)\], GENERIC\[0\]', text)[1] + ']'
            text = text.removesuffix('END\n') + f'MOV_PRECISE TEMP[117], {output}\n' + codec(stage, immediate=last+1, carrier=last+2, selector=selector)
            name = 'combined-' + label + '-' + stage
            e = source['expected']; version = int(e['profile'].split('-v')[-1])
            cases.append(dict(name=name, stage=stage, text=text, ok=True,
                              expected=expected(stage, text, PROFILE_MAP[version], e['constantCount'], e)))
            kernels.append(dict(case=name, name='combined-' + label, stage=stage, kind='radial',
                                count=e['constantCount'], observation='TEMP[117]', vectorSet='radial'))
    # Unsupported suffixes and source modifiers fail at the owned parser. A
    # PRECISE copy does not manufacture missing numeric or raster authority.
    for stage in ('vertex', 'fragment'):
        text = kernel_text(stage, 'MAX', 'direct')
        mutations = {
            'add': text.replace('MAX_PRECISE ', 'ADD_PRECISE '),
            'mul': text.replace('MAX_PRECISE ', 'MUL_PRECISE '),
            'suffix': text.replace('MAX_PRECISE ', 'MAX_PRECISE_PRECISE '),
            'saturate': text.replace('MAX_PRECISE ', 'MAX_SAT_PRECISE '),
            'unwritten': text.replace('MAX_PRECISE TEMP[117], TEMP[0]', 'MAX_PRECISE TEMP[117], TEMP[99]'),
            'authority': text.replace('MOV OUT[1], TEMP[115]' if stage == 'vertex' else 'MOV OUT[0], TEMP[115]',
                                      'MOV OUT[1], TEMP[117]' if stage == 'vertex' else 'MOV OUT[0], TEMP[117]')}
        for label, value in mutations.items():
            cases.append(dict(name='reject-' + label + '-' + stage, stage=stage, text=value, ok=False,
                              expected={'errorCode': 'parse-error' if label == 'unwritten' else 'unsupported-feature'}))
    partners = json.loads((ROOT / 'renderer/virgl-command/tests/bounded-loops-shaders.json').read_bytes())
    for e in partners['shaders']:
        if e['name'].startswith('pass-'):
            cases.append(dict(name=e['name'], stage=e['stage'], text=e['text'], ok=True,
                              expected={'profile': 'virgl-webgl2-straight-line-v5', 'constantCount': 0}))
    for k in kernels:
        pairs.append(dict(name='gpu-' + k['case'] + '-pair', vertex=k['case'] if k['stage'] == 'vertex' else 'pass-vertex',
                          fragment=k['case'] if k['stage'] == 'fragment' else 'pass-fragment', ok=True))
    for e in cases:
        if not e['ok']:
            pairs.append(dict(name=e['name'] + '-pair', vertex=e['name'] if e['stage'] == 'vertex' else 'pass-vertex',
                              fragment=e['name'] if e['stage'] == 'fragment' else 'pass-fragment', ok=False))
    # Keep the unchanged historical input/result as the migration baseline.
    # Only exact, formerly rejected inputs bearing one of the four supported
    # suffixes may acquire a new result. Everything else remains byte identical.
    migrations = []
    for name, e in old.items():
        if not e['ok'] and re.search(r'\b(?:MOV|MAX|FSEQ|FSNE)_PRECISE\b', e['text']):
            migrations.append(dict(name=name, inputSha256=e['inputSha256'], before=e['result'],
                                   reason='instruction-local exact word modifier admission'))
    result = dict(schema='precise-word-cases-v1', baselineSha256=BASELINE_SHA, cases=cases,
                  pairs=pairs, kernels=kernels, migrationCandidates=migrations)
    target = ROOT / 'renderer/virgl-shader/tests/precise-word-cases.json'
    target.write_text(json.dumps(result, indent=2) + '\n')
    print('Authored exact-word cases:', len(cases), 'pairs:', len(pairs), 'hardware kernels:', len(kernels),
          'explicit historical migration candidates:', len(migrations))


if __name__ == '__main__':
    main()

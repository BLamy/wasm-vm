#!/usr/bin/env python3
"""Author bounded literal CONST-domain compiler cases without running the compiler."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
PROFILE = 'virgl-webgl2-raw-bits-v7'
CASES = []


def expectation(stage, profile=PROFILE, count=46):
    return {'profile': profile, 'constantCount': count, 'constantDomains': [
        {'kind': 'constant-bank-finite-f32-v1', 'stage': stage, 'slot': 0,
         'name': ('vs' if stage == 'vertex' else 'fs') + 'const0', 'count': count}
    ] if profile == PROFILE else None}


def shader(stage, body, *, texture=False, prefix=True, terminal=True):
    vertex = stage == 'vertex'
    lines = ['VERT' if vertex else 'FRAG']
    lines += [f'DCL IN[{i}]' + ('' if vertex else f', GENERIC[{i}], PERSPECTIVE') for i in range(4)]
    lines += ['DCL OUT[0], POSITION', 'DCL OUT[1], GENERIC[0]'] if vertex else ['DCL OUT[0], COLOR']
    lines += ['DCL TEMP[0..117]', 'DCL CONST[0..45]']
    if texture: lines += ['DCL SAMP[7]', 'DCL SVIEW[7], 2D, FLOAT']
    lines += ['IMM[0] FLT32 {0, 1, 0.5, 2}', 'IMM[1] UINT32 {8388607, 1056964608, 4294967295, 1}']
    if prefix: lines += ['AND TEMP[116], CONST[0], IMM[1].xxxx']
    lines += body
    if terminal:
        lines += ['MOV OUT[1], TEMP[117]', 'MOV OUT[0], IN[0]'] if vertex else ['MOV OUT[0], TEMP[117]']
        lines += ['END']
    return '\n'.join(lines) + '\n'


def add(name, stage, body, ok=True, code='unsupported-feature', profile=PROFILE, **options):
    CASES.append({'name': name + '-' + stage, 'stage': stage, 'text': shader(stage, body, **options),
                  'ok': ok, 'expected': expectation(stage, profile) if ok else {'errorCode': code}})


def main():
    manifest = json.loads((ROOT / 'renderer/virgl-shader/tests/constant-compiler-migrations.json').read_text())
    for record in manifest['migrations']:
        CASES.append({'name': record['promotedCase'], 'stage': record['stage'], 'text': record['oldText'],
                      'ok': True, 'expected': expectation(record['stage'])})
    operations = {'ADD': 2, 'MUL': 2, 'MAD': 3, 'DIV': 2, 'MAX': 2, 'FRC': 1, 'LRP': 3, 'DP3': 2, 'RCP': 1, 'RSQ': 1, 'TEX': 1}
    for stage in ('vertex', 'fragment'):
        for op, arity in operations.items():
            if op == 'TEX' and stage == 'vertex': continue
            for position in range(arity):
                for variant in ('c0-negate', 'c45-swizzle', 'mov-alias', 'ucmp-mixed', 'ucmp-known-unsafe'):
                    prefix, dest = [], 'TEMP[117]'
                    if variant == 'c0-negate': operand = '-CONST[0].wzyx'
                    elif variant == 'c45-swizzle': operand = 'CONST[45].yzyx'
                    elif variant == 'mov-alias':
                        prefix = ['MOV TEMP[9], CONST[45].wzyx', 'MOV TEMP[10], TEMP[9].yzxw']
                        operand, dest = '-TEMP[10].zwyx', 'TEMP[10]'
                    elif variant == 'ucmp-mixed':
                        prefix = ['ADD TEMP[8], IN[1], IMM[0].yyyy',
                                  'UCMP TEMP[9], CONST[0], CONST[45], TEMP[8]',
                                  'MOV TEMP[10], TEMP[9].wzyx',
                                  'UCMP TEMP[10], CONST[0].yxwz, TEMP[10], IN[2]']
                        operand, dest = 'TEMP[10].zwyx', 'TEMP[10]'
                    else:
                        prefix = ['UCMP TEMP[9], IMM[0].xxxx, IMM[1].zzzz, CONST[45]', 'MOV TEMP[10], TEMP[9]']
                        operand = 'TEMP[10]'
                    sources = ['IN[1].yzxw', 'IN[2].wxzy', 'IN[3].zwyx'][:arity]
                    sources[position] = operand
                    body = prefix + [op + ' ' + dest + ', ' + ', '.join(sources) + (', SAMP[7], 2D' if op == 'TEX' else '')]
                    if dest != 'TEMP[117]': body += ['MOV TEMP[117], ' + dest]
                    add(f'numeric-{op}-source{position}-{variant}', stage, body, texture=op == 'TEX')
            if op not in ('MAD', 'TEX'):
                for mask in ('x', 'w'):
                    sources = ['CONST[45].yzxw', 'IN[2].wzyx', 'IN[3]'][:arity]
                    add(f'partial-{op}-{mask}', stage, ['MOV TEMP[117], IN[1]', op + ' TEMP[117].' + mask + ', ' + ', '.join(sources)])
        # Conditional use first forces the second pass to examine every suffix.
        trigger = ['ADD TEMP[8], CONST[45], IN[1]']
        for tail in ('MOV TEMP[117], CONST[0]',
                     'UCMP TEMP[117], CONST[0], CONST[45], IN[1]',
                     'UCMP TEMP[9], CONST[0], CONST[45], IN[1]\nMOV TEMP[117], TEMP[9]',
                     'UCMP TEMP[9], CONST[0], CONST[45], IN[1]\nUCMP TEMP[117], CONST[0], TEMP[9], TEMP[8]',
                     'MOV TEMP[117], IMM[1].wwww'):
            add('reject-conditional-output-' + str(len(CASES)), stage, trigger + tail.splitlines(), ok=False)
        # Copy/select do not upgrade output authority; actual arithmetic does.
        for selector in ('IMM[0].xxxx', 'IMM[0].yyyy', 'CONST[0]'):
            for yes, no in [('CONST[45]', 'IN[1]'), ('IN[1]', 'CONST[45]'), ('CONST[45]', 'TEMP[8]'), ('TEMP[8]', 'CONST[45]')]:
                body = trigger + [f'UCMP TEMP[9], {selector}, {yes}, {no}', 'MOV TEMP[10], TEMP[9].wzyx',
                                  'UCMP TEMP[10], CONST[0], TEMP[10], IN[2]', 'ADD TEMP[117], TEMP[10], IMM[0].yyyy']
                add('join-' + str(len(CASES)), stage, body)
        for selector, yes, no in [('IMM[0].xxxx', 'CONST[0]', 'TEMP[8]'), ('IMM[0].yyyy', 'TEMP[8]', 'CONST[0]'),
                                  ('IMM[0].xxxx', 'IMM[1].zzzz', 'TEMP[8]'), ('IMM[0].yyyy', 'TEMP[8]', 'IMM[1].zzzz')]:
            add('unused-arm-' + str(len(CASES)), stage, trigger + [f'UCMP TEMP[117], {selector}, {yes}, {no}'])
        # The raw selector alone contributes no dependency or new profile.
        add('ordinary-selector-only', stage, ['UCMP TEMP[9], CONST[45], IN[1], IN[2]',
                                             'ADD TEMP[117], TEMP[9], IMM[0].yyyy'], profile='virgl-webgl2-raw-bits-v4')
        raw = {'AND': 'TEMP[9], IMM[1].zzzz', 'OR': 'TEMP[9], IMM[0].xxxx', 'NOT': 'TEMP[9]',
               'SHL': 'TEMP[9], IMM[0].xxxx', 'USHR': 'TEMP[9], IMM[0].xxxx', 'UADD': 'TEMP[9], IMM[0].xxxx',
               'ISGE': 'TEMP[9], IMM[0].xxxx', 'USEQ': 'TEMP[9], IMM[0].xxxx', 'USNE': 'TEMP[9], IMM[0].xxxx',
               'FSLT': 'TEMP[9], IMM[0].xxxx', 'FSGE': 'TEMP[9], IMM[0].xxxx'}
        for op, args in raw.items():
            add('reject-raw-clobber-' + op, stage, trigger + ['MOV TEMP[9], CONST[0]', op + ' TEMP[9].x, ' + args,
                                                         'ADD TEMP[117], TEMP[9], IMM[0].yyyy'], ok=False)
        add('safe-after-raw-clobber', stage, trigger + ['MOV TEMP[9], CONST[0]', 'AND TEMP[9], TEMP[9], IMM[1].xxxx',
                                                     'OR TEMP[9], TEMP[9], IMM[1].yyyy', 'ADD TEMP[117], TEMP[9], IMM[0].yyyy'])
        for suffix in ['ADD_PRECISE TEMP[117], CONST[0], IN[1]', 'IF IN[1]', 'MOV TEMP[117], CONST[ADDR[0].x]',
                       'MOV TEMP[117], --IN[1]', 'PROPERTY LEGACY_MATH_RULES 1', 'MOV TEMP[117], TEMP[17]']:
            add('reject-retry-suffix-' + str(len(CASES)), stage, trigger + [suffix], ok=False)
        add('reject-before-retry', stage, ['MOV TEMP[9], |IN[1]|'] + trigger + ['MOV TEMP[117], TEMP[8]'],
            ok=False, code='parse-error')
        add('reject-no-constant-authority', stage, ['OR TEMP[9], IN[1], IMM[1].zzzz', 'ADD TEMP[117], TEMP[9], IN[1]'], ok=False)
        add('reject-conditional-unsafe-immediate', stage, trigger + ['ADD TEMP[117], CONST[0], IMM[1].wwww'], ok=False)
        # Prove both shortest bound and failure after the retry-triggering prefix.
        overhead = 4 if stage == 'vertex' else 3
        for total in (179, 180):
            add(f'instruction-count-{total}', stage,
                ['MOV TEMP[117], IN[1]'] + ['ADD TEMP[117].x, CONST[0].xxxx, TEMP[117].xxxx'] * (total - overhead),
                ok=total == 179)
        add('reject-conditional-emitter-overflow', stage,
            ['MAD TEMP[117], CONST[45], CONST[0], CONST[45]'] * (179 - (3 if stage == 'vertex' else 2)), ok=False)
    add('reject-vertex-TEX', 'vertex', ['ADD TEMP[8], CONST[45], IN[1]', 'TEX TEMP[117], CONST[0], SAMP[7], 2D'], ok=False)
    interfaces = json.loads((ROOT / 'renderer/virgl-shader/tests/dot-reciprocal-hardware.json').read_text())
    for stage in ('vertex', 'fragment'):
        old = next(c for c in interfaces['shaders'] if c['name'] == 'raw-' + stage)
        before = 'DP3 TEMP[117], ' + ('IN[1], IN[2]' if stage == 'vertex' else 'IN[2], IN[3]')
        after = 'DP3 TEMP[117], CONST[45], ' + ('IN[2]' if stage == 'vertex' else 'IN[3]')
        assert old['text'].count(before) == 1
        CASES.append({'name': 'conditional-interface-' + stage, 'stage': stage,
                      'text': old['text'].replace(before, after), 'ok': True, 'expected': expectation(stage)})
    assert len({c['name'] for c in CASES}) == len(CASES)
    (ROOT / 'renderer/virgl-shader/tests/constant-compiler-cases.json').write_text(json.dumps(CASES, indent=2) + '\n')
    print(json.dumps({'cases': len(CASES), 'positive': sum(c['ok'] for c in CASES), 'negative': sum(not c['ok'] for c in CASES)}))


if __name__ == '__main__': main()

#!/usr/bin/env python3
"""Literal point built-in admission; native driver separately parses TGSI."""
import json
from pathlib import Path
import struct
import sys


def program(stage, declarations, body):
    return ('VERT' if stage == 0 else 'FRAG') + '\n' + declarations + '\n' + ''.join(
        f'{i}: {instruction}\n' for i, instruction in enumerate([*body, 'END']))


def main(output):
    output.mkdir(parents=True, exist_ok=True)
    cases = []
    def add(name, a, kind=0, okay=True, b='', code=None):
        cases.append(dict(name=name, a=a, b=b, kind=kind, okay=okay, code=code))
    vertex = program(0, 'DCL IN[0]\nDCL IN[1]\nDCL OUT[0], POSITION\nDCL OUT[31], PSIZE',
                     ['MOV OUT[0], IN[0]', 'MOV OUT[31], IN[1]'])
    add('point-size-full-original', vertex)
    for index in [1, 7, 31]:
        for mask in ['', '.x']:
            for sid in ['', '[0]']:
                v = program(0, f'DCL IN[0]\nDCL IN[1]\nDCL OUT[0], POSITION\nDCL OUT[{index}]{mask}, PSIZE{sid}',
                            ['MOV OUT[0], IN[0]', f'MOV OUT[{index}].x, IN[1].xxxx'])
                add(f'psize-{index}-{mask}-{sid}', v)
    fragments = []
    for file, indices in [('IN', [0, 7, 31]), ('SV', [0, 1])]:
        for mask, swizzle in [('', 'xyzw'), ('.xy', 'yxxx'), ('.z', 'zzzz'), ('.w', 'wwww')]:
            for sid in ['', '[0]']:
                for index in indices:
                    declarations = f'DCL {file}[{index}]{mask}, PCOORD{sid}' + (', LINEAR' if file == 'IN' else '')
                    source = program(1, declarations + '\nDCL OUT[0], COLOR',
                                     [f'MOV OUT[0], {file}[{index}].{swizzle}'])
                    add(f'pcoord-{file}-{index}-{mask}-{sid}', source, kind=1)
                    fragments.append(source)
    for index in [0, 1]:
        alias = program(1, f'PROPERTY FS_COORD_ORIGIN LOWER_LEFT\nPROPERTY FS_COORD_PIXEL_CENTER HALF_INTEGER\nDCL IN[{index}], PCOORD, LINEAR\nDCL SV[{index}], PCOORD\nDCL CONST[511]\nDCL CONST[0]\nDCL TEMP[0]\nDCL OUT[0], COLOR\nIMM[0] FLT32 {{0.5,0.5,0.5,0.5}}',
                        [f'ADD TEMP[0], IN[{index}], SV[{index}]', 'MUL TEMP[0], TEMP[0], IMM[0]', 'ADD OUT[0], TEMP[0], CONST[0]'])
        add(f'physical-input-system-alias-{index}', alias, kind=1)
        add(f'pair-physical-input-system-alias-{index}', vertex, kind=2, b=alias)
    for i, fragment in enumerate(fragments):
        add(f'point-pair-{i}', vertex, kind=2, b=fragment)
    # Large original token stream exercises the fixed heap alias arena without
    # inventing numerical authority for indirect loads or loops.
    declarations = '\n'.join(f'DCL CONST[{i}]' for i in reversed(range(512)))
    large = program(1, declarations + '\nDCL ADDR[0]\nDCL SV[1], PCOORD\nDCL TEMP[0]\nDCL OUT[0], COLOR',
                    ['UARL ADDR[0].x, SV[1].xxxx'] + ['MAD TEMP[0], SV[1], SV[1], SV[1]'] * 765 + ['MOV OUT[0], TEMP[0]'])
    add('large-adapter-output-bound-reject', large, kind=1, okay=False, code='translation-error')
    add('large-bounded-system-adapter', program(1, declarations + '\nDCL SV[1], PCOORD\nDCL TEMP[0]\nDCL OUT[0], COLOR',
        ['MOV TEMP[0], SV[1]'] * 766 + ['MOV OUT[0], TEMP[0]']), kind=1)
    for stage, declaration in [(0, 'DCL OUT[1], PCOORD'), (0, 'DCL SV[0], PCOORD'),
        (0, 'DCL OUT[1], PSIZE[1]'), (0, 'DCL OUT[1], PSIZE\nDCL OUT[2], PSIZE'),
        (1, 'DCL OUT[1], PSIZE'), (1, 'DCL IN[0], PSIZE, LINEAR'),
        (1, 'DCL SV[0], PSIZE'), (1, 'DCL IN[0], PCOORD, CONSTANT'),
        (1, 'DCL IN[0], PCOORD, PERSPECTIVE'), (1, 'DCL IN[0], PCOORD[1], LINEAR'),
        (1, 'DCL SV[0], PCOORD[1]'), (1, 'DCL SV[0], PCOORD, LINEAR'),
        (1, 'DCL SV[0], PCOORD\nDCL SV[1], PCOORD'),
        (1, 'DCL IN[0], PCOORD, LINEAR\nDCL IN[1], PCOORD, LINEAR'),
        (1, 'DCL OUT[1], PCOORD')]:
        a = program(stage, 'DCL CONST[0]\nDCL OUT[0], ' + ('POSITION' if stage == 0 else 'COLOR') + '\n' + declaration,
                    ['MOV OUT[0], CONST[0]'])
        add(f'rejected-declaration-{len(cases)}', a, kind=stage, okay=False, code='unsupported-feature')
    for stage, text in [(0, vertex), (1, fragments[0])]:
        add(f'legacy-point-{stage}', text, kind=stage + 3, okay=False)
    for fragment in [fragments[-1], fragments[0]]:
        add(f'legacy-point-pair-{len(cases)}', vertex, kind=5, b=fragment, okay=False)
    binary = struct.pack('<I', len(cases))
    for case in cases:
        binary += struct.pack('<I', case['kind'])
        for name in ['a', 'b']:
            data = case[name].encode()
            binary += struct.pack('<I', len(data)) + data
    (output / 'cases.bin').write_bytes(binary)
    (output / 'cases.json').write_text(json.dumps({'schema': 1, 'task': 'E6-T11d11', 'cases': cases}, indent=2) + '\n')
    print(f'Wrote {len(cases)} literal original point compiler cases')


if __name__ == '__main__':
    main(Path(sys.argv[1]))

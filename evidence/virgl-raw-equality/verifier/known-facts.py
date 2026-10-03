#!/usr/bin/env python3
"""Independently seeded public-API admission checks and a real source-fault control."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

SEEDS = [0x615A4EC7, 0xCAB92135, 0x037D8A61, 0x92F460BD]
EXCEPTIONAL = [0, 0x80000000, 1, 0x80000001, 0x7FFFFF, 0x800000,
               0x3F800000, 0xBF800000, 0x7F800000, 0xFF800000,
               0x7F800001, 0xFF800001, 0x7FC00001, 0xFFC00001,
               0x7FFFFFFF, 0xFFFFFFFF, 0x7FC12345]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def eq(a, b):
    def nan(x):
        return (x >> 23) & 255 == 255 and x & 0x7FFFFF != 0
    return not (nan(a) or nan(b)) and (a == b or (a << 1) & 0xFFFFFFFF == 0
                                      and (b << 1) & 0xFFFFFFFF == 0)


def shader(stage, opcode, a, b, alias, negative=False):
    left, right = a[:], b[:]
    reads = f'{opcode} TEMP[0], IMM[0], IMM[1]'
    if alias == 'left':
        left, right = a[::-1], [b[1], b[0], b[3], b[2]]
        reads = 'MOV TEMP[0], IMM[0]\nMOV TEMP[1], IMM[1]\n' + \
            f'{opcode} TEMP[0], TEMP[0].wzyx, TEMP[1].yxwz'
    elif alias == 'right':
        left, right = [a[2], a[3], a[0], a[1]], b[::-1]
        reads = 'MOV TEMP[0], IMM[0]\nMOV TEMP[1], IMM[1]\n' + \
            f'{opcode} TEMP[1], TEMP[0].zwxy, TEMP[1].wzyx\nMOV TEMP[0], TEMP[1]'
    masks = [(eq(x, y) if opcode == 'FSEQ' else not eq(x, y)) for x, y in zip(left, right)]
    yes = [0x7FC01234 if chosen == negative else 0x3F800000 for chosen in masks]
    no = [0x3F800000 if chosen == negative else 0x7FC01234 for chosen in masks]
    declarations = ['VERT', 'DCL IN[0]', 'DCL OUT[0], POSITION', 'DCL OUT[1], GENERIC[0]'] \
        if stage == 'vertex' else ['FRAG', 'DCL OUT[0], COLOR']
    lines = declarations + ['DCL TEMP[0..1]']
    for n, words in enumerate([a, b, yes, no]):
        lines.append(f'IMM[{n}] UINT32 ' + '{' + ','.join(str(x) for x in words) + '}')
    lines += [reads, 'UCMP TEMP[1], TEMP[0], IMM[2], IMM[3]',
              'MOV ' + ('OUT[1]' if stage == 'vertex' else 'OUT[0]') + ', TEMP[1]']
    if stage == 'vertex':
        lines.append('MOV OUT[0], IN[0]')
    return '\n'.join(lines + ['END']) + '\n', masks


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--root', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    p.add_argument('--fault-binary', required=True, type=Path)
    args = p.parse_args()
    args.output.mkdir(exist_ok=True)
    run = subprocess.run(['bash', 'renderer/virgl-shader/build.sh', 'native'],
                         cwd=args.root, capture_output=True, timeout=120)
    (args.output / 'native-build.log').write_bytes(run.stdout + run.stderr)
    assert run.returncode == 0
    binary = args.root / 'renderer/virgl-shader/build/native/virgl-shader'
    transcript = []
    calls = 0

    def call(text, stage, positive, name, program=binary):
        nonlocal calls
        run = subprocess.run([str(program), stage], input=text.encode(), capture_output=True, timeout=10)
        assert run.returncode == 0 and not run.stderr, (name, run.returncode, run.stderr)
        result = json.loads(run.stdout)
        assert result['ok'] is positive, (name, result)
        if positive:
            assert result['metadata']['profile'] == 'virgl-webgl2-raw-bits-v13'
            assert not any(key in result['metadata'] for key in
                           ('constantDomains', 'constantAccesses', 'constantConstraints'))
        else:
            assert set(result) == {'ok', 'error'} and result['error']['code'] == 'unsupported-feature'
        transcript.append({'index': calls, 'name': name, 'stage': stage, 'input': text,
                           'inputSha256': sha(text.encode()), 'programSha256': sha(program.read_bytes()),
                           'result': result, 'stdoutSha256': sha(run.stdout)})
        calls += 1

    for seed in SEEDS:
        state = seed
        def random32():
            nonlocal state
            state ^= (state << 13) & 0xFFFFFFFF
            state ^= state >> 17
            state ^= (state << 5) & 0xFFFFFFFF
            state &= 0xFFFFFFFF
            return state
        for vector in range(32):
            a = [EXCEPTIONAL[random32() % len(EXCEPTIONAL)] if lane % 2 else random32()
                 for lane in range(4)]
            b = [a[lane] if random32() % 3 == 0 else EXCEPTIONAL[random32() % len(EXCEPTIONAL)]
                 for lane in range(4)]
            for opcode in ('FSEQ', 'FSNE'):
                for alias in ('none', 'left', 'right'):
                    for stage in ('vertex', 'fragment'):
                        for negative in (False, True):
                            text, masks = shader(stage, opcode, a, b, alias, negative)
                            name = f'{seed:08x}/{vector}/{opcode}/{alias}/{stage}/unsafe={negative}'
                            call(text, stage, not negative, name)
    # Unknown self-comparisons cannot authorize a NaN-bearing direct output.
    for stage in ('vertex', 'fragment'):
        for opcode in ('FSEQ', 'FSNE'):
            text, _ = shader(stage, opcode, [0]*4, [0]*4, 'none')
            text = text.replace('DCL TEMP[0..1]', 'DCL TEMP[0..1]\nDCL CONST[0]')
            text = text.replace(f'{opcode} TEMP[0], IMM[0], IMM[1]',
                                f'{opcode} TEMP[0], CONST[0], CONST[0]')
            call(text, stage, False, 'unknown-self/' + opcode + '/' + stage)
            # Masking the unknown operand to a complete signed-zero fact restores admission.
            text = text.replace(f'{opcode} TEMP[0], CONST[0], CONST[0]',
                                'AND TEMP[0], CONST[0], IMM[0]\n' +
                                f'{opcode} TEMP[0], TEMP[0], IMM[1]')
            call(text, stage, True, 'derived-complete-facts/' + opcode + '/' + stage)
    # The independently authored identical signaling NaN witness is safe on the
    # healthy compiler and rejects under the actual known-fact source mutation.
    for stage in ('vertex', 'fragment'):
        for opcode in ('FSEQ', 'FSNE'):
            text, _ = shader(stage, opcode, [0x7F800005]*4, [0x7F800005]*4, 'none')
            call(text, stage, True, 'signaling-same-word/' + opcode + '/' + stage)
            call(text, stage, False, 'known-nan-source-sabotage/' + opcode + '/' + stage,
                 args.fault_binary)
    log = ''.join(json.dumps(record, separators=(',', ':')) + '\n' for record in transcript).encode()
    (args.output / 'calls.jsonl').write_bytes(log)
    sources = []
    for path in ['renderer/virgl-shader/raw_bits.c', 'renderer/virgl-shader/raw_bits.h',
                 'renderer/virgl-shader/bridge.c', 'renderer/virgl-shader/build.sh']:
        raw = (args.root / path).read_bytes()
        sources.append({'path': path, 'bytes': len(raw), 'sha256': sha(raw)})
    report = {'schema': 'fresh-raw-equality-known-facts-v1', 'status': 'passed',
              'seeds': [f'{seed:08x}' for seed in SEEDS], 'vectorsPerSeed': 32,
              'calls': calls, 'sources': sources, 'binarySha256': sha(binary.read_bytes()),
              'faultBinarySha256': sha(args.fault_binary.read_bytes()),
              'transcript': {'path': 'calls.jsonl', 'bytes': len(log), 'sha256': sha(log)}}
    (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()

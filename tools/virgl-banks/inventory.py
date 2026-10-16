#!/usr/bin/env python3
"""Inventory unchanged captured TGSI bytes without invoking the translator."""
import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
FILES = ('IN', 'OUT', 'TEMP', 'CONST', 'IMM', 'SAMP', 'SVIEW', 'ADDR', 'GENERIC')
REGISTER = re.compile(r'\b(' + '|'.join(FILES) + r')\[([0-9]+)(?:\.\.([0-9]+))?\]')
INSTRUCTION = re.compile(r'\s*([0-9]+):\s*([A-Z][A-Z0-9_]*)(.*)')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def inventory():
    contract = json.loads((ROOT / 'docs/gpu-3d-contract.json').read_text())
    originals = {}
    for workload in ('textured-scene', 'kmscube', 'glmark2-es2', 'compositor'):
        for path in sorted((ROOT / 'evidence/virgl-corpus/captures' / workload / 'shaders').glob('*.tgsi')):
            raw = path.read_bytes()
            digest = sha(raw)
            require(digest == path.stem, f'original SHA differs from filename: {path}')
            if digest in originals:
                originals[digest]['paths'].append(str(path.relative_to(ROOT)))
                continue
            lines = [line for line in raw.decode('ascii').splitlines() if line.strip()]
            require(lines[0] in ('VERT', 'FRAG'), 'original stage header')
            declared = {file: None for file in FILES}
            direct = {file: None for file in FILES}
            opcodes = []
            for line in lines[1:]:
                instruction = INSTRUCTION.fullmatch(line)
                if instruction:
                    require(int(instruction[1]) == len(opcodes), 'original instruction labels must be sequential')
                    opcodes.append(instruction[2])
                    require('..' not in line, 'unexpected range in original instruction')
                    target = direct
                else:
                    require(line.startswith(('DCL ', 'IMM[', 'PROPERTY ')), 'unclassified original line')
                    target = declared
                for register in REGISTER.finditer(line):
                    index = int(register[3] or register[2])
                    key = register[1]
                    target[key] = max(target[key] if target[key] is not None else -1, index)
            require(opcodes and opcodes[-1] == 'END' and opcodes.count('END') == 1, 'one final original END')
            originals[digest] = {
                'sha256': digest, 'paths': [str(path.relative_to(ROOT))], 'bytes': len(raw),
                'stage': 'vertex' if lines[0] == 'VERT' else 'fragment',
                'nonemptyLines': len(lines), 'maximumLineBytes': max(len(line.encode('ascii')) for line in lines),
                'instructionsIncludingEnd': len(opcodes), 'nonEndInstructions': len(opcodes) - 1,
                'declaredMaxima': declared, 'directMaxima': direct,
                'preciseInstructions': [{'label': i, 'opcode': op} for i, op in enumerate(opcodes) if op.endswith('_PRECISE')],
            }
    require(len(originals) == 19 and set(originals) == set(contract['capturedShaders']), 'unchanged nineteen-hash corpus')
    records = [originals[digest] for digest in sorted(originals)]
    maxima = {}
    for key in ('bytes', 'nonemptyLines', 'maximumLineBytes', 'instructionsIncludingEnd', 'nonEndInstructions'):
        maximum = max(record[key] for record in records)
        maxima[key] = {'value': maximum, 'witnesses': [record['sha256'] for record in records if record[key] == maximum]}
    for section in ('declaredMaxima', 'directMaxima'):
        maxima[section] = {}
        for file in FILES:
            maximum = max((record[section][file] for record in records if record[section][file] is not None), default=None)
            maxima[section][file] = {'value': maximum, 'witnesses': [record['sha256'] for record in records
                if maximum is not None and record[section][file] == maximum]}
    expected = {'bytes': 8800, 'nonemptyLines': 191, 'maximumLineBytes': 80,
                'instructionsIncludingEnd': 179, 'nonEndInstructions': 178}
    require({key: maxima[key]['value'] for key in expected} == expected, 'original syntax maxima changed')
    require(maxima['declaredMaxima']['TEMP']['value'] == 117
            and maxima['directMaxima']['TEMP']['value'] == 113
            and maxima['declaredMaxima']['CONST']['value'] == 45
            and maxima['directMaxima']['CONST']['value'] == 25, 'original bank maxima changed')
    require(sum(bool(record['preciseInstructions']) for record in records) == 7
            and sum(len(record['preciseInstructions']) for record in records) == 12, 'original PRECISE inventory changed')
    return {'schema': 'wasm-vm-bank-inventory-v1', 'status': 'passed', 'originals': records, 'maxima': maxima,
            'admittedLimits': {'TEMP': 117, 'CONST': 45, 'IN': 7, 'OUT': 7, 'IMM': 7,
                               'SAMP': 7, 'SVIEW': 7, 'GENERIC': 7, 'nonEndInstructions': 179},
            'boundary': 'Original syntax inventory only; shader outcomes and execution require separate evidence.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = inventory()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print('Original inventory: 19 hashes; TEMP117/CONST45 declarations; 178 non-END instructions; seven PRECISE bodies.')


if __name__ == '__main__':
    main()

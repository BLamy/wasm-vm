#!/usr/bin/env python3
"""Fresh-critic literal TGSI and physical-source regression, independent of oracle.mjs.

Usage: python3 tools/virgl-original-corpus/verifier.py <gpu/report.json> [...]
Only captured instructions, recorded inputs and physical bytes supply predictions.
Undefined varying lanes are excluded; ordinary lighting gets the stated 8 ULP.
"""
import hashlib
import json
import math
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LANES = 'xyzw'
TEXELS = [255, 153, 3, 255, 9, 255, 153, 128,
          90, 30, 240, 64, 39, 252, 123, 0]


def require(value, label):
    if not value:
        raise AssertionError(label)


def number(word):
    return struct.unpack('<f', struct.pack('<I', word))[0]


def word(value):
    try:
        return struct.unpack('<I', struct.pack('<f', value))[0]
    except OverflowError:
        return 0xff800000 if value < 0 else 0x7f800000


def distance(a, b):
    if number(a) == number(b):
        return 0
    key = lambda x: 0x80000000 - (x & 0x7fffffff) if x >> 31 else 0x80000000 + x
    return abs(key(a) - key(b))


def divide(a, b):
    if b == 0:
        return math.nan if a == 0 else math.copysign(math.inf, a * math.copysign(1, b))
    return a / b


def execute(text, inputs, constants):
    """Restricted literal interpreter; it never reads compiler metadata or emitted GLSL."""
    registers = {f'IN[{index}]': value[:] for index, value in enumerate(inputs)}
    registers.update({f'CONST[{index // 4}]': constants[index:index + 4]
                      for index in range(0, len(constants), 4)})
    instructions, stack, ends, alternate = [], [], {}, {}
    for line in text.splitlines():
        line = re.sub(r'^\s*\d+:\s*', '', line.strip())
        if not line or re.match(r'^(VERT|FRAG|PROPERTY|DCL)\b', line):
            continue
        if line.startswith('IMM'):
            match = re.fullmatch(r'IMM\[(\d+)\] (UINT32|FLT32) \{([^}]+)\}', line)
            require(match is not None, 'literal immediate grammar')
            values = [x.strip() for x in match[3].split(',')]
            registers[f'IMM[{int(match[1])}]'] = [int(x) if match[2] == 'UINT32'
                                                  else word(float(x)) for x in values]
            continue
        op, _, body = line.partition(' ')
        require('_' not in op or op.endswith('_PRECISE'), 'no ignored instruction modifier')
        instructions.append((op.removesuffix('_PRECISE'), re.sub(r'\s*:\d+$', '', body)))
    for index, (op, _) in enumerate(instructions):
        if op in ('UIF', 'BGNLOOP'):
            stack.append((op, index))
        elif op == 'ELSE':
            require(stack[-1][0] == 'UIF', 'literal else scope')
            alternate[stack[-1][1]] = index
        elif op in ('ENDIF', 'ENDLOOP'):
            begin, start = stack.pop()
            require(begin == ('UIF' if op == 'ENDIF' else 'BGNLOOP'), 'literal end scope')
            ends[start] = index
            if start in alternate:
                ends[alternate[start]] = index
    require(not stack, 'closed literal control')
    address, loops, reads, branches, frames = None, [], [], [], []

    def operand(value):
        if value.startswith('CONST[ADDR[0].x]'):
            require(type(address) is int and 0 <= address < 46, 'initialized bounded address')
            reads.append(address)
            return f'CONST[{address}]', value.partition('].x]')[2].removeprefix('.') or LANES
        match = re.fullmatch(r'(IN|OUT|TEMP|CONST|IMM|ADDR)\[(\d+)\](?:\.([xyzw]{1,4}))?', value)
        require(match is not None, 'literal operand ' + value)
        return f'{match[1]}[{int(match[2])}]', match[3] or LANES

    def read(value, lane):
        negative = value.startswith('-')
        key, swizzle = operand(value[1:] if negative else value)
        component = LANES.index(swizzle[0] if len(swizzle) == 1 else swizzle[lane])
        result = registers.get(key, [None] * 4)[component]
        require(type(result) is int and 0 <= result <= 0xffffffff, f'defined literal {value}/{lane}')
        return result ^ 0x80000000 if negative else result

    pc = steps = 0
    while pc < len(instructions):
        steps += 1
        require(steps <= 10000, 'literal bounded execution')
        op, body = instructions[pc]
        if op == 'UIF':
            taken = read(body, 0) != 0
            branches.append((pc, taken))
            if not taken:
                pc = alternate.get(pc, ends[pc])
        elif op == 'ELSE':
            pc = ends[pc]
        elif op == 'BGNLOOP':
            frame = {'start': pc, 'end': ends[pc], 'iterations': 1}
            frames.append(frame)
            loops.append(frame)
        elif op == 'ENDLOOP':
            frame = frames[-1]
            frame['iterations'] += 1
            require(frame['iterations'] <= 18, 'literal eighteen-iteration maximum')
            pc = frame['start']
        elif op == 'BRK':
            pc = frames.pop()['end']
        elif op == 'END':
            require(not frames, 'literal loop terminates')
            break
        elif op != 'ENDIF':
            destination, *sources = re.split(r'\s*,\s*', body)
            if op == 'TEX':
                require(sources[1:] == ['SAMP[0]', '2D'], 'literal texture target')
                uv = [number(read(sources[0], i)) for i in (0, 1)]
                texel = (max(0, min(1, int(math.floor(uv[0] * 2)))) +
                         2 * max(0, min(1, int(math.floor(uv[1] * 2))))) * 4
                result = [word(value / 255) for value in TEXELS[texel:texel + 4]]
            elif op == 'DP3':
                products = [number(word(number(read(sources[0], i)) * number(read(sources[1], i))))
                            for i in range(3)]
                result = [word(number(word(products[0] + products[1])) + products[2])] * 4
            else:
                result = [None] * 4
            key, mask = operand(destination)
            snapshot = []
            for component in mask:
                lane = LANES.index(component)
                if op in ('TEX', 'DP3'):
                    value = result[lane]
                elif op == 'UCMP':
                    value = read(sources[1] if read(sources[0], lane) else sources[2], lane)
                else:
                    bits = [read(source, lane) for source in sources]
                    values = [number(value) for value in bits]
                    if op in ('MOV', 'UARL'): value = bits[0]
                    elif op == 'MUL': value = word(values[0] * values[1])
                    elif op == 'ADD': value = word(values[0] + values[1])
                    elif op == 'DIV': value = word(divide(*values))
                    elif op == 'RSQ': value = word(divide(1, math.sqrt(abs(values[0]))))
                    elif op == 'RCP': value = word(divide(1, values[0]))
                    elif op == 'FRC': value = word(values[0] - math.floor(values[0]))
                    elif op == 'LRP':
                        value = word(number(word(values[0] * values[1])) +
                                     number(word(number(word(1 - values[0])) * values[2])))
                    elif op == 'MAX': value = bits[0] if values[0] > values[1] else bits[1]
                    elif op in ('FSEQ', 'FSNE', 'FSLT', 'FSGE'):
                        test = {'FSEQ': values[0] == values[1], 'FSNE': values[0] != values[1],
                                'FSLT': values[0] < values[1], 'FSGE': values[0] >= values[1]}[op]
                        value = 0xffffffff if test else 0
                    elif op in ('USEQ', 'USNE'): value = 0xffffffff if ((bits[0] == bits[1]) == (op == 'USEQ')) else 0
                    elif op == 'ISGE':
                        signed = lambda x: x - 0x100000000 if x & 0x80000000 else x
                        value = 0xffffffff if signed(bits[0]) >= signed(bits[1]) else 0
                    elif op == 'UADD': value = (bits[0] + bits[1]) & 0xffffffff
                    elif op == 'SHL': value = (bits[0] << (bits[1] & 31)) & 0xffffffff
                    elif op == 'USHR': value = bits[0] >> (bits[1] & 31)
                    elif op == 'OR': value = bits[0] | bits[1]
                    elif op == 'AND': value = bits[0] & bits[1]
                    elif op == 'NOT': value = bits[0] ^ 0xffffffff
                    else: raise AssertionError('unsupported literal opcode ' + op)
                snapshot.append((lane, value))
            previous = registers.get(key, [None] * 4)[:]
            for lane, value in snapshot:
                previous[lane] = value
            registers[key] = previous
            if op == 'UARL': address = previous[0]
        pc += 1
    return registers, loops, reads, branches


def audit(path):
    record = json.loads(Path(path).read_text())
    acceptance = record['acceptance']
    require(record['status'] == 'passed' and acceptance['status'] == 'passed', 'passed physical capture')
    originals = {e['sha256']: e for e in acceptance['originals']}
    require(len(originals) == 19, 'nineteen unique original inputs')
    for entry in originals.values():
        require(hashlib.sha256(entry['text'].encode()).hexdigest() == entry['sha256'], 'unchanged original body')
        require((ROOT / entry['path']).read_text() == entry['text'], 'literal captured source')
    # The recording order comes from the actual createProgram calls, not membership
    # in a pool of valid sources. Substituting another valid original must fail.
    expected_programs = [pair for pair in acceptance['pairs'] if pair['ok']]
    expected_programs += [next(pair for pair in acceptance['pairs']
                              if pair['vertex'] == vertex['pair'][0] and pair['fragment'] == vertex['pair'][1])
                          for vertex in acceptance['vertices']]
    expected_programs += [{'result': migration['result']} for migration in acceptance['migrations']]
    expected_programs += [next(pair for pair in acceptance['pairs']
                              if pair['vertex'] == fragment['pair'][0] and pair['fragment'] == fragment['pair'][1])
                          for fragment in acceptance['fragments']]
    events = acceptance['events']
    actual_sources = [event['source'] for event in events if event['call'] == 'shaderSource']
    wanted_sources = [pair['result'][stage]['glsl'] for pair in expected_programs
                      for stage in ('vertex', 'fragment')]
    require(actual_sources == wanted_sources, 'ordered actual original shaderSource sequence')
    require(sum(event['call'] == 'createProgram' for event in events) == 80, 'all actual programs created')
    require(sum(event['call'] == 'compileShader' and event['status'] is True for event in events) == 160,
            'all original stage compilations')
    require(sum(event['call'] == 'linkProgram' and event['status'] is True for event in events) == 92,
            'all original program links and feedback relinks')
    words = pixels = migration_words = 0
    maximum_ulp, loop_iterations = {}, []
    for vertex in acceptance['vertices']:
        original = originals[vertex['sha256']]
        for item in vertex['vectors']:
            vector = item['vector']
            state, _, _, _ = execute(original['text'], [[word(x) for x in row] for row in vector['inputs']],
                                      [word(x) for row in vector['constants'] for x in row])
            expected = state['OUT[0]'] + state.get('OUT[1]', [])
            for lane, wanted in enumerate(expected):
                if wanted is None: continue
                actual = item['observed'][lane]
                budget = 8 if lane >= 4 and original['sha256'][:8] in ('12f6d594', 'd4f702f7') else 0
                delta = distance(actual, wanted)
                require(math.isfinite(number(actual)) and delta <= budget,
                        f'literal vertex {original["sha256"]}/{vector["name"]}/{lane}: {actual} vs {wanted}')
                maximum_ulp[original['sha256']] = max(maximum_ulp.get(original['sha256'], 0), delta)
                words += 1
    for fragment in acceptance['fragments']:
        original, partner = originals[fragment['sha256']], originals[fragment['pair'][0]]
        for item in fragment['draws']:
            vector = item['vector']
            if original['probe'] == 'gradient':
                inputs, constants = [[word(x) for x in [*vector['uv'], 0, 1]]], vector['bank']
                budget = 1
            else:
                constants = [word(x) for x in vector['constants']]
                if partner['sha256'].startswith('12f6d594'):
                    identity = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
                    state, _, _, _ = execute(partner['text'],
                        [[word(x) for x in row] for row in [[0, 0, 0, 1], vector['normal'], [*vector['uv'], 0, 1]]],
                        [word(x) for row in identity * 2 for x in row])
                    inputs, budget = [state['OUT[1]']], 1
                elif partner['sha256'].startswith('3f78a90d'):
                    state, _, _, _ = execute(partner['text'], [[word(x) for x in [0, 0, 0, 1]]],
                        [word(x) for row in [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 0], vector['constants']] for x in row])
                    inputs, budget = [state['OUT[1]']], 0
                else:
                    inputs, budget = [[word(x) for x in [*vector['uv'], 0, 1]]], 0
            state, loops, addresses, _ = execute(original['text'], inputs, constants)
            loop_iterations.extend(loop['iterations'] for loop in loops)
            require(all(0 <= index < 46 for index in addresses), 'bounded literal original reads')
            color = [max(0, min(255, int(math.floor(number(value) * 255 + .5)))) for value in state['OUT[0]']]
            require(all(abs(value - color[lane % 4]) <= budget for lane, value in enumerate(item['rgbaBytes'])),
                    f'literal fragment {original["sha256"]}/{vector["name"]}')
            pixels += len(item['rgbaBytes']) // 4
    for migration in acceptance['migrations']:
        for item in migration['probe']['vectors']:
            state, _, _, _ = execute(migration['text'], [[word(x) for x in row] for row in item['vector']['inputs']], [])
            require(all(distance(a, b) == 0 for a, b in zip(item['observed'], state['OUT[0]'])),
                    'separate historical position identity')
            migration_words += 4
    require((words, pixels, migration_words) == (1536, 155648, 512), 'literal original observation inventory')
    require(loop_iterations and max(loop_iterations) == 18, 'original maximum loop executed')
    return {'report': str(path), 'seed': acceptance['seed'], 'words': words, 'pixels': pixels,
            'migrationWords': migration_words, 'maximumUlp': maximum_ulp,
            'maximumLoopIterations': max(loop_iterations), 'status': 'passed'}


if __name__ == '__main__':
    require(len(sys.argv) > 1, 'name physical report files')
    for filename in sys.argv[1:]:
        print(json.dumps(audit(filename), sort_keys=True))

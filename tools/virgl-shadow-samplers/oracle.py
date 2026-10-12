#!/usr/bin/env python3
"""Replay original TGSI words against authenticated native inputs and whole planes.

This oracle does not read generated ESSL or the JavaScript fixture's expectedWords.
Its tiny TGSI interpreter is deliberately restricted to the recorded physical probes.
Comparison-linear probes have constant depth in each complete level: every filter tap
therefore has the same result, including on implementations with different PCF rules.
"""
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import sys

sha = lambda raw: hashlib.sha256(raw).hexdigest()
u32 = lambda raw, at=0: struct.unpack_from('<I', raw, at)[0]
f32 = lambda raw, at=0: struct.unpack_from('<f', raw, at)[0]
fw = lambda value: struct.unpack('<I', struct.pack('<f', value))[0]
wf = lambda value: struct.unpack('<f', struct.pack('<I', value & 0xffffffff))[0]
handle = lambda value: value['handle'] if value else None
MASK = 0xffffffff


def declarations(text, direction):
    return {int(m[1]): int(m[2]) for m in re.finditer(
        r'^DCL '+direction+r'\[(\d+)\], GENERIC\[(\d+)\]', text, re.M)}


def source(expression, registers):
    negative = expression.startswith('-')
    expression = expression.removeprefix('-')
    absolute = expression.startswith('|')
    if absolute:
        assert expression.endswith('|')
        expression = expression[1:-1]
    match = re.fullmatch(r'(IN|OUT|TEMP|IMM|SV)\[(\d+)\](?:\.([xyzw]{4}))?', expression)
    assert match, expression
    words = registers[(match[1], int(match[2]))]
    words = [words['xyzw'.index(c)] for c in (match[3] or 'xyzw')]
    if absolute:
        words = [w & 0x7fffffff for w in words]
    if negative:
        words = [w ^ 0x80000000 for w in words]
    return words


def execute(text, inputs, vertex, instance, base, sampler, depth, view, derivatives=None):
    regs = {('IN', index): words for index, words in inputs.items()}
    for match in re.finditer(r'^IMM\[(\d+)\] (UINT32|INT32|FLT32) \{([^}]+)\}', text, re.M):
        regs[('IMM', int(match[1]))] = [fw(float(n)) if match[2]=='FLT32' else int(n.strip()) & MASK for n in match[3].split(',')]
    for match in re.finditer(r'^DCL SV\[(\d+)\], (INSTANCEID|VERTEXID)', text, re.M):
        regs[('SV', int(match[1]))] = [((base + instance) if match[2] == 'INSTANCEID' else vertex) & MASK] * 4
    for match in re.finditer(r'^\d+: (\w+)(?: (.*))?$', text, re.M):
        opcode, operands = match[1], match[2]
        if opcode == 'END':
            continue
        args = operands.split(', ')
        dest = re.fullmatch(r'(OUT|TEMP)\[(\d+)\](?:\.([xyzw]+))?', args[0])
        assert dest, args[0]
        key = (dest[1], int(dest[2]))
        if opcode == 'MOV':
            value = source(args[1], regs)
        elif opcode == 'ADD':
            value = [fw(wf(a) + wf(b)) for a, b in zip(source(args[1], regs), source(args[2], regs))]
        elif opcode == 'XOR':
            value = [(a ^ b) & MASK for a, b in zip(source(args[1], regs), source(args[2], regs))]
        elif opcode == 'TXQ':
            slot=int(re.fullmatch(r'SAMP\[(\d+)\]',args[-2])[1])
            selected=sampler.get('bySlot',{}).get(slot)
            if selected:depth=selected[1]
            assert source(args[1], regs) == [0, 0, 0, 0]
            assert args[-1] in ['2D', 'SHADOW2D']
            value = [depth[0]['width'], depth[0]['height'], 0, len(depth)]
        else:
            assert opcode in ['TEX', 'TXL', 'TXD', 'TXP', 'TXB'] and args[-1] in ['SHADOW2D','2D']
            slot=int(re.fullmatch(r'SAMP\[(\d+)\]',args[-2])[1])
            selected=sampler.get('bySlot',{}).get(slot)
            current,depth,view=selected if selected else (sampler,depth,view)
            coord = [wf(w) for w in source(args[1], regs)]
            if opcode == 'TXP':
                assert coord[3] != 0
                coord = [v / coord[3] for v in coord[:3]] + [coord[3]]
            lod = 0
            if opcode == 'TXL':
                lod = coord[3]
            elif opcode == 'TXD':
                dx, dy = ([wf(w) for w in source(arg, regs)] for arg in args[2:4])
                rho = max(math.hypot(dx[0]*depth[0]['width'], dx[1]*depth[0]['height']),
                          math.hypot(dy[0]*depth[0]['width'], dy[1]*depth[0]['height']))
                lod = math.log2(rho) if rho else -math.inf
            elif opcode == 'TXB' and derivatives:
                rho = max(math.hypot(derivatives[0][0]*depth[0]['width'], derivatives[0][1]*depth[0]['height']),
                          math.hypot(derivatives[1][0]*depth[0]['width'], derivatives[1][1]*depth[0]['height']))
                lod = (math.log2(rho) if rho else -math.inf) + coord[3]
            else:
                # Point derivatives are not the oracle. These original probes make
                # every accessible level identical, so any legal implicit LOD agrees.
                assert len({level['value'] for level in depth.values()}) == 1
            lod = min(current['maxLod'], max(current['minLod'], lod))
            level = min(len(depth)-1, max(0, math.floor(lod + .5)))
            if current.get('integerColors'):
                assert args[-1]=='2D'
                value=[0 if c==4 else 1 if c==5 else depth[level]['value'][c] for c in view]
            else:
                z, ref = depth[level]['value'], coord[2]
                if current.get('fixedPoint'):
                    z, ref = min(1, max(0, z)), min(1, max(0, ref))
                compare = [False, ref < z, ref == z, ref <= z, ref > z, ref != z, ref >= z, True][current['function']]
                value = [fw(0 if c == 4 else 1 if c == 5 else int(compare)) for c in view] if args[-1]=='SHADOW2D' else [fw(0 if c==4 else 1 if c==5 else [z,0,0,1][c]) for c in view]
        out = regs.setdefault(key, [0, 0, 0, 0]).copy()
        for lane in dest[3] or 'xyzw':
            i = 'xyzw'.index(lane)
            out[i] = value[i]
        regs[key] = out
    return {index: words for (kind, index), words in regs.items() if kind == 'OUT'}

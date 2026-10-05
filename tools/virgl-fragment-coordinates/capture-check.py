#!/usr/bin/env python3
"""Independent forward source/clip-geometry audit of physical coordinate captures.

No import from the worker oracle, compiler IR, emitter or expected-pixel table.
Nearest binary32 is chosen by exact distances to neighboring representable words.
"""
from fractions import Fraction
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re
import struct
import sys

F = Fraction
SENTINEL = 0x44332211
KEY = '|tgsi-fragment-position-v1:in0/linear/lower-left/half-integer/window-z/reciprocal-w'
POLICY = dict(kind='tgsi-fragment-position-v1', stage='fragment', input=0,
              semanticIndex=0, source='gl_FragCoord', interpolation='linear',
              origin='lower-left', pixelCenter='half-integer',
              components='window-xy-depth-z-reciprocal-clip-w',
              precision='essl3-highp-builtin', rasterization='single-sample-half-pixel',
              surfaceOrigin='lower-left', authority='existing-input-no-static-range-facts')

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def require(ok, label):
    if not ok:
        raise AssertionError(label)

@lru_cache(maxsize=None)
def exact(bits):
    require((bits >> 23) & 255 != 255, 'finite scalar for rational arithmetic')
    return F(struct.unpack('<f', struct.pack('<I', bits))[0])

@lru_cache(maxsize=None)
def nearest(number):
    # The approximation proposes candidates; exact distances, not its rounding,
    # choose the result. Include both neighbors to avoid double-rounding facts.
    if not number:
        return 0
    approximate = struct.unpack('<I', struct.pack('<f', float(number)))[0]
    candidates = [w for w in range(max(0, approximate-2), min(0xffffffff, approximate+2)+1)
                  if (w >> 23) & 255 != 255]
    return min(candidates, key=lambda w: (abs(exact(w)-number), w & 1, w))

def determinant(u, v):
    return u[0]*v[1] - u[1]*v[0]

def subtract(a, b):
    return a[0]-b[0], a[1]-b[1]

@lru_cache(maxsize=None)
def project(serialized, x, y):
    geometry = json.loads(serialized)
    vx, vy, vw, vh = geometry['viewport']
    p = F(2*x+1, 2), F(2*y+1, 2)
    if not (vx <= p[0] < vx+vw and vy <= p[1] < vy+vh):
        return None
    vertices = [tuple(map(F, v)) for v in geometry['vertices']]
    require(all(v[3] > 0 for v in vertices), 'supplied positive clip-W geometry')
    screen = [(F(vx)+(v[0]/v[3]+1)*vw/2,
               F(vy)+(v[1]/v[3]+1)*vh/2) for v in vertices]
    candidates = []
    for i in range(0, len(geometry['indices']), 3):
        ids = geometry['indices'][i:i+3]
        a, b, c = (screen[j] for j in ids)
        denominator = determinant(subtract(b, a), subtract(c, a))
        wb = determinant(subtract(p, a), subtract(c, a))/denominator
        wc = determinant(subtract(b, a), subtract(p, a))/denominator
        weights = [1-wb-wc, wb, wc]
        if min(weights) < 0:
            continue
        z = sum(t*vertices[j][2]/vertices[j][3] for t, j in zip(weights, ids))
        reciprocal = sum(t/vertices[j][3] for t, j in zip(weights, ids))
        # A screen point within clip X/Y remains visible only within clip Z.
        if not (-1 <= z <= 1 and reciprocal > 0):
            continue
        near, far = map(F, geometry['depthRange'])
        coordinate = (*p, (far-near)*z/2+(far+near)/2, reciprocal)
        constant_z = len({vertices[j][2]/vertices[j][3] for j in ids}) == 1
        constant_w = len({1/vertices[j][3] for j in ids}) == 1
        candidates.append((coordinate, (False, False, not constant_z, not constant_w)))
    require(candidates, 'literal triangle actually covers the predicted viewport sample')
    require(all(c == candidates[0] for c in candidates), 'overlapping planes agree')
    return candidates[0]

@lru_cache(maxsize=None)
def interpret(text, inputs):
    """Forward scalar TGSI execution with operand snapshots before every write."""
    values = {('IN', i): list(v) for i, v in enumerate(inputs)}
    active = True
    flow = []
    exposed = None
    def source(token):
        m = re.fullmatch(r'(-?)(IN|IMM|TEMP|OUT)\[(\d+)\](?:\.([xyzw]{4}))?', token)
        require(m is not None, 'literal operand grammar '+token)
        negation, bank, index, lanes = m.groups()
        original = values[(bank, int(index))]
        return [(original['xyzw'.index(lane)][0] ^ (0x80000000 if negation else 0),
                 original['xyzw'.index(lane)][1]) for lane in lanes or 'xyzw']
    for line in text.splitlines():
        line = re.sub(r'^\s*\d+:\s*', '', line.strip())
        if not line or line.startswith(('FRAG', 'VERT', 'PROPERTY', 'DCL')):
            continue
        m = re.fullmatch(r'IMM\[(\d+)\] UINT32 \{([^}]+)\}', line)
        if m:
            values['IMM', int(m[1])] = [(int(w), False) for w in m[2].split(',')]
            continue
        op, *body = line.split(' ', 1)
        if op == 'END':
            break
        if op == 'UIF':
            condition = source(body[0])[0][0] != 0
            flow.append((active, condition))
            active = active and condition
            continue
        if op == 'ELSE':
            active = flow[-1][0] and not flow[-1][1]
            continue
        if op == 'ENDIF':
            active = flow.pop()[0]
            continue
        if not active:
            continue
        operands = body[0].split(', ')
        d = re.fullmatch(r'(TEMP|OUT)\[(\d+)\](?:\.([xyzw]+))?', operands[0])
        require(d is not None, 'literal destination grammar '+operands[0])
        bank, index, mask = d.groups()
        index = int(index)
        sources = [source(v) for v in operands[1:]]
        if op == 'USHR' and (bank, index) == ('TEMP', 1):
            exposed = sources[0][0]
        result = []
        for lane in range(4):
            a, taint_a = sources[0][lane]
            b, taint_b = sources[1][lane] if len(sources) > 1 else (0, False)
            if op == 'MOV':
                w = a
            elif op == 'AND':
                w = a & b
            elif op == 'OR':
                w = a | b
            elif op == 'USHR':
                w = a >> (b & 31)
            elif op == 'I2F':
                w = nearest(F(a if a < 1 << 31 else a-(1 << 32)))
            elif op == 'ADD':
                w = nearest(exact(a)+exact(b))
            elif op == 'MUL':
                w = nearest(exact(a)*exact(b))
            elif op == 'DIV':
                w = nearest(exact(a)/exact(b))
            else:
                raise AssertionError('unhandled literal opcode '+op)
            result.append((w, taint_a or taint_b))
        destination = values.setdefault((bank, index), [(None, False)]*4)
        for lane in mask or 'xyzw':
            n = 'xyzw'.index(lane)
            destination[n] = result[n]
    require(not flow, 'balanced source control flow')
    return exposed, values

def input_values(coordinate, variable, generic):
    return (tuple((nearest(v), t) for v, t in zip(coordinate, variable)),
            tuple((nearest(F(v)), False) for v in generic))

def audit_pixels(probe, framebuffer=(None, None), consumer=False, expect_failure=False):
    geometry = probe['geometry']
    width, height = framebuffer if consumer else (geometry['width'], geometry['height'])
    raw = bytes(probe['rgbaBytes'])
    require(len(raw) == width*height*4 and sha(raw) == probe['sha256'], 'actual complete RGBA8 digest')
    words = list(struct.unpack('<'+'I'*(width*height), raw))
    if not expect_failure:
        require(words == probe['words'] and len(words) == probe['checkedPixels'], 'all recorded complete words')
    text = probe['fragmentText'] if consumer else probe['text']
    generic = [F(1,4), F(1,2), F(3,4), F(1)] if consumer else probe['generic']
    encoded_geometry = json.dumps(geometry, sort_keys=True, separators=(',', ':'))
    maximum = F(0)
    maximum_point = None
    first = None
    failures = []
    drawn = 0
    for i, actual in enumerate(words):
        x, y = i % width, i // width
        projection = project(encoded_geometry, x, y)
        if projection is None:
            require(actual == SENTINEL, f'untouched outside viewport sample {x},{y}')
            continue
        coordinate, variable = projection
        predicted, final = interpret(text, input_values(coordinate, variable, generic))
        require(predicted is not None, 'literal full-word exposure exists')
        word, tainted = predicted
        budget = F(1, 1 << 20) if tainted else F(0)
        require(budget == 0 or (word >> 23) & 255 != 255, 'variable component remains numerical')
        error = abs(exact(actual)-exact(word)) if budget and (actual >> 23) & 255 != 255 else F(0)
        passed = actual == word if not budget else (actual >> 23) & 255 != 255 and error <= budget
        point = dict(x=x, y=y, coordinates=list(map(str, coordinate)), expectedWord=word,
                     observedWord=actual, budget=str(budget), absoluteError=str(error))
        if first is None:
            first = point
        if error > maximum:
            maximum, maximum_point = error, point
        if not passed:
            failures.append(point)
            require(expect_failure, f'forward source/geometry contradiction {probe.get("backend")}/{probe.get("variant")}/{probe.get("lane")} {x},{y}: {point}')
        drawn += 1
    if expect_failure:
        require(failures, 'source fault must contradict original forward prediction')
    return dict(pixels=len(words), drawn=drawn, sentinel=len(words)-drawn,
                rawSha256=sha(raw), first=first, maximumAbsoluteError=str(maximum),
                maximumPoint=maximum_point, failurePoints=failures[:1], failureCount=len(failures))

def main():
    report_path = Path(sys.argv[1])
    output = Path(sys.argv[2])
    source = report_path.read_bytes()
    report = json.loads(source)
    a = report['acceptance']
    failed = a.get('fault') is not None
    require(report['status'] == ('failed' if failed else 'passed'), 'record outcome')
    require(report['browserErrors'] == dict(console=[], page=[], requests=[]), 'zero browser errors')
    require(report['browser']['launch']['headless'] is False, 'headed browser')
    require(report['browser']['gpu']['featureStatus'][report['browser']['webglFeature']] == 'enabled', 'physical WebGL enabled')
    require('Apple M4 Max' in a['renderer']['renderer'] and not re.search('swiftshader|software', a['renderer']['renderer'], re.I), 'physical GPU identity')
    require(a['objects']['live'] == 0 and a['guestExecution'] is False and a['productionNegotiation'] is False, 'isolated/disposed scope')
    created, deleted = set(), set()
    for e in a['events']:
        if e['call'].startswith('create') or e['call'] == 'fenceSync':
            require(e['id'] not in created, 'unique native ownership')
            created.add(e['id'])
        if e['call'].startswith('delete'):
            require(e['id'] not in deleted, 'single native deletion')
            deleted.add(e['id'])
        if e['call'] in ['compileShader','linkProgram']:
            require(e['status'] is True, 'physical compile/link success')
    require(created == deleted and len(created) == a['objects']['created'], 'all physical GL names disposed')
    source_events = [e['source'] for e in a['events'] if e['call'] == 'shaderSource']
    transcript = []
    total = 0
    for index, probe in enumerate(a['probes']):
        require(probe['textSha256'] == sha(probe['text'].encode()), 'literal original source hash')
        require(probe['policy']['coordinates'] == POLICY and probe['pair']['interfaceKey'].endswith(KEY), 'coordinate policy/key')
        metadata = probe['pair']['fragment']['metadata']
        require(metadata['inputs'][0] == dict(index=0, name='gl_FragCoord', type='vec4', semantic='POSITION', semanticIndex=0, componentMask=15, interpolation='linear'), 'exact builtin metadata')
        primary = probe['primary']
        require(dict(index=0,last=0,semantic=0,semanticIndex=0,mask=15,interpolation=1) in primary['declarations'], 'primary POSITION tokens')
        require(primary['lowerLeftKey'] == 1 and primary['hasNoperspective'] == primary['hasSampleInput'] == 0, 'primary export excludes POSITION')
        require(primary['interstageCount'] == len([i for i in metadata['inputs'] if i['semantic'] == 'GENERIC']), 'primary ordinary interface count')
        require(dict(name=3,value=1) in primary['properties'] and dict(name=4,value=0) in primary['properties'], 'primary property values')
        reflection = probe['reflection']
        require(all(u['name'].find('FragCoord') < 0 for u in reflection['uniforms']), 'no host FragCoord uniform')
        require(all(i['name'] in ['in_0','in_1'] and i['type'] == 35666 and i['size'] == 1 for i in reflection['attributes']), 'physical attribute interface')
        expected_source = primary['glsl'] if probe['backend'] == 'mesa' else probe['pair']['fragment']['glsl']
        mutation = probe.get('mutation')
        if mutation:
            require(mutation['original'] == expected_source, 'actual original source fault site')
            require(mutation['served'] == expected_source.replace(mutation['needle'], mutation['replacement']), 'exact served source corruption')
            expected_source = mutation['served']
        require(expected_source in source_events and probe['pair']['vertex']['glsl'] in source_events, 'actual compiled sources')
        observation = audit_pixels(probe, expect_failure=bool(mutation))
        observation.update(pointer=f'/acceptance/probes/{index}', backend=probe['backend'],
                           lane=probe['lane'], variant=probe['variant'], sourceSha256=probe['textSha256'])
        transcript.append(observation)
        total += observation['pixels']
    rejection_count = 0
    schedules = []
    for ci, consumer in enumerate(a['consumers']):
        require(len(consumer['captures']) == 32 and len(consumer['rejections']) == 24, 'complete indexed boundary')
        require(all(v == 0 for v in consumer['finalBudgets'].values()) and all(v == 0 for v in consumer['finalResourceBudgets'].values()), 'zero owned budgets')
        schedules.append(consumer['commandsPerStep'])
        for submission in consumer['submissions']:
            require(all(b == 255 for b in submission['after']), 'poisoned caller wire bytes')
            if consumer['asynchronous'] and submission['begin']['ok']:
                require(submission['states'][-1]['status'] == 'done', 'bounded async completion')
                require(submission['states'][-1]['result'] == submission['result'], 'owned async result')
        for ri, rejection in enumerate(consumer['rejections']):
            require(rejection['result']['ok'] is False, 'closed consumer rejection')
            if 'before' in rejection:
                require(rejection['before'] == rejection['after'] and rejection['result']['appliedCommands'] == 0, 'atomic selector/raster rejection')
            events = rejection.get('nativeEvents', [])
            require(all(consumer['asynchronous'] and e['call'] in ['fenceSync','deleteSync'] for e in events), 'bounded async rejection fence only')
            require(len(events) <= 2, 'completion synchronization is bounded')
            rejection_count += 1
        for pi, capture in enumerate(consumer['captures']):
            require(capture['program']['interfaceKey'].endswith(KEY), 'actual cached coordinate selector')
            require(capture['result']['draws'][0]['actualMaxIndex'] == 5, 'actual retained index range')
            for v in capture['geometry']['vertices']:
                _, vertex = interpret(capture['vertexText'], (tuple((nearest(F(w)), False) for w in [*v[:2],0,1]),))
                require([exact(w) for w,_ in vertex['OUT',0]] == list(map(F,v)), 'literal consumer vertex outputs')
                require([exact(w) for w,_ in vertex['OUT',1]] == [F(1,4),F(1,2),F(3,4),F(1)], 'literal consumer GENERIC output')
            observation = audit_pixels(capture, (32,32), consumer=True)
            observation.update(pointer=f'/acceptance/consumers/{ci}/captures/{pi}', backend=capture['backend'], lane=capture['lane'], variant=capture['variant'])
            transcript.append(observation)
            total += observation['pixels']
    if not failed:
        require(total == a['checkedPixels'] == a['directPixels']+a['consumerPixels'], 'every measured framebuffer pixel checked independently')
    else:
        require(sum(bool(p.get('mutation')) for p in a['probes']) == 1, 'one actual fault')
    result = dict(schema='fragment-coordinate-independent-capture-audit-v1', status='passed',
                  sourceReport=str(report_path), sourceReportSha256=sha(source), seed=a['seed'], fault=a['fault'],
                  totalPixels=total, nativeObjects=len(created), rejections=rejection_count, schedules=schedules,
                  transcript=transcript)
    output.write_text(json.dumps(result,indent=2)+'\n')
    print(f'Independent forward audit: {total} complete component words; {rejection_count} atomic attacks; fault={a["fault"]}.')

if __name__ == '__main__':
    main()

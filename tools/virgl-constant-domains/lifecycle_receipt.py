"""Independent command-prefix, identity and asynchronous lifecycle reconstruction."""
import copy
import struct

from common import ROOT, FIXTURE, require, read
from browser_receipt import bank, raw_bank, words, finite, float_word, frame, BAD, FAULTS, SCHEDULES

SYNC = 'virgl-tiny-indexed-draw-v1'
ASYNC = 'virgl-tiny-async-jobs-v1'
DRAW_WORDS = [0, 6, 4, 1, 1, 0, 0, 0, 0, 0, 3, 0]
BUSY = {'ok': False, 'error': {'code': 'busy',
        'message': 'A renderer job is active; cancel and drain it before changing state.', 'byteOffset': 0, 'opcode': None}}
IDLE = {'active': 0, 'status': 'idle', 'appliedCommands': 0, 'commandCount': 0, 'draws': 0,
        'inputBytes': 0, 'outputBytes': 0, 'reads': 0, 'transfers': 0, 'stagingBytes': 0}


def packet(opcode, payload, kind=0):
    return struct.pack(f'<{len(payload) + 1}I', opcode + 256 * kind + 65536 * len(payload), *payload)


DRAW = packet(8, DRAW_WORDS)
CLEAR = packet(7, [4, 0, 0, float_word(1), float_word(1), 0, 0, 0])
LINK = packet(52, [1, 2, 0, 0, 0, 0])


def constants(stage, values):
    return packet(12, [stage, 0, *values])


def shader(handle, stage, body):
    data = body.encode('ascii') + b'\0'
    padded = data + b'\0' * (-len(data) % 4)
    return packet(1, [handle, stage, len(data), 256, 0, *struct.unpack(f'<{len(padded)//4}I', padded)], 4)


def sequence(rig, mode):
    fixtures = {item['name']: item for item in read(ROOT / FIXTURE)}
    result = []

    def add(label, raw, context=1, code=None, applied=None):
        result.append({'label': label, 'bytes': list(raw), 'contextId': context, 'code': code, 'applied': applied})

    def setup(variant='high', width=32):
        if variant.startswith('raw-'):
            _, stage, index = variant.split('-')
            vertex = f'raw-c{index}-vertex' if stage == 'vertex' else 'raw-pass-vertex'
            fragment = f'raw-c{index}-fragment' if stage == 'fragment' else 'raw-pass-fragment'
        else:
            vertex, fragment = f'hardware-{variant}-vertex', f'hardware-{variant}-fragment'
        return b''.join([shader(1, 0, fixtures[vertex]['text']), shader(2, 1, fixtures[fragment]['text']),
                         packet(1, [10, 103, 67, 0, 0], 8), packet(5, [1, 0, 10]),
                         packet(1, [11, 0, 0, 0, 29], 5), packet(2, [11], 5),
                         packet(6, [8, 0, 101]), packet(11, [102, 2, 0]),
                         packet(4, [0, float_word(width/2), float_word(width/2), float_word(.5),
                                    float_word(width/2), float_word(width/2), float_word(.5)]), packet(31, [1, 0])])

    def banks(label, value='A', context=1):
        add(label, constants(0, bank(value, 0)) + constants(1, bank(value, 1)), context)

    def prepare(context=1, variant='high', value='A', upload=True, width=32):
        add(variant + ' setup', setup(variant, width), context)
        if upload: banks(value + ' banks', value, context)
        add('prelink', LINK, context); add('bind fragment', packet(31, [2, 1]), context)

    def phase(label, context=1):
        add(label + ' clear', CLEAR, context); add(label + ' draw', DRAW, context)

    name = rig['name']
    if name.startswith('lifecycle-'):
        prepare(); phase('A initial'); banks('caller mutation ownership'); phase('A owned bank')
        banks('B replacement', 'B'); phase('B same program'); banks('A replacement'); phase('A same program restored')
        prepare(2, value='B'); phase('B context2', 2); phase('A context1 restored')
        add('create subcontext7', packet(29, [7])); prepare(value='B'); phase('B subcontext7')
        add('select default', packet(28, [0])); phase('A default restored')
        add('select subcontext7', packet(28, [7])); add('recreate subcontext7', packet(30, [7]) + packet(29, [7]))
        prepare(value='B', upload=False); add('recreated subcontext empty', DRAW, code='incomplete-draw', applied=0)
        banks('recreated B banks', 'B'); phase('B recreated subcontext'); add('return to default', packet(28, [0]))
        add('recreate vertex handle1', packet(3, [1], 4) + shader(1, 0, fixtures['hardware-high-vertex']['text']) + packet(31, [1, 0]) + LINK)
        phase('A new shader generation')
        for stage in (0, 1):
            for length in (180, 0):
                add(f'stage{stage} shortened{length}', constants(stage, bank('A', stage)[:length]))
                add(f'stage{stage} missing prefix{length}', DRAW, code='incomplete-draw', applied=0)
                add(f'stage{stage} restore complete', constants(stage, bank('A', stage)))
        for stage in (0, 1):
            add(f'stage{stage} applied short prefix', constants(stage, bank('A', stage)[:180]) + DRAW, code='incomplete-draw', applied=1)
            add('recover applied prefix', constants(stage, bank('A', stage)))
        phase('A final recovery')
    elif name.startswith('invalid-'):
        prepare(); phase('finite baseline before invalid wire')
        cases = [(stage, position, word) for stage in (0, 1) for position in (0, 90, 183) for word in BAD]
        if mode == 'decoder-and-guard-bypass': cases = cases[:1]
        for stage, position, word in cases:
            values = bank('A', stage); values[position] = word
            label = f'stage{stage} word{position} {word:x}'
            add(label + ' invalid packet', constants(1-stage, bank('B', 1-stage)) + constants(stage, values),
                code='invalid-value' if mode == 'normal' else None, applied=0 if mode == 'normal' else None)
            if mode == 'decoder-and-guard-bypass': break
            if mode == 'decoder-bypass': add(label + ' guarded draw', DRAW, code='constant-domain-error', applied=0)
            banks(label + ' finite recovery')
        if mode != 'decoder-and-guard-bypass': phase('A recovered from all invalid banks')
    elif name.startswith('raw-'):
        first = True
        for stage in ('vertex', 'fragment'):
            for index in (0, 45):
                if first: add('first raw subcontext', packet(29, [7])); first = False
                else:
                    add('drop previous raw subcontext', packet(30, [7])); add('new raw subcontext', packet(29, [7]))
                prepare(variant=f'raw-{stage}-{index}', upload=False, width=4)
                for value in (0, 1):
                    for bit in range(32):
                        values = raw_bank(value, bit)
                        add(f'raw {stage} C{index} phase{value} bit{bit}', constants(0, values) + constants(1, values) + DRAW)
    elif rig.get('classification') == 'trusted-host-metadata-fault':
        stage, fault = name.split('-', 1)
        require(stage in ('vertex', 'fragment') and fault in FAULTS, 'known metadata fault rig')
        prepare(); add('metadata baseline clear', CLEAR)
        add('malformed conditional metadata', shader(77, int(stage == 'fragment'), fixtures[f'hardware-high-{stage}']['text']),
            code='shader-domain-error', applied=0)
        phase('metadata failure recovery')
    else:
        require(name in ('high-vertex', 'high-fragment', 'low-both', 'order-both', 'inactive-both'), 'known extent rig')
        variant, stages = name.split('-')
        prepare(variant=variant, upload=False)
        reflection = rig['reflection']
        require([item['stage'] for item in reflection] == ['vertex', 'fragment'], 'both actual reflected stage banks')
        for stage, item in enumerate(reflection):
            require(item['count'] == (47 if variant == 'order' else 46) and
                    type(item['activeCount']) is int and 0 <= item['activeCount'] <= item['count'] and
                    item['uploadCount'] == min(item['activeCount'], 46), 'declaration/reflection/upload extents stay distinct')
            if item['activeCount']:
                indices = [event for event in rig['glEvents'] if event['call'] == 'getUniformIndices' and event['names'] == [item['name']]]
                require(len(indices) == 1 and any(event['call'] == 'getActiveUniforms' and
                        event['programId'] == indices[0]['programId'] and event['indices'] == indices[0]['indices'] and
                        event['parameter'] == 35384 and event['values'] == [item['activeCount']] for event in rig['glEvents']),
                        'prefix request derives from actual native stage reflection')
            if item['uploadCount']: add('actual reflected prefix', constants(stage, bank('A', stage)[:item['uploadCount']*4]))
        phase(variant + ' ' + stages)
        if variant == 'order':
            phase('order47 padding restored'); phase('order47 padding restored')
    return result


class Model:
    def __init__(self, rig):
        self.next = 1
        self.contexts = {}
        self.schedule = rig.get('schedule')
        self.translations = {(item['request']['stage'], item['request']['text']): item['result']
                             for item in rig['translations'] if item['kind'] == 'single' and item['fault'] is None}
        frames = rig['draws'] + [plane for draw in rig['rawDraws'] for plane in draw['planes']]
        self.programs = {}
        for frame in frames:
            program = frame['program']
            key = (frame['contextId'], frame['subContextGeneration'], program['vertexGeneration'], program['fragmentGeneration'])
            require(key not in self.programs or self.programs[key] == program, 'reused program has stable full reflection')
            self.programs[key] = program

    def generation(self):
        result = self.next; self.next += 1; return result

    def sub(self, id):
        return {'id': id, 'generation': self.generation(), 'banks': [[], []], 'shaders': [None, None],
                'objects': {}, 'programs': set()}

    def context(self, id):
        if id not in self.contexts:
            generation = self.generation()
            self.contexts[id] = {'id': id, 'generation': generation, 'resourceContextGeneration': 4 + len(self.contexts),
                                 'current': 0, 'subs': {0: self.sub(0)}}
        return self.contexts[id]

    def current(self, id):
        ctx = self.context(id); return ctx['subs'][ctx['current']]

    def apply(self, id, command):
        ctx, sub = self.context(id), self.current(id)
        op, kind, payload = command['opcode'], command['type'], command['payload']
        if op == 1:
            obj = {'handle': payload[0], 'generation': self.generation(), 'type': kind}
            if kind == 4:
                text = struct.pack(f'<{len(payload)-5}I', *payload[5:])[:payload[2]-1].decode('ascii')
                obj['fields'] = {'handle': payload[0], 'stage': payload[1], 'stageName': 'fragment' if payload[1] else 'vertex',
                                 'declaredTextBytes': payload[2], 'tokenCount': payload[3], 'streamOutputCount': payload[4], 'text': text}
            elif kind == 8:
                obj['fields'] = {'handle': payload[0], 'resourceHandle': payload[1], 'format': payload[2],
                                 'level': payload[3], 'firstLayer': payload[4], 'lastLayer': payload[4]}
            else:
                require(kind == 5, 'only authored object classes')
                obj['fields'] = {'handle': payload[0], 'elements': [{'sourceOffset': payload[1], 'instanceDivisor': payload[2],
                                                                  'vertexBufferIndex': payload[3], 'sourceFormat': payload[4]}]}
            sub['objects'][payload[0]] = obj
        elif op == 3:
            previous = sub['objects'].pop(payload[0])
            sub['programs'] = {pair for pair in sub['programs'] if previous['generation'] not in pair}
        elif op == 12: sub['banks'][payload[0]] = payload[2:]
        elif op == 28: ctx['current'] = payload[0]
        elif op == 29: ctx['subs'][payload[0]] = self.sub(payload[0]); ctx['current'] = payload[0]
        elif op == 30:
            del ctx['subs'][payload[0]]
            if ctx['current'] == payload[0]: ctx['current'] = 0
        elif op == 31:
            obj = sub['objects'][payload[0]]
            sub['shaders'][payload[1]] = {key: obj[key] for key in ('handle', 'generation')}
            if all(sub['shaders']): sub['programs'].add(tuple(x['generation'] for x in sub['shaders']))
        elif op == 52:
            sub['programs'].add(tuple(sub['objects'][h]['generation'] for h in payload[:2]))

    def draw(self, id, offset, width):
        ctx, sub = self.context(id), self.current(id)
        return {'byteOffset': offset, 'opcode': 8, 'count': 6, 'indexOffset': 0, 'indexByteLength': 12,
                'actualMinIndex': 0, 'actualMaxIndex': 3, 'contextId': id, 'contextGeneration': ctx['generation'],
                'subContextId': sub['id'], 'subContextGeneration': sub['generation'], 'indexResourceId': 102,
                'indexResourceGeneration': 2, 'vertexFetches': [{'attributeIndex': 0, 'location': 0, 'resourceId': 101,
                    'resourceGeneration': 1, 'stride': 8, 'offset': 0, 'firstByte': 0, 'requiredEnd': 32}],
                'framebuffer': {'resourceId': 103, 'resourceGeneration': 3, 'width': width, 'height': width},
                'vertexShader': copy.deepcopy(sub['shaders'][0]), 'fragmentShader': copy.deepcopy(sub['shaders'][1])}


def snapshot(value, model, asynchronous, waiting=False):
    require(value['ok'] is True and value['disposed'] is False and value['profile'] == (ASYNC if asynchronous else SYNC),
            'live renderer snapshot identity')
    require(set(value) == {'ok', 'profile', 'disposed', 'limits', 'hostUniformComponents', 'drawLimits', 'budgets', 'contexts'} |
            ({'jobLimits', 'jobs'} if asynchronous else set()), 'complete public snapshot shape')
    require(value['limits'] == {'contexts': 8, 'subContexts': 16, 'objects': 256, 'programs': 64, 'shaderBytes': 1048576, 'uniformBytes': 65536}
            and value['drawLimits'] == {'drawsPerSubmission': 64, 'indicesPerSubmission': 65536}, 'unchanged state/draw bounds')
    require(len(value['hostUniformComponents']) == 2 and all(type(n) is int and n >= 184 for n in value['hostUniformComponents']),
            'real stage limits fit recorded active banks')
    if asynchronous:
        require(value['jobLimits'] == {'jobs': 1, 'commandsPerStep': model.schedule['commandsPerStep'],
                'submissionBytes': 262144, 'transferBytes': 4194304}, 'exact bounded async limits')
        expected_job = {'active': 1, 'status': 'waiting-index', 'appliedCommands': 0, 'commandCount': 1, 'draws': 0,
                        'inputBytes': 0, 'outputBytes': 0, 'reads': 1, 'transfers': 0, 'stagingBytes': 12} if waiting else IDLE
        require(value['jobs'] == expected_job, 'snapshot records exact idle or suspended job ownership')
    budget = {'contexts': len(model.contexts), 'subContexts': 0, 'objects': 0, 'programs': 0, 'shaders': 0,
              'samplers': 0, 'leases': 0, 'shaderBytes': 0, 'uniformBytes': 0}
    require([ctx['id'] for ctx in value['contexts']] == list(model.contexts), 'snapshot complete context inventory')
    for actual in value['contexts']:
        require(set(actual) == {'id', 'generation', 'resourceContextGeneration', 'currentSubContext', 'subContexts'}, 'complete context snapshot shape')
        expected = model.contexts[actual['id']]
        require(actual['generation'] == expected['generation'] and actual['resourceContextGeneration'] == expected['resourceContextGeneration']
                and actual['currentSubContext'] == expected['current'], 'snapshot current context generation')
        require([sub['id'] for sub in actual['subContexts']] == list(expected['subs']), 'snapshot complete subcontext inventory')
        for sub in actual['subContexts']:
            require(set(sub) == {'id', 'generation', 'objects', 'bindings', 'programs', 'resets'}, 'complete subcontext snapshot shape')
            want = expected['subs'][sub['id']]
            budget['subContexts'] += 1
            budget['objects'] += len(want['objects'])
            budget['programs'] += len(want['programs'])
            require(sub['generation'] == want['generation'] and sub['bindings']['constants'] == want['banks']
                    and [sub['bindings']['vertexShader'], sub['bindings']['fragmentShader']] == want['shaders'],
                    'snapshot selected immutable bank and shader identities')
            objects = []
            for obj in want['objects'].values():
                desired = copy.deepcopy(obj)
                desired.update(name={4: 'SHADER', 8: 'SURFACE', 5: 'VERTEX_ELEMENTS'}[obj['type']], public=True,
                               references=1 if obj['type'] == 5 else 2)
                if obj['type'] == 4:
                    fields = obj['fields']; translated = model.translations[(fields['stageName'], fields['text'])]
                    desired['translation'] = translated
                    budget['shaders'] += 1; budget['shaderBytes'] += len(fields['text']) + len(translated['glsl'])
                if obj['type'] == 8: desired['resourceGeneration'] = 3; budget['leases'] += 1
                objects.append(desired)
            require(sub['objects'] == objects, 'complete live object fields, translations, ownership and generations')
            require({(p['vertexGeneration'], p['fragmentGeneration']) for p in sub['programs']} == want['programs']
                    and len(sub['programs']) == len(want['programs']), 'complete program generation cache')
            for program in sub['programs']:
                key = (actual['id'], sub['generation'], program['vertexGeneration'], program['fragmentGeneration'])
                require(program == model.programs[key], 'full program state equals independently checked GPU draw program')
                budget['shaderBytes'] += program['variantBytes']
                budget['uniformBytes'] += sum(block['byteLength'] for block in program['reflection']['uniformBlocks'])
            def ref(handle):
                obj = want['objects'].get(handle)
                return {key: obj[key] for key in ('handle', 'generation')} if obj else None
            populated = bool(want['objects'])
            bindings = {'blend': None, 'rasterizer': None, 'dsa': None, 'vertexElements': ref(11),
                        'vertexShader': want['shaders'][0], 'fragmentShader': want['shaders'][1],
                        'framebuffer': [ref(10)] if populated else [],
                        'vertexBuffers': [{'stride': 8, 'offset': 0, 'resourceHandle': 101, 'resourceGeneration': 1}] if populated else [],
                        'indexBuffer': {'resourceHandle': 102, 'indexSize': 2, 'offset': 0, 'resourceGeneration': 2} if populated else None,
                        'samplerViews': [[None] * 32 for _ in range(2)], 'samplerStates': [[None] * 32 for _ in range(2)],
                        'constants': want['banks'], 'viewport': {'scale': [16, 16, .5], 'translate': [16, 16, .5]} if populated else None,
                        'blendColor': [0, 0, 0, 0], 'stencilRef': {'front': 0, 'back': 0}, 'framebufferDefaults': {'width': 0, 'height': 0}}
            require(sub['bindings'] == bindings and sub['resets'] == {}, 'complete command-derived subcontext bindings')
            if populated: budget['leases'] += 2
    require(value['budgets'] == budget, 'complete command-derived live ownership budgets')


def async_states(record, expected, commands, schedule):
    result, states = record['result'], record['states']
    if expected['code'] == 'invalid-value':
        require(record['begin'] == result and states == [] and 'delays' not in record and 'inputAfter' not in record,
                'invalid whole submission rejected before async ownership')
        return
    require(record['begin'] == {'ok': True, 'job': {}, 'profile': ASYNC, 'byteLength': len(record['bytes']), 'commandCount': len(commands)},
            'async begin owns the complete decoded submission')
    require(record['inputAfter'] == [255] * len(record['bytes']), 'async caller input mutated after owned decode')
    require(2 <= len(states) <= 2000 and states[-1]['status'] == 'done' and states[-1]['jobs'] == IDLE,
            'async completion has drained every live job/staging resource')
    require(record['delays'] == [((schedule['seed'] * (i+1)) & 0xffffffff) % 3 for i in range(len(states)-1)],
            'deterministic varied later-task delays')
    previous = 0
    for index, state in enumerate(states):
        applied, job = state['appliedCommands'], state['jobs']
        require(type(applied) is int and previous <= applied <= result['appliedCommands']
                and applied - previous <= schedule['commandsPerStep'], 'bounded monotonic async command prefix')
        previous = applied
        if index == len(states)-1:
            require(applied == result['appliedCommands'], 'final async prefix equals returned result'); continue
        require(state['status'] in ('ready', 'waiting-gpu') and job['active'] == 1 and job['commandCount'] == len(commands)
                and job['appliedCommands'] == applied and job['inputBytes'] == job['outputBytes'] == job['transfers'] == 0,
                'live async step belongs to exact owned submission')
        require(job['draws'] == sum(command['opcode'] == 8 for command in commands[:applied]), 'async draw count follows applied prefix')
        waiting = job['status'] == 'waiting-index'
        require(job['reads'] == int(waiting) and job['stagingBytes'] == (12 if waiting else 0), 'bounded staged index ownership')
        if waiting:
            require(state['status'] == 'waiting-gpu' and applied < len(commands) and commands[applied]['opcode'] == 8,
                    'index read suspends before applying its draw')
        else:
            require(job['status'] == ('ready' if state['status'] == 'ready' else 'finishing'), 'known job continuation phase')


def fences(rig):
    schedule = rig.get('schedule'); pending = {}; count = withheld = actual_timeouts = 0
    last_turn = 0
    for index, event in enumerate(rig['glEvents']):
        require(event['sequence'] == index and type(event['turn']) is int and event['turn'] >= last_turn,
                'complete event sequence and monotonic browser task numbers')
        last_turn = event['turn']; call = event['call']
        if call == 'fenceSync':
            require(schedule is not None and event['id'] not in pending, 'only async jobs create distinct fences')
            count += 1
            pending[event['id']] = {'turn': event['turn'], 'last': event['turn'], 'scheduled': False, 'signaled': False,
                                    'remaining': ((count * 1664525 + schedule['seed'] + 1013904223) & 0xffffffff) % 4}
        elif call == 'fenceSchedule':
            state = pending[event['id']]
            require(not state['scheduled'] and event['withheld'] == state['remaining']
                    and rig['glEvents'][index-1]['call'] == 'fenceSync' and rig['glEvents'][index-1]['id'] == event['id'],
                    'each real fence has its deterministic withholding schedule')
            state['scheduled'] = True
        elif call == 'clientWaitSync':
            state = pending[event['id']]
            require(state['scheduled'] and not state['signaled'] and event['turn'] > state['last'],
                    'at most one fence poll per strictly later browser task')
            state['last'] = event['turn']
            require(event['actual'] in (37146, 37147, 37148), 'actual GL poll outcome')
            if event['actual'] != 37147 and state['remaining']:
                state['remaining'] -= 1; withheld += 1
                require(event['delivered'] == 37147, 'signaled fence deliberately withheld as timeout')
            else:
                require(event['delivered'] == event['actual'], 'unmodified actual poll outcome')
                state['signaled'] = event['actual'] != 37147
                actual_timeouts += int(event['actual'] == 37147)
        elif call == 'deleteSync':
            state = pending.pop(event['id'])
            require(state['signaled'] and state['remaining'] == 0, 'fence released only after delivered completion')
        require(call != 'finish', 'no blocking GPU completion')
    require(not pending, 'every created fence released')
    if schedule: require(count > 0 and withheld > 0, 'actual asynchronous fence and delayed-signal proof')
    return {'fences': count, 'withheldPolls': withheld, 'actualTimeouts': actual_timeouts}


def submissions(rig, mode):
    expected = sequence(rig, mode); actual = rig['submissions']; asynchronous = 'schedule' in rig
    require(len(actual) == len(expected), 'complete ordered submission inventory')
    model = Model(rig); before_models = []; after_models = []; draws = rejects = command_count = 0
    last_end = 0
    for record, want in zip(actual, expected):
        require(all(record[key] == want[key] for key in ('label', 'bytes', 'contextId')), 'literal raw packet sequence and context')
        commands = words(record['bytes']); command_count += len(commands); model.context(record['contextId'])
        before_models.append(copy.deepcopy(model))
        applied = len(commands) if want['code'] is None else want['applied']
        observed_draws = []
        for command in commands[:applied]:
            model.apply(record['contextId'], command)
            if command['opcode'] == 8: observed_draws.append(model.draw(record['contextId'], command['offset'], rig.get('width', 32)))
        after_models.append(copy.deepcopy(model))
        result = record['result']; draws += len(observed_draws); rejects += int(want['code'] is not None)
        keys = {'ok', 'error', 'appliedCommands', 'draws'} if want['code'] else {
            'ok', 'profile', 'appliedCommands', 'byteLength', 'contextId', 'subContextId', 'draws'}
        if asynchronous and want['code'] != 'invalid-value': keys.add('gpuComplete')
        require(set(result) == keys, 'complete structured submission result')
        require(result['ok'] is (want['code'] is None) and result['appliedCommands'] == applied and result['draws'] == observed_draws,
                'complete applied-prefix and draw result reconstruction')
        if want['code']:
            require(set(result['error']) == {'code', 'message', 'byteOffset', 'opcode'}, 'complete structured error')
            offset = 748 if want['code'] == 'invalid-value' else commands[applied]['offset']
            require(result['error']['code'] == want['code'] and result['error']['byteOffset'] == offset
                    and result['error']['opcode'] == (12 if want['code'] == 'invalid-value' else commands[applied]['opcode']),
                    'error cites exact unapplied packet')
            message = {'invalid-value': 'Non-finite float field.', 'incomplete-draw': 'Drawing requires every active constant word.',
                       'constant-domain-error': 'Active constant word is outside the finite-binary32 domain.'}.get(want['code'])
            if message is not None: require(result['error']['message'] == message, 'exact established structured error')
            else:
                fault = rig['name'].split('-', 1)[1]
                messages = {'missing': 'Conditional shader profile requires a constant domain.',
                            'profile': 'Unconditional shader profile carries a conditional contract.',
                            'duplicate': 'Array extent exceeds the bounded contract.',
                            'domains-object': 'Expected an own data array.', 'domain-null': 'Expected an own data record.',
                            'unknown-field': 'Unknown or accessor property.'}
                message = messages.get(fault, 'Constant domain does not match the declared bank extent and encoding.' if fault.startswith('count-')
                                       else 'Unknown or inconsistent constant-bank domain.')
                require(result['error']['message'] == message, 'independent metadata rejection reason')
        else:
            require(result['profile'] == (ASYNC if asynchronous else SYNC) and result['byteLength'] == len(record['bytes'])
                    and result['contextId'] == record['contextId'] and result['subContextId'] == model.context(record['contextId'])['current'],
                    'successful result reflects current command context')
        if asynchronous:
            async_states(record, want, commands, rig['schedule'])
            if want['code'] != 'invalid-value': require(result['gpuComplete'] is True, 'async result retires its real GPU work')
        else:
            require(record['states'] == [] and 'begin' not in record and 'delays' not in record and 'gpuComplete' not in result,
                    'synchronous submission has no invented async result')
            if record['label'] == 'caller mutation ownership': require(record['inputAfter'] == [255] * len(record['bytes']), 'sync owned packet mutation')
            else: require('inputAfter' not in record, 'no fabricated sync mutation')
        start, end = record['eventsStart'], record['eventsEnd']
        require(type(start) is type(end) is int and last_end <= start <= end <= len(rig['glEvents']), 'nonoverlapping complete event windows')
        last_end = end; events = rig['glEvents'][start:end]
        require(all(event['label'] == record['label'] for event in events), 'events tied to exact submission label')
        gpu_draws = [event for event in events if event['call'] == 'drawElements']
        require(len(gpu_draws) == len(observed_draws) and all(e['arguments'] == [4, 6, 5123, 0] for e in gpu_draws), 'actual native draw dispatch count')
        reads = [event for event in events if event['call'] == 'getBufferSubData']
        copies = [event for event in events if event['call'] == 'copyBufferSubData']
        require(len(reads) == len(observed_draws) and len(copies) == (len(observed_draws) if asynchronous else 0),
                'only accepted draws stage/read actual indices')
        for draw, readback in zip(gpu_draws, reads):
            require(readback['arguments'] == [36662, 0, {'byteLength': 12}] and readback['sequence'] < draw['sequence'],
                    'actual bounded index collection precedes dispatch')
            if asynchronous:
                copied = copies[0]
                require(copied['arguments'] == [36662, 36663, 0, 0, 12] and copied['turn'] < readback['turn'] == draw['turn'],
                        'real index copy yields before same-task collect and issue')
                ready = [event for event in events if event['call'] == 'clientWaitSync' and event['delivered'] in (37146, 37148)
                         and copied['sequence'] < event['sequence'] < readback['sequence']]
                require(len(ready) == 1 and ready[0]['turn'] == readback['turn'], 'index collection follows its delivered real fence')
        if want['code'] == 'invalid-value': require(events == [], 'normal predecode rejection has no GL effects')
    return expected, before_models, after_models, {'submissions': len(actual), 'commands': command_count,
        'draws': draws, 'rejectedSubmissions': rejects}


def same_pixels(entry):
    require(len(entry['pixelsBefore']) == len(entry['pixelsAfter']) == 4096 and entry['pixelsBefore'] == entry['pixelsAfter']
            and all(type(value) is int and 0 <= value <= 255 for value in entry['pixelsBefore']), 'entire rejection framebuffer unchanged')


def verify_rig(rig, mode):
    require(mode in ('normal', 'decoder-bypass', 'decoder-and-guard-bypass'), 'known evidence mode')
    asynchronous = 'schedule' in rig
    if mode != 'normal': require(rig['name'].startswith('invalid-'), 'bypass modes contain only exceptional-word workloads')
    if mode == 'decoder-and-guard-bypass': require(rig['name'] == 'invalid-sync' and not asynchronous, 'combined bypass is exactly one synchronous upload case')
    if asynchronous:
        require((rig['schedule']['seed'], rig['schedule']['commandsPerStep']) in SCHEDULES, 'prescribed async schedule')
        if rig['name'] != 'raw-async': require(rig['name'].endswith(f'{rig["schedule"]["seed"]:x}'), 'schedule name matches seed')
        else: require(rig['schedule'] == {'seed': SCHEDULES[1][0], 'commandsPerStep': 2}, 'raw schedule identity')
    expected, before, after, counts = submissions(rig, mode)
    counts.update(fences(rig)); counts.update(invalidCases=0, lifecycleTransitions=0, yieldAttacks=0)
    labels = [item['label'] for item in rig['submissions']]
    attack_names = []
    if rig['name'].startswith('lifecycle-'):
        attack_names = ['recreated subcontext empty', *[f'stage{stage} missing prefix{length}' for stage in (0, 1) for length in (180, 0)],
                        'stage0 applied short prefix', 'stage1 applied short prefix']
    elif rig['name'].startswith('invalid-'):
        matrix = [(stage, position, word) for stage in (0, 1) for position in (0, 90, 183) for word in BAD]
        if mode == 'decoder-and-guard-bypass': matrix = matrix[:1]
        for stage, position, word in matrix:
            label = f'stage{stage} word{position} {word:x}'; attack_names.append(label)
            if mode == 'decoder-bypass': attack_names.append(label + ' guarded draw')
        counts['invalidCases'] = len(matrix)
    require([entry['name'] for entry in rig['attacks']] == attack_names, 'complete ordered reject/invalid-bank matrix')
    for entry in rig['attacks']:
        invalid = 'word' in entry
        index = labels.index(entry['name'] + ' invalid packet' if invalid else entry['name'])
        record = rig['submissions'][index]
        require(entry['result'] == record['result'] and entry['events'] == rig['glEvents'][record['eventsStart']:record['eventsEnd']],
                'attack uses original submission and complete native events')
        snapshot(entry['before'], before[index], asynchronous); snapshot(entry['after'], after[index], asynchronous)
        same_pixels(entry)
        require(entry['pixelsBefore'] == list(frame('A')[2]), 'invalid bank/draw leaves the independently established A framebuffer')
        desired = copy.deepcopy(entry['before'])
        if invalid and mode != 'normal':
            ctx = next(c for c in desired['contexts'] if c['id'] == 1)
            sub = next(s for s in ctx['subContexts'] if s['id'] == ctx['currentSubContext'])
            sub['bindings']['constants'] = copy.deepcopy(after[index].current(1)['banks'])
        elif record['result']['appliedCommands']:
            ctx = next(c for c in desired['contexts'] if c['id'] == 1)
            sub = next(s for s in ctx['subContexts'] if s['id'] == ctx['currentSubContext'])
            sub['bindings']['constants'] = copy.deepcopy(after[index].current(1)['banks'])
        require(entry['after'] == desired, 'only honestly applied constant prefixes change state')
        if invalid:
            stage, position, word = entry['stage'], entry['position'], entry['word']
            require((stage, position, word) in matrix, 'literal stage/lane/exceptional-word tuple')
            values = bank('A', stage); values[position] = word
            require(entry['name'] == f'stage{stage} word{position} {word:x}' and entry['words'] == values
                    and entry['packetBytes'] == record['bytes']
                    and entry['callerBytesAfter'] == ([255] * len(record['bytes']) if asynchronous and mode != 'normal' else record['bytes']),
                    'actual invalid packet and postdecode caller ownership')
            bad_uploads = [event for event in entry['events'] if event['call'] == 'uniform4uiv' and not all(map(finite, event['words']))]
            if mode == 'normal': require('invalidUploads' not in entry and entry['events'] == [], 'normal decoder atomically rejects every word')
            else:
                require(entry['invalidUploads'] == bad_uploads, 'complete observed invalid upload list')
                if mode == 'decoder-bypass': require(bad_uploads == [] and 'guardContradiction' not in entry, 'consumer blocks every invalid restoration upload')
                else:
                    require(bad_uploads and entry['guardContradiction'] == {'expectedInvalidUploads': 0,
                            'actualInvalidUploads': len(bad_uploads), 'first': bad_uploads[0]}, 'single guard omission has a measured contradiction')
        else:
            require(not any(event['call'] in ('drawElements', 'getBufferSubData', 'copyBufferSubData') for event in entry['events']),
                    'invalid draw rejects before index collection or dispatch')
    if 'validation' in rig:
        require(rig.get('classification') == 'trusted-host-metadata-fault', 'metadata validation rig identity')
        entry = rig['validation']; stage, fault = rig['name'].split('-', 1); index = labels.index('malformed conditional metadata')
        require(entry['stage'] == stage and entry['fault'] == fault and entry['result'] == rig['submissions'][index]['result'], 'exact metadata rejection')
        submission = rig['submissions'][index]
        require(entry['events'] == rig['glEvents'][submission['eventsStart']:submission['eventsEnd']], 'metadata rejection contains the complete original event window')
        snapshot(entry['before'], before[index], False); snapshot(entry['after'], after[index], False)
        require(entry['before'] == entry['after'] and entry['events'] == [], 'invalid metadata publishes no state or GL work')
        same_pixels(entry)
        require(entry['pixelsBefore'] == [0, 0, 255, 255] * 1024, 'metadata rejection preserves the independently authored clear')
    else: require(rig.get('classification') != 'trusted-host-metadata-fault', 'metadata evidence is mandatory')
    expected_lifecycle = ['subcontext reuse', 'shader handle reuse'] if rig['name'].startswith('lifecycle-') else []
    require([entry['name'] for entry in rig['lifecycle']] == expected_lifecycle, 'complete lifecycle transition inventory')
    for entry, start, end in zip(rig['lifecycle'], ['recreate subcontext7', 'recreate vertex handle1'], ['B recreated subcontext draw', 'recreate vertex handle1']):
        snapshot(entry['before'], before[labels.index(start)], asynchronous)
        snapshot(entry['after'], after[labels.index(end)], asynchronous)
    counts['lifecycleTransitions'] = len(expected_lifecycle)
    expected_yields = int(asynchronous and rig['name'].startswith('lifecycle-'))
    require(len(rig['yieldAttacks']) == expected_yields, 'complete waiting-index attack inventory')
    if expected_yields:
        entry = rig['yieldAttacks'][0]; index = labels.index('A final recovery draw')
        snapshot(entry['before'], before[index], True, True); snapshot(entry['after'], before[index], True, True)
        require(entry['before'] == entry['after'] and entry['inspectionMutationRejected'] is True
                and entry['attempts'] == [{'name': name, 'result': BUSY} for name in ('begin', 'restore', 'destroy')],
                'all public state mutations blocked during owned index suspension')
        require(entry['before']['jobs'] == {'active': 1, 'status': 'waiting-index', 'appliedCommands': 0,
                'commandCount': 1, 'draws': 0, 'inputBytes': 0, 'outputBytes': 0, 'reads': 1, 'transfers': 0, 'stagingBytes': 12},
                'attack targets actual pending index ownership')
        require(entry['poisoned'] == rig['poison'][-1], 'yield attack binds its external GL disruption')
    counts['yieldAttacks'] = expected_yields
    poison_labels = (['before A restored draw'] + (['during waiting-index'] if asynchronous else [])) if rig['name'].startswith('lifecycle-') else []
    require([entry['label'] for entry in rig['poison']] == poison_labels, 'complete external binding corruption inventory')
    for entry in rig['poison']:
        require(entry['after'] == {'programId': None, 'framebufferNull': True, 'vertexArrayNull': True,
                                  'viewport': [0, 0, 1, 1], 'colorMask': [False] * 4}, 'actual external binding disruption')
        require([value['name'] for value in entry['entries']] == [f'{stage}const0[{index}]' for stage in ('vs', 'fs') for index in (0, 5, 7, 45)]
                and all(value['values'] == value['observed'] == list(map(float_word, (16, -8, 4, -2))) for value in entry['entries']),
                'actual poisoned constant elements')
    require(set(rig['finalBudgets']) == {'contexts', 'subContexts', 'objects', 'programs', 'shaders', 'samplers', 'leases', 'shaderBytes', 'uniformBytes'}
            and all(type(value) is int and value == 0 for value in rig['finalBudgets'].values()), 'complete final renderer release')
    require(set(rig['finalResourceBudgets']) == {'resources', 'contexts', 'storages', 'backingBytes', 'cpuBytes', 'gpuBytes', 'scratchBytes', 'tickets', 'leases'}
            and all(type(value) is int and value == 0 for value in rig['finalResourceBudgets'].values()), 'complete final resource release')
    return counts

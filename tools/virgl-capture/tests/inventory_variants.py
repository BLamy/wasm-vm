#!/usr/bin/env python3
"""Record literal synthetic decoder cases; never a guest/rendering claim.

The input packets use wire numbers and field values written independently of
Inventory. Each balanced API session first passes the retained framing/shader
assembler. Save every packet/backing byte, decoded result, assertion and state
transition so a critic can reproduce the checks without a guest boot.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import inventory
from test_events import Session
from test_validate import VERTEX, command, shader_packets

ROOT = Path(__file__).resolve().parents[3]
FRAGMENT = b"FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {1.0, 0.0, 0.0, 1.0}\n  0: MOV OUT[0], IMM[0]\n  1: END\n"
# An independent empty-state oracle, not Inventory.state() as a golden value.
EMPTY_STATE = {'objects':{},'bound':{},'shaders':{},'framebuffer':{'colors':[],'depth':None},
               'vertices':[],'index':None,'views':{},'samplers':{},'uniforms':{},'constants':{},'viewport':None}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def packet(opcode, *words, kind=0):
    return command(opcode, kind, struct.pack('<' + 'I' * len(words), *words))


def draw(indexed=0):
    # DRAW_VBO: start/count/mode/indexed/instances/bias/start-instance/restart/
    # restart-index/min/max/count-from-streamout. No GPU execution is asserted.
    return packet(8, 0, 3, 4, indexed, 1, 0, 0, 0, 0, 0, 2, 0)


class LiteralSession(Session):
    def __init__(self):
        super().__init__()
        self.events[0]['workload'] = 'kmscube'
        self.backings, self.labels, self.resource_keys, self.context_keys = {}, {}, {}, {}
        self.cleanup_seen = False
        self.initialize()

    def initialize(self):
        self.returned(self.enter('init', flags=0, callbackVersion=1))

    def context(self, cid=4, name=b'kmscube'):
        seq = self.enter('context_create', ctxId=cid, nameBytes=len(name), blob=('context_name', name))
        self.returned(seq)
        self.context_keys[cid] = f'{cid}@{seq}'

    def resource(self, rid, fmt, target, bind, raw, samples=0):
        seq = self.enter('resource_create', resourceId=rid, iovCount=int(raw is not None),
                         target=target, format=fmt, bind=bind, width=64 if target == 0 else 4,
                         height=1 if target == 0 else 4, depth=1, arraySize=1,
                         lastLevel=0, nrSamples=samples, flags=0)
        if raw is not None:
            self.add('backing_snapshot', resourceId=rid, reason='create',
                     iovLengths=[len(raw)], blob=('backing', raw))
            self.backings[rid] = raw
        self.returned(seq)
        self.resource_keys[rid] = f'{rid}@{seq}'

    def submit(self, named_packets, cid=4):
        snapshots = {}
        for rid, raw in sorted(self.backings.items()):
            snapshots[rid] = self.add('backing_snapshot', resourceId=rid, reason='submit',
                                     iovLengths=[len(raw)], blob=('backing', raw))
        raw = b''.join(body for _, body in named_packets)
        seq = self.enter('submit_cmd', ctxId=cid, ndw=len(raw) // 4, blob=('command', raw))
        offset = 0
        for label, body in named_packets:
            if label:
                if label in self.labels:
                    raise AssertionError('duplicate fixture label ' + label)
                self.labels[label] = {'event':seq, 'line':seq, 'contextId':cid,
                    'contextCreateEvent':int(self.context_keys[cid].split('@')[1]),
                    'subcontext':0, 'byteOffset':offset, 'byteLength':len(body),
                    'blobSha256':digest(raw), 'packetSha256':digest(body),
                    'snapshots':snapshots.copy(), 'words':list(struct.unpack('<'+'I'*(len(body)//4), body))}
            offset += len(body)
        self.returned(seq)

    def boundary(self, kind):
        seq = self.enter(kind)
        self.returned(seq)
        self.backings.clear()
        self.resource_keys.clear()
        self.context_keys.clear()
        if kind == 'cleanup':
            self.cleanup_seen = True
            self.initialize()
        return seq

    def end(self):
        super().end()
        self.events[-1].update(workload='kmscube', cleanupSeen=self.cleanup_seen)


def setup(s, prefix='', raw_seed=0):
    s.context()
    # Each role gets different bytes and a different declared resource bind.
    for rid, fmt, target, bind, samples in ((1,67,2,2,0), (2,64,0,16,0),
            (3,64,0,8,0), (4,64,0,32,0), (5,64,0,64,0), (6,64,0,524288,0),
            (7,67,2,2,4), (8,64,0,64,0)):
        s.resource(rid, fmt, target, bind, bytes((rid*17+raw_seed+i)%256 for i in range(64)), samples)
    first, last = shader_packets(VERTEX, split=20, handle=11, stage=0)
    s.submit([(prefix+'shader-first', first)])
    s.submit([(prefix+'shader-last', last), (prefix+'fragment', shader_packets(FRAGMENT, handle=12, stage=1)[0]),
              (prefix+'surface', packet(1,50,1,67,0,0,kind=8)),
              (prefix+'msaa', packet(1,52,7,67,0,0,4,kind=11)),
              (prefix+'buffer-view', packet(1,53,3,67,7,13,1672,kind=6)),
              (prefix+'sampler', packet(1,54,0,0,0,0,0,0,0,0,kind=7)),
              (prefix+'elements', packet(1,55,0,0,0,30,kind=5)),
              ('',packet(2,55,kind=5)), ('',packet(6,12,4,2)),
              ('',packet(31,11,0)), ('',packet(31,12,1)),
              ('',packet(5,1,0,50)), ('',packet(10,1,3,53)), ('',packet(18,1,3,54))])
    return dict(s.resource_keys), s.context_keys[4]


class Checks:
    def __init__(self):
        self.rows = []

    def equal(self, name, actual, expected):
        self.rows.append({'prediction':name, 'expected':expected, 'observed':copy.deepcopy(actual),
                          'held':actual == expected})
        if actual != expected:
            raise AssertionError(f'{name}: expected {expected!r}, observed {actual!r}')


def citation(s, label):
    return {key:value for key,value in s.labels[label].items() if key not in ('snapshots','words')}


def backing(s, label, rid):
    event = s.events[s.labels[label]['snapshots'][rid]-1]
    return {'event':event['seq'], 'line':event['seq'], 'reason':'submit',
            'iovLengths':event['iovLengths'], 'blob':event['blobs'][0]}


def object_at(result, s, label):
    cite = citation(s,label)
    return next(obj for obj in result['clientObjects'] if obj['citation'] == cite)


def check_objects(c, s, result, observations, keys):
    view = object_at(result,s,'buffer-view')
    c.equal('buffer-view resource lifetime',view['resource'],keys[3])
    c.equal('buffer-view literal fields',view['fields'],{'format':67,'formatName':'R8G8B8A8_UNORM',
            'target':0,'layerWord':7,'levelWord':13,'swizzleWord':1672,'swizzle':[0,1,2,3],
            'firstElement':7,'lastElement':13})
    msaa = object_at(result,s,'msaa')
    cite = citation(s,'msaa')
    c.equal('MSAA object lifetime',msaa['key'],
            s.context_keys[4]+f"/0/MSAA_SURFACE/52@{cite['event']}:{cite['byteOffset']}")
    c.equal('MSAA surface samples/resource', [msaa['kind'],msaa['handle'],msaa['resource'],msaa['fields']],
            ['MSAA_SURFACE',52,keys[7],{'format':67,'formatName':'R8G8B8A8_UNORM',
                                    'level':0,'firstLayer':0,'lastLayer':0,'sampleCount':4}])
    first = next(o for o in observations if o['event']==s.labels['shader-first']['event'])
    c.equal('incomplete shader installs no object',first['shaderObjects'],[])
    shader = object_at(result,s,'shader-last')
    c.equal('joined shader body/stage/handle', [shader['fields']['sha256'],shader['fields']['bytes'],
                                             shader['fields']['stage'],shader['handle']],
            [digest(VERTEX),len(VERTEX),'VERT',11])
    c.equal('joined shader original fragments',
            [[p['event'],p['byteOffset'],p['continuation']] for p in shader['fields']['packets']],
            [[s.labels['shader-first']['event'],0,False],[s.labels['shader-last']['event'],0,True]])
    c.equal('shader object only on final continuation',
            [o['event'] for o in observations if any(x['handle']==11 for x in o['shaderObjects'])][0],
            s.labels['shader-last']['event'])


def run_case(module, output, name, build, check, expected_error=None):
    directory = output/name
    (directory/'blobs').mkdir(parents=True)
    s = LiteralSession()
    expected = build(s)
    s.end()
    (directory/'events.jsonl').write_text(''.join(json.dumps(e,sort_keys=True)+'\n' for e in s.events))
    for sha, raw in s.blobs.items():
        (directory/'blobs'/(sha+'.bin')).write_bytes(raw)
    write_json(directory/'fixture-labels.json',s.labels)
    summary, shaders, _ = s.validate()
    summary['manifestSha256'] = digest((directory/'events.jsonl').read_bytes())
    write_json(directory/'framing-summary.json',summary)
    for sha, shader in shaders.items():
        (directory/(sha+'.tgsi')).write_bytes(shader['text'])
    model = module.Inventory(directory,summary)
    observations, lines = [], set()
    inventory_filename = str(Path(module.__file__).resolve())

    def observe_events():
        for event in s.events:
            yield event
            if event.get('phase')=='enter' and event['type'] in ('submit_cmd','reset','cleanup'):
                observations.append({'event':event['seq'],'type':event['type'],
                    'liveContexts':{str(k):v['key'] for k,v in model.live_contexts.items()},
                    'liveResources':{str(k):v['key'] for k,v in model.live_resources.items()},
                    'backings':copy.deepcopy(model.backings),
                    'states':{v['key']:copy.deepcopy(v['states']) for v in model.live_contexts.values()},
                    'shaderObjects':[{'handle':o['handle'],'sha256':o['fields']['sha256'],
                                      'key':o['key']} for v in model.live_contexts.values()
                                     for sub in v['states'].values() for (kind,_),o in sub['objects'].items()
                                     if kind=='SHADER']})

    def trace(frame, event, _):
        if event=='line' and frame.f_code.co_filename==inventory_filename:
            lines.add(frame.f_lineno)
        return trace

    c = Checks()
    try:
        sys.settrace(trace)
        try:
            result = model.run(observe_events())
        except module.CaptureError as error:
            if expected_error is None:
                raise
            c.equal('exact expected decoder rejection',str(error),expected_error)
            result = {'rejected':True,'error':str(error)}
        finally:
            sys.settrace(None)
        if expected_error is not None:
            c.equal('invalid input rejects',result.get('rejected'),True)
        else:
            check(c,s,result,observations,expected)
        write_json(directory/'inventory.json',result)
    finally:
        # JSON object keys cannot be the internal (kind,handle)/(stage,slot)
        # tuples. Preserve their literal repr and all values for interrogation.
        def serializable(value):
            if isinstance(value,dict):
                return {str(k):serializable(v) for k,v in value.items()}
            if isinstance(value,(list,tuple)):
                return [serializable(v) for v in value]
            if isinstance(value,set):
                return sorted(value)
            return value
        write_json(directory/'observations.json',serializable(observations))
        write_json(directory/'assertions.json',c.rows)
        write_json(directory/'coverage.json',{'sourceSha256':digest(Path(module.__file__).read_bytes()),
                                            'lines':sorted(lines)})
    return {'case':name,'events':len(s.events),'assertions':len(c.rows),'rejected':expected_error is not None,
            'lines':sorted(lines)}


def bindings(s):
    keys,ctx = setup(s)
    s.submit([('index',packet(11,4,2,19)), ('uniform',packet(27,1,2,12,20,5)),
              ('other-slot',packet(27,0,5,28,8,8)), ('indexed-draw',draw(1))])
    s.submit([('index-zero',packet(11,0)), ('uniform-zero',packet(27,1,2,0,0,0)),
              ('unbound-draw',draw()), ('third-draw',draw())])
    # The same uniform resource in a second context must not change context 4.
    s.context(9,b'supporting')
    s.submit([('other-context-uniform',packet(27,1,2,40,4,5))],9)
    s.submit([('after-other-context',draw())])
    return keys,ctx


def check_bindings(c,s,r,o,expected):
    keys,ctx = expected
    check_objects(c,s,r,o,keys)
    indexed = r['clientDraws'][0]
    c.equal('literal indexed draw words',indexed['words'],[0,3,4,1,1,0,0,0,0,0,2,0])
    c.equal('literal index binding',indexed['indexBuffer'],{'resource':keys[4],'resourceId':4,
            'indexBytes':2,'offset':19,'citation':citation(s,'index')})
    c.equal('index-buffer draw role',next(x for x in r['resources'] if x['key']==keys[4])['uses'][ctx]['drawRoles'],['index-buffer'])
    expected_uniform = {'resource':keys[5],'resourceId':5,'offset':12,'length':20,'citation':citation(s,'uniform')}
    other_slot = {'resource':keys[8],'resourceId':8,'offset':28,'length':8,'citation':citation(s,'other-slot')}
    c.equal('literal uniform bindings/stage-slot citations',indexed['uniformBuffers'],[expected_uniform,other_slot])
    for d in r['clientDraws'][1:]:
        c.equal('zero index unbinding at event '+str(d['citation']['event']),d['indexBuffer'],None)
        c.equal('uniform unbinding retains only other slot at event '+str(d['citation']['event']),d['uniformBuffers'],[other_slot])
    c.equal('uniform-buffer draw role',next(x for x in r['resources'] if x['key']==keys[5])['uses'][ctx]['drawRoles'],['uniform-buffer'])
    bound = next(x for x in o if x['event']==s.labels['index']['event'])['states'][ctx][0]['uniforms']
    c.equal('literal shader stage and slot keys',sorted(bound),[(0,5),(1,2)])
    last = next(x for x in o if x['event']==s.labels['after-other-context']['event'])
    c.equal('cleared slot remains empty across other context binding',last['states'][ctx][0]['uniforms'][(1,2)],None)
    c.equal('new context has its independent slot',last['states'][s.context_keys[9]][0]['uniforms'][(1,2)]['offset'],40)


def transfers(s):
    keys,ctx = setup(s)
    # Latest backing bytes differ from both creation and earlier submissions.
    s.backings[1] = bytes(range(63,-1,-1))
    s.backings[6] = bytes(range(100,164))
    s.submit([('copy',packet(45,1,2,7,32,128,1,2,0,2,3,1,6,19,3)),
              ('inline',packet(9,1,3,9,16,48,2,1,0,2,1,1,0x04030201,0x88776655,0x99)),
              ('first-draw',draw()), ('second-draw',draw()), ('third-draw',draw())])
    return keys,ctx


def check_transfers(c,s,r,o,expected):
    keys,ctx = expected
    copied,inline = r['clientTransfers']
    c.equal('copy literal fields/backings',copied,{'opcode':'COPY_TRANSFER3D','resource':keys[1],
        'level':2,'usage':7,'stride':32,'layerStride':128,'box':{'x':1,'y':2,'z':0,'w':2,'h':3,'d':1},
        'citation':citation(s,'copy'),'backingAtSubmit':backing(s,'copy',1),
        'sourceResource':keys[6],'sourceOffset':19,'flags':3,'sourceBackingAtSubmit':backing(s,'copy',6)})
    c.equal('inline literal payload/fields',inline,{'opcode':'RESOURCE_INLINE_WRITE','resource':keys[1],
        'level':3,'usage':9,'stride':16,'layerStride':48,'box':{'x':2,'y':1,'z':0,'w':2,'h':1,'d':1},
        'citation':citation(s,'inline'),'backingAtSubmit':backing(s,'inline',1),
        'inlineBytes':12,'inlineSha256':digest(b'\x01\x02\x03\x04\x55\x66\x77\x88\x99\x00\x00\x00')})
    c.equal('inline write counted',r['clientInlineWriteCount'],1)
    c.equal('copy source lifetime has source role',next(x for x in r['resources'] if x['key']==keys[6])['uses'][ctx]['roles'],['copy-transfer-source'])


def reuse(s,kind):
    old,ctx = setup(s)
    s.submit([('old-index',packet(11,4,2,19)),('old-uniform',packet(27,1,2,12,20,5)),
              ('old-draw-1',draw(1)),('old-draw-2',draw(1)),('old-draw-3',draw(1))])
    boundary = s.boundary(kind)
    new,newctx = setup(s,'new-',71)
    s.submit([('new-draw-1',draw()),('new-draw-2',draw()),('new-draw-3',draw()),
              ('new-copy',packet(45,1,0,0,16,64,0,0,0,1,1,1,6,23,1))])
    # A resource with reused numeric ID and no IOV must not borrow old backing.
    seq = s.enter('resource_unref',resourceId=6)
    s.returned(seq)
    s.backings.pop(6)
    s.resource(6,64,0,524288,None)
    latest = s.resource_keys[6]
    s.submit([('no-iov-copy',packet(45,1,0,0,16,64,0,0,0,1,1,1,6,29,0))])
    return old,ctx,new,newctx,boundary,latest


def check_reuse(c,s,r,o,expected):
    old,ctx,new,newctx,boundary,latest = expected
    cleared = next(x for x in o if x['event']==boundary)
    c.equal('boundary clears all live contexts/resources', [cleared['liveContexts'],cleared['liveResources'],cleared['states']], [{},{},{}])
    c.equal('numeric context ID gets new lifetime',ctx != newctx,True)
    c.equal('numeric resources get distinct new lifetimes',all(old[k]!=new[k] for k in old),True)
    first = next(x for x in o if x['event']==s.labels['new-shader-first']['event'])
    c.equal('new incomplete shader cannot borrow old objects',first['shaderObjects'],[])
    c.equal('new context has no inherited bindings',first['states'][newctx][0],EMPTY_STATE)
    for d in r['clientDraws'][3:]:
        c.equal('new draw has only new vertex lifetime',d['vertexBuffers'][0]['resource'],new[2])
        c.equal('new draw has no old index or uniforms',[d['indexBuffer'],d['uniformBuffers']],[None,[]])
        c.equal('new draw uses new surface/shaders',all(k.startswith(newctx+'/') for k in d['colors']+list(d['shaders'].values())),True)
    c.equal('historical old draw keeps old vertex/index/uniform provenance',
            [r['clientDraws'][0]['vertexBuffers'][0]['resource'],r['clientDraws'][0]['indexBuffer']['resource'],r['clientDraws'][0]['uniformBuffers'][0]['resource']],
            [old[2],old[4],old[5]])
    transfer = r['clientTransfers'][0]
    c.equal('reset/cleanup copy cites both new backings',[transfer['backingAtSubmit'],transfer['sourceBackingAtSubmit']],
            [backing(s,'new-copy',1),backing(s,'new-copy',6)])
    final = r['clientTransfers'][1]
    c.equal('reused ID without IOV cannot borrow historical backing',
            [final['sourceResource'],final['sourceBackingAtSubmit']],[latest,None])


def rejection(s,body):
    setup(s)
    s.submit([('valid-1',draw()),('valid-2',draw()),('valid-3',draw()),('invalid',body)])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--sabotage',choices=['index-offset'])
    args = parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    module = inventory
    source = Path(inventory.__file__).read_text()
    if args.sabotage:
        needle = "'indexBytes':w[2],'offset':w[3],'citation':cite"
        if source.count(needle)!=1:
            raise AssertionError('index-offset source fault boundary moved')
        source = source.replace(needle,"'indexBytes':w[2],'offset':w[3]+4,'citation':cite")
        fault = args.output/'inventory-index-offset.py'
        fault.write_text(source)
        spec = importlib.util.spec_from_file_location('inventory_index_offset_fault',fault)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    source_bindings = []
    for relative in ('tools/virgl-capture/inventory.py','tools/virgl-capture/validate.py',
                     'tools/virgl-capture/tests/test_validate.py','tools/virgl-capture/tests/test_events.py',
                     'tools/virgl-capture/tests/inventory_variants.py',
                     'renderer/virgl-shader/vendor/src/virgl_protocol.h','renderer/virgl-shader/vendor/src/virgl_hw.h'):
        raw = (ROOT/relative).read_bytes()
        source_bindings.append({'path':relative,'bytes':len(raw),'sha256':digest(raw)})
    write_json(args.output/'sources.json',source_bindings)
    results = []
    try:
        for name,build,check,error in (
                ('objects-index-uniform',bindings,check_bindings,None),
                ('copy-inline',transfers,check_transfers,None),
                ('reset-reuse',lambda s:reuse(s,'reset'),check_reuse,None),
                ('cleanup-reuse',lambda s:reuse(s,'cleanup'),check_reuse,None),
                ('index-missing-resource',lambda s:rejection(s,packet(11,99,2,19)),None,'packet references missing live resource 99'),
                ('uniform-missing-resource',lambda s:rejection(s,packet(27,1,2,12,20,99)),None,'packet references missing live resource 99'),
                ('index-unbound-draw',lambda s:rejection(s,packet(11,0)+draw(1)),None,'indexed draw has no index resource')):
            results.append(run_case(module,args.output,name,build,check,error))
    finally:
        write_json(args.output/'result.json',{'schema':'virgl-synthetic-inventory-variants-v1',
            'boundary':'Synthetic literal decoder checks only; no real guest use, renderer admission or GPU execution.',
            'sourceHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
            'executedInventorySha256':digest(Path(module.__file__).read_bytes()),
            'sabotage':args.sabotage,'completedCases':results})
    lines = sorted({line for row in results for line in row['lines']})
    for line in (139,147,166,221,222,223,231,232,233,255,256,257,258,260,261,291,292,301,302,370,371):
        if line not in lines:
            raise AssertionError('required inventory branch unexecuted at line '+str(line))
    print(json.dumps({'cases':len(results),'assertions':sum(r['assertions'] for r in results),
                      'requiredLinesCovered':True,'boundary':'synthetic decoder only'}))


if __name__=='__main__':
    main()

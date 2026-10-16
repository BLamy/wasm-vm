#!/usr/bin/env python3
"""Independent literal-wire/RGB9E5/native-plane critic, without expected blobs."""
import argparse
import functools
import gzip
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re
import struct
import subprocess
import tarfile
from fractions import Fraction

ROOT = Path(__file__).resolve().parents[2]
BASE = 'b76fa7d63703e3cf2a3dfc3b2d7c835c3f3db5e1'
FROZEN = '62011567d7616e2b9bbe888e4754aa2064bde3ee'
SUBMISSION = '691d75bcbae32edd8ee76a824164165f714b0e9e'
PROFILE = 'virgl-standard-rgb9e5-image-async-jobs-v1'
sha = lambda raw: hashlib.sha256(raw).hexdigest()
f32 = lambda n: struct.unpack('<f', struct.pack('<f', n))[0]
shrink = lambda n, level: max(1, n // 2**level)

@functools.lru_cache(maxsize=None)
def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def rgb9e5(raw):
    assert len(raw) % 4 == 0
    colors = []
    for word, in struct.iter_unpack('<I', raw):
        exponent = (word >> 27)-24
        scale = Fraction(2**exponent) if exponent >= 0 else Fraction(1, 2**-exponent)
        colors.append([((word >> (9*lane)) & 511)*scale for lane in range(3)]+[Fraction(1)])
    return colors

def floats(raw):
    assert len(raw) % 4 == 0
    return list(struct.unpack('<'+'f'*(len(raw)//4), raw))

def packets(hexadecimal):
    raw, cursor, result = bytes.fromhex(hexadecimal), 0, []
    while cursor < len(raw):
        header, = struct.unpack_from('<I', raw, cursor)
        end = cursor+4+4*(header >> 16)
        assert end <= len(raw)
        payload = raw[cursor+4:end]
        result.append(dict(offset=cursor, opcode=header & 255, object=header >> 8 & 255,
                           words=list(struct.unpack('<'+'I'*(len(payload)//4), payload)), raw=payload))
        cursor = end
    assert cursor == len(raw)
    return result

def immediate(text):
    result = {}
    for index, kind, value in re.findall(r'^IMM\[(\d+)\] (FLT32|INT32|UINT32) \{([^}]+)\}$', text, re.M):
        result[int(index)] = [Fraction(f32(float(n))) if kind == 'FLT32' else int(n) for n in value.split(',')]
    return result

def literal_sample(run, blobs, frame, stage, view):
    text = run['vertex' if stage == 0 else 'fragment']
    op, operands = re.search(r'^\d+: (TEX|TXL|TXF|TXD|TXB|TXQ) (.*)$', text, re.M).groups()
    imm, first, last = immediate(text), *view['range']
    assert int(re.search(r'SAMP\[(\d+)\], 2D$', operands)[1]) == view['slot']
    planes = [[p['width'], p['height'], rgb9e5(blobs[p['input']['key']])] for p in run['planes'][first:last+1]]
    if frame.get('sourceUpdate'):
        update = frame['sourceUpdate']; local = update['level']-first
        if 0 <= local < len(planes):
            raw = blobs[update['input']['key']]
            assert all(word == update['word'] for word, in struct.iter_unpack('<I', raw))
            planes[local][2] = rgb9e5(raw)
    if op == 'TXQ':
        assert operands.startswith('TEMP[0].xyw, IMM[1],') and 'U2F TEMP[0], TEMP[0]' in text
        lod = imm[1][0]
        return [Fraction(shrink(planes[0][0], lod)), Fraction(shrink(planes[0][1], lod)), Fraction(0), Fraction(last-first+1)]
    def texel(level, x, y):
        w, h, pixels = planes[level]
        assert 0 <= x < w and 0 <= y < h
        return pixels[y*w+x]
    def sample(level, u, v, linear):
        w, h, _ = planes[level]
        clamp = lambda n, maximum: max(0, min(maximum-1, n))
        if not linear:
            return texel(level, clamp(math.floor(u*w), w), clamp(math.floor(v*h), h))
        x, y = u*w-Fraction(1, 2), v*h-Fraction(1, 2)
        ix, iy = math.floor(x), math.floor(y); ax, ay = x-ix, y-iy
        weights = [(1-ax)*(1-ay), ax*(1-ay), (1-ax)*ay, ax*ay]
        colors = [texel(level, clamp(ix+dx, w), clamp(iy+dy, h)) for dx, dy in [(0,0),(1,0),(0,1),(1,1)]]
        return [sum(color[k]*weight for color, weight in zip(colors, weights)) for k in range(4)]
    if op == 'TXF':
        x, y, _, lod = imm[1]; color = texel(lod, x, y)
    else:
        u, v, _, lod = imm[0]
        if op in ('TEX', 'TXB'):
            # These programs use constant coordinates, so fragment derivatives are zero.
            lod = Fraction(0)
        elif op == 'TXD':
            w, h, _ = planes[0]; dx, dy = imm[2], imm[3]
            lod = math.log2(max(math.hypot(dx[0]*w, dx[1]*h), math.hypot(dy[0]*w, dy[1]*h)))
        p = view['parameters']; lod = max(p['minLod'], min(p['maxLod'], lod))
        linear = p['mag'] if lod <= 0 else p['min']
        if lod <= 0 or p['mip'] == 2:
            color = sample(0, u, v, linear)
        elif p['mip'] == 0:
            color = sample(max(0, min(len(planes)-1, math.floor(lod+.5))), u, v, linear)
        else:
            lod = max(0, min(len(planes)-1, lod)); lo = math.floor(lod); hi = min(len(planes)-1, lo+1)
            weight = Fraction(lod)-lo; A, B = sample(lo, u, v, linear), sample(hi, u, v, linear)
            color = [A[k]*(1-weight)+B[k]*weight for k in range(4)]
    return [Fraction(0) if k == 4 else Fraction(1) if k == 5 else color[k] for k in view['swizzle']]

class Critic:
    def __init__(self, output):
        self.output = output; self.points = []; self.original_seals = []
        self.totals = dict(archiveMembers=0, sourceIdentities=0, originalPackets=0, blobMembers=0,
                           outputComponents=0, retainedComponents=0, sourceComponents=0, publicBytes=0,
                           paddingBytes=0, nativeRuns=0, guestDraws=0, completionSignals=0, nativeControls=0, retiredComponents=0, samplerComponents=0)

    def held(self, prediction, member, point, digest, detail):
        self.points.append(dict(prediction=prediction, status='HELD', member=member, point=point, sha256=digest, detail=detail))

    def authenticate(self):
        folder = ROOT/'evidence/virgl-standard-shared-exponent-consumer/worker'
        manifest = json.loads((folder/'manifest.json').read_bytes()); raw_index = (folder/'records.json').read_bytes()
        index = json.loads(raw_index); expected = {r['path']: r for r in index['records']}
        assert len(expected) == len(index['records']) == manifest['records']
        assert sha(raw_index) == manifest['recordIndexSha256']
        assert sha((folder/'recording.tar.gz').read_bytes()) == manifest['archiveSha256']
        target = self.output/'worker'; target.mkdir(parents=True, exist_ok=True); seen = set()
        with tarfile.open(folder/'recording.tar.gz', 'r:gz') as tar:
            for member in tar:
                path = PurePosixPath(member.name)
                assert member.isfile() and not path.is_absolute() and '..' not in path.parts
                assert member.name in expected and member.name not in seen
                raw = tar.extractfile(member).read(); row = expected[member.name]
                assert len(raw) == row['bytes'] == member.size and sha(raw) == row['sha256']
                dest = target/member.name; dest.parent.mkdir(parents=True, exist_ok=True); dest.write_bytes(raw)
                seen.add(member.name)
        assert seen == expected.keys(); self.totals['archiveMembers'] = len(seen)
        self.held('P1', str(folder.relative_to(ROOT))+'/recording.tar.gz', '/all-indexed-members', manifest['archiveSha256'], len(seen))
        receipts = {}
        for prefix in ('hot', 'cold'):
            receipt = json.loads((target/prefix/'receipt.json').read_bytes()); receipts[prefix] = receipt
            assert receipt['status'] == 'passed' and receipt['gitHead'] == FROZEN
            for name, digest in receipt['files'].items():
                assert sha((target/prefix/name).read_bytes()) == digest
            for name, digest in receipt['sources'].items():
                assert sha(git('show', FROZEN+':'+name)) == digest, name
                self.totals['sourceIdentities'] += 1
            for name, digest in receipt['generated'].items():
                assert sha((target/(prefix+'-generated')/name).read_bytes()) == digest
        cold = json.loads((target/'cold/report.json').read_bytes())
        assert cold['status'] == 'passed' and cold['gitHead'] == cold['cloneHead'] == FROZEN
        assert cold['statusBefore'] == cold['statusAfter'] == '' and cold['exitCode'] == 0
        assert cold['command'] == ['make', 'verify-E6-T11d30']
        assert sha((target/'cold/receipt.json').read_bytes()) == cold['receiptSha256'] == manifest['coldReceiptSha256']
        clone = Path(cold['clone'])
        assert subprocess.check_output(['git','rev-parse','HEAD'], cwd=clone, text=True).strip() == FROZEN
        assert not subprocess.check_output(['git','diff','--name-only','HEAD'], cwd=clone)
        for prefix, location in [('hot',ROOT), ('cold',clone)]:
            for name, digest in receipts[prefix]['generated'].items(): assert sha((location/name).read_bytes()) == digest
        assert sha((target/'hot/receipt.json').read_bytes()) == manifest['hotReceiptSha256']
        assert sha((target/'cold/report.json').read_bytes()) == manifest['coldReportSha256']
        assert not git('diff','--name-only',BASE,SUBMISSION,'--','renderer/virgl-shader','web','crates','tools/guest')
        for name in ['resources','shared-exponent-images','shared-exponent-gpu','packed-float-images','float-images','color-images','cache','constant-domain']:
            path = 'renderer/virgl-command/'+name+'.mjs'
            assert git('show',BASE+':'+path) == git('show',FROZEN+':'+path) == (ROOT/path).read_bytes()
        for family in ['float-consumer','packed-float-images','packed-float-consumer','shared-exponent-images']:
            for role in ('worker','verifier'):
                folder = 'evidence/virgl-standard-'+family+'/'+role
                pins = {}
                for name in ('manifest.json','records.json','recording.tar.gz'):
                    path = folder+'/'+name; raw = (ROOT/path).read_bytes()
                    assert raw == git('show',BASE+':'+path)
                    assert sha(raw) == receipts['hot']['carriedVerifiedEvidence'][path] == receipts['cold']['carriedVerifiedEvidence'][path]
                    pins[name] = sha(raw)
                previous = json.loads((ROOT/folder/'manifest.json').read_bytes())
                assert pins['records.json'] == previous['recordIndexSha256'] and pins['recording.tar.gz'] == previous['archiveSha256']
                self.original_seals.append(dict(folder=folder,pins=pins,unchanged=True))
        self.worker_manifest = manifest; self.cold = cold
        self.held('P1', 'cold/report.json', '/cloneHead,/statusBefore,/statusAfter,/receiptSha256', sha((target/'cold/report.json').read_bytes()), cold)
        self.held('P9', 'hot/receipt.json', '/carriedVerifiedEvidence,/carriedUnchangedBoundaries', sha((target/'hot/receipt.json').read_bytes()), self.original_seals)

    def record(self, base, fault=False):
        raw = (base/'report.json').read_bytes(); record = json.loads(raw)
        member = str(base.relative_to(self.output))+'/report.json'; digest = sha(raw)
        assert record['status'] == ('failed' if fault else 'passed')
        assert record['browserErrors'] == dict(console=[], page=[], requests=[])
        assert not record['browser']['headless'] and 'Metal' in (record.get('partial') or record['browserResult']['result'])['gpu']
        assert not any(re.search(r'swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu', arg, re.I) for arg in record['browser']['commandLine'])
        for source in record['sources']:
            path = source['path']
            if source.get('archivePath'):
                data = (base/source['archivePath']).read_bytes()
            elif '/build/' in path:
                data = (self.output/'worker'/('hot-generated' if '/hot/' in str(base) else 'cold-generated')/path).read_bytes()
            else:
                data = git('show',record['gitHead']+':'+path)
            assert sha(data) == source['sha256'] and len(data) == source['bytes'], (member,path)
        source_rows = {r['path']: r for r in record['sources']}
        for served in record['servedFiles']:
            if served['path'] == '/': continue
            original = source_rows[served['path'][1:]]
            assert served['sha256'] == original['sha256'] and served['bytes'] == original['bytes']
        for key in ('browserCoverage','screenshot'):
            assert sha((base/record[key]['path']).read_bytes()) == record[key]['sha256']
        for script in json.loads((base/record['browserCoverage']['path']).read_bytes())['scripts']:
            assert script['sha256'] == source_rows[script['source']]['sha256']
        result = record['partial'] if fault else record['browserResult']['result']; blobs = {}
        for blob in result['blobs']:
            compressed = (base/blob.get('path', blob['key']+'.bin.gz')).read_bytes()
            assert sha(compressed) == blob['gzipSha256']; value = gzip.decompress(compressed)
            assert sha(value) == blob['sha256'] and len(value) == blob['bytes'] and blob['key'] not in blobs
            blobs[blob['key']] = value; self.totals['blobMembers'] += 1
        return result, blobs, member, digest

    def fence(self, run, label):
        signals = [r for r in run['events'] if r['name'] == 'clientWaitSync' and r['label'] == label and r['delivered'] in (37146,37148)]
        assert signals, label
        for signal in signals:
            assert signal['actual'] in (37146,37148)
            creates = [e for e in run['events'] if e['name'] == 'fenceSync' and e['sync'] == signal['sync']]
            assert len(creates) == 1 and creates[0]['turn'] < signal['turn']
            assert sum(e['name'] == 'deleteSync' and e['sync'] == signal['sync'] for e in run['events']) == 1
        self.totals['completionSignals'] += len(signals)
        return signals[-1]

    def inputs(self, run, blobs, member, index, fault):
        point = '/runs/'+str(index)
        self.totals['nativeRuns'] += 1
        assert all(n == 0 for owner in ('renderer','resources') for n in run['final'][owner]['budgets'].values())
        assert all(r['deleted'] == 1 for r in run['nativeObjects'])
        if 'source' not in run: return []
        assert run['source']['format'] == 125 and run['target']['format'] == 31
        backing = blobs[run['backing']['key']]; parsed = []
        for history in run['history']:
            commands = packets(history['hex']); parsed.extend(commands); self.totals['originalPackets'] += len(commands)
            if history.get('dump'):
                if history['dump']['submissions']: assert history['dump']['submissions'][0]['hex'] == history['hex']
                else: assert not history['result']['ok']
        texts, views, states = {}, {}, {}
        for p in parsed:
            words = p['words']
            if p['opcode'] == 1 and p['object'] == 4:
                text = p['raw'][20:20+words[2]].rstrip(b'\0').decode(); assert text.endswith('\n'); texts[words[1]] = text
            elif p['opcode'] == 1 and p['object'] == 6:
                assert words[2] == 125 | 2 << 24 and words[3] == 0
                views[words[0]] = dict(range=[words[4]&255, words[4]>>8], swizzle=[words[5]>>(3*k)&7 for k in range(4)])
            elif p['opcode'] == 1 and p['object'] == 7:
                bits = words[1]
                states[words[0]] = dict(s=bits&7,t=bits>>3&7,r=bits>>6&7,min=bits>>9&3,mip=bits>>11&3,mag=bits>>13&3,
                                        minLod=struct.unpack_from('<f',p['raw'],12)[0],maxLod=struct.unpack_from('<f',p['raw'],16)[0])
        assert texts == {0:run['vertex'],1:run['fragment']}
        active, samplers = {}, {}
        for p in parsed:
            words = p['words']
            if p['opcode'] in (10,18) and len(words)==3 and words[2]:
                (active if p['opcode']==10 else samplers)[(words[0],words[1])] = words[2]
        declared = run.get('views') or [dict(stage=0 if run['stage']=='vertex' else 1,slot=run['slot'],range=run['range'],handle=5)]
        original_views = []
        for v in declared:
            pair=(v['stage'],v['slot']); handle=active.get(pair,v['handle']); view=views[handle]
            state=states[samplers.get(pair,8)]; assert view['range']==v['range']
            assert state==run['parameters']; original_views.append(dict(stage=v['stage'],slot=v['slot'],parameters=state,**view))
        assert len(run['planes'])==run['source']['lastLevel']+1
        for plane in run['planes']:
            level,width,height=plane['level'],plane['width'],plane['height']; data=blobs[plane['input']['key']]
            assert (width,height)==(shrink(run['source']['width'],level),shrink(run['source']['height'],level)) and len(data)==width*height*4
            for y in range(height): assert backing[plane['offset']+y*plane['stride']:plane['offset']+y*plane['stride']+width*4]==data[y*width*4:(y+1)*width*4]
            transfer=next(p for p in parsed if p['opcode']==43 and p['words'][0]==6 and p['words'][1]==level and p['words'][-1]==1)['words']
            assert transfer==[6,level,0,plane['stride'],plane['stride']*height,0,0,0,width,height,1,plane['offset'],1], (member, run['name'], transfer)
            exchange=next(e for e in run['exchanges'] if e['direction']=='upload' and e['resource']['id']==6 and e['layout']['level']==level)
            assert blobs[exchange['blob']['key']]==data
            upload=next(e for e in run['uploads'] if e['label']==exchange['label'] and e['args'][1]==level and e['type']=='Uint32Array')
            assert upload['args'][4:8]==[width,height,6407,35902] and blobs[upload['bytes']['key']]==data
        assert floats(blobs[run['positions']['key']])==[-1.,-1.,0.,1.,1.,-1.,0.,1.,1.,1.,0.,1.,-1.,-1.,0.,1.,1.,1.,0.,1.,-1.,1.,0.,1.]
        for request in run['requests']: assert request['request']['vertexText']==run['vertex'] and request['request']['fragmentText']==run['fragment']
        for native in run['draws']:
            assert native['name']=='drawArrays' and native['args']==[4,0,6]
            assert native['native']['level']==run['outputLevel'] and native['native']['viewport']==[0,0,run['width'],run['height']]
            assert native['native']['drawBuffer']==36064 and not native['native']['scissor']
            assert not any(v for k,v in native['native']['capabilities'].items() if k!='BLEND')
            for a in native['attributes']: assert a['stride']==16 and a['enabled'] and blobs[a['bytes']['key']]==blobs[run['positions']['key']]
            for s in native['samplers']:
                v=next(v for v in original_views if s['unit']==v['slot']+(16 if v['stage']==0 else 0))
                if not fault:
                    assert s['metadata']['format']==125 and s['base']==0 and s['last']==v['range'][1]-v['range'][0]
                    assert [s['metadata']['width'],s['metadata']['height']]==[shrink(run['source'][n],v['range'][0]) for n in ('width','height')]
                    assert any(e['name']=='texStorage2D' and e['texture']==s['texture'] and e['args'][2]==35901 for e in run['imageEvents'])
                    expected_min={ (0,0):9984,(1,0):9985,(0,1):9986,(1,1):9987,(0,2):9728,(1,2):9729 }[(v['parameters']['min'],v['parameters']['mip'])]
                    assert s['parameters']['TEXTURE_MIN_FILTER']==expected_min and s['parameters']['TEXTURE_MAG_FILTER']==(9729 if v['parameters']['mag'] else 9728)
                    plane=run['planes'][v['range'][0]]
                    original=[float(n) for color in rgb9e5(blobs[plane['input']['key']]) for n in color]
                    assert floats(blobs[s['texels']['key']])==original
                    self.totals['samplerComponents']+=len(original)
            self.totals['guestDraws']+=1
        for retired in run['retiredPlanes']:
            data=floats(blobs[retired['pixels']['key']]);attachment=run['draws'][-1]['native']['attachment']
            if retired['texture']==attachment:
                color=literal_sample(run,blobs,{},original_views[0]['stage'],original_views[0])
                assert len(data)==run['width']*run['height']*4
                assert all(abs(n-float(color[i%4]))<=2e-6*max(1,abs(float(color[i%4]))) for i,n in enumerate(data))
            else:assert data==[0.]*(retired['metadata']['width']*retired['metadata']['height']*4)
            self.totals['retiredComponents']+=len(data)
        if run.get('cache'):
            first,warm=run['cache'][:2]; assert first['temperature']=='first' and warm['temperature']=='warm'
            assert first['snapshot']['profile']==warm['snapshot']['profile']==PROFILE
            assert first['snapshot']['work']['programLinks']==warm['snapshot']['work']['programLinks']
        self.held('P2/P3/P4',member,point+'/history,/planes,/uploads,/draws,/cache',sha(blobs[run['backing']['key']]),'Literal original packets/TGSI, backing rows, native125 allocation and sampler/attribute state independently agree.')
        return original_views

    def frame(self,run,frame,views,blobs,member,index,previous,fault):
        point='/frames/'+str(index);history=run['history'][frame['historyIndex']]
        assert history['label']==frame['label']
        assert history['result'].get('gpuComplete') or frame.get('retired') and history['result']['error']['code']=='cancelled'
        event=self.fence(run,frame['label'])
        if frame['kind']=='clear':
            p=next(p for p in reversed(packets(history['hex'])) if p['opcode']==7)
            color=list(struct.unpack_from('<4f',p['raw'],4));assert color==run['clearColor']
        else:
            colors=[literal_sample(run,blobs,frame,v['stage'],v) for v in views]
            if len(colors)==2:
                assert 'ADD OUT[0], TEMP[0], IN[0]' in run['fragment'];color=[colors[0][k]+colors[1][k] for k in range(4)]
            else:color=colors[0]
            assert all(struct.unpack('<e',struct.pack('<e',float(n)))[0]==float(n) for n in color),('undeclared binary16 lattice',run['name'],color)
            if frame['blend']:
                flags=next(p['words'][3] for p in packets(history['hex']) if p['opcode']==1 and p['object']==1)
                assert flags>>27&15==frame['mask'] and flags&1 and flags>>4&31==1 and flags>>9&31==1
            if not frame.get('boundary'):color=[color[k]+(previous[k] if frame['blend'] else 0) if frame['mask']&(1<<k) else previous[k] for k in range(4)]
        expected=list(map(lambda n:f32(float(n)),color));raw=blobs[frame['pixels']['key']];actual=floats(raw)
        assert len(actual)==run['width']*run['height']*4
        misses=[dict(at=i,expected=expected[i%4],actual=n,budget=2e-6*max(1,abs(expected[i%4]))) for i,n in enumerate(actual) if not math.isfinite(n) or abs(n-expected[i%4])>2e-6*max(1,abs(expected[i%4]))]
        if fault and misses:
            self.totals['nativeControls']+=1;self.held('P8',member,point+'/pixels,/events',sha(raw),dict(expected=expected,observed=actual[:4],fence=event,mismatches=misses[:8]));return expected,True
        assert not misses,(member,point,run['name'],misses[:8]);self.totals['outputComponents']+=len(actual)
        self.held('P3/P4/P11',member,point+'/pixels',sha(raw),dict(expected=expected,components=len(actual),fence=event))
        if frame.get('boundary'):
            if frame.get('sourceUpdate'):
                assert blobs[run['backingAfter']['key']]==blobs[run['backing']['key']]
                assert len(frame['sourcePlanes'])==len(run['planes'])
                for p in frame['sourcePlanes']:
                    source=frame['sourceUpdate']['input'] if p['level']==frame['sourceUpdate']['level'] else run['planes'][p['level']]['input']
                    values=[float(n) for color in rgb9e5(blobs[source['key']]) for n in color]
                    assert floats(blobs[p['native']['key']])==values;self.totals['sourceComponents']+=len(values)
            return expected,False
        assert len(frame['outputs'])==run['target']['lastLevel']+1
        for p in frame['outputs']:
            assert [p['width'],p['height']]==[shrink(run['target'][n],p['level']) for n in ('width','height')]
            assert blobs[p['native']['key']]==raw if p['level']==run['outputLevel'] else floats(blobs[p['native']['key']])==[0.]*(p['width']*p['height']*4)
        for binding in frame['bindings']:
            assert len(binding['planes'])==binding['range'][1]-binding['range'][0]+1
            for p in binding['planes']:
                assert p['original']==binding['range'][0]+p['local'];original=run['planes'][p['original']]
                values=[float(n) for color in rgb9e5(blobs[original['input']['key']]) for n in color]
                assert floats(blobs[p['native']['key']])==values;self.totals['retainedComponents']+=len(values)
        read=run['history'][frame['publicHistory']];assert read['result']['ok'] and read['result']['gpuComplete'];self.fence(run,read['label'])
        p,=packets(read['hex']);width,height=run['width'],run['height'];stride=width*16+3
        assert p['opcode']==43 and p['words']==[1,run['outputLevel'],0,stride,0,0,0,0,width,height,1,5,2]
        exchange=next(e for e in run['exchanges'] if e['label']==read['label'] and e['direction']=='readback')
        public=blobs[exchange['blob']['key']];assert public==raw
        backing=blobs[frame['outputBacking']['key']];touched=set()
        for y in range(height):
            start=5+y*stride;assert backing[start:start+width*16]==public[y*width*16:(y+1)*width*16];touched.update(range(start,start+width*16))
        assert all(n==0x2e for i,n in enumerate(backing) if i not in touched)
        self.totals['publicBytes']+=len(public);self.totals['paddingBytes']+=len(backing)-len(touched)
        return expected,False

    def boundary(self,result,member,digest):
        assert len(result['runs'])==11
        for run in result['runs']:
            name=run.get('name','')
            if name=='retained-125':
                reuse=run['actions'][0];assert reuse['newGeneration']>run['sourceGeneration'] and reuse['replacement']['width']==11
                assert len(run['draws'])==4 and {h['ctx'] for h in run['history']}=={1,2}
            elif name.startswith('queued-125-'):
                reuse,terminal=run['actions'];assert reuse['before']['budgets']['imageHolds']==2 and reuse['newGeneration']>run['sourceGeneration']
                assert reuse['renderer']['jobs']['status']=='finishing'
                if name.endswith('complete'):assert terminal['result']['ok'] and terminal['result']['gpuComplete']
                else:assert terminal['result']['error']['code']==('cancelled' if name.endswith('cancel') else 'disposed')
                if terminal.get('disposed'):
                    # The unchanged, previously HELD disposal boundary releases an
                    # owned sync, reports no completion, and relies on native object
                    # lifetime. It never claims a consumed signal or calls finish.
                    created=[e for e in run['events'] if e['name']=='fenceSync' and e['label']==terminal['label']]
                    assert len(created)==1
                    released=[e for e in run['events'] if e['name']=='deleteSync' and e['sync']==created[0]['sync']]
                    assert len(released)==1 and released[0]['label']==terminal['label']
                    assert not any(e['name']=='clientWaitSync' and e['sync']==created[0]['sync'] for e in run['events'])
                    assert terminal['result']['error']['code']=='disposed' and not terminal['result'].get('gpuComplete',False)
                else:self.fence(run,terminal['label'])
            elif name=='gpu-refresh-125':
                label='original-shared-exponent-GPU-only-update';reads=[r for r in run['readbacks'] if r['label']==label]
                uploads=[u for u in run['uploads'] if u['label']==label]
                assert len(reads)==len(uploads)==1 and reads[0]['type']==uploads[0]['type']=='PBO'
                assert reads[0]['buffer']==uploads[0]['unpackBuffer'] and uploads[0]['bytes'] is None
                assert uploads[0]['args'][6:8]==[6407,35902]
                assert any(e['name']=='clearBufferfv' and e['label']==label for e in run['imageEvents'])
                assert run['sourceUpdate']['word']==96|160<<9|224<<18|16<<27
                assert not run['actions'][-1]['result']['ok'] and len(run['draws'])==1
            elif run.get('kind')=='native-float-clear-failure':
                assert len(run['faultEvents'])==1 and run['faultEvents'][0]['delivered']==6146 and not run['draws']
                assert run['actions'][0]['result']['error']['code']=='backend-error'
            elif run.get('kind')=='strict-shared-exponent-consumer-config':
                assert len(run['actions'])==4 and all(a['result']['error']['code']=='invalid-input' for a in run['actions'])
                assert run['getterReads']==0 and len(run['allocations'])==1 and not run['draws']
                assert [o['name'] for o in run['nativeObjects']]==['createVertexArray','createFramebuffer']*3+['createTexture']
                assert any(p['prediction']=='invalid shared exponent consumer fields allocate no native objects' and p['observed']==p['expected']==0 for p in result['predictions'])
        assert len(result['hostRefusals'])==3 and all(h['allocations']==0 and h['result']['error']['code']=='unsupported-host' for h in result['hostRefusals'])
        self.held('P5/P6/P7',member,'/runs,/hostRefusals',digest,'Retained generation, physical terminal fence, GPU PBO-only mutation, native clear/host/config refusals and terminal cleanup independently checked.')

    def whole(self,base,fault=False):
        result,blobs,member,digest=self.record(base,fault)
        views={i:self.inputs(run,blobs,member,i,fault) for i,run in enumerate(result['runs'])};previous={};failures=0
        for i,frame in enumerate(result['frames']):
            index=frame['run'];value,failed=self.frame(result['runs'][index],frame,views[index],blobs,member,i,previous.get(index),fault)
            previous[index]=value;failures+=failed
        if fault:assert failures>0 and (result['sabotage'].get('fenceCompleted') or result['sabotage'].get('physicalFenceConsumed'))
        elif result['mode']=='boundaries':self.boundary(result,member,digest)
        elif result['mode']=='matrix':
            assert len(result['runs'])==52
            assert {(r['stage'],r['opcode']) for r in result['runs']}=={(s,op) for s in ('vertex','fragment') for op in ('TEX','TXL','TXF','TXD','TXQ','TXB') if not(s=='vertex' and op=='TXB')}
            assert sum('fractional-mip' in r['name'] for r in result['runs'])==4
        elif result['mode']=='novel':
            run=result['runs'][0];assert len(run['draws'])==5 and run['actions'][0]['newGeneration']>run['sourceGeneration']
            for draw in run['draws']:assert len(draw['samplers'])==2 and len({s['texture'] for s in draw['samplers']})==2
        return result

    def historical(self,base):
        result,blobs,member,digest=self.record(base)
        assert len(result['nativeControls'])==10
        for index,run in enumerate(result['nativeControls']):
            assert all(n==0 for owner in run['final'].values() for n in owner['budgets'].values())
            assert all(n['deleted']==1 for n in run['nativeObjects'])
            color=None
            for history in run['history']:
                assert history['result']['ok'] and history['dump']['submissions'][0]['hex']==history['hex']
                for p in packets(history['hex']):
                    if p['opcode']==7:color=struct.unpack_from('<4f',p['raw'],4)
                    if p['opcode']==1 and p['object']==4 and p['words'][1]==1:
                        text=p['raw'][20:20+p['words'][2]].rstrip(b'\0').decode()
                        assert 'MOV OUT[0], IMM[0]' in text;color=immediate(text)[0]
                if index>=2:self.fence(run,history['label'])
            expected=bytes(math.floor(max(0.,min(1.,float(n)))*255+.5) for n in color)*4
            assert blobs[run['pixels']['key']]==expected
            if index>=3:assert any(c['name']=='drawArrays' and c['args']==[4,0,6] for c in run['calls'])
            self.held('P9/P10',member,'/nativeControls/'+str(index),sha(expected),dict(factory=run['name'],allOriginalOutputBytes=len(expected),profile=run['profile']))
        assert len(result['wireControls'])>=18
        for control in result['wireControls']:
            p,=packets(control['hex']);assert p['opcode']==1 and p['object']==6 and p['words'][2]==125|2<<24
            assert control['result']['ok']==(control['name']=='decodeStandardSharedExponentImageSubmission')
        self.held('P2/P9',member,'/wireControls',digest,'Every exported historical decoder, including the texture-only decoder, rejects both original125 swizzles; only selected RGB9E5 accepts.')

    def audit(self):
        self.authenticate()
        for prefix in ('hot','cold'):
            folder=self.output/'worker'/prefix
            wire=json.loads((folder/'wire/report.json').read_bytes());assert wire['status']=='passed' and len(wire['wire']['records'])==17
            for row in wire['wire']['records']:
                p,=packets(row['hex']);assert p['opcode']==1
                assert row['selected']['ok']==(row['kind']=='sampler')
                if row['selected']['ok']:assert row['selected']['profile']=='virgl-standard-rgb9e5-image-commands-v1'
            for base in sorted(folder.glob('hardware-*'))+sorted(folder.glob('fault-*')):self.whole(base,base.name.startswith('fault-'))
            for gate,task in [('retained-async-jobs','E6-T11b1'),('retained-float-consumer','E6-T11d26'),('retained-packed-storage','E6-T11d27'),('retained-packed-consumer','E6-T11d28'),('retained-shared-storage','E6-T11d29')]:
                report=json.loads((folder/gate/'report.json').read_bytes());assert report['status']=='passed' and report['task']==task and report['gitHead']==FROZEN
        worker_totals=dict(self.totals)
        for name in ['fresh-matrix','novel-native','fresh-boundaries-0x6a09e667','fresh-boundaries-0xbb67ae85','fresh-boundaries-0x3c6ef372','sabotage-post-fence','fresh-fault-original-level','fresh-fault-linear-filter']:
            if (self.output/name/'report.json').exists():self.whole(self.output/name,'fault-' in name or name.startswith('sabotage-'))
        if (self.output/'historical-native/report.json').exists():self.historical(self.output/'historical-native')
        result=dict(schema='d30-independent-original-native-critic-v1',status='passed',taskCorrectness='HELD',workerSubmission=SUBMISSION,frozenRuntime=FROZEN,
                    workerManifest=self.worker_manifest,cold=self.cold,carriedSeals=self.original_seals,workerTotals=worker_totals,totals=self.totals,points=self.points,
                    ignoredWorkerExpectedBlobs=True,unchangedPixelBudget='2e-6*max(1,abs(original))',arithmetic='rational original RGB9E5 fields plus literal original sampler/view/TGSI operands')
        (self.output/'audit.json').write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps({k:v for k,v in result.items() if k in ('status','taskCorrectness','workerTotals','totals')}))

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();output=args.output.resolve();output.mkdir(parents=True,exist_ok=True);Critic(output).audit()

if __name__=='__main__':main()

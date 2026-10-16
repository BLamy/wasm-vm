#!/usr/bin/env python3
"""Critic arithmetic starts from integer original words, never renderer decoders."""
from collections import Counter
from fractions import Fraction
from functools import lru_cache
import gzip
import hashlib
import json
from pathlib import Path
import struct

OUT = Path(__file__).resolve().parent
sha = lambda b: hashlib.sha256(b).hexdigest()
U32 = struct.Struct('<I')
FIXTURES = [0, 31<<27, 1, 1<<9, 1<<18, 0xffffffff,
            17|33<<9|7<<18|9<<27, 511|255<<9|1<<18|16<<27,
            127|63<<9|15<<18|24<<27]
UPDATE = 17|257<<9|413<<18|12<<27


@lru_cache(maxsize=262144)
def predict(word):
    m = [(word >> shift)&511 for shift in (0,9,18)]
    exponent = word >> 27
    quantum = Fraction(1, 1<<24)
    scale = Fraction(1<<exponent, 1<<24)
    rgb = [value*scale for value in m]
    # Evaluate the primary float conversion with exact rational arithmetic.
    # Increase the quantum until its half-open 512-bin interval contains maxRGB.
    selected = 0
    while max(rgb) >= 512*quantum:
        selected += 1
        quantum *= 2
    mantissas = []
    for value in rgb:
        rounded = value/quantum+Fraction(1,2)
        mantissas.append(rounded.numerator//rounded.denominator)
    assert max(mantissas) < 512
    assert [x*quantum for x in mantissas] == rgb
    canonical = sum(value<<shift for value,shift in zip(mantissas,(0,9,18))) | selected<<27
    # Independent integer binary32 encoding, without float casts or log2.
    bits = []
    for value in m:
        if value == 0:
            bits.append(0)
        else:
            significant = value.bit_length()
            fp_exponent = exponent-24+significant-1+127
            bits.append(fp_exponent<<23 | ((value<<(24-significant))&0x7fffff))
    return canonical, tuple(bits+[0x3f800000])


def canonical(raw):
    return b''.join(U32.pack(predict(w[0])[0]) for w in struct.iter_unpack('<I',raw))


def floats(raw):
    return b''.join(struct.pack('<4I',*predict(w[0])[1]) for w in struct.iter_unpack('<I',raw))


def read_blob(folder, entry):
    p = folder/(entry.get('path') or entry['key']+'.bin.gz')
    packed = p.read_bytes()
    assert sha(packed) == entry['gzipSha256']
    raw = gzip.decompress(packed)
    assert len(raw) == entry['bytes'] and sha(raw) == entry['sha256']
    return raw


def generated(run):
    seed = run['seed']&0xffffffff
    planes = {}
    for p in run['planes']:
        values = []
        for index in range(p['width']*p['height']):
            if run.get('fields') and p['level']==0 and index<49152:
                e = index//1536
                lane = (index//512)%3
                fields = [256,271,333]
                fields[lane] = index%512
                word = fields[0]|fields[1]<<9|fields[2]<<18|e<<27
            elif index<9:
                word = FIXTURES[(index+p['level'])%9]
            else:
                seed = ((seed^(seed<<13))&0xffffffff)
                seed ^= seed>>17
                seed = ((seed^(seed<<5))&0xffffffff)
                word = seed
            values.append(word)
        planes[p['level']] = b''.join(U32.pack(w) for w in values)
    return planes


def dense(backing, p):
    rowbytes = p['width']*4
    return b''.join(backing[p['offset']+y*p['stride']:p['offset']+y*p['stride']+rowbytes]
                    for y in range(p['height']))


class Auditor:
    def __init__(self):
        self.counts = Counter()
        self.rows = []

    def check_plane(self, folder, path, original, entry, public=False):
        wanted = canonical(original) if public else floats(original)
        actual = read_blob(folder, entry)
        assert actual == wanted, (str(folder), path, next((i for i,(x,y) in enumerate(zip(actual,wanted)) if x!=y), 'length'))
        self.counts['publicBytes' if public else 'nativeComponents'] += len(actual)//(1 if public else 4)
        self.rows.append(dict(record=str(folder.relative_to(OUT)),point=path,
                             prediction='P4' if public else 'P2/P3',status='HELD',
                             originalSha256=sha(original),predictedSha256=sha(wanted),
                             observedSha256=sha(actual),blob=entry.get('path',entry['key']+'.bin.gz'),bytes=len(actual)))

    def run(self, folder, row, ordinal):
        self.counts['runs'] += 1
        path = '/browserResult/result/runs/'+str(ordinal)
        originals = {p['level']:read_blob(folder,p['input']) for p in row['planes']}
        assert originals == generated(row)
        backing = read_blob(folder,row['backing'])
        for p in row['planes']:
            assert dense(backing,p)==originals[p['level']]
            assert p['width']==max(1,row['metadata']['width']>>p['level'])
            assert p['height']==max(1,row['metadata']['height']>>p['level'])
        self.counts['originalInputBytes'] += sum(map(len,originals.values()))
        patched = dict(originals)
        if 'patch' in row:
            p=row['patch']; payload=read_blob(folder,p['input'])
            patch_seed=row['seed']^0x317051ab^0xe6472351
            assert payload == generated(dict(seed=patch_seed,planes=[dict(level=0,width=p['width'],height=p['height'])]))[0]
            target=bytearray(patched[p['level']]); full=row['planes'][p['level']]
            assert dense(backing,p)==payload
            for y in range(p['height']):
                start=((p['y']+y)*full['width']+p['x'])*4
                target[start:start+p['width']*4]=payload[y*p['width']*4:(y+1)*p['width']*4]
            patched[p['level']]=bytes(target)
        for p in row['planes']:
            if 'observed' in p:
                self.check_plane(folder,path+'/planes/'+str(p['level']),originals[p['level']],p['observed']['native'])
        for vi,v in enumerate(row.get('views',[])):
            for p in v['planes']:
                assert p['local']==p['original']-v['firstLevel']
                self.check_plane(folder,path+'/views/'+str(vi)+'/planes/'+str(p['local']),originals[p['original']],p['native'])
        for oi,obs in enumerate(row.get('observations',[])):
            self.fence(obs['fence'])
            if obs['kind']=='retained-old-read':
                assert obs['generation']==row['generation']
                self.check_plane(folder,path+'/observations/'+str(oi),originals[0],obs['native'],True)
            else:
                wanted=patched[obs['original']]
                if 'clearInput' in obs:
                    wanted=U32.pack(UPDATE)*(len(wanted)//4)
                    assert read_blob(folder,obs['clearInput'])==wanted
                self.check_plane(folder,path+'/observations/'+str(oi),wanted,obs['native'])
        for ti,t in enumerate(row.get('transfers',[])):
            self.check_plane(folder,path+'/transfers/'+str(ti)+'/sync',originals[t['level']],t['sync'],True)
            for ri,r in enumerate(t['reads']):
                self.fence(r['fence'])
                self.check_plane(folder,path+'/transfers/'+str(ti)+'/reads/'+str(ri),originals[t['level']],r['nativeBytes'],True)
                self.layout(r['layout'],len(originals[t['level']]))
        if 'partialReads' in row:
            payload=read_blob(folder,row['patch']['input']); t=row['partialReads']
            self.check_plane(folder,path+'/partialReads/sync',payload,t['sync'],True)
            for ri,r in enumerate(t['reads']):
                self.fence(r['fence']);self.layout(r['layout'],len(payload))
                self.check_plane(folder,path+'/partialReads/reads/'+str(ri),payload,r['nativeBytes'],True)
        if row.get('kind')=='read-budget':
            short=row['boundary'].endswith('short');sync=row['boundary'].startswith('conversion')
            assert row['foreignLease']['error']['code']=='invalid-lease'
            assert row['start']['ok']==(not short)
            assert row['queued']['owner']['budgets']['scratchBytes']==(0 if short or sync else 60)
            assert row['queued']['async']['stagingBytes']==(0 if short or sync else 120)
            if short:
                assert row['start']['error']['code']=='limit-exceeded'
                assert not any(o['label']=='bounded-packed-read-budget' for o in row['nativeObjects'])
            else:
                self.fence(row['read']['fence'])
                self.check_plane(folder,path+'/read',originals[0],row['read']['nativeBytes'],True)
        for key,fill in [('finalBacking',0xa7),('finalStagingBacking',0x2e)]:
            if key not in row:continue
            final=read_blob(folder,row[key]);wanted=bytearray([fill])*len(backing);occupied=set()
            for p in ([] if 'patch' in row and key=='finalStagingBacking' else row['planes']):
                payload=originals[p['level']] if 'patch' in row else canonical(originals[p['level']])
                for y in range(p['height']):
                    at=p['offset']+y*p['stride'];n=p['width']*4
                    wanted[at:at+n]=payload[y*n:(y+1)*n];occupied.update(range(at,at+n))
            if 'patch' in row:
                p=row['patch'];payload=canonical(read_blob(folder,p['input']))
                for y in range(p['height']):
                    at=p['offset']+y*p['stride'];n=p['width']*4
                    wanted[at:at+n]=payload[y*n:(y+1)*n];occupied.update(range(at,at+n))
            assert bytes(wanted)==final,(path,key,'full backing and padding')
            self.counts['paddingBytes']+=len(final)-len(occupied)
        if row.get('kind')=='retained-native-range':
            assert read_blob(folder,row['backingAfterRefresh'])==backing
            assert row['view']['generation']==row['generation']<row['replacement']['generation']
            assert (row['view']['metadata']['width'],row['view']['metadata']['height'],row['view']['metadata']['lastLevel'])==(6,3,2)
            snapshots={r['point']:r for r in row['snapshots']}
            assert snapshots['queued-old-read']['state']['budgets']['gpuBytes']==452+88+144+728
            assert snapshots['queued-old-read']['async']['stagingBytes']==728
            assert snapshots['old-read-completed']['state']['budgets']['gpuBytes']==452+88+144+260
            assert snapshots['old-read-completed']['async']['stagingBytes']==0
            self.fence(row['holdFence'])
        self.footprints(folder,row,path)
        if row.get('kind')=='private-budget':
            short=row['boundary'].endswith('short')
            assert (row['baseBytes'],row['nativeBytes'],row['helperBytes'])==(452,88,144)
            assert row['capture']['ok']==(not short)
            assert row['queued']['state']['budgets']['gpuBytes']==(452 if short else 684)
            assert row['limits']['gpuBytes']==684-int(short)
            if short:
                assert not any(o['label']=='bounded-shared-private-budget-capture' for o in row['nativeObjects'])
            else:
                assert row['ambient']['before']==row['ambient']['after']
                assert row['view']['metadata']['sharedCopyScratchBytes']==144
                copies=[r for r in row['readbacks'] if r['label'].startswith('bounded-shared-private-budget-refresh-')]
                assert len(copies)==9 and all(r['name']=='readPixels' and r['type']=='PBO' for r in copies)
        if row.get('kind') in ('hostile-original-authority','foreign-same-id'):
            assert all(not r['result']['ok'] for r in row['refusals'])
            for refusal in row['refusals']:
                if refusal.get('mutation') in ('getter','prototype','shared-marker','private-copy-marker'):assert refusal['calls']==0
                if refusal.get('mutation')=='proxy':assert refusal['calls']==1
        if row.get('kind')=='native-failure':
            assert not row['result']['ok'] and len(row['faultEvents'])==1
            # The trusted backend's ResourceFault is converted by host() to the
            # store's bounded backend-error, including precision refusal.
            expected='backend-error'
            assert row['result']['error']['code']==expected
            assert row['afterFailure']['budgets']['scratchBytes']==row['afterFailure']['budgets']['tickets']==0
            self.rows.append(dict(record=str(folder.relative_to(OUT)),point=path+'/faultEvents/0',
                                 prediction='P8',status='HELD',fault=row['nativeFault'],observed=row['faultEvents'][0],result=row['result']))
            self.counts['physicalFailureCases']+=1
        assert all(v==0 for v in row['final']['budgets'].values())
        assert all(o['deleted']==1 for o in row['nativeObjects'])

    def fence(self,f):
        assert f['name']=='clientWaitSync' and f['actual'] in (37146,37148) and f['delivered'] in (37146,37148)
        self.counts['fenceCitations']+=1

    def layout(self,layout,n):
        assert layout['scratchBytes']==n and layout['conversionBytes']==n and layout['stagingBytes']==2*n

    def footprints(self,folder,row,path):
        for a in row['allocations']:
            m=a['metadata']
            if m['format']!=125:continue
            assert m['sharedExponent'] is True and m['bind']==8
            plane_bytes=[4*max(1,m['width']>>i)*max(1,m['height']>>i) for i in range(m['lastLevel']+1)]
            assert m['byteLength']==m['gpuByteLength']==sum(plane_bytes)
            stages=[e for e in row['nativeEvents'] if e['name']=='texStorage2D' and e.get('texture')==a['texture']]
            assert len(stages)==1 and stages[0]['args'][1:]==[m['lastLevel']+1,35901,m['width'],m['height']]
            if a['copyScratch']:
                helper=a['copyScratch'];w=helper['width'];h=helper['height'];assert m['sharedCopyScratchBytes']==w*h*8
                stages=[e for e in row['nativeEvents'] if e['name']=='texStorage2D' and e.get('texture')==helper['texture']]
                buffers=[e for e in row['nativeEvents'] if e['name']=='bufferData' and e.get('buffer')==helper['buffer']]
                assert len(stages)==len(buffers)==1
                assert stages[0]['args'][1:]==[1,32856,w,h]
                assert buffers[0]['args'][1]==w*h*4
            self.counts['physicalAllocations']+=1
        original={p['level']:read_blob(folder,p['input']) for p in row['planes']}
        replacement={}
        if 'replacement' in row:
            replacement={p['level']:read_blob(folder,p['input']) for p in row['replacement']['planes']}
            assert replacement==generated({**row['replacement'],'seed':row['seed']^0x52af93d1})
        for up in row['uploads']:
            if up['type']=='PBO':
                assert up['bytes'] is None and up['unpackBuffer']>0 and up['args'][6:8]==[6407,35902]
                if up['label']!='bounded-float-native-only-clear':
                    matching=[r for r in row['readbacks'] if r['label']==up['label'] and r.get('buffer')==up['unpackBuffer']]
                    assert matching and all(r['name']=='readPixels' and r['type']=='PBO' and r['bytes'] is None for r in matching),(path,up['label'],up['unpackBuffer'])
                self.counts['pboUploads']+=1
                continue
            assert up['type']=='Uint32Array' and up['args'][6:8]==[6407,35902]
            level=up['args'][1]
            data=replacement[level] if up['label'].startswith('bounded-float-unequal-replacement') else read_blob(folder,row['patch']['input']) if up['label']=='bounded-packed-patch-upload' else original[level]
            if '-row' in up['label']:
                p=row['planes'][level];at=up['args'][3]*p['width']*4;data=data[at:at+p['width']*4]
            assert read_blob(folder,up['bytes'])==data
            self.counts['nativeUploadBytes']+=len(data)
        for read in row['readbacks']:
            if read['name']=='readPixels' and read['label']!='independent-shared-diagnostic':
                expected=6402 if row.get('nativeFault')=='read' else 6408
                assert read['args'][4:6]==[expected,5121]
        self.rows.append(dict(record=str(folder.relative_to(OUT)),point=path+'/allocations',prediction='P3/P5/P6/P7',status='HELD',allocations=len(row['allocations']),final=row['final']['budgets']))


def main():
    a=Auditor()
    for side in ('hot','cold'):
        base=OUT/'unpacked'/side
        wire=json.loads((base/'wire/report.json').read_text())['wire']
        assert len(wire['records'])==43 and len(wire['predictions'])==119
        assert all(p['held'] for p in wire['predictions'])
        for r in wire['records']:
            if r['kind']=='metadata':
                assert r['original']['format']==125 and r['original']['bind']==8
                expected=4*sum(max(1,17>>i)*max(1,9>>i) for i in range(4))
                assert r['result']['byteLength']==r['result']['gpuByteLength']==expected
            if r['kind']=='layout':
                l=r['layout'];d=r['fields'];n=d['box']['width']*d['box']['height']*4
                assert l['tightBytes']==l['scratchBytes']==n
                assert l['conversionBytes']==(n if d['direction']==2 else 0)
                assert l['stagingBytes']==(2*n if d['direction']==2 else 0)
        original=(base/'scalars/original.bin').read_bytes();output=(base/'scalars/canonical.bin').read_bytes()
        assert canonical(original)==output and len(original)==59264*4
        a.counts['scalarWords']+=59264
        for file in sorted(base.glob('hardware*/report.json')):
            envelope=json.loads(file.read_text());report=envelope['browserResult']['result']
            assert envelope['status']==report['status']=='passed'
            assert not report['guestExecution'] and not report['productionNegotiation'] and not report['productionDrawAuthority']
            assert envelope['browserErrors']==dict(console=[],page=[],requests=[])
            assert 'M4' in report['gpu'] and 'Metal' in report['gpu'] and not envelope['browser']['headless']
            assert all(p['held'] for p in report['predictions'])
            for i,row in enumerate(report['runs']):a.run(file.parent,row,i)
        for file in sorted(base.glob('fault-*/report.json')):
            envelope=json.loads(file.read_text());report=envelope['partial'];s=report['sabotage'];a.fence(s['fence'])
            assert envelope['status']=='failed' and s['fenceCompleted'] and not s['held']
            row=report['runs'][0];obs=s['observation'];level=obs.get('original',obs.get('level'));original=read_blob(file.parent,row['planes'][level]['input']);actual=read_blob(file.parent,obs['native']);wanted=floats(original)
            assert actual!=wanted
            first=next(i for i,(x,y) in enumerate(zip(struct.iter_unpack('<I',wanted),struct.iter_unpack('<I',actual))) if x!=y)
            a.rows.append(dict(prediction='P9',status='HELD',record=str(file.relative_to(OUT)),point='/partial/sabotage/observation',fault=envelope['fault'],component=first,expectedBits=hex(struct.unpack_from('<I',wanted,first*4)[0]),observedBits=hex(struct.unpack_from('<I',actual,first*4)[0]),blob=obs['native'].get('path',obs['native']['key']+'.bin.gz'),blobSha256=sha(actual),fence=s['fence']))
            a.counts['physicalControls']+=1
    assert a.counts['runs']==226 and a.counts['physicalFailureCases']==126 and a.counts['physicalControls']==4
    rows=''.join(json.dumps(r,sort_keys=True)+'\n' for r in a.rows)
    (OUT/'plane-citations.jsonl').write_text(rows)
    result=dict(schema='fresh-rgb9e5-independent-original-bit-audit-v1',status='HELD',
                arithmetic='Exact rational primary conversion and integer binary32 encoding; no renderer/worker decoder imported',
                predictions=['P2','P3','P4','P5','P6','P7','P8','P9'],counts=dict(a.counts),
                citationsSha256=sha(rows.encode()),citations=len(a.rows))
    (OUT/'plane-audit.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))


if __name__=='__main__':main()

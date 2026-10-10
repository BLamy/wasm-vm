#!/usr/bin/env python3
"""Critic oracle: authenticate originals and reconstruct packed planes independently.

No runtime tables, emitted expectations or worker value/scalar helpers are used.
Every assertion records an archive member, structured point and SHA256.
"""
import bisect, functools, gzip, hashlib, json, math, struct, subprocess, sys, tarfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
BASE='a5085b5491f24b3c700fb7cef7b1629c2efef914'
FREEZE='f8daccb922097c7fa1cd71f601395824a32277e1'
SUBMIT='62f86e0202d715f580a09ae15488a115d7999110'
sha=lambda data:hashlib.sha256(data).hexdigest()
@functools.lru_cache(maxsize=None)
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)

def field(code,bits):
    exponent,fraction=divmod(code,2**bits)
    if exponent==31:return math.inf if fraction==0 else math.nan
    return math.ldexp(fraction,-14-bits) if exponent==0 else math.ldexp(2**bits+fraction,exponent-15-bits)

TABLES={bits:[field(code,bits) for code in range(31*2**bits)] for bits in (5,6)}
def quantize(word,bits):
    value=struct.unpack('<f',struct.pack('<I',word))[0]
    if math.isnan(value):return (31<<bits)|(1<<(bits-1))
    if value<=0:return 0
    if math.isinf(value):return 31<<bits
    table=TABLES[bits];right=bisect.bisect_left(table,value)
    if right==len(table):return len(table)-1
    if right==0:return 0
    low,high=right-1,right;ld,hd=value-table[low],table[high]-value
    return low if ld<hd else high if hd<ld else low if low%2==0 else high

def inverse(raw):
    assert len(raw)%16==0
    return b''.join(struct.pack('<I',quantize(r,6)|(quantize(g,6)<<11)|(quantize(b,5)<<22)) for r,g,b,a in struct.iter_unpack('<IIII',raw))

def channels(raw):
    assert len(raw)%4==0
    return [(field(w&2047,6),field(w>>11&2047,6),field(w>>22,5),1.) for w, in struct.iter_unpack('<I',raw)]

class Critic:
    def __init__(self,output):
        self.output=Path(output);self.output.mkdir(parents=True,exist_ok=True)
        self.citations=[];self.totals={k:0 for k in ['archiveMembers','sourceRecords','servedRecords','blobRecords','scalarVectors','nativeComponents','publicComponents','inverseBytes','uploadBytes','paddingBytes','nativeFences','nativeRuns','nativeAllocations','literalLayouts','rangeCopies','failureCases']}
        self.results={f'C{i:02}':dict(result='HELD',citations=[]) for i in range(1,21)}

    def held(self,cid,member,point,digest,detail):
        row=dict(prediction=cid,member=member,point=point,sha256=digest,detail=detail)
        self.results[cid]['citations'].append(len(self.citations));self.citations.append(row)

    def seal(self,folder):
        manifest=json.loads((folder/'manifest.json').read_text());indexraw=(folder/'records.json').read_bytes();index=json.loads(indexraw)
        raw=(folder/'recording.tar.gz').read_bytes();assert sha(raw)==manifest['archiveSha256'] and sha(indexraw)==manifest['recordIndexSha256']
        expected={row['path']:row for row in index['records']};assert len(expected)==len(index['records'])==manifest['records']
        members={}
        with tarfile.open(folder/'recording.tar.gz') as archive:
            for member in archive:
                assert member.isfile() and member.name in expected and member.name not in members
                data=archive.extractfile(member).read();row=expected[member.name]
                assert len(data)==row['bytes'] and sha(data)==row['sha256'],member.name
                members[member.name]=data
        assert members.keys()==expected.keys()
        self.totals['archiveMembers']+=len(members)
        return manifest,members

    def compare(self,original,actual,member,point,public=False):
        expected=[x for pixel in channels(original) for x in pixel]
        observed=struct.unpack('<'+'f'*(len(actual)//4),actual)
        assert len(expected)==len(observed),(member,point,'length')
        checked=0
        for i,(wanted,got) in enumerate(zip(expected,observed)):
            if not math.isfinite(wanted):continue
            assert got==wanted or 0<wanted<2**-14 and got==0,(member,point,i,wanted,got)
            checked+=1
        self.totals['publicComponents' if public else 'nativeComponents']+=checked
        return checked

    def public(self,original,actual,member,point):
        floats=b''.join(struct.pack('<ffff',*p) for p in channels(actual))
        return self.compare(original,floats,member,point,True)

    def fence(self,event,run,member,point):
        assert event['name']=='clientWaitSync' and event['actual'] in (37146,37148) and event['delivered'] in (37146,37148),(member,point,event)
        assert event in run['events']
        sync=event['sync'];created=[e for e in run['events'] if e['name']=='fenceSync' and e['sync']==sync]
        assert len(created)==1 and created[0]['turn']<event['turn']
        assert sum(e['name']=='deleteSync' and e['sync']==sync for e in run['events'])==1
        self.totals['nativeFences']+=1

    def blob(self,members,directory,entry):
        name=directory+'/'+entry.get('path',entry['key']+'.bin.gz');packed=members[name]
        assert sha(packed)==entry['gzipSha256'];raw=gzip.decompress(packed)
        assert len(raw)==entry['bytes'] and sha(raw)==entry['sha256'],name
        self.totals['blobRecords']+=1
        return raw

    def sources(self,report,members,member):
        sources={r['path']:r for r in report['sources']}
        for name,row in sources.items():
            if row.get('archivePath'):recorded=members['/'.join(member.split('/')[:-1])+'/'+row['archivePath']]
            else:recorded=members.get(member.split('/')[0]+'-generated/'+name) if '/build/' in name else git('show',FREEZE+':'+name)
            assert recorded is not None and len(recorded)==row['bytes'] and sha(recorded)==row['sha256'],(member,name)
            if '/build/' not in name:assert recorded==git('show',report['gitHead']+':'+name)
            self.totals['sourceRecords']+=1
        for row in report.get('servedFiles',[]):
            if row['path']=='/':continue
            if row['path']=='/fixtures.json':
                assert row['sha256']==report['fixtureTransport']['sha256'] and row['bytes']==report['fixtureTransport']['bytes']
                for item in report['inputs']:
                    original=git('show',report['gitHead']+':'+item['path']);assert len(original)==item['bytes'] and sha(original)==item['sha256']
                    if 'decodedSha256' in item:
                        decoded=gzip.decompress(original);assert len(decoded)==item['decodedBytes'] and sha(decoded)==item['decodedSha256']
                continue
            name=row['path'][1:];assert name in sources and row['sha256']==sources[name]['sha256'] and row['bytes']==sources[name]['bytes'],(member,name)
            self.totals['servedRecords']+=1
        if report.get('browserCoverage'):
            coverage_name='/'.join(member.split('/')[:-1])+'/'+report['browserCoverage']['path'];raw=members[coverage_name]
            assert sha(raw)==report['browserCoverage']['sha256']
            coverage=json.loads(raw)
            for script in coverage.get('scripts',[]):
                assert script['sha256']==sources[script['source']]['sha256']
        self.held('C02',member,'/sources,/servedFiles,/browserCoverage',sha(members[member]),'Full original, actual served and nested V8 identities authenticated.')

    def layout(self,wire,layout,metadata,member,point):
        raw=bytes.fromhex(wire);words=struct.unpack('<'+'I'*(len(raw)//4),raw);opcode=words[0]&255
        assert opcode in (43,45) and words[0]>>16==len(words)-1 and words[0]>>8&255==0
        w,h=words[9:11];direction=words[-1];offset=words[-2] if opcode==45 else words[12]
        row=4*w;footprint=(h-1)*words[4]+row;native=w*h*(16 if direction in (2,3) else 4)
        assert words[1]==metadata['id'] and layout.get('level',0)==words[2]
        assert layout['box']==dict(x=words[6],y=words[7],z=words[8],width=w,height=h,depth=words[11])
        assert layout['offset']==offset and layout['rowBytes']==row and layout['rowCount']==h and layout['rowStride']==words[4]
        assert layout['footprintBytes']==footprint and layout['requiredEnd']==offset+footprint and layout['tightBytes']==row*h
        assert layout['scratchBytes']==native and layout['stagingBytes']==(native if direction in (2,3) else 0),(member,point,layout)
        self.totals['literalLayouts']+=1

    def run(self,members,directory,report,index,run):
        member=directory+'/report.json';digest=sha(members[member]);point='/browserResult/result/runs/'+str(index)
        self.totals['nativeRuns']+=1;meta=run['metadata'];assert meta['format']==124
        originals={p['level']:self.blob(members,directory,p['input']) for p in run['planes']}
        backing=self.blob(members,directory,run['backing'])
        for p in run['planes']:
            assert p['width']==max(1,meta['width']>>p['level']) and p['height']==max(1,meta['height']>>p['level'])
            raw=b''.join(backing[p['offset']+y*p['stride']:p['offset']+y*p['stride']+p['width']*4] for y in range(p['height']))
            assert raw==originals[p['level']]
        for allocation in run['allocations']:
            m=allocation['metadata']
            if m['format']!=124:continue
            sizes=[max(1,m['width']>>k)*max(1,m['height']>>k)*4 for k in range(m['lastLevel']+1)]
            assert m['byteLength']==m['gpuByteLength']==sum(sizes) and m['packedFloat'] is True
            for p in m.get('levels',[]):assert p==dict(level=p['level'],width=max(1,m['width']>>p['level']),height=max(1,m['height']>>p['level']),byteLength=sizes[p['level']],gpuByteLength=sizes[p['level']])
            self.totals['nativeAllocations']+=1
        for op in run['operations']:self.layout(op['wire'],op['layout'],meta,member,point+'/operations')
        replacement={p['level']:self.blob(members,directory,p['input']) for p in run.get('replacement',{}).get('planes',[])}
        for upload in run['uploads']:
            inputs=replacement if upload['label'].startswith('bounded-float-unequal-replacement') else originals
            expected=self.blob(members,directory,run['patch']['input']) if upload['label']=='bounded-packed-patch-upload' else inputs[upload['args'][1]]
            actual=self.blob(members,directory,upload['bytes'])
            assert actual==expected and upload['type']=='Uint32Array' and upload['args'][6:8]==[6407,35899]
            self.totals['uploadBytes']+=len(actual)
        fault=run.get('nativeFault')
        for event in run['nativeEvents']:
            if event['name']=='texStorage2D':
                assert event['args'][0]==3553 and event['args'][2]==35898
                if fault=='storage':assert event['args'][1]==0
                else:
                    m=next(a['metadata'] for a in run['allocations'] if a['texture']==event['texture'])
                    assert event['args']==[3553,m['lastLevel']+1,35898,m['width'],m['height']]
            if event['name']=='blitFramebuffer':
                assert event['args'][8:]==([0x40000000,9728] if fault=='copy' else [16384,9728])
                if fault!='copy':
                    assert event['source']!=event['target'] and event['sourceLevel']>=event['targetLevel']
                    views=run.get('views',[])+([run['view']] if 'view' in run else [])
                    view=next((v for v in views if v['texture']==event['target']),None)
                    if view:
                        assert event['source']==run['allocations'][0]['texture']
                        assert event['sourceLevel']==view['firstLevel']+event['targetLevel']
                        assert view['firstLevel']<=event['sourceLevel']<=view['lastLevel']
                        width,height=max(1,meta['width']>>event['sourceLevel']),max(1,meta['height']>>event['sourceLevel'])
                        assert event['args'][:8]==[0,0,width,height,0,0,width,height]
                    self.totals['rangeCopies']+=1
        for read in run['readbacks']:
            if read['name']=='readPixels':
                assert read['args'][4:]==([36249,5126] if fault=='read' else [6408,5126]) and read['type'] in ('Float32Array','PBO')
                if read['bytes']:assert read['bytes']['bytes']==read['args'][2]*read['args'][3]*16
        for p in run['planes']:
            if 'observed' in p:self.compare(originals[p['level']],self.blob(members,directory,p['observed']['native']),member,point+'/planes/'+str(p['level']))
        if 'uploadFence' in run:self.fence(run['uploadFence'],run,member,point+'/uploadFence')
        for v in run.get('views',[]):
            assert v['metadata']['width']==max(1,meta['width']>>v['firstLevel']) and v['metadata']['height']==max(1,meta['height']>>v['firstLevel'])
            assert v['metadata']['lastLevel']==v['lastLevel']-v['firstLevel'] and v['generation']==run['generation']
            self.fence(v['fence'],run,member,point+'/views/fence')
            for p in v['planes']:
                assert p['local']==p['original']-v['firstLevel']
                self.compare(originals[p['original']],self.blob(members,directory,p['native']),member,point+'/views/planes')
        def public_check(original,out,label,path):
            candidates=[r for r in run['readbacks'] if r['label']==label and r['bytes'] and r['name'] in ('readPixels','getBufferSubData')]
            assert len(candidates)==1,(member,path,label)
            native=self.blob(members,directory,candidates[0]['bytes']);actual=self.blob(members,directory,out)
            assert inverse(native)==actual,(member,path,'independent native inverse')
            self.totals['inverseBytes']+=len(actual);self.public(original,actual,member,point+path)
        for t in run.get('transfers',[]):
            level=t['level'];public_check(originals[level],t['sync'],'original-float-sync-read-'+str(level),'/transfers/sync')
            for read in t['reads']:
                self.layout(read['wire'],read['layout'],meta,member,point+'/transfers/read/layout');self.fence(read['fence'],run,member,point+'/transfers/read/fence')
                public_check(originals[level],read['nativeBytes'],'original-float-staged-'+str(read['opcode'])+'-'+str(level),'/transfers/read')
        for o in run.get('observations',[]):
            actual=self.blob(members,directory,o['native']);self.fence(o['fence'],run,member,point+'/observations/fence')
            if o['kind']=='retained-old-read':
                self.public(originals[0],actual,member,point+'/observations/old');native=next(r for r in run['readbacks'] if r['name']=='getBufferSubData' and r['bytes']['bytes']==meta['width']*meta['height']*16)
                assert inverse(self.blob(members,directory,native['bytes']))==actual
            else:
                expected=self.blob(members,directory,o['clearInput']) if 'clearInput' in o else originals[o['original']]
                if o['kind'].startswith('partial-') and o['original']==run['patch']['level']:
                    p=run['patch'];patch=self.blob(members,directory,p['input']);plane=next(x for x in run['planes'] if x['level']==p['level']);expected=bytearray(expected)
                    for y in range(p['height']):at=((p['y']+y)*plane['width']+p['x'])*4;expected[at:at+p['width']*4]=patch[y*p['width']*4:(y+1)*p['width']*4]
                if 'originalClear' in o:
                    assert o['originalClear']==[.125,1.25,4,1]
                    assert all(p==(.125,1.25,4,1) for p in channels(expected))
                self.compare(expected,actual,member,point+'/observations/'+o['kind'])
                if 'local' in o:assert o['local']==o['original']-run['view']['firstLevel']
        if run.get('kind')=='retained-native-range':
            assert backing==self.blob(members,directory,run['backingAfterRefresh'])
            assert run['replacement']['generation']>run['generation'] and run['replacement']['metadata']['width']==11 and run['replacement']['metadata']['height']==5
            old=next(a for a in run['allocations'] if a['metadata']['width']==13);new=next(a for a in run['allocations'] if a['metadata']['width']==11);assert old['texture']!=new['texture']
            assert run['view']['generation']==run['generation'] and [run['view']['metadata'][k] for k in ('width','height','lastLevel')]==[6,3,2]
            snap=next(s for s in run['snapshots'] if s['point']=='old-read-completed');retained=next(r for r in snap['state']['resources'] if r['generation']==run['generation']);assert not retained['public'] and retained['references']==2
            assert snap['state']['budgets']['gpuBytes']==452+88+260 and snap['state']['budgets']['scratchBytes']==0 and snap['async']['stagingBytes']==0
            self.fence(run['holdFence'],run,member,point+'/holdFence')
            self.held('C12',member,point+'/backingAfterRefresh,/observations',digest,'Native-only mip2 clear independently equals original representable values; backing is unchanged.')
            self.held('C13',member,point+'/snapshots,/replacement,/holdFence',digest,'Old/new dimensions, generations and native object identities stay separate through consumed completion.')
        if run.get('kind')=='read-budget':
            short=run['boundary'].endswith('short');assert run['start']['ok']==(not short) and run['foreignLease']['error']['code']=='invalid-lease'
            assert run['queued']['owner']['budgets']['scratchBytes']==(0 if short else 240) and run['queued']['async']['stagingBytes']==(0 if short else 240)
            if short:assert run['start']['error']['code']=='limit-exceeded'
            else:
                self.fence(run['read']['fence'],run,member,point+'/read/fence');public_check(originals[0],run['read']['nativeBytes'],'bounded-packed-read-budget','/read/nativeBytes')
            self.held('C15',member,point+'/queued,/start,/foreignLease',digest,'Exact 240-byte native scratch/PBO and one-byte-short refusal agree with original dimensions.')
        if 'partialReads' in run:
            p=run['patch'];assert [p[k] for k in ('x','y','width','height','level','stride')]==[3,2,7,4,1,37];original=self.blob(members,directory,p['input']);t=run['partialReads']
            public_check(original,t['sync'],'bounded-packed-patch-sync','/partialReads/sync')
            for read in t['reads']:
                self.layout(read['wire'],read['layout'],meta,member,point+'/partialReads/layout');self.fence(read['fence'],run,member,point+'/partialReads/fence')
                public_check(original,read['nativeBytes'],'bounded-packed-patch-staged-'+str(read['opcode']),'/partialReads/read')
            self.held('C14',member,point+'/patch,/observations,/partialReads',digest,'Complete native patch neighbors, copied mips and literal nonzero public read ranges reconstructed.')
        if fault:
            assert fault in ['texture','storage','upload','framebuffer','copy','read','buffer','fence'] and not run['result']['ok'] and len(run['faultEvents'])==1
            assert run['afterFailure']['budgets']['scratchBytes']==0 and run['afterFailure']['budgets']['tickets']==0
            self.totals['failureCases']+=1
        assert all(n==0 for n in run['final']['budgets'].values()) and all(o['deleted']==1 for o in run['nativeObjects'])
        for name,fill in [('finalBacking',0xa7),('finalStagingBacking',0x2e)]:
            if name not in run:continue
            raw=self.blob(members,directory,run[name]);assert len(raw)==len(backing);occupied=set()
            planes=[] if 'patch' in run and name=='finalStagingBacking' else run['planes']
            if 'patch' in run:planes=planes+[run['patch']]
            for p in planes:
                dense=b''.join(raw[p['offset']+y*p['stride']:p['offset']+y*p['stride']+p['width']*4] for y in range(p['height']))
                original=self.blob(members,directory,p['input']);self.public(original,dense,member,point+'/'+name)
                for y in range(p['height']):occupied.update(range(p['offset']+y*p['stride'],p['offset']+y*p['stride']+p['width']*4))
            for i,value in enumerate(raw):
                if i not in occupied:assert value==fill;self.totals['paddingBytes']+=1
        for cid in ['C05','C06','C07','C08','C10','C11','C16','C17']:
            self.held(cid,member,point,digest,'Independently reconstructed original/native/public data, literal calls, physical fences and terminal custody.')

    def audit(self):
        folder=ROOT/'evidence/virgl-standard-packed-float-images/worker';manifest,members=self.seal(folder)
        assert manifest['sourceHead']==FREEZE and manifest['records']==3168
        self.held('C01',str(folder.relative_to(ROOT))+'/recording.tar.gz','all 3168 indexed members',manifest['archiveSha256'],'Full member hashes/sizes and exact complete membership authenticated.')
        changed=git('diff','--name-only',FREEZE,SUBMIT).decode().splitlines();assert all(n.startswith('evidence/virgl-standard-packed-float-images/worker/') or n in ['tasks/QUEUE.md','tasks/epic-6-transcendence/E6-T11d27-standard-packed-float-images.md'] for n in changed)
        for prefix in ['hot','cold']:
            receipt=json.loads(members[prefix+'/receipt.json']);assert receipt['gitHead']==FREEZE and receipt['status']=='passed'
            for name,digest in receipt['files'].items():assert sha(members[prefix+'/'+name])==digest
            for name,digest in receipt['sources'].items():assert sha(git('show',FREEZE+':'+name))==digest
            for name,digest in receipt['generated'].items():assert sha(members[prefix+'-generated/'+name])==digest
            for name,digest in receipt['carriedVerifiedEvidence'].items():assert sha((ROOT/name).read_bytes())==digest and git('show',BASE+':'+name)==(ROOT/name).read_bytes()
            for name,digest in receipt['carriedUnchangedBoundaries'].items():
                if name.endswith('packed-float-images.mjs'):assert digest==sha(b'')
                else:assert digest==sha(git('show',BASE+':'+name))
            for d in ['hardware-matrix','hardware-boundaries-0xa5471e03','hardware-boundaries-0x13579bdf','hardware-boundaries-0x9e3779b9']:
                directory=prefix+'/'+d;member=directory+'/report.json';r=json.loads(members[member]);assert r['status']=='passed' and r['gitHead']==FREEZE
                self.sources(r,members,member);assert r['browserErrors']==dict(console=[],page=[],requests=[]) and not r['browser']['headless']
                assert not any(any(token in arg.lower() for token in ['swiftshader','llvmpipe','softpipe','lavapipe','--disable-gpu']) for arg in r['browser']['commandLine'])
                b=r['browserResult']['result'];assert 'M4 Max' in b['gpu'] and 'Metal' in b['gpu'] and not b['guestExecution'] and not b['productionNegotiation'] and not b['productionDrawAuthority']
                for entry in b['blobs']:self.blob(members,directory,entry)
                for i,run in enumerate(b['runs']):self.run(members,directory,b,i,run)
                if 'hostRefusal' in b:
                    h=b['hostRefusal'];assert h['actualExtension'] and h['deliveredExtension'] is None and h['nativeAllocations']==0 and h['result']['error']['code']=='unsupported-host'
                    self.held('C04',member,'/browserResult/result/hostRefusal',sha(members[member]),'Actual host extension exists; withheld capability refuses before native allocation.')
            for d in ['fault-upload-lane','fault-copy-level']:
                member=prefix+'/'+d+'/report.json';r=json.loads(members[member]);assert r['status']=='failed';self.sources(r,members,member)
                b=r['partial'];s=b['sabotage'];run=b['runs'][0];self.fence(s['fence'],run,member,'/partial/sabotage/fence');assert not s['held'] and s['fenceCompleted'] and any(e['fault']==r['fault'] for e in run['faultEvents'])
                o=s['observation'];level=o.get('original',o.get('level'));p=next(p for p in run['planes'] if p['level']==level);original=self.blob(members,prefix+'/'+d,p['input']);actual=self.blob(members,prefix+'/'+d,o['native'])
                wanted=[x for p in channels(original) for x in p];observed=struct.unpack('<'+'f'*(len(actual)//4),actual);miss=[dict(component=i,expected=e,observed=a) for i,(e,a) in enumerate(zip(wanted,observed)) if math.isfinite(e) and e!=a and not (0<e<2**-14 and a==0)]
                assert miss,(member,'physical control unexpectedly passed')
                self.held('C18',member,'/partial/sabotage/observation',sha(members[member]),dict(firstMismatch=miss[0],fence=s['fence']))
            scalar=json.loads(members[prefix+'/scalar-audit.json']);vectors=json.loads(members[prefix+'/scalar-vectors.json']);assert len(scalar['records'])==len(vectors['records'])==11950 and scalar['inputSha256']==sha(members[prefix+'/scalar-vectors.json'])
            for i,(record,vector) in enumerate(zip(scalar['records'],vectors['records'])):
                assert record['words']==vector['words'];r,g,b=record['words'];predicted=quantize(r,6)|(quantize(g,6)<<11)|(quantize(b,5)<<22)
                assert record['actual']==predicted,(prefix,i,record,predicted);self.totals['scalarVectors']+=1
            self.held('C09',prefix+'/scalar-audit.json','/records/0..11949',sha(members[prefix+'/scalar-audit.json']),'Rational representable-value bisection, exact-distance ties to even; no runtime bit algorithm or worker expected values used.')
            wire=json.loads(members[prefix+'/wire/report.json']);assert len(wire['wire']['records'])==39
            for i,row in enumerate(wire['wire']['records']):
                kind=row['kind']
                if kind=='layout':self.layout(row['wire'],row['layout'],row['metadata'],prefix+'/wire/report.json','/wire/records/'+str(i))
                elif kind=='metadata':
                    m=row['metadata'] if 'metadata' in row else row['original']
                    size=4*sum(max(1,m['width']>>k)*max(1,m['height']>>k) for k in range(m['lastLevel']+1))
                    assert row['result']['byteLength']==row['result']['gpuByteLength']==size
                elif kind=='backend-profile':assert row['result']['error']['code']=='invalid-input'
                elif kind=='hostile':assert not row['result']['ok'] and row['calls']==(1 if row['mutation']=='proxy' else 0)
                elif kind in ['invalid','invalid-transfer']:assert not row['result']['ok']
                elif kind in ['allocation-limit','transfer-limit']:assert row['result']['ok']==row['boundary'].endswith('exact')
            self.held('C04',prefix+'/wire/report.json','/wire/records/0..38',sha(members[prefix+'/wire/report.json']),'Original own-data/layout/profile refusal and one-byte-short allocation/transfer bounds reconstructed.')
            for name in ['retained-float-storage','retained-async-jobs']:
                member=prefix+'/'+name+'/report.json';r=json.loads(members[member]);assert r['status']=='passed' and r['gitHead']==FREEZE
                assert not r['browser']['headless'];self.sources(r,members,member)
                self.held('C20',member,'/browserResult,/browserCoverage',sha(members[member]),'Affected original native regression passed with full serving/native closure.')
        cold=json.loads(members['cold/report.json']);assert cold['gitHead']==cold['cloneHead']==FREEZE and cold['status']=='passed' and cold['exitCode']==0 and not cold['statusBefore'] and not cold['statusAfter']
        assert sha(members['cold/cold.log'])==cold['logSha256'] and sha(members['cold/receipt.json'])==cold['receiptSha256']
        clone=Path(cold['clone']);assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=clone,text=True).strip()==FREEZE
        assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=clone,text=True).strip()
        self.held('C02','cold/report.json','/statusBefore,/statusAfter,/cloneHead,/receiptSha256',sha(members['cold/report.json']),'Original final clone remains exact and pristine; scrub algorithm removes Rust/Cargo/compiler/browser/npm overrides before default acceptance. Carried without redundant rebuild.')
        for prefix in ['evidence/virgl-standard-float-images','evidence/virgl-standard-float-consumer']:
            for role in ['worker','verifier']:
                p=ROOT/prefix/role;m,data=self.seal(p)
                if role=='verifier':assert m['verdict']=='verified'
                self.held('C03',str(p.relative_to(ROOT))+'/recording.tar.gz','complete original archive',m['archiveSha256'],dict(records=len(data),indexSha256=m['recordIndexSha256']))
        servers=json.loads((ROOT/'tools/virgl-command/standard-packed-float-image-serving-boundary.json').read_text())
        for row in servers['changes']:
            current=git('show',FREEZE+':'+row['path']).decode();assert current.count(row['after'])==1
            original=current.replace(row['after'],row['before'],1).encode();assert original==git('show',BASE+':'+row['path'])
            self.held('C20',row['path'],'declaration-only exact predecessor inverse',sha(current.encode()),'Complete server algorithm byte-identical after removing only new static import source declaration.')
        assert not git('diff','--name-only',BASE,SUBMIT,'--','renderer/virgl-shader','crates','web','tools/guest')
        self.held('C03','git diff '+BASE+'..'+SUBMIT,'production/compiler/default boundary',sha(git('diff',BASE,SUBMIT,'--','renderer/virgl-command/resources.mjs','renderer/virgl-command/packed-float-images.mjs')),'Only selected resources/scalar runtime changed; complete production/compiler/default decoder closure remains unchanged.')
        result=dict(schema='d27-original-independent-critic-audit-v1',status='passed',workerArchiveSha256=manifest['archiveSha256'],workerIndexSha256=manifest['recordIndexSha256'],totals=self.totals,results=self.results,citations=self.citations)
        (self.output/'original-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(dict(status='passed',totals=self.totals)))

    def audit_fresh(self,root):
        root=Path(root).resolve();members={p.relative_to(root).as_posix():p.read_bytes() for p in root.rglob('*') if p.is_file()}
        for directory in ['boundaries','fields-0x6c8e9cf5','fields-0xd013cc87']:
            member=directory+'/report.json';r=json.loads(members[member]);assert r['status']=='passed';self.sources(r,members,member)
            assert r['browserErrors']==dict(console=[],page=[],requests=[]) and not r['browser']['headless']
            b=r['browserResult']['result'];assert 'M4 Max' in b['gpu'] and 'Metal' in b['gpu']
            for entry in b['blobs']:self.blob(members,directory,entry)
            for i,run in enumerate(b['runs']):
                self.run(members,directory,b,i,run)
                if 'exactRange' in run:
                    t=run['exactRange'];self.layout(t['wire'],t['layout'],run['metadata'],member,'/exactRange/layout');assert t['expectedEnd']==run['backing']['bytes']==t['layout']['requiredEnd']
                    raw=next(p for p in run['readbacks'] if p['name']=='readPixels' and p['label']=='fresh-exact-public-box');public=self.blob(members,directory,t['public']);original=self.blob(members,directory,t['input']);assert inverse(self.blob(members,directory,raw['bytes']))==public;self.public(original,public,member,'/exactRange/public')
                    for refusal in run['refusals']:
                        if refusal['kind']=='foreign-actual-owner':assert refusal['capture']['error']['code']==refusal['read']['error']['code']=='invalid-lease' and refusal['nativeBefore']==refusal['nativeAfter']
                        elif refusal['kind']=='final-byte-range':assert refusal['result']['error']['code']=='out-of-bounds'
                        else:assert not refusal['result']['ok']
                    assert all(n==0 for n in run['foreignOwner']['final']['budgets'].values()) and all(o['deleted']==1 for o in run['foreignOwner']['nativeObjects'])
                    self.results.setdefault('C21',dict(result='HELD',citations=[]));self.held('C21',member,'/browserResult/result/runs/0/exactRange,/refusals,/foreignOwner',sha(members[member]),'Independent asymmetric original fields, actual same-ID foreign owner, exact-end nonzero mip box and shifted-byte refusal survived actual hardware execution.')
            for legacy in b.get('legacy',[]):
                assert self.blob(members,directory,legacy['input'])==self.blob(members,directory,legacy['output'])
                assert all(n==0 for n in legacy['final']['budgets'].values()) and all(o['deleted']==1 for o in legacy['nativeObjects'])
                self.fence(legacy['fence'],legacy,member,'/legacy/fence')
                native=next(p for p in legacy['readbacks'] if p['name']=='readPixels');assert self.blob(members,directory,native['bytes'])
                self.held('C19',member,'/legacy/'+str(legacy['metadata']['format']),sha(members[member]),'Actual historical native byte/default path and original public inverse recorded to fill governing legacy fallbacks.')
        member='sabotage-fields/report.json';r=json.loads(members[member]);assert r['status']=='failed';self.sources(r,members,member)
        b=r['partial'];run=b['runs'][0];s=b['sabotage'];self.fence(s['fence'],run,member,'/partial/sabotage/fence');assert s['fenceCompleted'] and not s['held'] and any(e['fault']=='upload-lane' for e in run['faultEvents'])
        o=s['observation'];p=next(p for p in run['planes'] if p['level']==o['level']);original=self.blob(members,'sabotage-fields',p['input']);actual=self.blob(members,'sabotage-fields',o['native']);wanted=[x for p in channels(original) for x in p];observed=struct.unpack('<'+'f'*(len(actual)//4),actual)
        misses=[dict(component=i,expected=e,observed=a) for i,(e,a) in enumerate(zip(wanted,observed)) if e!=a and not (0<e<2**-14 and a==0)];assert misses
        self.results['C22']=dict(result='HELD',citations=[]);self.held('C22',member,'/partial/sabotage/observation',sha(members[member]),dict(firstMismatch=misses[0],fence=s['fence'],originalInputSha256=p['input']['sha256'],nativeSha256=o['native']['sha256']))
        result=dict(schema='d27-fresh-independent-critic-audit-v1',status='passed',totals=self.totals,results=self.results,citations=self.citations)
        (self.output/'fresh-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(dict(status='passed',totals=self.totals)))

if __name__=='__main__':
    critic=Critic(sys.argv[1])
    if len(sys.argv)>2:critic.audit_fresh(sys.argv[2])
    else:critic.audit()

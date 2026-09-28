#!/usr/bin/env python3
"""Independent raw CDP recount and non-custom WASM section/name parser.
Does not import the worker profiler, binder, summarizer or their outputs.
"""
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
from urllib.parse import urljoin

OUT = Path(__file__).resolve().parent
REPO = OUT.parents[2]
SHA = lambda data: hashlib.sha256(data).hexdigest()


def uint(data, at):
    value = 0
    for shift in range(0, 35, 7):
        assert at < len(data), 'truncated ULEB'
        byte = data[at]; at += 1
        value |= (byte & 127) << shift
        if not byte & 128:
            assert value <= 0xffffffff
            return value, at
    raise AssertionError('overlong ULEB')


def string(data, at):
    size, at = uint(data, at)
    assert at + size <= len(data)
    return data[at:at+size].decode('utf8'), at+size


def sections(data):
    assert data[:8] == bytes([0,97,115,109,1,0,0,0])
    at = 8; result = []
    while at < len(data):
        start = at; kind = data[at]; at += 1
        size, at = uint(data, at)
        assert at + size <= len(data)
        result.append(dict(id=kind, sectionOffset=start, payloadOffset=at,
                           size=size, payload=data[at:at+size]))
        at += size
    return result


def function_names(named_sections):
    names = {}
    for sec in named_sections:
        if sec['id'] != 0:
            continue
        data = sec['payload']; title, at = string(data, 0)
        if title != 'name':
            continue
        while at < len(data):
            kind=data[at]; at += 1; size, at = uint(data, at)
            end=at+size; assert end<=len(data)
            if kind == 1:
                count, pos = uint(data,at)
                for _ in range(count):
                    index, pos = uint(data,pos); name, pos = string(data,pos)
                    assert index not in names, 'duplicate function-name index'
                    names[index] = name
                assert pos == end
            at = end
    assert names
    return names


def main():
    assert 3 <= len(sys.argv) <= 4, 'audit-profile.py NAMED_WASM PROFILE_JSON [WORKER_SUMMARY_JSON]'
    release_path=REPO/'web/dist/pkg/wasm_vm_wasm_bg.wasm'
    named_path=Path(sys.argv[1]); profile_path=Path(sys.argv[2])
    release=release_path.read_bytes(); named=named_path.read_bytes(); raw=profile_path.read_bytes()
    assert SHA(release)=='8230800b2ed4fe92ed0647d871d6c548fe824f3a550b09ca4a9b4941bc220ca4'
    rs=sections(release); ns=sections(named)
    re=[s for s in rs if s['id']]; ne=[s for s in ns if s['id']]
    assert [(s['id'],s['payload']) for s in re]==[(s['id'],s['payload']) for s in ne], 'non-custom sections differ'
    names=function_names(ns)
    rec=json.loads(raw); p=rec['profile']; nodes={}; parents={}; counts=Counter(); weights=Counter()
    assert len(p['samples'])==len(p['timeDeltas'])>0
    for i,node in enumerate(p['nodes']):
        assert isinstance(node['id'],int) and node['id']>0 and node['id'] not in nodes
        nodes[node['id']]=node
    for node in p['nodes']:
        assert len(node.get('children',[]))==len(set(node.get('children',[]))), 'duplicate child edge'
        for child in node.get('children',[]):
            assert child in nodes and child not in parents, 'missing child or multiple parents'
            parents[child]=node['id']
    assert len(nodes)-len(parents)==1, 'one profile tree root required'
    for node_id in nodes:
        seen=set(); node=node_id
        while node is not None:
            assert node not in seen, 'cycle'
            seen.add(node); node=parents.get(node)
    module_url=urljoin(rec['url'],'./pkg/wasm_vm_wasm_bg.wasm')
    def display(node_id):
        cf=nodes[node_id]['callFrame']; name=cf['functionName']; url=cf['url']
        if url == module_url and name.startswith('wasm-function[') and name.endswith(']'):
            index=name[14:-1]
            if index.isdigit():
                return names.get(int(index),name)
        return (name+' '+url).strip()
    self_us={}; inclusive_us={}; self_nodes=defaultdict(set); inclusive_nodes=defaultdict(set)
    total=0; sample_first={}; sample_last={}
    for sample_index,(node_id,delta) in enumerate(zip(p['samples'],p['timeDeltas'])):
        assert node_id in nodes and isinstance(delta,(int,float)) and 0<=delta<float('inf')
        counts[node_id]+=1; weights[node_id]+=delta; total+=delta
        sample_first.setdefault(node_id,sample_index); sample_last[node_id]=sample_index
        label=display(node_id); self_us[label]=self_us.get(label,0)+delta; self_nodes[label].add(node_id)
        seen=set(); node=node_id
        while node is not None:
            label=display(node)
            if label not in seen:
                inclusive_us[label]=inclusive_us.get(label,0)+delta; inclusive_nodes[label].add(node)
                seen.add(label)
            node=parents.get(node)
    assert total>0
    def ranked(mapping):
        return [dict(name=k,us=v,percent=100*v/total) for k,v in sorted(mapping.items(),key=lambda item:-item[1])]
    summary=dict(totalUs=total,samples=len(p['samples']),self=ranked(self_us),inclusive=ranked(inclusive_us))
    sec_receipts=[dict(id=s['id'],payloadSha256=SHA(s['payload']),payloadOffset=s['payloadOffset'],bytes=s['size']) for s in re]
    if len(sys.argv)==4:
        worker=json.loads(Path(sys.argv[3]).read_text())
        assert worker['releaseSha256']==SHA(release) and worker['namedSha256']==SHA(named)
        assert worker['sections']==[dict(id=s['id'],payloadSha256=s['payloadSha256']) for s in sec_receipts]
        assert worker['names']=={str(k):v for k,v in names.items()}
        claimed=worker['profiles'][profile_path.name]
        assert claimed['sha256']==SHA(raw)
        for key,value in summary.items():
            assert claimed[key]==value, ('summary mismatch',key)
    result=dict(checkedAt=datetime.now(timezone.utc).isoformat(),releaseFile=str(release_path),
                releaseSha256=SHA(release),namedFile=str(named_path),namedSha256=SHA(named),
                profileFile=str(profile_path),profileSha256=SHA(raw),nonCustomSections=sec_receipts,
                functionsNamed=len(names),profileSpanUs=p['endTime']-p['startTime'],
                summary=summary,
                nodeRecount=[dict(id=i,count=counts[i],us=weights[i],reportedHitCount=nodes[i].get('hitCount'),
                    sampleFirst=sample_first[i],sampleLast=sample_last[i],callFrame=nodes[i]['callFrame'],label=display(i))
                    for i in sorted(counts,key=lambda i:-weights[i])],
                selfCitations={k:sorted(v) for k,v in self_nodes.items()},
                inclusiveCitations={k:sorted(v) for k,v in inclusive_nodes.items()})
    (OUT/('r2-profile-inspection.json' if profile_path.parent.parent.name.endswith('-r2') else 'profile-inspection.json')).write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(profileSha256=SHA(raw),nonCustomSections=len(sec_receipts),names=len(names),
                         spanUs=result['profileSpanUs'],totalUs=total,samples=summary['samples'],
                         self=summary['self'][:8],inclusive=summary['inclusive'][:12]),indent=2))

if __name__=='__main__':
    main()

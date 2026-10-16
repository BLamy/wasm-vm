#!/usr/bin/env python3
"""Carry prior HELD compiler/bank proofs when their bytes and receipts are unchanged."""
from pathlib import Path
import hashlib
import json
import subprocess
import tarfile

OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[2]
BASE='eb0658dbda25bee84991f47e13a374fdd13f1ab6'
CLAIM='b3dd41b2633adf4dd5d29d8cac848294b8fa4e9f'

def sha(raw):return hashlib.sha256(raw).hexdigest()

def main():
    prior=ROOT/'evidence/virgl-known-branches/worker'
    manifest=json.loads((prior/'manifest.json').read_bytes())
    index=json.loads((prior/'records.json').read_bytes())
    archive=prior/manifest['archive']['path']
    assert sha(archive.read_bytes())==manifest['archive']['sha256']
    assert sha((prior/'records.json').read_bytes())==manifest['recordIndex']['sha256']
    entry=next(r for r in index['records'] if r['path']=='hot/legacy.json')
    with tarfile.open(archive,'r:gz') as reader:raw=reader.extractfile(entry['path']).read()
    assert len(raw)==entry['bytes'] and sha(raw)==entry['sha256']
    previous=json.loads(raw)
    comparisons=[]
    for prefix in ['hot','cold/acceptance']:
        legacy_raw=(OUT/'unpacked'/prefix/'legacy.json').read_bytes()
        legacy=json.loads(legacy_raw)
        assert legacy['task']==previous['task']=='E6-T12g6m2'
        assert legacy['cases']==previous['cases']
        assert legacy['extensions']==previous['extensions']
        assert legacy['oldPairs']==previous['oldPairs']==2683
        assert len(legacy['cases'])==10717 and len(legacy['extensions'])==177
        native=json.loads((OUT/'unpacked'/prefix/'native/report.json').read_bytes())
        node=json.loads((OUT/'unpacked'/prefix/'node.json').read_bytes())
        assert len(native['cases'])==len(node['cases'])==18
        for c,n in zip(native['cases'],node['cases']):
            assert c['result']==n['original'] and c['pairResult']==n['pair']
            assert c['result']['metadata']['profile']!='virgl-webgl2-raw-bits-v42'
            checked={k:v for k,v in n['contract'].items() if k not in {'exactDomain','exactBase'}}
            assert checked==n['contract']['exactBase']
            assert n['accepted']==next(a['copy'] for a in node['ownership'] if a['name']==n['name'])
        assert len(node['metadataAttacks'])==322 and all(not a['result']['ok'] for a in node['metadataAttacks'])
        assert node['getterInvocations']==0 and len(node['ownership'])==18 and len(node['bankAttacks'])==323
        comparisons.append({'prefix':prefix,'legacySha256':sha(legacy_raw),'completeResultsEqual':10717,
                            'completePairsEqual':2683,'sameClosedExtensions':177,'completeNativeWasmSinglesPairs':18,
                            'ownedMetadataRejections':322,'bankChecks':323,'aliasCopies':18,'getterCalls':0})
    unchanged_paths=['renderer/virgl-shader','renderer/virgl-command/decoder.mjs','renderer/virgl-command/resources.mjs',
                     'tools/virgl-known-branches/legacy.mjs','tools/virgl-known-branches/cases.mjs','web']
    assert not subprocess.check_output(['git','diff','--name-only',BASE,CLAIM,'--',*unchanged_paths],cwd=ROOT)
    prior_task=ROOT/'tasks/epic-6-transcendence/E6-T12g6m2-known-branch-liveness.md'
    proof=prior_task.read_text()
    assert 'VERDICT: verified' in proof and 'P6 priority and lineage — HELD.' in proof
    report={'task':'E6-T12g6m3a','predictions':['P2','P4','P7'],'status':'HELD',
            'predecessorManifestSha256':sha((prior/'manifest.json').read_bytes()),
            'predecessorArchiveSha256':manifest['archive']['sha256'],'predecessorLegacySha256':entry['sha256'],
            'predecessorVerifierTaskSha256':sha(prior_task.read_bytes()),'comparisons':comparisons,
            'unchangedBoundaries':unchanged_paths,'priorProofsRetained':True,'historicalRecordRetagged':False,
            'compilerAdmissionChanged':False,'publicDemoImportsChanged':False,'guestExecution':False,'performanceClaim':False}
    (OUT/'carry-forward.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))

if __name__=='__main__':main()

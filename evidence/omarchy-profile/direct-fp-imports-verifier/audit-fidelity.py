#!/usr/bin/env python3
"""Compare the actual AO protocol to AN and its committed source bytes."""
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
import hashlib
import json
import subprocess

repo = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
sha = lambda data: hashlib.sha256(data).hexdigest()
old_path = repo / 'evidence/omarchy-profile/fmadd-single-r1/physical-input/desktop/report.json'
new_path = repo / 'evidence/omarchy-profile/direct-fp-imports-r1/physical-input/desktop/report.json'
assert sha(old_path.read_bytes()) == '31b9e015b5f16c70cff14342357c77704e371294bec9a050c52f2e2139ae8fea'
old, new = [json.loads(path.read_text()) for path in [old_path, new_path]]
fields = ['arm', 'recycling', 'experiment', 'jitResidencyPolicy', 'jitResidencyCap',
          'startupMs', 'typingMs', 'readbackMs', 'captureMs', 'cleanupMs',
          'profilingRequested', 'admissionProbeRequested']
for field in fields:
    assert old['trial'][field] == new['trial'][field], field
roles = ['kernel', 'bootSnapshot', 'overlayDelta', 'chunkManifest', 'image']
for role in roles:
    assert old['candidate']['source'][role] == new['candidate']['source'][role], role
queries = [parse_qs(urlsplit(report['url']).query) for report in [old, new]]
for query in queries:
    query.pop('omarchyAssetBase')
assert queries[0] == queries[1]
head = new['trial']['head']
helpers = []
for path, pin in new['trial']['helpers'].items():
    data = subprocess.check_output(['git', 'show', head + ':' + path], cwd=repo)
    assert len(data) == pin['size'] and sha(data) == pin['sha256'], path
    helpers.append({'path': path, 'sha256': pin['sha256']})
served = []
for entry in new['resourceIdentities']:
    path = entry.get('repoPath')
    if path and path.startswith('web/'):
        data = subprocess.check_output(['git', 'show', head + ':' + path], cwd=repo)
        assert sha(data) == entry['sha256'], path
        served.append({'path': path, 'sha256': entry['sha256']})
runtimes = [row['runtime'] for row in new['observations'] if 'runtime' in row]
before, after = runtimes[0], runtimes[-1]
retired = after['jit']['guestRetired'] - before['jit']['guestRetired']
jit = after['jit']['retiredViaJit'] - before['jit']['retiredViaJit']
assert 0 < retired and 0 <= jit <= retired
receipt = {
    'passed': True, 'head': head, 'rawReportSha256': sha(new_path.read_bytes()),
    'sameTrialFields': fields, 'sameSourceRoles': roles, 'sameQueriesExceptOwnedOrigin': queries[1],
    'helpersBoundToCommittedHead': helpers, 'servedWebFilesBoundToCommittedHead': served,
    'inputDeviceSamples': [row['inputDevice'] for row in runtimes],
    'frames': [before['presentation']['framesReceived'], after['presentation']['framesReceived']],
    'intervalRetired': retired, 'intervalJitRetired': jit, 'intervalJitShare': jit / retired,
    'guestClockTicksAdvanced': int(after['clock']['mtime']) - int(before['clock']['mtime']),
    'clockTimebaseHz': after['clock']['timebaseHz'],
    'physicalOutcome': new['trial']['outcome'],
    'performanceClaim': 'No speedup inference from a single physical trial; benchmark is separate.',
}
(out / 'physical-fidelity.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({key: receipt[key] for key in ['head', 'frames', 'intervalRetired', 'intervalJitRetired', 'physicalOutcome']}, indent=2))

"""Report observed deltas without equating physical PCs with code identity."""
from pathlib import Path
import json

gates = Path(__file__).resolve().parent
run = gates.parent/'residency-after-fp-r1'
fields = ['guestRetired', 'retiredViaJit', 'jitCacheInstalls', 'jitCacheRetranslations',
          'jitCacheEvictions', 'jitCacheBatches', 'jitCacheCodeBytes', 'compiledBlocks']
result = {'limits': ['Retranslations count recurring previously evicted physical PCs, not equal code bytes.',
                     'Evictions count whole batches, while installs and retranslations count blocks.',
                     'One pair establishes its absolute input outcomes, not a comparative speedup.'], 'arms': []}
for arm in ['control', 'candidate']:
    report = json.loads((run/arm/'report.json').read_text())
    states = [row['runtime']['jit'] for row in report['observations'] if row.get('runtime')]
    before, after = states[0], states[-1]
    result['arms'].append({'arm': arm, 'policy': before['jitResidencyPolicy'],
        'cap': before['jitResidencyCap'], 'before': {k: before[k] for k in fields},
        'after': {k: after[k] for k in fields}, 'delta': {k: after[k]-before[k] for k in fields},
        'queueBefore': before['compileQueue'], 'queueAfter': after['compileQueue']})
(run/'cache-observations.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(result, indent=2))

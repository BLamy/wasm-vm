"""Extract actual recorded outcomes without changing or inferring acceptance."""
from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parent
source = root / 'physical-input/desktop/report.json'
report = json.loads(source.read_text())
runtimes = [row['runtime'] for row in report['observations'] if 'runtime' in row]
before, after = runtimes[0], runtimes[-1]
keyboard = report.get('keyboard', {})
guest_file = keyboard.get('guestFile')
readbacks = [row['exec'] for row in report['observations']
             if 'exec' in row and guest_file and guest_file in row['exec'].get('command', '')]
requested = [row for row in report['serialCommands']
             if guest_file and guest_file in row.get('command', '')]
summary = {
    'reportSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'head': report['trial']['head'],
    'wasmSha256': report['identities']['files']['pkg/wasm_vm_wasm_bg.wasm']['sha256'],
    'responsive': report.get('result') == 'input-trial-physical-nonce-and-fresh-presentation',
    'startup': report.get('startup'),
    'keyboard': keyboard,
    'eventCount': len(report['inputEvents']),
    'trustedEvents': sum(row.get('trusted', False) for row in report['inputEvents']),
    'inputDeviceFinal': after['inputDevice'],
    'framesBefore': before['presentation']['framesReceived'],
    'framesAfter': after['presentation']['framesReceived'],
    'guestRetiredBefore': before['jit']['guestRetired'],
    'guestRetiredAfter': after['jit']['guestRetired'],
    'jitShareAfter': after['jit']['jitRetiredShare'],
    'guestClockBefore': before['clock'],
    'guestClockAfter': after['clock'],
    'completedReadbackCommands': len(readbacks),
    'pendingReadbackCommands': len(requested) - len(readbacks),
    'readbackExits': [row.get('exit') for row in readbacks],
    'errors': report.get('errors'),
    'cleanup': report.get('cleanup'),
}
baseline = root / 'physical-input/desktop/desktop.png'
failure = root / 'physical-input/desktop/failure.png'
if baseline.exists() and failure.exists():
    summary['sameBaselineAndFailureImage'] = baseline.read_bytes() == failure.read_bytes()
(root / 'physical-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary, indent=2))

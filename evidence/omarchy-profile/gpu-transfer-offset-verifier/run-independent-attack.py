"""Run the critic oracle and one old-arithmetic sabotage only in the completed cold clone."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys

clone = Path(sys.argv[1]).resolve()
out = Path(__file__).resolve().parent
assert str(clone).startswith('/private/tmp/wasm-vm-gpu-transfer-cold-')
expected_head = '2e61bf3e971595741c627e8b68fcaee055c27945'
env = {key:value for key,value in os.environ.items()
       if not key.startswith(('CARGO_', 'OMARCHY_')) and key not in ('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG')}
env['DEVELOPER_DIR'] = '/Library/Developer/CommandLineTools'
env['PATH'] = str(Path.home()/'.cargo/bin') + ':/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'
digest = lambda data: hashlib.sha256(data).hexdigest()
receipt = {'head':expected_head, 'clone':str(clone), 'steps':[], 'passed':False}

def git(*args):
    return subprocess.check_output(['git',*args],cwd=clone,env=env)

def save():
    (out/'independent-attack.json').write_text(json.dumps(receipt,indent=2)+'\n')

def run(label, command, expected=0):
    result = subprocess.run(command,cwd=clone,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    (out/(label+'.log')).write_bytes(result.stdout)
    receipt['steps'].append({'label':label,'command':command,'code':result.returncode,
                             'logSha256':digest(result.stdout)})
    save()
    assert result.returncode == expected, (label,result.returncode,result.stdout[-3000:])
    return result.stdout

def library(label):
    text = run(label,['cargo','build','--offline','-p','wasm-vm-core','--message-format=json'])
    artifacts = []
    for line in text.splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if row.get('reason') == 'compiler-artifact' and row.get('target',{}).get('name') == 'wasm_vm_core':
            artifacts += [Path(file) for file in row['filenames'] if file.endswith('.rlib')]
    assert len(artifacts) == 1, artifacts
    return artifacts[0]

def probe(label, lib, expected=0):
    binary = clone.parent/('critic-offset-'+label)
    run(label+'-compile',['rustc','--edition=2024','--test',str(out/'independent-offset-attack.rs'),
                         '--extern','wasm_vm_core='+str(lib),'-L','dependency='+str(clone/'target/debug/deps'),
                         '-o',str(binary)])
    receipt[label+'BinarySha256'] = digest(binary.read_bytes())
    run(label,[str(binary),'--nocapture','--test-threads=1'],expected)

assert git('rev-parse','HEAD').decode().strip() == expected_head
assert git('status','--porcelain') == b'', 'cold clone must be clean before critic mutation'
source_path = clone/'crates/core/src/dev/virtio/gpu/resources.rs'
original = source_path.read_bytes()
assert original == git('show',expected_head+':crates/core/src/dev/virtio/gpu/resources.rs')
receipt['originalSourceSha256'] = digest(original)
old = git('show','af253faa:crates/core/src/dev/virtio/gpu/resources.rs').decode()
old_arithmetic = old[old.index('        let first_row = offset\n'):old.index('        let last_row_advance =')]
assert 'checked_add' in old_arithmetic and 'rect.y' in old_arithmetic and 'rect.x' in old_arithmetic
try:
    probe('clean',library('clean-build'))
    changed = original.decode().replace('        let first_row = offset;\n',old_arithmetic)
    assert changed != original.decode()
    source_path.write_text(changed)
    receipt['sabotagedSourceSha256'] = digest(source_path.read_bytes())
    receipt['sabotageDiff'] = git('diff','--','crates/core/src/dev/virtio/gpu/resources.rs').decode()
    run('worker-literal-sabotage',['cargo','test','--offline','-p','wasm-vm-core','--lib',
        'gpu_transfer_literal_source_offsets_cross_sg_pages_and_end_exactly','--','--nocapture'],101)
    run('worker-queue-sabotage',['cargo','test','--offline','-p','wasm-vm-core','--lib',
        'gpu_transfer_controlq_copies_sg_rows_and_echoes_fence','--','--nocapture'],101)
    probe('sabotaged',library('sabotaged-build'),101)
finally:
    source_path.write_bytes(original)
    receipt['sourceRestored'] = source_path.read_bytes() == original
    save()
assert git('status','--porcelain') == b'', 'critic must restore all tracked cold-clone bytes'
probe('restored',library('restored-build'))
receipt['trackedCloneClean'] = True
receipt['passed'] = True
save()
print(json.dumps({'passed':True,'head':expected_head,'clone':str(clone),'steps':len(receipt['steps'])}))

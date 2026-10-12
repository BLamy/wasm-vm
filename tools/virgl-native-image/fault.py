#!/usr/bin/env python3
"""Wrong native mip geometry in a separate checkout must fail the literal oracle."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
repo = Path(__file__).resolve().parents[2]
output = Path(sys.argv[1]).resolve()
assert not output.exists()
output.mkdir(parents=True)
head = subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
clone = Path(tempfile.mkdtemp(prefix='wasm-vm-native-image-fault-'))/'repo'
subprocess.run(['git','clone','--quiet','--shared','--no-checkout',str(repo),str(clone)],check=True)
subprocess.run(['git','checkout','--quiet','--detach',head],cwd=clone,check=True)
path = 'crates/core/src/dev/virtio/gpu/control3d.rs'
source = (clone/path).read_bytes()
anchor = b'Ok(((self.width >> level).max(1), (self.height >> level).max(1)))'
assert source.count(anchor) == 1
mutant = source.replace(anchor,b'Ok((self.width, self.height))')
(clone/path).write_bytes(mutant)
(output/'original.rs').write_bytes(source)
(output/'mutant.rs').write_bytes(mutant)
env = {k:v for k,v in os.environ.items() if not k.startswith(('CARGO_','RUST','LLVM_PROFILE'))}
env['CARGO_TARGET_DIR'] = str(repo/'target/virgl-native-image-fault')
command = ['cargo','test','--offline','-p','wasm-vm-core','--features','virgl-control-proof,gpu-trace,trace','--test','virtio_gpu_submit3d',
           'selected_desktop_image_layouts_live_mip_dma_and_guards','--','--nocapture','--test-threads=1']
result = subprocess.run(command,cwd=clone,env=env,capture_output=True,timeout=600)
(output/'stdout').write_bytes(result.stdout);(output/'stderr').write_bytes(result.stderr)
assert result.returncode == 101, result.stderr[-2000:]
text = result.stderr.decode()
assert 'NATIVE_IMAGE_PREDICTION format=1 public=224 gpu=224 levels=4' in text
assert 'left: (720, 720)' in text and 'right: (224, 224)' in text
points = [json.loads(l.removeprefix('SUBMIT3D_PORTABLE_RECORD ')) for l in text.splitlines() if l.startswith('SUBMIT3D_PORTABLE_RECORD ')]
point = points[-1];assert point['case'] == 'image-create'
for key in ['transport','submit']:
    assert hashlib.sha256(bytes.fromhex(point[key+'Canonical'])).hexdigest() == point[key+'Digest']
report = {'schema':'native-image-sabotage-v1','head':head,'clone':str(clone),'command':command,'exitCode':result.returncode,
          'originalSha256':hashlib.sha256(source).hexdigest(),'mutantSha256':hashlib.sha256(mutant).hexdigest(),
          'point':point,'prediction':{'format':1,'public':224,'gpu':224},'observed':{'public':720,'gpu':720},
          'finding':'Wrong NPOT mip extent charges720 bytes; the independent literal224-byte native accounting oracle failed.'}
(output/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(report['finding'])

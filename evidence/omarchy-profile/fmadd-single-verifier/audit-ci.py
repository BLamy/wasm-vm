#!/usr/bin/env python3
import hashlib,json,os,re,subprocess
from pathlib import Path
repo=Path(__file__).resolve().parents[3];out=Path(__file__).resolve().parent
worker=repo/'evidence/omarchy-profile/fmadd-single-r1'
old=(repo/'evidence/omarchy-profile/snapshot-allocation-gates/ci.log').read_text()
now=(worker/'ci.log').read_text()
status=json.loads((worker/'ci-commands.json').read_text())
assert status['commands'][0]['code']==2 and status['allPassed'] is False
errors=lambda t:set(re.findall(r'^error(?:\[[^]]+\])?:.*$',t,re.M))
targets=lambda t:re.findall(r'^make: \*\*\* \[([^]]+)\] Error (\d+)',t,re.M)
assert errors(now)<=errors(old),errors(now)-errors(old)
assert targets(now)==targets(old)==[('clippy','101'),('test','101'),('wasm','1'),('test-riscv','1'),('determinism','1')]
assert 'reserved_section_is_refused_as_unsupported_on_wasm32 ... FAIL' in now
assert 'crates/wasm/tests/resume.rs:93' in now
assert '- passing: **128 / 128**' in now
assert 'perf-smoke: alu median 58.4 MIPS ≥ floor 15' in now
env=dict(os.environ,DEVELOPER_DIR='/Library/Developer/CommandLineTools')
git=lambda *a:subprocess.check_output(['git',*a],cwd=repo,env=env)
sha=lambda b:hashlib.sha256(b).hexdigest()
paths=['crates/wvseccomp/src/main.rs','crates/core/src/dispatch.rs','crates/core/src/hart/mod.rs','crates/core/src/lib.rs','crates/wasm/tests/resume.rs','crates/core/src/dev/virtio/gpu/resources.rs','Cargo.lock']
same={}
for p in paths:
 a=git('show','27eab37c:'+p);b=git('show','618286f3:'+p)
 assert a==b,p
 same[p]=sha(b)
p='crates/wasm/src/jit_browser.rs';marker=b'#[cfg(all(test, target_arch = "wasm32"))]'
a=git('show','27eab37c:'+p);b=git('show','618286f3:'+p)
assert a[a.index(marker):]==b[b.index(marker):]
same[p+'::test_module']=sha(b[b.index(marker):])
receipt=dict(broadCiPassed=False,exitCode=2,failingTargets=targets(now),
 noNewCompilerError=True,sameFailedTargets=True,unchangedFailureBoundaries=same,
 nativeIsa='128/128',perfMedianMips=58.4,perfFloorMips=15,
 currentSha256=sha(now.encode()),baselineSha256=sha(old.encode()),
 note='These five inherited categories remain failures; affected and frozen acceptance results are separate.')
(out/'ci-inspection.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt,indent=2))

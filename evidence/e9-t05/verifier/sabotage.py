#!/usr/bin/env python3
"""Deliberately bypass exact-input capture in an isolated partial crate, never the product tree."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'evidence/e9-t05/verifier'
SCRATCH = ROOT / 'target/e9-t05-critic-sabotage'
assert not SCRATCH.exists(), 'preserve any previous sabotage experiment'
shutil.copytree(ROOT / 'crates/core', SCRATCH / 'crates/core')
(SCRATCH / 'tests/riscv-tests-bin').mkdir(parents=True)
shutil.copyfile(ROOT / 'tests/riscv-tests-bin/rv64ua-p-lrsc',
                SCRATCH / 'tests/riscv-tests-bin/rv64ua-p-lrsc')
shutil.copyfile(ROOT / 'rust-toolchain.toml', SCRATCH / 'rust-toolchain.toml')
shutil.copyfile(ROOT / 'Cargo.lock', SCRATCH / 'Cargo.lock')
workspace = re.search(r'(?ms)^\[workspace\.package\]\n.*?(?=^\[|\Z)',
                      (ROOT / 'Cargo.toml').read_text()).group()
(SCRATCH / 'Cargo.toml').write_text('[workspace]\nmembers=["crates/core"]\nresolver="2"\n' + workspace)
original = (ROOT / 'crates/core/src/lib.rs').read_bytes()
path = SCRATCH / 'crates/core/src/lib.rs'
source = path.read_text()
needle = 'self.save_resume_inner(None, true)'
assert source.count(needle) == 1
path.write_text(source.replace(needle, 'self.save_resume_inner(None, false)'))
command = ['cargo', 'test', '--manifest-path', str(SCRATCH / 'Cargo.toml'), '-p', 'wasm-vm-core',
           '--features', 'virgl-renderer,trace', '--test', 'e9_session_checkpoint_verifier',
           'mixed_delivered_pending_staged_input_survives_32_boundary_schedules', '--', '--nocapture']
env = {key: value for key, value in os.environ.items()
       if not key.startswith('CARGO_') and key not in ('RUSTFLAGS', 'RUSTDOCFLAGS', 'RUST_LOG')}
with (OUT / 'sabotage.log').open('wb') as log:
    result = subprocess.run(command, cwd=SCRATCH, env=env, stdout=log, stderr=subprocess.STDOUT)
log = (OUT / 'sabotage.log').read_text()
assert result.returncode != 0
assert 'capture changed a delivered/pending/staged input ledger' in log, log[-4000:]
assert (ROOT / 'crates/core/src/lib.rs').read_bytes() == original
report = {'status': 'HELD', 'experiment': 'intentionally incomplete isolated crate; not pristine-clone proof',
          'command': command, 'exit_code': result.returncode,
          'mutation': 'save_session_resume routes to legacy physical-input release codec',
          'original_sha256': hashlib.sha256(original).hexdigest(),
          'sabotaged_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
          'product_source_unchanged': True, 'expected_failure': 'capture changed a delivered/pending/staged input ledger'}
(OUT / 'sabotage.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))

#!/usr/bin/env python3
"""Run a wrong literal in an isolated copy, then restore and repeat that fixture."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
scratch = Path(tempfile.mkdtemp(prefix='wasm-vm-division-critic-', dir='/private/tmp'))
(scratch / 'src').mkdir()
support = (root / 'tests/support/jit_fp_division_verifier.rs').read_text()
mutant, count = re.subn(
    r'BOX \| 0x3eaa_aaab,(\s*"CRITIC_FDIV_THIRD_GOLDEN")',
    r'BOX | 0x3eaa_aaaa,\1', support)
assert count == 1
(scratch / 'Cargo.toml').write_text(f'''[package]
name = "wasm-vm-fp-division-critic-sabotage"
version = "0.0.0"
edition = "2024"
[workspace]
[dependencies]
wasm-vm-core = {{ path = "{root}/crates/core" }}
wasm-vm-jit-runtime = {{ path = "{root}/crates/jit-runtime" }}
''')
wrapper = '''#[allow(dead_code)]
#[path = "proof.rs"]
mod proof;
fn native(_: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(jit_runtime::WasmtimeExecutor::new())
}
#[test]
fn isolated_division_literal() {
    eprintln!("ISOLATED_DIVISION {:?}", proof::literal_goldens(native, false));
}
'''
(scratch / 'src/lib.rs').write_text(wrapper)
shutil.copyfile(root / 'Cargo.lock', scratch / 'Cargo.lock')
env = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools',
           CARGO_TARGET_DIR=str(root / 'target'), CARGO_BUILD_JOBS='4')
command = ['cargo', 'test', '--offline', '--manifest-path', str(scratch / 'Cargo.toml'),
           '--', '--nocapture']


def run(label, text):
    (scratch / 'src/proof.rs').write_text(text)
    with (out / f'sabotage-{label}.log').open('w') as stream:
        proc = subprocess.run(command, env=env, cwd=root, stdout=stream,
                              stderr=subprocess.STDOUT, check=False)
    return proc.returncode


mutant_exit = run('mutant', mutant)
assert mutant_exit == 101
assert 'CRITIC_FDIV_THIRD_GOLDEN' in (out / 'sabotage-mutant.log').read_text()
restored_exit = run('restored', support)
assert restored_exit == 0
digest = lambda b: hashlib.sha256(b).hexdigest()
receipt = dict(scratch=str(scratch), command=command,
               mutation='One isolated expected 1/3 RNE result changed from 3eaaaaab to 3eaaaaaa',
               original_support_sha256=digest(support.encode()),
               mutant_support_sha256=digest(mutant.encode()),
               wrapper_sha256=digest(wrapper.encode()),
               restored_support_sha256=digest((scratch / 'src/proof.rs').read_bytes()),
               mutant_exit=mutant_exit, restored_exit=restored_exit,
               logs={f'sabotage-{name}.log': digest((out / f'sabotage-{name}.log').read_bytes())
                     for name in ['mutant', 'restored']})
(out / 'sabotage.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))

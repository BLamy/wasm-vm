#!/usr/bin/env python3
"""Authenticate coverage with the exact original executables, never rebuilt binaries."""
from pathlib import Path
import hashlib
import json
import os
import subprocess

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
UNPACKED = OUT / 'unpacked'

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def main():
    records = []
    for label, prefix, generated in [('hot', 'hot', 'generated'), ('cold', 'cold/acceptance', 'cold-generated')]:
        original = UNPACKED / generated / 'known-branch-sanitize/known-branch-test'
        original_raw = original.read_bytes()
        raw_profile = UNPACKED / prefix / 'native/native.profraw'
        merged = OUT / (label + '-original.profdata')
        subprocess.run(['xcrun', 'llvm-profdata', 'merge', '-sparse', str(raw_profile), '-o', str(merged)], check=True)
        exported = subprocess.check_output(['xcrun', 'llvm-cov', 'export', str(original), '-instr-profile=' + str(merged)])
        old = (UNPACKED / prefix / 'native/coverage.json').read_bytes()
        assert json.loads(exported) == json.loads(old), label
        (OUT / (label + '-reexport.json')).write_bytes(exported)
        records.append({'label': label, 'binarySha256': sha(original_raw), 'rawProfileSha256': sha(raw_profile.read_bytes()),
                        'originalExportSha256': sha(old), 'reexportSha256': sha(exported), 'fullParsedExportEqual': True})
    # Replay only the exact retained hot executable against the exact recorded input.
    hot = UNPACKED / 'generated/known-branch-sanitize/known-branch-test'
    hot.chmod(0o755)
    env = {**os.environ, 'ASAN_OPTIONS': 'abort_on_error=1', 'UBSAN_OPTIONS': 'halt_on_error=1',
           'LLVM_PROFILE_FILE': str(OUT / 'retained-native-replay.profraw')}
    result = subprocess.run([str(hot)], input=(UNPACKED / 'hot/native/cases.bin').read_bytes(), env=env, capture_output=True)
    (OUT / 'retained-native-replay.log').write_bytes(result.stdout)
    (OUT / 'retained-native-replay.stderr').write_bytes(result.stderr)
    assert result.returncode == 0 and not result.stderr
    assert result.stdout == (UNPACKED / 'hot/native/native.log').read_bytes()
    current_wasm = ROOT / 'renderer/virgl-shader/build/wasm/virgl-shader.wasm'
    assert current_wasm.read_bytes() == (UNPACKED / 'generated/wasm/virgl-shader.wasm').read_bytes()
    report = {'task': 'E6-T12g6m3a', 'status': 'passed', 'exports': records,
              'retainedReplayExitCode': result.returncode, 'retainedReplayStdoutSha256': sha(result.stdout),
              'currentWasmEqualsOriginal': True, 'wasmSha256': sha(current_wasm.read_bytes())}
    (OUT / 'reexport-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))

if __name__ == '__main__':
    main()

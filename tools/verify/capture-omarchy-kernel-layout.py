#!/usr/bin/env python3
"""Run inside the existing read-only kernel build container; emit provenance JSON."""
import hashlib
import json
import pathlib
import re
import shlex
import subprocess

kernel = pathlib.Path('/build/linux-6.6.63')
source = pathlib.Path('/repo/tools/verify/omarchy-kernel-layout.c')
saved = (kernel / 'arch/riscv/kernel/.asm-offsets.s.cmd').read_text().splitlines()[0]
original = shlex.split(saved.split(' := ', 1)[1])
command = [arg for arg in original if not arg.startswith('-Wp,-MMD,')]
command[command.index('-o') + 1] = '/tmp/omarchy-kernel-layout.s'
command[-1] = str(source)
subprocess.run(command, cwd=kernel, check=True, capture_output=True)
assembly = pathlib.Path('/tmp/omarchy-kernel-layout.s').read_text()
offsets = {name: int(value) for name, value in re.findall(r'->(\w+) (\d+) ', assembly)}
assert len(offsets) == 37, offsets
paths = ['arch/riscv/boot/Image', 'System.map', '.config',
         'include/generated/asm-offsets.h', 'arch/riscv/kernel/stacktrace.c',
         'include/linux/sched.h', 'include/linux/sched/signal.h',
         'include/linux/mm_types.h', 'arch/riscv/include/asm/ptrace.h',
         'arch/riscv/include/asm/processor.h', 'arch/riscv/include/asm/thread_info.h']
hashes = {name: hashlib.sha256((kernel / name).read_bytes()).hexdigest() for name in paths}
result = {
    'purpose': 'offline checkpoint layout, not a kernel rebuild',
    'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'kernelFiles': hashes,
    'compiler': subprocess.check_output([command[0], '--version'], text=True).splitlines()[0],
    'originalCommand': original,
    'probeCommand': command,
    'offsets': offsets,
    'assembly': assembly,
    'generatedOffsets': (kernel / 'include/generated/asm-offsets.h').read_text(),
    'stacktraceSource': (kernel / 'arch/riscv/kernel/stacktrace.c').read_text(),
}
print(json.dumps(result, indent=2))

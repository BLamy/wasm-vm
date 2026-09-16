#!/usr/bin/env python3
"""Reconstruct the benchmark's final RAM/registers and matched medians."""
from pathlib import Path
import hashlib
import json
import statistics
import struct
import sys

directory = Path(sys.argv[1])
report_path = directory / 'report.json'
report = json.loads(report_path.read_text())
elf = (directory / 'mixed-fp.elf').read_bytes()
assert hashlib.sha256(elf).hexdigest() == report['elfSha256']
assert report['iterations'] == 50000
assert report['retirements'] == 500065
assert elf[:7] == b'\x7fELF\x02\x01\x01'
assert struct.unpack_from('<H', elf, 18)[0] == 243
phoff = struct.unpack_from('<Q', elf, 32)[0]
phentsize, phnum = struct.unpack_from('<HH', elf, 54)
assert phnum == 1 and phentsize == 56
kind, flags, offset, vaddr, paddr, filesz, memsz, align = struct.unpack_from('<IIQQQQQQ', elf, phoff)
assert (kind, flags, offset, vaddr, paddr, filesz, memsz, align) == (
    1, 7, 4096, 0x80000000, 0x80000000, 0x2060, 12288, 4096
)
words = list(struct.unpack_from('<44I', elf, offset))
assert words == report['words']
assert words[-1] == 0x6f
# Independently classify the loop's actual opcode words, not fixture metadata.
loop = words[16:26]
counts = {'fp_arith_s': 0, 'fp_from_int_s': 0, 'fp_to_word_s': 0, 'fp_div_s': 0, 'fp_fmadd_s': 0}
for word in loop:
    opcode = word & 0x7f
    funct7 = word >> 25
    if opcode == 0x43:
        assert (word >> 25) & 3 == 0
        counts['fp_fmadd_s'] += 50000
    elif opcode == 0x53:
        name = {0: 'fp_arith_s', 0x68: 'fp_from_int_s', 0x60: 'fp_to_word_s', 0x0c: 'fp_div_s'}[funct7]
        counts[name] += 50000
    else:
        assert opcode in [0x13, 0x63]
assert counts == {'fp_arith_s': 50000, 'fp_from_int_s': 50000, 'fp_to_word_s': 50000, 'fp_div_s': 50000, 'fp_fmadd_s': 200000}
count_key = 'derivedHelperOccurrences' if 'derivedHelperOccurrences' in report else 'expectedHelperCalls'
assert counts == report[count_key]
ram = bytearray(8 * 1024 * 1024)
ram[:filesz] = elf[offset:offset + filesz]
boxed = [0xffffffff00000000 | value for value in [
    0x3f800000, 0x41000000, 0x3ec00000, 0x40800000,
    0x41000000, 0x3f800000, 0x3f800000,
]]
for index, value in enumerate(boxed):
    struct.pack_into('<Q', ram, 0x2020 + index * 8, value)
ram_digest = hashlib.sha256(ram).hexdigest()
registers = [0] * 33
registers[0] = 0x800000ac
registers[2] = 0x2000  # x1 LUI, then CSRW mstatus
registers[6] = 0x80002000  # x5 data address
registers[11] = 4  # x10 converted word
for reg, value in zip(range(13, 20), boxed):
    registers[reg + 1] = value
registers[22] = 2  # x21 saved frm
# csr.rs normalize_mstatus hardwires UXL=SXL=2 for RV64, independently of
# the software write above. Include those read-only bits in the full oracle.
registers[23] = 0x8000000a00006000  # x22 saved mstatus
expected_registers = [format(value, 'x') for value in registers]
measurement = report['measurement']
assert [run['arm'] for run in measurement['warmups']] == ['baseline', 'candidate', 'candidate', 'baseline']
assert len(measurement['pairs']) == 5
runs = list(measurement['warmups'])
for index, pair in enumerate(measurement['pairs']):
    order = ['baseline', 'candidate'] if index % 2 == 0 else ['candidate', 'baseline']
    assert pair['pair'] == index and pair['order'] == order
    assert [run['arm'] for run in pair['runs']] == order
    runs.extend(pair['runs'])
compiled = []
for run in runs:
    assert run['prefix']['kind'] == 'max' and run['result']['kind'] == 'max'
    assert run['stats']['retired'] == 500065
    assert run['registers'] == expected_registers, (run['arm'], run['registers'], expected_registers)
    assert run['digest'] == ram_digest, (run['digest'], ram_digest)
    retired_jit = run['jitStats']['retiredViaJit']
    assert retired_jit >= 0.99 * 500065 and retired_jit <= 500065
    lower = {name: count - (500065 - retired_jit) for name, count in counts.items()}
    assert min(lower.values()) > 0
    if 'compiledHelperLowerBounds' in run:
        assert run['compiledHelperLowerBounds'] == lower
    compiled.append({'arm': run['arm'], 'compiledRetirements': retired_jit, 'helperCompiledLowerBounds': lower})
    assert run['stats'] == runs[0]['stats']
assert len({run['compiledRetirements'] for run in compiled}) == 1
times = {arm: [run['elapsedMs'] for pair in measurement['pairs'] for run in pair['runs'] if run['arm'] == arm] for arm in ['baseline', 'candidate']}
assert all(len(values) == 5 and min(values) > 0 for values in times.values())
medians = {arm: statistics.median(values) for arm, values in times.items()}
assert medians['candidate'] < medians['baseline']
assert report['medians'] == {'baselineMs': medians['baseline'], 'candidateMs': medians['candidate']}
assert report['candidateRatio'] == medians['candidate'] / medians['baseline']
assert report['passed'] and report['errors'] == []
receipt = {
    'reportPath': str(report_path), 'reportSha256': hashlib.sha256(report_path.read_bytes()).hexdigest(),
    'elfSha256': hashlib.sha256(elf).hexdigest(), 'independentRamSha256': ram_digest,
    'independentRegisters': expected_registers, 'helperOccurrencesFromOpcodes': counts,
    'compiledCoverage': compiled, 'times': times, 'medians': medians,
    'candidateRatio': medians['candidate'] / medians['baseline'],
    'claim': 'bounded mixed-FP import benchmark only; not desktop responsiveness',
}
out = Path(sys.argv[2])
out.write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({key: receipt[key] for key in ['independentRamSha256', 'medians', 'candidateRatio']}, indent=2))

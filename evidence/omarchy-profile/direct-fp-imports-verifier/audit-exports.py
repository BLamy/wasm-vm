#!/usr/bin/env python3
"""Read raw production WASM type/export sections, independently of JS glue."""
from pathlib import Path
import hashlib
import json
import sys


class Reader:
    def __init__(self, data):
        self.data = data
        self.at = 0

    def byte(self):
        value = self.data[self.at]
        self.at += 1
        return value

    def uleb(self):
        value = shift = 0
        while True:
            byte = self.byte()
            value |= (byte & 127) << shift
            if byte < 128:
                return value
            shift += 7
            assert shift < 70

    def take(self, size):
        end = self.at + size
        assert end <= len(self.data)
        value = self.data[self.at:end]
        self.at = end
        return value

    def name(self):
        return self.take(self.uleb()).decode()

    def limits(self):
        flags = self.uleb()
        self.uleb()
        if flags & 1:
            self.uleb()


def inspect(path):
    data = path.read_bytes()
    assert data[:8] == b'\0asm\1\0\0\0'
    reader = Reader(data[8:])
    types, imported, functions, exports = [], [], [], {}
    while reader.at < len(reader.data):
        kind = reader.byte()
        body = Reader(reader.take(reader.uleb()))
        if kind == 1:
            for _ in range(body.uleb()):
                assert body.byte() == 0x60, 'unexpected non-function type'
                params = list(body.take(body.uleb()))
                results = list(body.take(body.uleb()))
                types.append([params, results])
        elif kind == 2:
            for _ in range(body.uleb()):
                body.name()
                body.name()
                entry_kind = body.byte()
                if entry_kind == 0:
                    imported.append(body.uleb())
                elif entry_kind == 1:
                    body.byte()
                    body.limits()
                elif entry_kind == 2:
                    body.limits()
                elif entry_kind == 3:
                    body.take(2)
                elif entry_kind == 4:
                    body.byte()
                    body.uleb()
                else:
                    raise AssertionError(f'unknown import {entry_kind}')
        elif kind == 3:
            functions = [body.uleb() for _ in range(body.uleb())]
        elif kind == 7:
            for _ in range(body.uleb()):
                name, export_kind, index = body.name(), body.byte(), body.uleb()
                if name.startswith('__jit_fp_'):
                    assert export_kind == 0
                    exports[name] = index
        if kind in [1, 2, 3, 7]:
            assert body.at == len(body.data), f'incomplete section {kind}'
    i32, i64 = 0x7f, 0x7e
    expected = {
        '__jit_fp_arith_s': [[i32, i32, i32, i32], [i64]],
        '__jit_fp_from_int_s': [[i64, i32, i32], [i64]],
        '__jit_fp_to_word_s': [[i32, i32, i32], [i64]],
        '__jit_fp_div_s': [[i32, i32, i32], [i64]],
        '__jit_fp_fmadd_s': [[i32, i32, i32, i32], [i64]],
    }
    assert exports.keys() == expected.keys(), exports
    actual = {}
    for name, index in exports.items():
        assert index >= len(imported), 'helper must be defined in this instance'
        type_id = functions[index - len(imported)]
        signature = types[type_id]
        assert signature == expected[name], (name, signature)
        actual[name] = {
            'functionIndex': index,
            'typeIndex': type_id,
            'signature': signature,
            'definedInMainInstance': True,
        }
    return {
        'path': str(path), 'bytes': len(data),
        'sha256': hashlib.sha256(data).hexdigest(), 'exports': actual,
    }


if __name__ == '__main__':
    path = Path(sys.argv[1] if len(sys.argv) > 1 else 'web/dist/pkg/wasm_vm_wasm_bg.wasm')
    print(json.dumps(inspect(path), indent=2))

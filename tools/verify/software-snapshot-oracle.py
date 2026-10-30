#!/usr/bin/env python3
"""Independent bounded gzip/TLV/sparse-RAM byte oracle; never retains a full image."""
import gzip, hashlib, json, struct, sys
from pathlib import Path
source = Path(sys.argv[1])
raw_hash = hashlib.sha256()
count = 0
with gzip.open(source, 'rb') as stream:
    def read(n):
        global count
        out = stream.read(n)
        if len(out) != n: raise ValueError('truncated snapshot')
        raw_hash.update(out); count += n
        return out
    header = read(84)
    assert header[:8] == b'WVMRESU1' and struct.unpack_from('<I', header, 8)[0] == 1
    sections = []; ram_hash = hashlib.sha256(); ram_bytes = 0
    while True:
        marker = stream.peek(1) if hasattr(stream, 'peek') else None
        if not marker: break
        tag, length = struct.unpack('<II', read(8))
        section_hash = hashlib.sha256(); remaining = length
        def part(n):
            global remaining
            if n > remaining: raise ValueError('section overflow')
            b = read(n); remaining -= n; section_hash.update(b); return b
        if tag == 2:
            while remaining:
                kind, n = struct.unpack('<BI', part(5))
                if kind not in (0, 1) or ram_bytes + n > 1073741824: raise ValueError('sparse overflow')
                while n:
                    size = min(n, 1024 * 1024)
                    ram_hash.update(bytes(size) if kind == 0 else part(size)); n -= size; ram_bytes += size
        else:
            while remaining: part(min(remaining, 1024 * 1024))
        sections.append({'tag': tag, 'length': length, 'sha256': section_hash.hexdigest()})
    assert count == 634769246 and raw_hash.hexdigest() == 'a356cd7455a7b5c7dddb67523e14bcfb07029b8846955ff5245d4a35ac23f762'
    assert ram_bytes == 1073741824 and len(sections) == 16
print(json.dumps({'expandedBytes': count, 'sha256': raw_hash.hexdigest(), 'ramBytes': ram_bytes,
    'ramSha256': ram_hash.hexdigest(), 'sections': sections}, indent=2))

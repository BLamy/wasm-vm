#!/usr/bin/env python3
"""Independently derive all expected bytes' hashes from the pinned original R3."""
import datetime
import gzip
import hashlib
import json
from pathlib import Path
import struct

here = Path(__file__).resolve().parent
repo = here.parents[2]
source = repo / "target/omarchy-sdr-r3-snapshot/omarchy-ready.snap.gz"
out = here / "r3-byte-oracle.json"
assert not out.exists()
compressed_hasher = hashlib.sha256()
with source.open("rb") as raw:
    while block := raw.read(1024 * 1024):
        compressed_hasher.update(block)
compressed_hash = compressed_hasher.hexdigest()
assert compressed_hash == "2231a21eb8ebc8d3965d1352a3523501faebc87bda31e2c8dc184320219235f5"
hashes = [hashlib.sha256() for _ in range(4)]
sections = []
with gzip.open(source, "rb") as f:
    header = f.read(84)
    assert len(header) == 84 and header[:8] == b"WVMRESU1"
    assert struct.unpack_from("<I", header, 8)[0] == 1
    for h in hashes:
        h.update(header)
    position = 84
    console = None
    while framing := f.read(8):
        assert len(framing) == 8
        tag, size = struct.unpack("<II", framing)
        section = {"tag": tag, "payloadOffset": position + 8, "payloadBytes": size}
        sections.append(section)
        for h in hashes:
            h.update(framing)
        if tag == 11:
            assert console is None and size == 320
            payload = f.read(size)
            assert len(payload) == size
            transport_bytes = 45 + 8 * 29
            queue_index = 5
            present_offset = transport_bytes + queue_index * 5
            generation_offset = transport_bytes + 6 * 5 + 5
            assert present_offset == 302 and generation_offset == 312
            assert payload[present_offset:present_offset+5] == bytes(5)
            generation = struct.unpack_from("<Q", payload, generation_offset)[0]
            queue_offset = 45 + queue_index * 29
            queue_size = struct.unpack_from("<I", payload, queue_offset)[0]
            queue_ready = payload[queue_offset + 4]
            assert queue_ready == 1 and 0 < queue_size <= 256 and queue_size & (queue_size - 1) == 0
            for restores, h in enumerate(hashes):
                expected = bytearray(payload)
                if restores:
                    expected[present_offset] = 1
                    struct.pack_into("<Q", expected, generation_offset, (generation + restores) % (1 << 64))
                h.update(expected)
            console = {**section, "initialAgentTxPresent": 0, "initialAgentTxCursors": [0, 0],
                       "queueSize": queue_size, "queueReady": queue_ready,
                       "initialGeneration": generation,
                       "presenceByte": position + 8 + present_offset,
                       "generationOffset": position + 8 + generation_offset}
        else:
            left = size
            while left:
                part = f.read(min(left, 1024 * 1024))
                assert part
                left -= len(part)
                for h in hashes:
                    h.update(part)
        position += 8 + size
    assert console is not None
report = {"createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
          "source": str(source.relative_to(repo)), "compressedSha256": compressed_hash,
          "rawBytes": position, "headerHex": header.hex(), "sections": sections,
          "consoleTransition": console,
          "expectedFullBlobSha256ByRestoreCount": {str(i): h.hexdigest() for i, h in enumerate(hashes)},
          "note": "Derived before final evidence; exact expected transform only. Persistent save/read adds no restore count."}
out.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))

#!/usr/bin/env python3
"""Independent streaming audit; never boots, restores or edits a candidate."""
import gzip
import hashlib
import json
import pathlib
import struct
import sys


def exact(stream, length):
    data = stream.read(length)
    assert len(data) == length, ("truncated", length, len(data))
    return data


def discard(stream, length):
    while length:
        chunk = exact(stream, min(length, 1024 * 1024))
        length -= len(chunk)


def identity(path):
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            size += len(chunk)
            digest.update(chunk)
    return {"size": size, "sha256": digest.hexdigest()}


def audit(report_path):
    report = json.loads(report_path.read_text())
    pair = report["pair"]
    manifest = json.loads(pathlib.Path(report["candidate"]["source"]["chunkManifest"]["filename"]).read_text())
    canonical = {key: manifest[key] for key in ("version", "image_len", "chunk_size", "layout", "chunks")}
    base = hashlib.sha256(json.dumps(canonical, separators=(",", ":")).encode()).hexdigest()
    assert base == report["loaderIdentity"]["baseBinding"] == pair["base"]
    assert manifest["image_len"] == 4294967296
    result = {"report": identity(report_path), "base": base, "generation": str(pair["generation"])}
    for name in ("snapshot", "delta"):
        result[name] = identity(pathlib.Path(pair[name]["filename"]))
        assert all(result[name][key] == pair[name][key] for key in ("size", "sha256"))
    sections = []
    total = 84
    with gzip.open(pair["snapshot"]["filename"], "rb") as stream:
        header = exact(stream, 84)
        assert header[:8] == b"WVMRESU1" and struct.unpack_from("<I", header, 8)[0] == 1
        assert header[12:44] == b"0.0.1".ljust(32, b"\0")
        assert header[12:44].hex() == pair["coreId"]
        assert header[44:76].hex() == base
        assert struct.unpack_from("<Q", header, 76)[0] == int(pair["generation"])
        seen = set()
        while framing := stream.read(8):
            assert len(framing) == 8
            tag, length = struct.unpack("<II", framing)
            assert 1 <= tag <= 16 and tag not in seen
            seen.add(tag)
            row = {"tag": tag, "offset": total + 8, "length": length}
            total += 8 + length
            if tag != 2:
                discard(stream, length)
            else:
                remaining = length
                expanded = 0
                records = 0
                while remaining:
                    assert remaining >= 5
                    kind, span = struct.unpack("<BI", exact(stream, 5))
                    remaining -= 5
                    assert kind in (0, 1)
                    if kind:
                        assert span <= remaining
                        discard(stream, span)
                        remaining -= span
                    expanded += span
                    records += 1
                    assert expanded <= 1073741824
                assert expanded == 1073741824
                row.update(expandedBytes=expanded, sparseRecords=records)
            sections.append(row)
        assert {1, 2}.issubset(seen)
    assert total == pair["snapshotBytes"]
    result["snapshot"].update(rawBytes=total, sections=sections, coreId=pair["coreId"])
    with gzip.open(pair["delta"]["filename"], "rb") as stream:
        header = exact(stream, 61)
        assert header[:5] == b"WVOD1"
        assert struct.unpack_from("<I", header, 5)[0] == 4096
        assert struct.unpack_from("<Q", header, 9)[0] == 4294967296
        assert header[17:49].hex() == base
        assert struct.unpack_from("<Q", header, 49)[0] == int(pair["generation"])
        count = struct.unpack_from("<I", header, 57)[0]
        assert count == pair["blocks"]
        indices = set()
        index_digest = hashlib.sha256()
        for record in range(count):
            index_bytes = exact(stream, 8)
            index = struct.unpack("<Q", index_bytes)[0]
            assert 0 <= index < 1048576 and index not in indices, (record, index)
            indices.add(index)
            index_digest.update(index_bytes)
            exact(stream, 4096)
        assert stream.read(1) == b"", "unaccounted delta suffix"
    result["delta"].update(blocks=count, rawBytes=61 + 4104 * count,
                           indexSha256=index_digest.hexdigest(),
                           firstIndex=min(indices) if indices else None,
                           lastIndex=max(indices) if indices else None)
    assert pair["paused"] is True
    result["paused"] = True
    return result


if __name__ == "__main__":
    print(json.dumps(audit(pathlib.Path(sys.argv[1])), indent=2))

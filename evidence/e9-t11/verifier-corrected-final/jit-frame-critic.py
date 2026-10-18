#!/usr/bin/env python3
"""Independent fixed-layout audit of RTC/JIT native frames and WVOBLOG1 tapes."""
import argparse
import hashlib
import json
import struct
from pathlib import Path


def sha(data):
    return hashlib.sha256(data).hexdigest()


def tape(path, positions, kind, values):
    raw = path.read_bytes()
    assert raw[:8] == b"WVOBLOG1"
    # The header is version u32, policy version/divider u32, timebase u64, count u32.
    assert struct.unpack_from("<IIIQI", raw, 8) == (1, 1, 5, 10_000_000, len(positions))
    offset = 32
    rows = []
    for index, (position, value) in enumerate(zip(positions, values), 1):
        transition, retired, sequence, ordinal, actual_kind, status, requested, length = struct.unpack_from(
            "<QQQIBBII", raw, offset
        )
        payload = raw[offset + 38:offset + 38 + length]
        assert (transition, retired, sequence, ordinal, actual_kind, status, requested, length) == (
            position, position, index, 1, kind, 0, 8, 8
        )
        assert payload == value.to_bytes(8, "little")
        rows.append({"offset": offset, "transition": transition, "retired": retired,
                     "sequence": sequence, "ordinal": ordinal, "kind": actual_kind,
                     "host_ns": value})
        offset += 38 + length
    assert offset == len(raw)
    return {"path": str(path), "sha256": sha(raw), "bytes": len(raw), "records": rows}


def frame(path, *, transition, count, alarm, fired, guest_read=False):
    raw = path.read_bytes()
    assert raw[:8] == b"WVMRESU1" and struct.unpack_from("<I", raw, 8)[0] == 1
    sections = {}
    offset = 84
    while offset < len(raw):
        tag, size = struct.unpack_from("<II", raw, offset)
        assert tag not in sections and offset + 8 + size <= len(raw)
        sections[tag] = raw[offset + 8:offset + 8 + size]
        offset += 8 + size
    assert offset == len(raw)
    cpu = sections[1]
    words = struct.unpack_from("<32Q", cpu)
    assert words[0] == 0x80000000
    loops = transition // (8 if guest_read else 6)
    assert list(words[1:6]) == [loops * n for n in [1, 3, 5, 7, 11]]
    assert words[10] == 0x101000
    if guest_read and count:
        assert words[6] == 123
    clint = struct.unpack("<QQB", sections[3])
    assert clint == (transition // 5, (1 << 64) - 1, 0)
    rtc = struct.unpack("<QIQIBBB", sections[8])
    assert rtc == (0, 0, alarm, alarm >> 32, int(bool(alarm) and not fired), 0, int(fired))
    clock = struct.unpack("<QQQ", sections[9])
    assert clock == (transition % 5, 5, (1 << 64) - 1)
    session = sections[18]
    assert session[:8] == b"WVCLK001" and len(session) == 58
    assert struct.unpack_from("<I5QBBI", session, 8) == (1, transition, transition, 0, count, count, 0, 0, 0)
    sources = sections[19]
    assert sources[:8] == b"WVOBS001" and len(sources) == 32
    assert struct.unpack_from("<IIQQ", sources, 8) == (1, 5, 10_000_000, count)
    return {"path": str(path), "sha256": sha(raw), "bytes": len(raw),
            "transition": transition, "retired": transition, "source_cursor": count,
            "pc": hex(words[0]), "x1_x5": list(words[1:6]), "clint_mtime": clint[0],
            "clock_residue": clock[0], "rtc_alarm": rtc[2], "rtc_armed": bool(rtc[4]),
            "rtc_fired": bool(rtc[6]), "sections": sorted(sections)}


def boundary(directory):
    cases = []
    baselines = {}
    for rq in [1, 6, 7]:
        for pq in [1, 6, 7]:
            key = f"fire-rq{rq}-pq{pq}"
            result = {"case": key,
                      "tape": tape(directory / f"{key}.observations", [384, 385, 386], 5, [123, 124, 125])}
            for suffix, transition, count, fired in [("initial", 384, 0, False), ("record", 468, 3, True), ("replay", 468, 3, True)]:
                path = directory / f"{key}.{suffix}.resume"
                result[suffix] = frame(path, transition=transition, count=count, alarm=125, fired=fired)
                old = baselines.setdefault(suffix, path.read_bytes())
                assert path.read_bytes() == old
            assert result["record"]["sha256"] == result["replay"]["sha256"]
            assert result["tape"]["sha256"] == baselines.setdefault("tape_sha", result["tape"]["sha256"])
            cases.append(result)
    return cases


def jit(directory):
    cases = []
    baselines = {}
    for guest_read, alarm, quanta in [(False, True, [1, 6]), (True, False, [1, 8])]:
        for rq in quanta:
            for pq in quanta:
                key = f"jit-source-read-{str(guest_read).lower()}-alarm-{str(alarm).lower()}-rq{rq}-pq{pq}"
                positions = [390, 398, 406, 414] if guest_read else list(range(384, 420))
                result = {"case": key, "tape": tape(directory / f"{key}.observations", positions, 1 if guest_read else 5, [123] * len(positions))}
                final = 416 if guest_read else 420
                rtc_alarm = (1 << 63) - 1 if alarm else 0
                for suffix, transition, count in [("initial", 384, 0), ("record", final, len(positions)), ("replay", final, len(positions))]:
                    path = directory / f"{key}-{suffix}.resume"
                    result[suffix] = frame(path, transition=transition, count=count, alarm=rtc_alarm, fired=False, guest_read=guest_read)
                    old = baselines.setdefault((guest_read, suffix), path.read_bytes())
                    assert path.read_bytes() == old
                assert result["record"]["sha256"] == result["replay"]["sha256"]
                assert result["tape"]["sha256"] == baselines.setdefault((guest_read, "tape_sha"), result["tape"]["sha256"])
                cases.append(result)
    return cases


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["boundary", "jit"], required=True)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    cases = (boundary if args.mode == "boundary" else jit)(args.directory)
    result = {"status": "passed", "oracle": "independent Python struct/SHA256, no emulator codec", "cases": cases}
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"status": "passed", "cases": len(cases), "output": str(args.output)}))

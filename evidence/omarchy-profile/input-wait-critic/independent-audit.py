#!/usr/bin/env python3
"""Independent Python decoding of T03o RAM; imports no worker reader code."""
import bisect
import gzip
import hashlib
import json
import pathlib
import struct
import sys


def sha(data):
    return hashlib.sha256(data).hexdigest()


trial, decoded = map(pathlib.Path, sys.argv[1:3])
report_bytes = (trial / "desktop/report.json").read_bytes()
report = json.loads(report_bytes)
observed_bytes = decoded.read_bytes()
observed = json.loads(observed_bytes)
result = observed["result"]
capture = report["failureCheckpoint"]["snapshot"]
compressed = pathlib.Path(capture["file"]).read_bytes()
assert sha(compressed) == capture["compressedSha256"]
ram = gzip.decompress(compressed)
ram_sha = sha(ram)
assert len(ram) == 1073741824 == capture["bytes"]
assert ram_sha == capture["sha256"] == capture["stateDigestBefore"] == capture["stateDigestAfter"]
assert observed["report"]["sha256"] == sha(report_bytes)
assert observed["ram"]["sha256"] == ram_sha
assert observed["ram"]["compressedSha256"] == sha(compressed)
layout_bytes = pathlib.Path("evidence/omarchy-profile/checkpoint-wait-layout/layout.json").read_bytes()
assert sha(layout_bytes) == "0ee696d2e47cf290bf57d1648a7cbe99144f2dff95e4aa3b2a7844e0bd405d82"
layout = json.loads(layout_bytes)
offset = layout["offsets"]
image = pathlib.Path("releases/kernel/6.6.63/Image").read_bytes()
map_bytes = pathlib.Path("releases/kernel/6.6.63/System.map").read_bytes()
assert sha(image) == layout["kernelFiles"]["arch/riscv/boot/Image"]
assert sha(map_bytes) == layout["kernelFiles"]["System.map"]
symbols = sorted([(int(a, 16), t, n) for a, t, n in map(str.split, map_bytes.decode().splitlines())], key=lambda x: x[0])
named = {n: a for a, t, n in symbols}
addresses = [s[0] for s in symbols]
base = 0x80000000
mask64 = (1 << 64) - 1


def physical(address, length):
    assert base <= address <= base + len(ram) - length
    return ram[address - base:address - base + length]


def walk(virtual, root):
    assert 0 <= virtual <= mask64
    canonical = virtual & ((1 << 57) - 1)
    if canonical & (1 << 56):
        canonical |= mask64 ^ ((1 << 57) - 1)
    assert virtual == canonical and root % 4096 == 0
    table = root
    chain = []
    for level in range(4, -1, -1):
        address = table + ((virtual >> (12 + 9 * level)) & 511) * 8
        pte = int.from_bytes(physical(address, 8), "little")
        chain.append({"level": level, "physical": hex(address), "pte": hex(pte)})
        assert pte & 1 and pte >> 54 == 0
        assert not pte & 4 or pte & 2
        target = ((pte >> 10) & ((1 << 44) - 1)) << 12
        if pte & 10:
            mask = (1 << (12 + 9 * level)) - 1
            assert target & mask == 0
            answer = target | (virtual & mask)
            physical(answer, 1)
            return answer, chain, pte
        assert pte & 208 == 0
        table = target
    raise AssertionError("no leaf")


root = 0x80200000 + named["swapper_pg_dir"] - named["_start"]
assert result["context"]["root"] == hex(root)
assert result["context"]["pagingMode"] == 10
assert "pc" not in result["context"] and "satp" not in result["context"]
for name in ("pgtable_l5_enabled", "pgtable_l4_enabled"):
    address = 0x80200000 + named[name] - named["_start"]
    assert physical(address, 1) == b"\x01"


def read(virtual, length, page_root=root):
    parts = []
    while length:
        size = min(length, 4096 - virtual % 4096)
        address, _, _ = walk(virtual, page_root)
        parts.append(physical(address, size))
        virtual += size
        length -= size
    return b"".join(parts)


def number(virtual, size=8):
    return int.from_bytes(read(virtual, size), "little")


def linked(head):
    previous, current, visited, members = head, number(head), {head}, []
    while current != head:
        assert current % 8 == 0 and current not in visited and len(members) < 4096
        visited.add(current)
        nxt = number(current)
        assert number(current + 8) == previous and number(nxt + 8) == current
        members.append(current)
        previous, current = current, nxt
    assert number(head + 8) == previous
    return members


def field(task, name, size=8):
    return number(task + offset[name], size)


leaders = [named["init_task"]] + [n - offset["TASK_TASKS"] for n in linked(named["init_task"] + offset["TASK_TASKS"])]
records = []
pids = set()
for leader in leaders:
    pid = field(leader, "TASK_PID", 4)
    assert field(leader, "TASK_TGID", 4) == pid and field(leader, "TASK_GROUP_LEADER") == leader
    signal = field(leader, "TASK_SIGNAL")
    threads = [n - offset["TASK_THREAD_NODE"] for n in linked(signal + offset["SIGNAL_THREAD_HEAD"])]
    assert leader in threads
    for task in threads:
        tid = field(task, "TASK_PID", 4)
        assert tid not in pids and tid <= 4194304
        pids.add(tid)
        assert field(task, "TASK_TGID", 4) == pid
        assert field(task, "TASK_GROUP_LEADER") == leader and field(task, "TASK_SIGNAL") == signal
        name = read(task + offset["TASK_COMM"], 16)
        assert b"\0" in name
        record = {"task": hex(task), "pid": tid, "tgid": pid, "comm": name.split(b"\0", 1)[0].decode(),
                  "state": field(task, "TASK_STATE", 4), "onCpu": field(task, "TASK_ON_CPU", 4),
                  "startBoottimeNs": hex(field(task, "TASK_START_BOOTTIME")),
                  "utimeNs": hex(field(task, "TASK_UTIME")), "stimeNs": hex(field(task, "TASK_STIME"))}
        records.append(record)
assert records == result["tasks"]
running = [r for r in records if r["onCpu"] == 1]
assert len(running) == 1 and running[0] == result["current"]
assert result["context"]["currentTask"] == running[0]["task"]
allowed_roots = {root}
for target in result["targets"]:
    task = int(target["task"], 16)
    pgd = number(field(task, "TASK_MM") + offset["MM_PGD"])
    allowed_roots.add(walk(pgd, root)[0])
    if target["onCpu"]:
        assert target["task"] == running[0]["task"]
        assert not {"trap", "frames", "userPc", "wait"} & target.keys()
        continue
    stack = field(task, "TASK_STACK")
    sp = field(task, "TASK_THREAD_SP")
    fp = field(task, "TASK_THREAD_S0")
    pc = field(task, "TASK_THREAD_RA")
    trap = stack + offset["THREAD_SIZE_BYTES"] - ((offset["PT_SIZE"] + 15) & ~15)
    assert stack % 4096 == 0 and stack <= sp < trap and sp % 8 == 0
    pcs = [pc]
    for depth in range(64):
        assert fp >= sp + 16 and fp <= stack + offset["THREAD_SIZE_BYTES"] and fp % 8 == 0
        prev, pc = number(fp - 16), number(fp - 8)
        pcs.append(pc)
        if pc == named["ret_from_exception"]:
            assert fp == trap
            break
        sp, fp = fp, prev
    else:
        raise AssertionError("frame bound")
    assert pcs == [int(frame["pc"], 16) for frame in target["frames"]]
    for pc, frame in zip(pcs, target["frames"]):
        symbol_index = bisect.bisect_right(addresses, pc) - 1
        address, kind, name = symbols[symbol_index]
        assert named["_start"] <= pc < named["_etext"] and kind in "tT"
        assert frame["symbol"] == {"name": name, "start": hex(address), "end": hex(symbols[symbol_index + 1][0]), "offset": hex(pc - address)}
        assert read(pc, 16) == image[pc - named["_start"]:pc - named["_start"] + 16]
    assert number(trap + offset["PT_STATUS"]) & 0x100 == 0

witnesses = 0


def check_witnesses(value):
    global witnesses
    if isinstance(value, list):
        for item in value:
            check_witnesses(item)
    if not isinstance(value, dict):
        return
    if "physical" in value and "bytes" in value:
        address = int(value["physical"], 16)
        expected = bytes.fromhex(value["bytes"])
        assert physical(address, len(expected)) == expected
        witnesses += 1
        if "virtual" in value:
            va = int(value["virtual"], 16)
            chain = value["translation"]
            page_root = int(chain[0]["physical"], 16) - ((va >> 48) & 511) * 8
            assert page_root in allowed_roots
            actual_address, actual_chain, _ = walk(va, page_root)
            assert actual_address == address and actual_chain == chain
            assert value["ramOffset"] == address - base
        if value.get("value") is not None:
            assert int(value["value"], 16) == int.from_bytes(expected, "little")
    for item in value.values():
        check_witnesses(item)


check_witnesses(result)
earlier_bytes = pathlib.Path("evidence/omarchy-profile/checkpoint-wait-r1/checkpoint.json").read_bytes()
assert sha(earlier_bytes) == "1278b8bdd81471590bbb37cccdf6c392c09132fd0bfc24f274b26981cfb1b49a"
earlier = json.loads(earlier_bytes)["result"]["targets"]
for target in result["targets"]:
    before = next(t for t in earlier if (t["pid"], t["tgid"]) == (target["pid"], target["tgid"]))
    assert int(before["startBoottimeNs"], 16) == int(target["startBoottimeNs"], 16)
    if target.get("wait"):
        assert target["wait"]["address"] == before["wait"]["address"]
        for field_name in ("PT_EPC", "PT_CAUSE", "PT_A7", "PT_A1", "PT_A2", "PT_ORIG_A0"):
            assert target["trap"][field_name]["value"] == before["trap"][field_name]["value"]
print(json.dumps({"result": "independent RAM decoding passed", "reportSha256": sha(report_bytes),
                  "decodedSha256": sha(observed_bytes), "ramSha256": ram_sha, "compressedSha256": sha(compressed),
                  "groups": len(leaders), "tasks": len(records), "witnesses": witnesses,
                  "currentTaskMarker": running[0], "targets": [{key: t.get(key) for key in ("pid", "tgid", "state", "onCpu", "startBoottimeNs", "contextKind", "wait")} for t in result["targets"]]}, indent=2))

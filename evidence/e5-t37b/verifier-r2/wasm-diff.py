#!/usr/bin/env python3
"""Compare the shipped wasm at two commits: where do the bytes differ, and what are they?

usage: wasm-diff.py OLD.wasm NEW.wasm [lib.rs-old lib.rs-new]
Prints JSON. A core::panic::Location in wasm32 rodata is {file_ptr:u32, file_len:u32, line:u32,
col:u32}; a changed line number is a changed little-endian u32 at offset +8 of such a record.
"""
import json, struct, sys

def leb(b, i):
    r = s = 0
    while True:
        c = b[i]; i += 1
        r |= (c & 0x7f) << s; s += 7
        if not c & 0x80:
            return r, i

def sections(b):
    assert b[:8] == b"\0asm\x01\0\0\0"
    i, out = 8, []
    names = {0:"custom",1:"type",2:"import",3:"function",4:"table",5:"memory",6:"global",7:"export",8:"start",9:"elem",10:"code",11:"data",12:"datacount"}
    while i < len(b):
        sid = b[i]; size, j = leb(b, i + 1)
        out.append({"id": sid, "name": names.get(sid, str(sid)), "start": j, "end": j + size})
        i = j + size
    return out

def data_segments(b, sec):
    i = sec["start"]; n, i = leb(b, i); segs = []
    for _ in range(n):
        flags, i = leb(b, i)
        addr = None
        if flags == 0:
            assert b[i] == 0x41, hex(b[i])  # i32.const
            # signed LEB
            r = s = 0; i += 1
            while True:
                c = b[i]; i += 1
                r |= (c & 0x7f) << s; s += 7
                if not c & 0x80:
                    if c & 0x40: r -= 1 << s
                    break
            addr = r & 0xffffffff
            assert b[i] == 0x0b; i += 1
        elif flags == 1:
            pass
        else:
            raise SystemExit(f"segment flags {flags}")
        size, i = leb(b, i)
        segs.append({"file_start": i, "file_end": i + size, "addr": addr})
        i += size
    return segs

old = open(sys.argv[1], "rb").read(); new = open(sys.argv[2], "rb").read()
res = {"old_len": len(old), "new_len": len(new)}
so, sn = sections(old), sections(new)
res["section_layout_equal"] = so == sn
res["sections"] = []
for a in so:
    eq = old[a["start"]:a["end"]] == new[a["start"]:a["end"]]
    nd = sum(1 for k in range(a["start"], a["end"]) if old[k] != new[k])
    res["sections"].append({"name": a["name"], "start": a["start"], "end": a["end"], "identical": eq, "differing_bytes": nd})
diff = [k for k in range(len(old)) if old[k] != new[k]]
res["differing_bytes_total"] = len(diff)
data = next(s for s in so if s["name"] == "data")
segs_o, segs_n = data_segments(old, data), data_segments(new, data)
res["data_segment_layout_equal"] = segs_o == segs_n
# memory image: addr -> file offset
def addr_of(off):
    for s in segs_o:
        if s["file_start"] <= off < s["file_end"] and s["addr"] is not None:
            return s["addr"] + off - s["file_start"], s
    return None, None
def off_of(addr):
    for s in segs_o:
        if s["addr"] is not None and s["addr"] <= addr < s["addr"] + s["file_end"] - s["file_start"]:
            return s["file_start"] + addr - s["addr"]
    return None
# group differing bytes into aligned u32 words (by memory address)
words = {}
outside = []
for k in diff:
    a, s = addr_of(k)
    if a is None:
        outside.append(k); continue
    words.setdefault(a & ~3, None)
res["differing_bytes_outside_data_segments"] = outside
recs = []
for a in sorted(words):
    off = off_of(a)
    ov, nv = struct.unpack_from("<I", old, off)[0], struct.unpack_from("<I", new, off)[0]
    # Location record: ptr,len at a-8, a-4 ; col at a+4
    po = off_of(a - 8)
    rec = {"mem_addr": a, "file_off": off, "old_u32": ov, "new_u32": nv, "delta": nv - ov}
    if po is not None:
        ptr, ln = struct.unpack_from("<II", old, po)
        ptr_n, ln_n = struct.unpack_from("<II", new, po)
        col = struct.unpack_from("<I", old, off + 4)[0]; col_n = struct.unpack_from("<I", new, off + 4)[0]
        fo = off_of(ptr)
        fname = old[fo:fo + ln].decode("utf8", "replace") if fo is not None and 0 < ln < 300 else None
        rec.update({"file_ptr_equal": ptr == ptr_n and ln == ln_n, "file": fname, "col_old": col, "col_new": col_n})
    recs.append(rec)
res["changed_words"] = recs
res["changed_word_count"] = len(recs)
res["deltas"] = sorted(set(r["delta"] for r in recs))
res["files"] = sorted(set(str(r.get("file")) for r in recs))
res["old_line_min_max"] = [min(r["old_u32"] for r in recs), max(r["old_u32"] for r in recs)] if recs else None
if len(sys.argv) >= 5:
    lo = open(sys.argv[3]).read().split("\n"); ln_ = open(sys.argv[4]).read().split("\n")
    # every changed location: the source line at old line number in the old file equals the
    # source line at new line number in the new file (the same statement, moved)
    same = []
    for r in recs:
        a = lo[r["old_u32"] - 1] if 0 < r["old_u32"] <= len(lo) else None
        b = ln_[r["new_u32"] - 1] if 0 < r["new_u32"] <= len(ln_) else None
        r["src_old"] = a.strip()[:90] if a is not None else None
        same.append(a is not None and a == b)
    res["every_changed_location_names_the_same_source_line"] = all(same)
print(json.dumps(res, indent=1))

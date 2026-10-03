#!/usr/bin/env python3
"""Validate complete reference VirGL captures and derive the shader/opcode corpus.

This checks capture integrity and command framing, not rendered GPU semantics.
Shader bytes come exclusively from recorded CREATE_OBJECT packets.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
import hashlib
import gzip
import json
from pathlib import Path
import re
import struct


ROOT = Path(__file__).resolve().parents[2]
PROTOCOL = ROOT / "renderer/virgl-shader/vendor/src/virgl_protocol.h"
MAX_SHADER_BYTES = 4 * 1024 * 1024
MAX_SUBMIT_BYTES = 4 * 1024 * 1024
STAGES = ("VERT", "FRAG", "GEOM", "TESS_CTRL", "TESS_EVAL", "COMP")


class CaptureError(ValueError):
    """An incomplete, malformed, or unverifiable capture."""


def require(condition, message):
    if not condition:
        raise CaptureError(message)


def uint(value, label, maximum=0xFFFFFFFF):
    require(type(value) is int and 0 <= value <= maximum, f"{label}: invalid unsigned integer")
    return value


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def enum_names(name, prefix):
    source = re.sub(r"/\*.*?\*/", "", PROTOCOL.read_text(), flags=re.S)
    source = re.sub(r"//[^\n]*", "", source)
    match = re.search(r"enum\s+" + re.escape(name) + r"\s*\{([^}]+)\}", source)
    require(match is not None, f"missing pinned protocol enum {name}")
    result, value = {}, 0
    for item in match.group(1).split(","):
        item = item.strip()
        if not item:
            continue
        parts = item.split("=")
        require(len(parts) <= 2, "unsupported enum expression")
        if len(parts) == 2:
            require(re.fullmatch(r"[0-9]+", parts[1].strip()) is not None, "nonliteral enum value")
            value = int(parts[1])
        symbol = parts[0].strip()
        if symbol.startswith(prefix):
            result[value] = symbol[len(prefix):]
        value += 1
    return result


COMMANDS = enum_names("virgl_context_cmd", "VIRGL_CCMD_")
OBJECTS = enum_names("virgl_object_type", "VIRGL_OBJECT_")


@dataclass
class PendingShader:
    handle: int
    declared_bytes: int
    tokens: int
    streamout_outputs: int
    first_event: int
    data: bytearray = field(default_factory=bytearray)
    packets: list = field(default_factory=list)


class CommandDecoder:
    """Preserve submission boundaries and assemble cross-submission shaders."""

    def __init__(self):
        self.opcodes = Counter()
        self.objects = Counter()
        self.instructions = Counter()
        self.subcontexts = {}
        self.pending = {}
        self.shaders = {}
        self.submissions = []

    def submit(self, data, ctx_id, event_seq):
        uint(ctx_id, "context id")
        uint(event_seq, "event sequence", (1 << 63) - 1)
        require(len(data) <= MAX_SUBMIT_BYTES and len(data) % 4 == 0,
                f"event {event_seq}: unaligned or oversized submit")
        offset, count = 0, 0
        while offset < len(data):
            header = struct.unpack_from("<I", data, offset)[0]
            opcode, object_type, length = header & 255, (header >> 8) & 255, header >> 16
            require(opcode in COMMANDS, f"event {event_seq}, byte {offset}: unknown opcode {opcode}")
            require(object_type in OBJECTS, f"event {event_seq}, byte {offset}: unknown object type {object_type}")
            packet_end = offset + 4 * (1 + length)
            require(packet_end <= len(data), f"event {event_seq}, byte {offset}: truncated command")
            packet = data[offset:packet_end]
            words = struct.unpack("<" + "I" * (length + 1), packet)
            name = COMMANDS[opcode]
            self.opcodes[name] += 1
            count += 1
            if name == "SET_SUB_CTX":
                require(length == 1, "SET_SUB_CTX must contain exactly one handle")
                self.subcontexts[ctx_id] = words[1]
            elif name == "CREATE_OBJECT":
                require(length >= 1 and object_type != 0, "CREATE_OBJECT lacks a typed handle")
                self.objects[OBJECTS[object_type]] += 1
                if OBJECTS[object_type] == "SHADER":
                    self.shader(packet, words, ctx_id, event_seq, offset)
            elif name == "DESTROY_SUB_CTX":
                require(length == 1, "DESTROY_SUB_CTX must contain exactly one handle")
                require(not any(key[:2] == (ctx_id, words[1]) for key in self.pending),
                        "subcontext destroyed with unfinished shader")
            offset = packet_end
        self.submissions.append({"event": event_seq, "context": ctx_id, "bytes": len(data),
                                 "sha256": sha256(data), "commands": count})

    def shader(self, packet, words, ctx_id, event_seq, byte_offset):
        require(len(words) >= 7, "CREATE_SHADER has no complete header/text word")
        handle, stage, offlen, tokens, streamout = words[1:6]
        require(handle != 0 and stage < len(STAGES), "invalid shader handle/stage")
        require(0 < tokens <= MAX_SHADER_BYTES, "invalid shader token count")
        if stage == 5:  # Compute's word 5 is local-memory size, not streamout.
            streamout = 0
        require(streamout <= 64, "shader streamout count exceeds protocol bound")
        text_word = 6 + (4 + 2 * streamout if streamout else 0)
        require(text_word < len(words), "truncated shader streamout/text")
        fragment = packet[text_word * 4:]
        key = (ctx_id, self.subcontexts.get(ctx_id, 0), stage)
        continuation, value = bool(offlen & 0x80000000), offlen & 0x7FFFFFFF
        if continuation:
            require(key in self.pending, "shader continuation has no initial packet")
            shader = self.pending[key]
            require(streamout == 0, "continuation repeats streamout header")
            require(handle == shader.handle and tokens == shader.tokens, "continuation changes shader identity")
            require(value == len(shader.data), "shader continuation offset gap/overlap")
        else:
            require(key not in self.pending, "new shader replaces unfinished shader")
            require(1 < value <= MAX_SHADER_BYTES, "invalid declared shader byte length")
            shader = PendingShader(handle, value, tokens, streamout, event_seq)
            self.pending[key] = shader
        padded_length = (shader.declared_bytes + 3) & ~3
        require(len(shader.data) + len(fragment) <= padded_length, "shader continuation exceeds declared length")
        shader.data.extend(fragment)
        shader.packets.append({"event": event_seq, "byteOffset": byte_offset,
                               "fragmentBytes": len(fragment), "continuation": continuation})
        if len(shader.data) != padded_length:
            return
        framed = bytes(shader.data[:shader.declared_bytes])
        require(framed[-1:] == b"\0" and b"\0" not in framed[:-1],
                "shader declared length does not delimit one terminal NUL")
        text = framed[:-1]
        require(all(byte in (9, 10, 13) or 32 <= byte <= 126 for byte in text), "non-ASCII TGSI body")
        lines = text.decode("ascii").splitlines()
        require(lines and lines[0].strip() == STAGES[stage], "TGSI stage/header mismatch")
        instructions = Counter()
        for line in lines[1:]:
            match = re.match(r"^\s*\d+:\s*([A-Z][A-Z0-9_]*)\b", line)
            if match:
                instructions[match.group(1)] += 1
        require(instructions.get("END", 0) > 0, "TGSI body lacks END instruction")
        digest = sha256(text)
        occurrence = {"context": ctx_id, "subcontext": key[1], "stage": STAGES[stage],
                      "handle": handle, "declaredBytes": shader.declared_bytes,
                      "declaredTokens": tokens, "streamoutOutputs": shader.streamout_outputs,
                      "packets": shader.packets}
        if digest not in self.shaders:
            self.shaders[digest] = {"text": text, "stage": STAGES[stage], "instructions": dict(sorted(instructions.items())),
                                    "bytes": len(text), "occurrences": []}
            self.instructions.update(instructions)
        self.shaders[digest]["occurrences"].append(occurrence)
        del self.pending[key]

    def destroy_context(self, ctx_id):
        require(not any(key[0] == ctx_id for key in self.pending), "context destroyed with unfinished shader")
        self.subcontexts.pop(ctx_id, None)

    def finish(self):
        require(not self.pending, f"EOF with {len(self.pending)} unfinished shaders")
        return {"opcodes": dict(sorted(self.opcodes.items())), "objects": dict(sorted(self.objects.items())),
                "shaderInstructions": dict(sorted(self.instructions.items())),
                "submissions": self.submissions,
                "shaders": {digest: {key: value for key, value in shader.items() if key != "text"}
                            for digest, shader in sorted(self.shaders.items())}}


API_TYPES = frozenset({
    "init", "context_create", "context_create_with_flags", "context_destroy",
    "resource_create", "resource_unref", "resource_attach_iov", "resource_detach_iov",
    "ctx_attach_resource", "ctx_detach_resource", "submit_cmd", "transfer_write_iov",
    "transfer_read_iov", "get_cap_set", "fill_caps", "create_fence", "write_fence",
    "context_create_fence", "write_context_fence", "cleanup", "reset",
})
SCHEMA = "wasm-vm-virgl-capture-v1"
WORKLOADS = ("textured-scene", "kmscube", "glmark2-es2", "compositor")


def validate_events(events, read_blob):
    """Check ordered API framing and resource backing at every submit boundary."""
    require(len(events) >= 4, "capture has no complete API session")
    first, last = events[0], events[-1]
    require(first.get("type") == "begin" and first.get("schema") == SCHEMA,
            "capture begin/schema missing")
    require(first.get("byteOrder") == "little", "capture must use little endian")
    require(first.get("workload") in WORKLOADS, "unknown workload")
    require(last.get("type") == "end" and last.get("complete") is True
            and last.get("normalExit") is True and uint(last.get("openCalls"), "open calls", 0) == 0
            and uint(last.get("droppedRecords"), "dropped records", 0) == 0
            and last.get("workload") == first["workload"],
            "capture lacks a complete no-drop footer")
    limits = first.get("limits", {})
    for key in ("events", "blobBytes", "eventBytes", "singleBlobBytes", "resources", "iovs"):
        require(uint(limits.get(key), f"limit {key}", 1 << 32) > 0, "zero capture limit")
    require(len(events) <= limits["events"] + 1, "event count exceeds capture limit")
    calls, resources, contexts, snapshots, fences = {}, {}, set(), {}, set()
    blobs, api_counts, results = {}, Counter(), Counter()
    resource_descriptions, capsets = [], []
    decoder = CommandDecoder()
    initialized = False
    cleanup_seen = False
    for seq, event in enumerate(events, 1):
        require(uint(event.get("seq"), "sequence", (1 << 63) - 1) == seq,
                f"event {seq}: sequence gap or duplicate")
        kind, phase = event.get("type"), event.get("phase")
        require(isinstance(event.get("blobs"), list), f"event {seq}: missing blob inventory")
        by_role = {}
        for ref in event["blobs"]:
            digest = ref.get("sha256", "")
            require(isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest), "invalid blob digest")
            size = uint(ref.get("bytes"), "blob bytes", limits["singleBlobBytes"])
            role = ref.get("role")
            require(isinstance(role, str) and role not in by_role, "duplicate/missing blob role")
            data = read_blob(digest)
            require(len(data) == size and sha256(data) == digest, f"event {seq}: corrupt blob {digest}")
            by_role[role] = data
            blobs[digest] = size
        event_data = {**event, "data": by_role, "snapshots": {}, "children": []}
        if seq in (1, len(events)):
            require(not by_role and phase is None, "session boundary has unexpected payload")
            continue
        require(kind != "failure", f"event {seq}: recorder reported failure")
        if kind == "backing_snapshot":
            require(phase is None and set(by_role) == {"backing"}, "malformed backing snapshot")
            rid = uint(event.get("resourceId"), "snapshot resource")
            lengths = event.get("iovLengths")
            require(isinstance(lengths, list) and 0 < len(lengths) <= limits["iovs"], "invalid IOV lengths")
            require(sum(uint(n, "IOV length", limits["singleBlobBytes"]) for n in lengths)
                    == len(by_role["backing"]), "IOV lengths do not cover backing blob")
            reason = event.get("reason")
            if reason == "submit":
                require(rid in resources and resources[rid] == lengths, "submit snapshot has unknown/changed backing")
                require(rid not in snapshots, "duplicate backing snapshot before submit")
                snapshots[rid] = lengths
            else:
                expected = {"create": {"resource_create"}, "attach": {"resource_attach_iov"},
                            "transfer_before": {"transfer_write_iov", "transfer_read_iov"},
                            "transfer_after": {"transfer_read_iov"}}
                require(reason in expected, "unknown snapshot reason")
                owners = [call for call in calls.values() if call["type"] in expected[reason]
                          and call.get("resourceId") == rid]
                require(len(owners) == 1, "snapshot lacks unique enclosing resource/transfer call")
                require(reason not in owners[0]["snapshots"], "duplicate call backing snapshot")
                owners[0]["snapshots"][reason] = lengths
            continue
        require(kind in API_TYPES, f"event {seq}: unknown record type {kind}")
        require(phase in ("enter", "return"), "API event missing enter/return")
        if phase == "enter":
            require("callSeq" not in event, "enter has return reference")
            parent = uint(event.get("parentCallSeq"), "parent call", (1 << 63) - 1)
            thread = uint(event.get("threadId"), "thread id", (1 << 63) - 1)
            require(thread > 0, "missing capture-local thread identity")
            require(parent == 0 or (parent in calls and calls[parent]["threadId"] == thread),
                    "nested API call lacks active parent on same thread")
            calls[seq] = event_data
            api_counts[kind] += 1
            if kind == "submit_cmd":
                require(initialized and event.get("ctxId") in contexts, "submit has no initialized context")
                require(set(by_role) == {"command"}, "submit lacks exact command blob")
                require(4 * uint(event.get("ndw"), "submit ndw") == len(by_role["command"]), "ndw does not match submit bytes")
                require(snapshots == {rid: lengths for rid, lengths in resources.items() if lengths},
                        f"event {seq}: submit omitted attached resource backing")
                snapshots = {}
                decoder.submit(by_role["command"], event["ctxId"], seq)
            elif kind in ("context_create", "context_create_with_flags"):
                require(set(by_role) == {"context_name"} and len(by_role["context_name"]) == event.get("nameBytes"),
                        "context name blob length mismatch")
            else:
                require(not by_role, "unexpected API enter payload")
            if kind in ("create_fence", "context_create_fence"):
                fence = uint(event.get("fenceId"), "fence", (1 << 64) - 1)
                fences.add((event.get("ctxId") if kind == "context_create_fence" else None,
                            event.get("ringId") if kind == "context_create_fence" else None, fence))
            elif kind in ("write_fence", "write_context_fence"):
                key = (event.get("ctxId") if kind == "write_context_fence" else None,
                       event.get("ringId") if kind == "write_context_fence" else None, event.get("fenceId"))
                require(key in fences, "completion references uncaptured fence")
            continue
        call_seq = uint(event.get("callSeq"), "return call sequence", (1 << 63) - 1)
        require(call_seq in calls and calls[call_seq]["type"] == kind, "unpaired/mismatched API return")
        call = calls.pop(call_seq)
        require(event.get("threadId") == call["threadId"], "return moved to another host thread")
        require(event.get("parentCallSeq") == call["parentCallSeq"], "return parent identity changed")
        parent = call["parentCallSeq"]
        require(not any(child["parentCallSeq"] == call_seq for child in calls.values()),
                "API return precedes nested child return")
        if parent:
            require(parent in calls, "API child returned after parent")
            calls[parent]["children"].append(call)
        result = event.get("result")
        require(type(result) is int, "API return lacks integer result")
        results[f"{kind}:{result}"] += 1
        require(result == 0, f"event {seq}: reference API {kind} failed with {result}")
        if kind == "fill_caps":
            require(set(by_role) == {"capset"} and len(by_role["capset"]) > 0, "missing capset bytes")
            capsets.append({"event": seq, "set": call.get("set"), "version": call.get("version"),
                            "bytes": len(by_role["capset"]), "sha256": sha256(by_role["capset"])})
        else:
            require(not by_role, "unexpected API return payload")
        if kind == "init":
            require(not initialized, "duplicate renderer initialization")
            initialized = True
        elif kind in ("context_create", "context_create_with_flags"):
            ctx = uint(call.get("ctxId"), "created context")
            forwarded = (kind == "context_create" and len(call["children"]) == 1
                         and call["children"][0]["type"] == "context_create_with_flags"
                         and call["children"][0]["ctxId"] == ctx
                         and call["children"][0]["data"] == call["data"])
            require(not call["children"] or forwarded, "context creation forwarded different identity")
            require(ctx not in contexts or forwarded, "duplicate live context")
            contexts.add(ctx)
        elif kind == "context_destroy":
            ctx = call.get("ctxId")
            require(ctx in contexts, "destroy of unknown context")
            decoder.destroy_context(ctx)
            contexts.remove(ctx)
        elif kind in ("resource_create", "resource_attach_iov"):
            rid = uint(call.get("resourceId"), "resource id")
            require((rid not in resources) if kind == "resource_create" else (rid in resources),
                    "invalid resource create/attach lifecycle")
            count = uint(call.get("iovCount"), "IOV count", limits["iovs"])
            lengths = call["snapshots"].get("create" if kind == "resource_create" else "attach", [])
            require(len(lengths) == count, "resource create/attach lacks backing snapshot")
            resources[rid] = lengths
            require(len(resources) <= limits["resources"], "resource limit exceeded")
            if kind == "resource_create":
                fields = ("resourceId", "target", "format", "bind", "width", "height", "depth",
                          "arraySize", "lastLevel", "nrSamples", "flags")
                resource_descriptions.append({"event": call_seq,
                                              **{key: uint(call.get(key), key) for key in fields}})
        elif kind in ("resource_unref", "resource_detach_iov"):
            rid = call.get("resourceId")
            require(rid in resources, "resource release of unknown id")
            if kind == "resource_unref":
                del resources[rid]
            else:
                resources[rid] = []
        elif kind in ("transfer_write_iov", "transfer_read_iov"):
            rid = call.get("resourceId")
            require(rid in resources and type(call.get("explicitIov")) is bool, "invalid transfer backing")
            expected_count = call["iovCount"] if call["explicitIov"] else len(resources[rid])
            if expected_count:
                require(len(call["snapshots"].get("transfer_before", [])) == expected_count,
                        "transfer missing input backing snapshot")
                if kind == "transfer_read_iov":
                    require(len(call["snapshots"].get("transfer_after", [])) == expected_count,
                            "read transfer missing output backing snapshot")
        elif kind in ("reset", "cleanup"):
            for ctx in contexts:
                decoder.destroy_context(ctx)
            contexts.clear()
            resources.clear()
            snapshots.clear()
            if kind == "cleanup":
                cleanup_seen = True
                initialized = False
    require(not calls, "EOF with unreturned API calls")
    require(not snapshots, "EOF between backing snapshots and submission")
    require(last.get("cleanupSeen") == cleanup_seen, "footer cleanup state contradicts calls")
    require(sum(blobs.values()) == last.get("blobBytes") <= limits["blobBytes"], "footer blob total/limit mismatch")
    require(api_counts["init"] > 0 and api_counts["submit_cmd"] > 0, "capture lacks initialized draw session")
    decoded = decoder.finish()
    return {"workload": first["workload"], "events": len(events), "blobs": len(blobs),
            "blobBytes": sum(blobs.values()), "apiCalls": dict(sorted(api_counts.items())),
            "apiResults": dict(sorted(results.items())), "resourceCreates": resource_descriptions,
            "resourceFormats": dict(sorted(Counter(str(item["format"]) for item in resource_descriptions).items())),
            "capsets": capsets, **decoded}, decoder.shaders, set(blobs)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"duplicate JSON key {key}")
        result[key] = value
    return result


def load_json(data):
    return json.loads(data, object_pairs_hook=unique_object)


def checked_file(directory, reference, max_bytes=64 * 1024 * 1024):
    require(isinstance(reference, dict), "missing file reference")
    name = reference.get("path")
    require(isinstance(name, str) and name and not Path(name).is_absolute()
            and ".." not in Path(name).parts, "unsafe artifact path")
    path = directory / name
    require(path.is_file() and not path.is_symlink() and directory.resolve() in path.resolve().parents,
            f"missing/unsafe artifact {name}")
    size = uint(reference.get("bytes"), "artifact bytes", max_bytes)
    require(path.stat().st_size == size, f"artifact length mismatch {name}")
    data = path.read_bytes()
    require(sha256(data) == reference.get("sha256"), f"artifact digest mismatch {name}")
    return data


def validate_capture(directory):
    directory = Path(directory)
    require(not (directory / "FAILED").exists(), "recorder FAILED marker exists")
    manifest_bytes = (directory / "manifest.json").read_bytes()
    manifest = load_json(manifest_bytes)
    require(manifest.get("schema") == SCHEMA and manifest.get("workload") in WORKLOADS,
            "manifest schema/workload invalid")
    workload = manifest["workload"]
    result = manifest.get("result", {})
    require(result.get("complete") is True and uint(result.get("qemuExitCode"), "QEMU exit", 0) == 0
            and uint(result.get("guestExitCode"), "guest exit", 0) == 0 and result.get("guestBegin") is True
            and result.get("guestEnd") is True and result.get("error") is None,
            "reference workload did not complete successfully")
    events_data = checked_file(directory, manifest.get("events"))
    require(events_data.endswith(b"\n"), "event stream has truncated final line")
    events = [load_json(line) for line in events_data.splitlines()]
    require(events and events[0].get("workload") == workload, "manifest/event workload mismatch")
    artifacts = {}
    paths = {"manifest.json", manifest["events"]["path"]}
    for ref in manifest.get("artifacts", []):
        role = ref.get("role")
        require(isinstance(role, str) and role not in artifacts and ref.get("path") not in paths,
                "duplicate artifact role/path")
        artifacts[role] = checked_file(directory, ref)
        paths.add(ref["path"])
    required = {"command.json", "guest.sh", "guest-serial.log", "guest-exit-code.txt",
                "guest-packages.txt", "guest-libraries.sha256", "host-packages.txt",
                "host-library-maps.txt", "host.log", "workload.log"}
    require(required <= artifacts.keys(), "missing required execution/provenance artifacts")
    require(load_json(artifacts["command.json"]) == manifest.get("command"), "command metadata differs from captured command")
    require(manifest["command"].get("guestScript") == "guest.sh", "missing captured guest script")
    require(artifacts["guest-exit-code.txt"].strip() == b"0", "guest exit artifact contradicts manifest")
    serial_lines = artifacts["guest-serial.log"].decode("utf-8", errors="replace").splitlines()
    require(serial_lines.count(f"VIRGL_CORPUS_BEGIN {workload}") == 1
            and serial_lines.count(f"VIRGL_CORPUS_END {workload} status=0") == 1,
            "missing/duplicate actual guest BEGIN/END lines")
    require(serial_lines.index(f"VIRGL_CORPUS_BEGIN {workload}")
            < serial_lines.index(f"VIRGL_CORPUS_END {workload} status=0"), "guest markers reversed")
    versions = manifest.get("versions", {})
    guest, host = versions.get("guest", {}), versions.get("host", {})
    require(guest.get("architecture") == "riscv64" and guest.get("mesa") == "1:26.2.2-1"
            and guest.get("hyprland") == "0.56.2-3", "unexpected guest stack")
    packages = dict(line.split(maxsplit=1) for line in artifacts["guest-packages.txt"].decode().splitlines())
    for package in ("mesa", "hyprland"):
        require(packages.get(package) == guest[package], f"guest {package} package pin not observed")
    require(host.get("virglrenderer") == "1.3.0"
            and host.get("virglCommit") == "ca50e008863837e094747a69974dde3ae148aeaa"
            and host.get("architecture") == "aarch64" and host.get("renderer") == "llvmpipe",
            "unexpected reference host stack")
    inputs = {}
    for ref in manifest.get("inputs", []):
        role = ref.get("role")
        require(isinstance(role, str) and role not in inputs, "duplicate input role")
        require(isinstance(ref.get("sourcePath"), str)
                and re.fullmatch(r"[0-9a-f]{64}", ref.get("sha256", ""))
                and uint(ref.get("bytes"), "input bytes", 1 << 40) > 0, "invalid input provenance")
        inputs[role] = ref
    require({"rootfs", "kernel", "hostRenderer", "recorder", "qemu"} <= inputs.keys(), "missing pinned inputs")
    require(inputs["rootfs"]["sha256"] == "bfcde69e5eeb2b5baba96a451f0671092b5973e8cc3a7f581722adf513651200"
            and inputs["kernel"]["sha256"] == "af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce",
            "reference image/kernel pin changed")
    require(inputs["hostRenderer"]["sourcePath"] in artifacts["host-library-maps.txt"].decode(),
            "pinned renderer was not observed in QEMU library maps")
    for name in ("recorder.c", "recorder.build.sh", "capture.py"):
        require(name in artifacts and artifacts[name] == (ROOT / "tools/virgl-capture" / name).read_bytes(),
                f"captured {name} differs from checked-in source")
    require("recorder.so" in artifacts and sha256(artifacts["recorder.so"]) == inputs["recorder"]["sha256"],
            "captured recorder binary differs from executed input")
    require("workloads-build-manifest.json" in artifacts, "missing workload build provenance")
    build = load_json(artifacts["workloads-build-manifest.json"])
    require(build.get("schema") == "virgl-guest-workloads-v1"
            and build.get("pins") == load_json((ROOT / "tools/virgl-capture/workloads/pins.json").read_bytes())
            and build.get("workload_source_sha256")
            == sha256((ROOT / "tools/virgl-capture/workloads/textured-scene.c").read_bytes()),
            "workload build/source pins differ")
    executables = {"textured-scene": "bin/virgl-textured-scene", "kmscube": "bin/kmscube",
                   "glmark2-es2": "usr/bin/glmark2-es2-wayland"}
    if workload in executables:
        executable = executables[workload]
        name = Path(executable).name
        require(name in artifacts and sha256(artifacts[name]) == build.get("binaries", {}).get(executable),
                "captured workload executable differs from pinned build")
    workload_log = artifacts["workload.log"].decode(errors="replace")
    renderer_log = (artifacts.get("hyprland.log", b"").decode(errors="replace")
                    if workload == "compositor" else workload_log)
    require(re.search(r'(?im)^.*(?:GL_RENDERER|renderer)\s*[:=]\s*"?virgl\b', renderer_log),
            "actual guest renderer is not VirGL")
    if workload == "textured-scene":
        require("TEXTURED_SCENE_END status=pass draws=3 checked_pixels=768" in workload_log
                and workload_log.count("PIXELS_PASS") == 3, "textured scene lacks exact pixel proof")
    elif workload == "glmark2-es2":
        require("Validation: Success" in workload_log and "Validation: Failure" not in workload_log
                and "Validation: Unknown" not in workload_log, "glmark2 did not pass its pixel oracle")
    elif workload == "kmscube":
        require("Rendered 7 frames" in workload_log, "kmscube did not finish eight draws (one unreported warmup)")
    blob_cache = {}
    blob_total = 0
    blob_budget = uint(manifest.get("limits", {}).get("blobBytes"), "capture blob budget", 512 * 1024 * 1024)
    require((directory / "blobs").is_dir() and not (directory / "blobs").is_symlink(),
            "missing/unsafe blob directory")

    def read_blob(digest):
        nonlocal blob_total
        if digest not in blob_cache:
            path = directory / "blobs" / (digest + ".bin")
            packed = path.with_suffix(".bin.gz")
            require(path.is_file() != packed.is_file(), f"missing/ambiguous blob {digest}")
            selected = path if path.is_file() else packed
            require(not selected.is_symlink(), "symlink blob")
            require(selected.stat().st_size <= 64 * 1024 * 1024, "oversized blob file")
            if selected == path:
                data = path.read_bytes()
            else:
                with gzip.open(packed, "rb") as stream:
                    data = stream.read(64 * 1024 * 1024 + 1)
                require(len(data) <= 64 * 1024 * 1024, "oversized decompressed blob")
            blob_total += len(data)
            require(blob_total <= blob_budget, "capture exceeds validator blob budget")
            blob_cache[digest] = data
        return blob_cache[digest]

    summary, shaders, digests = validate_events(events, read_blob)
    require(len(events_data) <= events[0]["limits"]["eventBytes"], "event bytes exceed limit")
    for key in ("events", "blobBytes", "eventBytes"):
        require(manifest.get("limits", {}).get(key) == events[0]["limits"][key], "manifest/event limits differ")
    actual_blobs = {p.name for p in (directory / "blobs").iterdir()}
    require(actual_blobs == {digest + (".bin" if (directory / "blobs" / (digest + ".bin")).exists()
                                      else ".bin.gz") for digest in digests}, "extra/missing unindexed blobs")
    for path in directory.rglob("*"):
        if path.is_file():
            relative = str(path.relative_to(directory))
            require(relative in paths or relative.startswith("blobs/") or relative == "summary.json"
                    or relative.startswith("shaders/"), f"unhashed artifact {relative}")
    require(summary["opcodes"].get("DRAW_VBO", 0) > 0 and summary["objects"].get("SAMPLER_VIEW", 0) > 0
            and summary["apiCalls"].get("write_fence", 0) > 0 and len(shaders) >= 2,
            "capture lacks draw, texture, fence or shader work")
    if workload == "textured-scene":
        require(summary["opcodes"]["DRAW_VBO"] == 3, "textured scene draw bound changed")
    elif workload == "kmscube":
        require(summary["opcodes"]["DRAW_VBO"] >= 8, "kmscube did not draw eight frames")
    summary["manifestSha256"] = sha256(manifest_bytes)
    summary["versions"] = versions
    summary["shaderStageCounts"] = dict(sorted(Counter(shader["stage"] for shader in shaders.values()).items()))
    return summary, shaders


def generated_outputs(directory, summary, shaders, write=False):
    expected = {"summary.json": (json.dumps(summary, indent=2, sort_keys=True) + "\n").encode()}
    expected.update({f"shaders/{digest}.tgsi": shader["text"] for digest, shader in shaders.items()})
    for name, data in expected.items():
        path = directory / name
        if write:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        else:
            require(path.is_file() and path.read_bytes() == data, f"derived output differs/missing: {path}")
    actual = {str(p.relative_to(directory)) for p in (directory / "shaders").glob("*")}
    require(actual == {name for name in expected if name.startswith("shaders/")}, "extra/missing extracted shaders")


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("captures", type=Path, help="capture directory or parent containing all four workloads")
    parser.add_argument("--write", action="store_true", help="write deterministic derived summaries/TGSI; default checks existing")
    parser.add_argument("--pack-blobs", action="store_true", help="losslessly gzip validated blobs with mtime zero")
    args = parser.parse_args()
    directories = ([args.captures] if (args.captures / "manifest.json").exists()
                   else [args.captures / name for name in WORKLOADS])
    for directory in directories:
        summary, shaders = validate_capture(directory)
        generated_outputs(directory, summary, shaders, args.write)
        if args.pack_blobs:
            for path in sorted((directory / "blobs").glob("*.bin")):
                packed = path.with_suffix(".bin.gz")
                require(not packed.exists(), "ambiguous existing packed blob")
                data = path.read_bytes()
                compressed = gzip.compress(data, compresslevel=9, mtime=0)
                require(gzip.decompress(compressed) == data, "gzip roundtrip failed")
                with packed.open("xb") as stream:
                    stream.write(compressed)
                path.unlink()
        print(json.dumps({"workload": summary["workload"], "events": summary["events"],
                          "draws": summary["opcodes"]["DRAW_VBO"], "shaders": len(shaders),
                          "manifestSha256": summary["manifestSha256"]}, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (CaptureError, OSError, ValueError, KeyError, TypeError) as error:
        import sys
        print(f"capture validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)

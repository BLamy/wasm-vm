import copy
import tempfile
from pathlib import Path
import unittest

from test_validate import capture, command


class Session:
    def __init__(self):
        self.events, self.blobs = [], {}
        self.add("begin", schema=capture.SCHEMA, workload="textured-scene", byteOrder="little",
                 limits={"events": 1000, "blobBytes": 1000000, "eventBytes": 1000000,
                         "singleBlobBytes": 65536, "resources": 16, "iovs": 16})

    def add(self, kind, blob=None, **fields):
        refs = []
        if blob is not None:
            role, data = blob
            digest = capture.sha256(data)
            self.blobs[digest] = data
            refs.append({"role": role, "bytes": len(data), "sha256": digest})
        event = {"seq": len(self.events) + 1, "type": kind, "blobs": refs, **fields}
        self.events.append(event)
        return event["seq"]

    def enter(self, kind, **fields):
        return self.add(kind, phase="enter", threadId=1, parentCallSeq=fields.pop("parentCallSeq", 0), **fields)

    def returned(self, call, result=0, **fields):
        return self.add(self.events[call-1]["type"], phase="return", callSeq=call, threadId=1,
                        parentCallSeq=self.events[call-1]["parentCallSeq"], result=result, **fields)

    def end(self):
        self.add("end", workload="textured-scene", complete=True, normalExit=True,
                 cleanupSeen=False, openCalls=0, droppedRecords=0, blobBytes=sum(map(len, self.blobs.values())))

    def validate(self):
        return capture.validate_events(self.events, self.blobs.__getitem__)


def session():
    s = Session()
    s.returned(s.enter("init", flags=0, callbackVersion=1))
    outer = s.enter("context_create", ctxId=4, nameBytes=4, blob=("context_name", b"mesa"))
    inner = s.enter("context_create_with_flags", ctxId=4, nameBytes=4, flags=1,
                    parentCallSeq=outer, blob=("context_name", b"mesa"))
    s.returned(inner)
    s.returned(outer)
    resource = s.enter("resource_create", resourceId=8, iovCount=1, target=2, format=67, bind=8,
                       width=1, height=1, depth=1, arraySize=1, lastLevel=0, nrSamples=0, flags=0)
    s.add("backing_snapshot", resourceId=8, reason="create", iovLengths=[4], blob=("backing", b"RGBA"))
    s.returned(resource)
    s.add("backing_snapshot", resourceId=8, reason="submit", iovLengths=[4], blob=("backing", b"RGBA"))
    s.returned(s.enter("submit_cmd", ctxId=4, ndw=1, blob=("command", command(0))))
    fence = s.enter("create_fence", ctxId=516, fenceId=7)
    s.returned(fence)
    s.returned(s.enter("write_fence", fenceId=7))
    s.end()
    return s


class EventTests(unittest.TestCase):
    def test_complete_nested_forwarding_and_legacy_fence(self):
        report, _, digests = session().validate()
        self.assertEqual(report["opcodes"], {"NOP": 1})
        self.assertEqual(report["apiCalls"]["context_create"], 1)
        self.assertEqual(len(digests), 3)

    def test_each_missing_event_fails_even_after_sequence_repair(self):
        base = session()
        for index in range(len(base.events)):
            s = copy.deepcopy(base)
            del s.events[index]
            old_to_new = {event["seq"]: i + 1 for i, event in enumerate(s.events)}
            for i, event in enumerate(s.events, 1):
                event["seq"] = i
                for key in ("callSeq", "parentCallSeq"):
                    if event.get(key):
                        event[key] = old_to_new.get(event[key], 99999)
            with self.subTest(index=index), self.assertRaises(capture.CaptureError):
                s.validate()

    def test_stale_backing_does_not_satisfy_second_submit(self):
        s = session()
        s.events.pop()
        s.returned(s.enter("submit_cmd", ctxId=4, ndw=1, blob=("command", command(0))))
        s.end()
        with self.assertRaisesRegex(capture.CaptureError, "omitted attached"):
            s.validate()

    def test_recomputed_blob_digest_cannot_hide_iov_omission(self):
        s = session()
        e = next(e for e in s.events if e["type"] == "backing_snapshot" and e["reason"] == "submit")
        e["iovLengths"] = [3]
        with self.assertRaisesRegex(capture.CaptureError, "cover backing"):
            s.validate()

    def test_nested_identity_and_thread_tampering(self):
        for key, value in (("ctxId", 5), ("parentCallSeq", 0), ("threadId", 2)):
            s = session()
            e = next(e for e in s.events if e["type"] == "context_create_with_flags" and e["phase"] == "enter")
            e[key] = value
            with self.subTest(key=key), self.assertRaises(capture.CaptureError):
                s.validate()

    def test_api_error_and_footer_failure(self):
        for key, value in (("complete", False), ("openCalls", 1), ("droppedRecords", 1),
                           ("blobBytes", 0), ("cleanupSeen", True)):
            s = session()
            s.events[-1][key] = value
            with self.subTest(key=key), self.assertRaises(capture.CaptureError):
                s.validate()
        s = session()
        s.events[2]["result"] = -22
        with self.assertRaisesRegex(capture.CaptureError, "failed"):
            s.validate()

    def test_corrupt_and_missing_blob(self):
        s = session()
        s.blobs[capture.sha256(b"RGBA")] = b"BGRA"
        with self.assertRaisesRegex(capture.CaptureError, "corrupt blob"):
            s.validate()

    def test_json_duplicate_keys_and_path_escape(self):
        with self.assertRaisesRegex(capture.CaptureError, "duplicate JSON"):
            capture.load_json('{"seq":1,"seq":2}')
        with tempfile.TemporaryDirectory() as tmp:
            for path in ("../secret", "/absolute"):
                with self.assertRaisesRegex(capture.CaptureError, "unsafe artifact"):
                    capture.checked_file(Path(tmp), {"path": path})

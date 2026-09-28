import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import stat
import sys
import tempfile
import threading
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("capture", Path(__file__).with_name("capture-omarchy-vm.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def qmp_version():
    return {"qemu": {"major": 11, "minor": 1, "micro": 1}, "package": "fixture-package"}


def fixture_copy(source_fd, directory_fd, name):
    """Small synthetic fixture only; the production primitive is tested separately."""
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=directory_fd)
    try:
        os.lseek(source_fd, 0, os.SEEK_SET)
        with os.fdopen(fd, "wb", closefd=False) as stream:
            for block in iter(lambda: os.read(source_fd, 4096), b""):
                stream.write(block)
    finally:
        os.close(fd)


def disk_response(path, *, node="disk0", **overrides):
    disk = {
        "file": str(path), "drv": "qcow2", "backing_file_depth": 0,
        "cache": {"no-flush": False}, "node-name": node, "ro": False,
        "active": True, "image": {"virtual-size": module.DISK_BYTES,
        "dirty-flag": False, "format-specific": {"data": {"corrupt": False}}},
    }
    disk.update(overrides)
    return [{"io-status": "ok", "inserted": disk}]


class FakeQmp:
    def __init__(self, source, running=True):
        self.source = str(source)
        self.running = running
        self.commands = []
        self.version = qmp_version()
        self.resume_calls = 0
        self.resume_error = None

    def call(self, command, deadline=None):
        del deadline
        self.commands.append(command)
        if command == "query-status":
            return {"running": self.running, "status": "running" if self.running else "paused"}
        if command == "query-block-jobs":
            return []
        if command == "query-block":
            return disk_response(self.source)
        if command == "stop":
            self.running = False
        if command == "cont":
            self.running = True
        return {}

    def resume(self, source, expected, source_identity):
        del source, expected, source_identity
        self.resume_calls += 1
        if self.resume_error is not None:
            raise self.resume_error
        self.call("cont")
        return self.call("query-status")


class ScriptedQmpServer:
    """A deterministic socketpair QMP peer; each connection has a script."""

    def __init__(self, scripts, version=None):
        self.scripts = list(scripts)
        self.version = qmp_version() if version is None else version
        self.commands = []
        self.cont_count = 0
        self.errors = []
        self.client_sockets = []
        self.server_sockets = []
        for _ in self.scripts:
            client, server = socket.socketpair()
            self.client_sockets.append(client)
            self.server_sockets.append(server)
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()

    def _send(self, connection, payload):
        connection.sendall((json.dumps(payload) + "\n").encode())

    def _serve(self):
        try:
            for script, connection in zip(self.scripts, self.server_sockets):
                connection.settimeout(2)
                self._send(connection, {"QMP": {"version": self.version, "capabilities": []}})
                disconnected = False
                while not disconnected:
                    line = connection.recv(65536)
                    if not line:
                        break
                    for raw in line.splitlines():
                        request = json.loads(raw)
                        command = request["execute"]
                        self.commands.append(command)
                        if command == "qmp_capabilities":
                            self._send(connection, {"return": {}, "id": request["id"]})
                            continue
                        if command == "cont":
                            self.cont_count += 1
                        action = script.get(command)
                        if command == "query-status" and isinstance(action, list):
                            action = action.pop(0) if action else {}
                        if action == "disconnect":
                            connection.close()
                            disconnected = True
                            break
                        if callable(action):
                            action(connection, request)
                        else:
                            self._send(connection, {"return": action or {}, "id": request["id"]})
                connection.close()
        except (OSError, socket.timeout):
            pass
        except BaseException as error:
            self.errors.append(error)

    def next_client(self):
        return self.client_sockets.pop(0)

    def close(self):
        for connection in self.client_sockets + self.server_sockets:
            try:
                connection.close()
            except OSError:
                pass
        self.thread.join(timeout=2)
        if self.errors:
            raise self.errors[0]


class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        root = Path(self.tempdir.name)
        self.source = root / "source.qcow2"
        self.source.write_bytes(b"test qcow2 payload")
        self.output = root / "out"
        self.output.mkdir(mode=0o700)

    def tearDown(self):
        self.tempdir.cleanup()

    clone_fixture = staticmethod(fixture_copy)

    def test_running_clones_only_when_paused_and_resumes(self):
        qmp = FakeQmp(self.source)
        result = module.capture(qmp, self.source, self.output / "copy.qcow2", self.clone_fixture)
        self.assertTrue(qmp.running)
        self.assertEqual((result["before"], result["after"]), ("running", "running"))
        self.assertEqual(qmp.commands[:5], ["query-block-jobs", "query-block", "query-status", "stop", "query-status"])
        self.assertEqual((self.output / "copy.qcow2").stat().st_mode & 0o777, 0o400)
        self.assertEqual(result["sha256"], hashlib.sha256(b"test qcow2 payload").hexdigest())

    def test_receipt_is_atomically_created_after_frozen_copy(self):
        qmp = FakeQmp(self.source)
        result = module.capture(qmp, self.source, self.output / "copy.qcow2", self.clone_fixture)
        receipt = self.output / "capture.json"
        self.assertEqual(json.loads(receipt.read_text())["sha256"], result["sha256"])
        self.assertEqual(receipt.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(receipt.read_text())["qemu"], qmp_version())
        self.assertEqual(list(self.output.glob(".capture.json.*.tmp")), [])

    def test_clone_failure_restores_running_and_preserves_primary(self):
        qmp = FakeQmp(self.source)
        primary = OSError("synthetic clone failure")

        def clone(*_args):
            raise primary

        with self.assertRaises(OSError) as raised:
            module.capture(qmp, self.source, self.output / "copy.qcow2", clone)
        self.assertIs(raised.exception, primary)
        self.assertTrue(qmp.running)
        self.assertEqual(qmp.resume_calls, 1)

    def test_restoration_failure_retains_primary_and_cleanup_error(self):
        qmp = FakeQmp(self.source)
        qmp.resume_error = RuntimeError("synthetic restoration failure")
        primary = OSError("synthetic clone failure")

        with self.assertRaises(module.CaptureError) as raised:
            module.capture(qmp, self.source, self.output / "copy.qcow2", lambda *_: (_ for _ in ()).throw(primary))
        self.assertIs(raised.exception.primary, primary)
        self.assertEqual(str(raised.exception.restoration), "synthetic restoration failure")

    def test_restoration_only_failure_removes_clone_without_hash_or_receipt(self):
        qmp = FakeQmp(self.source)
        qmp.resume_error = RuntimeError("restoration-only failure")
        source_stat = self.source.stat()
        with mock.patch.object(module, "_freeze_and_hash") as freeze:
            with self.assertRaises(RuntimeError) as raised:
                module.capture(qmp, self.source, self.output / "copy.qcow2", self.clone_fixture)
            freeze.assert_not_called()
        self.assertIs(raised.exception, qmp.resume_error)
        self.assertEqual(list(self.output.iterdir()), [])
        self.assertEqual(self.source.stat().st_mode, source_stat.st_mode)
        self.assertEqual(self.source.read_bytes(), b"test qcow2 payload")

    def test_deferred_interrupt_removes_successful_clone_before_hashing(self):
        for signum, exception in [(module.signal.SIGINT, KeyboardInterrupt),
                                  (module.signal.SIGTERM, SystemExit)]:
            with self.subTest(signal=signum):
                qmp = FakeQmp(self.source)
                original_resume = qmp.resume

                def resume(*args):
                    os.kill(os.getpid(), signum)
                    return original_resume(*args)

                qmp.resume = resume
                with mock.patch.object(module, "_freeze_and_hash") as freeze:
                    with self.assertRaises(exception):
                        module.capture(qmp, self.source, self.output / "copy.qcow2", self.clone_fixture)
                    freeze.assert_not_called()
                self.assertTrue(qmp.running)
                self.assertEqual(list(self.output.iterdir()), [])

    def test_successful_clone_then_primary_and_restoration_failures_removes_clone(self):
        qmp = FakeQmp(self.source)
        qmp.resume_error = RuntimeError("restoration failure")
        original_call = qmp.call
        cloned = False
        primary = RuntimeError("post-clone status failure")

        def clone(*args):
            nonlocal cloned
            self.clone_fixture(*args)
            cloned = True

        def call(command, deadline=None):
            if cloned and command == "query-status":
                raise primary
            return original_call(command, deadline)

        qmp.call = call
        with self.assertRaises(module.CaptureError) as raised:
            module.capture(qmp, self.source, self.output / "copy.qcow2", clone)
        self.assertIs(raised.exception.primary, primary)
        self.assertIs(raised.exception.restoration, qmp.resume_error)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_output_directory_swap_keeps_clone_hash_and_receipt_on_retained_fd(self):
        moved = self.output.with_name("retained-output")
        other = self.output.with_name("replacement-output")
        other.mkdir(mode=0o700)
        sentinel = other / "copy.qcow2"
        sentinel.write_bytes(b"replacement must not be frozen or hashed")
        sentinel.chmod(0o600)

        def clone(*args):
            self.clone_fixture(*args)
            self.output.rename(moved)
            self.output.symlink_to(other, target_is_directory=True)

        qmp = FakeQmp(self.source)
        result = module.capture(qmp, self.source, self.output / "copy.qcow2", clone)
        self.assertEqual(result["sha256"], hashlib.sha256(b"test qcow2 payload").hexdigest())
        frozen = moved / "copy.qcow2"
        self.assertEqual(result["copyInode"], frozen.stat().st_ino)
        self.assertEqual(stat.S_IMODE(frozen.stat().st_mode), 0o400)
        self.assertEqual(json.loads((moved / "capture.json").read_text()), result)
        self.assertEqual(sentinel.read_bytes(), b"replacement must not be frozen or hashed")
        self.assertEqual(stat.S_IMODE(sentinel.stat().st_mode), 0o600)
        self.assertEqual(list(other.iterdir()), [sentinel])

    def test_failure_after_directory_swap_removes_only_retained_clone(self):
        moved = self.output.with_name("retained-output")

        def clone(*args):
            self.clone_fixture(*args)
            self.output.rename(moved)
            self.output.mkdir(mode=0o700)
            (self.output / "copy.qcow2").write_bytes(b"unrelated replacement")

        qmp = FakeQmp(self.source)
        qmp.resume_error = RuntimeError("restore failed after directory swap")
        with self.assertRaises(RuntimeError) as raised:
            module.capture(qmp, self.source, self.output / "copy.qcow2", clone)
        self.assertIs(raised.exception, qmp.resume_error)
        self.assertEqual(list(moved.iterdir()), [])
        self.assertEqual((self.output / "copy.qcow2").read_bytes(), b"unrelated replacement")
        self.assertFalse((self.output / "capture.json").exists())

    def test_hardlink_clone_is_rejected_before_source_chmod_or_hash(self):
        qmp = FakeQmp(self.source)
        source_stat = self.source.stat()

        def hardlink(_source_fd, directory_fd, name):
            os.link(self.source, name, dst_dir_fd=directory_fd)

        with mock.patch.object(module, "_freeze_and_hash") as freeze:
            with self.assertRaisesRegex(RuntimeError, "shares the source inode"):
                module.capture(qmp, self.source, self.output / "copy.qcow2", hardlink)
            freeze.assert_not_called()
        self.assertTrue(qmp.running)
        self.assertEqual(list(self.output.iterdir()), [])
        self.assertEqual(self.source.stat().st_mode, source_stat.st_mode)
        self.assertEqual(self.source.read_bytes(), b"test qcow2 payload")

    def test_clone_entry_replacement_after_restore_fails_before_freeze(self):
        qmp = FakeQmp(self.source)
        source_mode = self.source.stat().st_mode
        original_resume = qmp.resume

        def resume(*args):
            state = original_resume(*args)
            (self.output / "copy.qcow2").unlink()
            os.link(self.source, self.output / "copy.qcow2")
            return state

        qmp.resume = resume
        with mock.patch.object(module.os, "fchmod") as chmod:
            with self.assertRaisesRegex(RuntimeError, "clone entry identity changed"):
                module.capture(qmp, self.source, self.output / "copy.qcow2", self.clone_fixture)
            chmod.assert_not_called()
        self.assertEqual(self.source.stat().st_mode, source_mode)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_receipt_write_failure_removes_clone_and_temporary_receipt(self):
        qmp = FakeQmp(self.source)
        with mock.patch.object(module.os, "write", return_value=0):
            with self.assertRaisesRegex(OSError, "write made no progress"):
                module.capture(qmp, self.source, self.output / "copy.qcow2", self.clone_fixture)
        self.assertTrue(qmp.running)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_prepaused_still_gets_fresh_stop_and_stays_paused(self):
        qmp = FakeQmp(self.source, running=False)
        result = module.capture(qmp, self.source, self.output / "copy.qcow2", self.clone_fixture)
        self.assertFalse(qmp.running)
        self.assertIn("stop", qmp.commands)
        self.assertNotIn("cont", qmp.commands)
        self.assertEqual((result["before"], result["after"]), ("paused", "paused"))

    def test_signal_during_cleanup_is_deferred_and_primary_survives(self):
        qmp = FakeQmp(self.source)
        primary = KeyboardInterrupt()

        def clone(*_args):
            raise primary

        original_resume = qmp.resume

        def resume(*args):
            os.kill(os.getpid(), module.signal.SIGINT)
            return original_resume(*args)

        qmp.resume = resume
        with self.assertRaises(KeyboardInterrupt) as raised:
            module.capture(qmp, self.source, self.output / "copy.qcow2", clone)
        self.assertIs(raised.exception, primary)
        self.assertTrue(qmp.running)

    def test_source_replacement_is_rejected_before_clone(self):
        qmp = FakeQmp(self.source)
        original = self.source.read_bytes()
        original_clone = self.clone_fixture

        def clone(*args):
            replacement = self.source.with_suffix(".replacement")
            replacement.write_bytes(original)
            os.replace(replacement, self.source)
            return original_clone(*args)

        with self.assertRaises(RuntimeError):
            module.capture(qmp, self.source, self.output / "copy.qcow2", clone)
        self.assertTrue(qmp.running)
        self.assertFalse((self.output / "copy.qcow2").exists())

    def test_metadata_matrix_fails_closed_before_stop(self):
        cases = ["wrong version", "block job", "path", "io status", "backing", "no flush",
                 "corrupt", "dirty", "read only", "inactive", "size"]
        for name in cases:
            with self.subTest(name=name):
                qmp = FakeQmp(self.source)
                original_call = qmp.call
                if name == "wrong version":
                    qmp.version = {"qemu": {"major": 11, "minor": 1, "micro": 0}, "package": ""}

                def call(command, deadline=None, *, name=name):
                    if name == "block job" and command == "query-block-jobs":
                        qmp.commands.append(command)
                        return [{}]
                    if command != "query-block":
                        return original_call(command, deadline)
                    blocks = disk_response(self.source)
                    block = blocks[0]
                    if name == "path":
                        block["inserted"]["file"] = "/other.qcow2"
                    elif name == "io status":
                        block["io-status"] = "failed"
                    elif name == "backing":
                        block["inserted"]["backing_file_depth"] = 1
                    elif name == "no flush":
                        block["inserted"]["cache"] = {}
                    elif name == "corrupt":
                        block["inserted"]["image"]["format-specific"]["data"]["corrupt"] = True
                    elif name == "dirty":
                        block["inserted"]["image"]["dirty-flag"] = True
                    elif name == "read only":
                        block["inserted"]["ro"] = True
                    elif name == "inactive":
                        block["inserted"]["active"] = False
                    elif name == "size":
                        block["inserted"]["image"]["virtual-size"] = 1
                    qmp.commands.append(command)
                    return blocks

                qmp.call = call
                with self.assertRaises(RuntimeError):
                    module.capture(qmp, self.source, self.output / "copy.qcow2", self.clone_fixture)
                self.assertNotIn("stop", qmp.commands)


class QmpRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.source = Path(self.tempdir.name) / "source.qcow2"
        self.source.write_bytes(b"source")
        self.output = Path(self.tempdir.name) / "out"
        self.output.mkdir(mode=0o700)
        self.identity = module._stat_identity(self.source.stat())
        self.expected = {"node": "disk0", "virtualBytes": module.DISK_BYTES}

    clone_fixture = staticmethod(fixture_copy)

    def tearDown(self):
        self.tempdir.cleanup()

    def recovery_script(self, *, status, cont=None, final=None, node="disk0"):
        return {
            "query-status": ([{"running": status == "running", "status": status}, final]
                             if final is not None else {"running": status == "running", "status": status}),
            "query-block-jobs": [],
            "query-block": disk_response(self.source, node=node),
            "cont": cont or {},
        }

    def test_constructor_accepts_real_wrapped_greeting_and_preserves_package(self):
        for package in ("", "Homebrew 11.1.1"):
            with self.subTest(package=package):
                version = {"qemu": {"major": 11, "minor": 1, "micro": 1}, "package": package}
                server = ScriptedQmpServer([{}], version=version)
                qmp = None
                try:
                    qmp = module.Qmp("socketpair", socket_obj=server.next_client())
                    self.assertEqual(qmp.version, version)
                    module._require_version(qmp.version)
                    self.assertEqual(server.commands, ["qmp_capabilities"])
                finally:
                    if qmp is not None:
                        qmp.close()
                    server.close()

    def test_constructor_rejects_wrong_or_incomplete_wrapped_version_before_commands(self):
        versions = [
            {"qemu": {"major": 11, "minor": 1, "micro": 0}, "package": ""},
            {"major": 11, "minor": 1, "micro": 1},
            {"qemu": {"major": 11, "minor": 1, "micro": 1}},
            {"qemu": {"major": 11, "minor": 1, "micro": 1}, "package": None},
            {"qemu": {"major": 11, "minor": True, "micro": 1}, "package": ""},
        ]
        for version in versions:
            with self.subTest(version=version):
                server = ScriptedQmpServer([{}], version=version)
                try:
                    with self.assertRaisesRegex(RuntimeError, "QEMU 11.1.1"):
                        module.Qmp("socketpair", socket_obj=server.next_client())
                    self.assertEqual(server.commands, [])
                finally:
                    server.close()

    def test_resume_reconnects_state_first_and_restores_paused(self):
        server = ScriptedQmpServer([
            {},
            self.recovery_script(status="paused", final={"running": True, "status": "running"}),
        ])
        qmp = module.Qmp("socketpair", socket_obj=server.next_client(), connector=server.next_client)
        try:
            qmp.resume(self.source, self.expected, self.identity)
            self.assertEqual(server.commands[1:6], ["qmp_capabilities", "query-status", "query-block-jobs", "query-block", "cont"])
            self.assertEqual(server.cont_count, 1)
        finally:
            qmp.close()
            server.close()

    def test_resume_reconnects_when_already_running_without_cont(self):
        server = ScriptedQmpServer([
            {},
            {"query-status": {"running": True, "status": "running"},
             "query-block-jobs": [], "query-block": disk_response(self.source)},
        ])
        qmp = module.Qmp("socketpair", socket_obj=server.next_client(), connector=server.next_client)
        try:
            qmp.resume(self.source, self.expected, self.identity)
            self.assertEqual(server.cont_count, 0)
        finally:
            qmp.close()
            server.close()

    def test_capture_stop_reply_loss_still_reconnects_and_restores(self):
        server = ScriptedQmpServer([
            {"query-block-jobs": [], "query-block": disk_response(self.source),
             "query-status": {"running": True, "status": "running"}, "stop": "disconnect"},
            {"query-status": [{"running": False, "status": "paused"},
                              {"running": True, "status": "running"}],
             "query-block-jobs": [], "query-block": disk_response(self.source)},
        ])
        qmp = module.Qmp("socketpair", socket_obj=server.next_client(), connector=server.next_client)
        try:
            with self.assertRaises(RuntimeError):
                module.capture(qmp, self.source, self.output / "copy.qcow2", self.clone_fixture)
            self.assertEqual(server.cont_count, 1)
            self.assertFalse((self.output / "copy.qcow2").exists())
        finally:
            qmp.close()
            server.close()

    def test_cont_reply_loss_reconnects_and_does_not_repeat_cont(self):
        server = ScriptedQmpServer([
            {},
            {"query-status": {"running": False, "status": "paused"},
             "query-block-jobs": [], "query-block": disk_response(self.source), "cont": "disconnect"},
            {"query-status": {"running": True, "status": "running"},
             "query-block-jobs": [], "query-block": disk_response(self.source)},
        ])
        qmp = module.Qmp("socketpair", socket_obj=server.next_client(), connector=server.next_client)
        try:
            qmp.resume(self.source, self.expected, self.identity)
            self.assertEqual(server.cont_count, 1)
        finally:
            qmp.close()
            server.close()

    def test_recovery_identity_failure_is_bounded_and_never_continues(self):
        server = ScriptedQmpServer([
            {},
            {"query-status": {"running": False, "status": "paused"},
             "query-block-jobs": [], "query-block": disk_response(self.source, node="wrong")},
            {"query-status": {"running": False, "status": "paused"},
             "query-block-jobs": [], "query-block": disk_response(self.source, node="wrong")},
        ])
        qmp = module.Qmp("socketpair", socket_obj=server.next_client(), connector=server.next_client)
        try:
            with self.assertRaises(RuntimeError):
                qmp.resume(self.source, self.expected, self.identity)
            self.assertEqual(server.cont_count, 0)
        finally:
            qmp.close()
            server.close()

    def test_qmp_call_has_absolute_deadline_under_event_flood(self):
        def flood(connection, request):
            for number in range(10000):
                connection.sendall((json.dumps({"event": "NOOP", "id": 9000 + number}) + "\n").encode())

        server = ScriptedQmpServer([{"query-status": flood}])
        qmp = module.Qmp("socketpair", timeout=0.05, socket_obj=server.next_client(), connector=server.next_client)
        try:
            with self.assertRaises((TimeoutError, OSError)):
                qmp.call("query-status")
        finally:
            qmp.close()
            server.close()


@unittest.skipUnless(sys.platform == "darwin", "requires macOS APFS clonefile")
class ApfsCloneTests(unittest.TestCase):
    def test_native_clone_has_distinct_inode_and_independent_cow_bytes(self):
        # Only new, tiny synthetic files are used here. No VM or image access.
        with tempfile.TemporaryDirectory(prefix="omarchy-cow-test.", dir="/private/tmp") as path:
            root = Path(path)
            source = root / "synthetic-source.bin"
            original = bytes(range(256)) * 256
            source.write_bytes(original)
            source.chmod(0o600)
            source_fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
            directory_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            clone_fd = None
            try:
                module.clone_apfs(source_fd, directory_fd, "synthetic-clone.bin")
                clone_fd = os.open("synthetic-clone.bin", os.O_RDWR | os.O_NOFOLLOW,
                                   dir_fd=directory_fd)
                before = os.fstat(source_fd)
                clone = os.fstat(clone_fd)
                self.assertEqual(clone.st_dev, before.st_dev)
                self.assertNotEqual(clone.st_ino, before.st_ino)
                self.assertEqual(clone.st_size, len(original))
                self.assertEqual(os.pread(clone_fd, len(original), 0), original)
                edit = b"copy-on-write fixture"
                self.assertEqual(os.pwrite(clone_fd, edit, 4096), len(edit))
                os.fsync(clone_fd)
                self.assertEqual(os.pread(source_fd, len(original), 0), original)
                self.assertEqual(os.pread(clone_fd, len(original), 0),
                                 original[:4096] + edit + original[4096 + len(edit):])
                self.assertEqual(os.fstat(source_fd).st_mode, before.st_mode)
                self.assertEqual(os.fstat(source_fd).st_size, before.st_size)
            finally:
                if clone_fd is not None:
                    os.close(clone_fd)
                os.close(directory_fd)
                os.close(source_fd)


if __name__ == "__main__":
    unittest.main()

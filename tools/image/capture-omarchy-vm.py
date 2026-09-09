#!/usr/bin/env python3
"""Private, crash-consistent APFS capture of one identified live QEMU disk.

Never publish this copy. Guest RAM/app buffers are not captured. Replay/check the
filesystem only on the copy, then construct the release on a new filesystem.
"""
import argparse
from contextlib import contextmanager
import ctypes
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import stat
import sys
import time


QEMU_VERSION = {"major": 11, "minor": 1, "micro": 1}
DISK_BYTES = 32 * 1024 * 1024 * 1024
QMP_DEADLINE_SECONDS = 10.0


class CaptureError(RuntimeError):
    """A capture failure whose cleanup failure is retained separately."""

    def __init__(self, primary, restoration=None, cleanup=None):
        self.primary = primary
        self.restoration = restoration
        self.cleanup = cleanup
        message = f"capture failed: {primary}"
        if restoration is not None:
            message += f"; VM restoration failed: {restoration}"
        if cleanup is not None:
            message += f"; failed to remove inadmissible capture: {cleanup}"
        super().__init__(message)


class Qmp:
    def __init__(self, path, timeout=QMP_DEADLINE_SECONDS, deadline=None, socket_obj=None,
                 connector=None):
        self.path = Path(path)
        self.timeout = timeout
        self.socket = socket_obj or socket.socket(socket.AF_UNIX)
        self._connector = connector
        self.file = None
        self.seq = 1
        try:
            end = deadline or time.monotonic() + timeout
            self._set_deadline(end)
            if socket_obj is None:
                self.socket.connect(str(self.path))
            self.file = self.socket.makefile("rwb", buffering=0)
            greeting = self._read_json(end)
            self.version = greeting["QMP"]["version"]
            _require_version(self.version)
            self.call("qmp_capabilities", deadline=end)
        except BaseException:
            self.close()
            raise
        finally:
            self._clear_timeout()

    def _set_deadline(self, deadline):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("QMP deadline expired")
        self.socket.settimeout(remaining)

    def _clear_timeout(self):
        try:
            if self.socket is not None:
                self.socket.settimeout(None)
        except OSError:
            pass

    def _read_json(self, deadline):
        self._set_deadline(deadline)
        line = self.file.readline()
        if not line:
            raise RuntimeError("QMP disconnected")
        return json.loads(line)

    def call(self, command, deadline=None):
        deadline = deadline or time.monotonic() + self.timeout
        sequence = self.seq
        self.seq += 1
        self._set_deadline(deadline)
        self.file.write((json.dumps({"execute": command, "id": sequence}) + "\n").encode())
        while True:
            response = self._read_json(deadline)
            if response.get("id") != sequence:
                continue
            if "error" in response:
                error = response["error"]
                raise RuntimeError(f"QMP {command} failed: {error.get('class')}")
            return response.get("return", {})

    def _fresh(self, deadline):
        if self._connector is None:
            return Qmp(self.path, timeout=self.timeout, deadline=deadline)
        return Qmp(self.path, timeout=self.timeout, deadline=deadline,
                   socket_obj=self._connector(), connector=self._connector)

    def resume(self, source, expected, source_identity):
        """Boundedly restore a stopped VM, proving identity before ``cont``.

        The old stream is discarded. Two fresh connections are the maximum: the
        first may lose a ``cont`` reply, and the second may perform one retry if
        it observes the VM still paused. A running observation is success and is
        never followed by a blind second ``cont``.
        """
        deadline = time.monotonic() + self.timeout
        self.close()
        for attempt in range(2):
            recovery = None
            try:
                recovery = self._fresh(deadline)
                state = _coherent_status(recovery.call("query-status", deadline=deadline))
                _require_version(recovery.version)
                validate_disk(recovery, source, expected, deadline=deadline)
                _verify_source_identity(source, source_identity)
                if state["status"] == "running":
                    return state
                recovery.call("cont", deadline=deadline)
                final = _coherent_status(recovery.call("query-status", deadline=deadline))
                if final != {"running": True, "status": "running"}:
                    raise RuntimeError("VM did not resume; operator intervention required")
                return final
            except (OSError, RuntimeError, TimeoutError, KeyError, TypeError, ValueError):
                if attempt == 1:
                    raise
            finally:
                if recovery is not None:
                    recovery.close()
        raise RuntimeError("VM restoration failed")

    def close(self):
        """Close both wrappers without masking an earlier error."""
        file_object, self.file = self.file, None
        if file_object is not None:
            try:
                file_object.close()
            except OSError:
                pass
        sock, self.socket = self.socket, None
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass


def _require_version(version):
    # QMP's version object includes both the upstream version and a distributor
    # package string. Retain both in the receipt; package text is not a version.
    if (not isinstance(version, dict)
            or not isinstance(version.get("package"), str)
            or version.get("qemu") != QEMU_VERSION
            or any(type(value) is not int for value in version["qemu"].values())):
        raise RuntimeError("stop/drain contract has only been reviewed for QEMU 11.1.1")


def _coherent_status(value):
    if not isinstance(value, dict) or type(value.get("running")) is not bool:
        raise RuntimeError("QMP returned an incomplete VM status")
    status = value.get("status")
    if status not in ("running", "paused"):
        raise RuntimeError("QMP returned an unsupported VM status")
    if value["running"] != (status == "running"):
        raise RuntimeError("QMP returned incoherent VM status")
    return {"running": value["running"], "status": status}


def _stat_identity(value):
    return {"device": value.st_dev, "inode": value.st_ino, "size": value.st_size,
            "mode": stat.S_IFMT(value.st_mode)}


def _verify_source_identity(source, identity, source_fd=None):
    path_stat = os.stat(source, follow_symlinks=False)
    if _stat_identity(path_stat) != identity:
        raise RuntimeError("source path identity changed")
    if source_fd is not None and _stat_identity(os.fstat(source_fd)) != identity:
        raise RuntimeError("source descriptor identity changed")
    if identity["mode"] != stat.S_IFREG:
        raise RuntimeError("source must remain a regular file")


def _entry_exists(directory_fd, name):
    try:
        os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    except FileNotFoundError:
        return False
    return True


def _close_fd(fd):
    if fd is not None:
        try:
            os.close(fd)
        except OSError:
            pass


def _open_capture_descriptors(source, destination):
    source_fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    directory_fd = None
    try:
        source_stat = os.fstat(source_fd)
        identity = _stat_identity(source_stat)
        _verify_source_identity(source, identity, source_fd)
        directory_fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        if _stat_identity(os.fstat(directory_fd)) != _stat_identity(
                os.stat(destination.parent, follow_symlinks=False)):
            raise RuntimeError("destination directory identity changed")
        if _entry_exists(directory_fd, destination.name):
            raise RuntimeError("destination already exists")
        if source_stat.st_dev != os.fstat(directory_fd).st_dev:
            raise RuntimeError("source and destination must be on the same filesystem")
        return source_fd, directory_fd, identity
    except BaseException:
        _close_fd(source_fd)
        _close_fd(directory_fd)
        raise


def validate_disk(qmp, source, expected=None, deadline=None):
    _require_version(qmp.version)
    if qmp.call("query-block-jobs", deadline=deadline):
        raise RuntimeError("refusing capture during a block job")
    blocks = [b for b in qmp.call("query-block", deadline=deadline)
              if b.get("inserted", {}).get("file") == str(source)]
    if len(blocks) != 1:
        raise RuntimeError("expected exactly one QMP disk matching the source path")
    block = blocks[0]
    disk = block.get("inserted")
    if not isinstance(disk, dict):
        raise RuntimeError("QMP disk has no inserted device")
    if block.get("io-status") != "ok":
        raise RuntimeError("disk I/O status is not clean")
    required = ("drv", "backing_file_depth", "cache", "node-name", "ro", "active", "image")
    if any(field not in disk for field in required):
        raise RuntimeError("QMP disk metadata is incomplete")
    image = disk["image"]
    if not isinstance(image, dict):
        raise RuntimeError("QMP disk image metadata is incomplete")
    if disk["drv"] != "qcow2" or disk["backing_file_depth"] != 0:
        raise RuntimeError("only standalone qcow2 disks are supported")
    if disk["ro"] is not False or disk["active"] is not True:
        raise RuntimeError("source disk must be active and writable")
    if disk["cache"].get("no-flush") is not False:
        raise RuntimeError("source does not honor flushes")
    if image.get("backing-filename") or image.get("full-backing-filename"):
        raise RuntimeError("source has a backing image")
    if image.get("format-specific", {}).get("data", {}).get("corrupt") is not False:
        raise RuntimeError("source corruption state is not explicitly clean")
    if image.get("dirty-flag") is not False:
        raise RuntimeError("source qcow2 metadata is dirty")
    if image.get("virtual-size") != DISK_BYTES:
        raise RuntimeError("source disk must have exactly 32 GiB virtual size")
    metadata = {"node": disk["node-name"], "virtualBytes": image["virtual-size"]}
    if expected is not None and metadata != expected:
        raise RuntimeError("QMP disk identity changed during capture")
    return metadata


def clone_apfs(source_fd, directory_fd, destination_name):
    """No byte-copy fallback: pausing a VM for a long copy is not acceptable."""
    if sys.platform != "darwin":
        raise RuntimeError("this capture path requires macOS APFS cloning")
    library = ctypes.CDLL(None, use_errno=True)
    clone = library.fclonefileat
    clone.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32]
    clone.restype = ctypes.c_int
    if clone(source_fd, directory_fd, os.fsencode(destination_name), 0) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))


def _verify_clone(clone_fd, directory_fd, name, source_identity):
    info = os.fstat(clone_fd)
    if (not stat.S_ISREG(info.st_mode)
            or info.st_size != source_identity["size"]
            or info.st_dev != source_identity["device"]):
        raise RuntimeError("clone is not the expected regular file on the source filesystem")
    if info.st_ino == source_identity["inode"]:
        raise RuntimeError("clone shares the source inode")
    if _stat_identity(info) != _stat_identity(
            os.stat(name, dir_fd=directory_fd, follow_symlinks=False)):
        raise RuntimeError("clone entry identity changed")
    return info


def _freeze_and_hash(clone_fd, directory_fd, name, source_identity):
    _verify_clone(clone_fd, directory_fd, name, source_identity)
    os.fchmod(clone_fd, 0o400)
    os.fsync(clone_fd)
    os.fsync(directory_fd)
    hashes = []
    for _ in range(2):
        os.lseek(clone_fd, 0, os.SEEK_SET)
        digest = hashlib.sha256()
        for block in iter(lambda: os.read(clone_fd, 8 * 1024 * 1024), b""):
            digest.update(block)
        hashes.append(digest.hexdigest())
    if hashes[0] != hashes[1]:
        raise RuntimeError("frozen clone changed while hashing")
    info = _verify_clone(clone_fd, directory_fd, name, source_identity)
    return info, hashes[0]


@contextmanager
def _defer_termination_signals():
    pending = []
    previous = {}

    def defer(signum, _frame):
        pending.append(signum)

    try:
        for signum in (signal.SIGINT, signal.SIGTERM):
            previous[signum] = signal.getsignal(signum)
            signal.signal(signum, defer)
        yield pending
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)


def _deferred_exception(signum):
    return KeyboardInterrupt() if signum == signal.SIGINT else SystemExit(128 + signum)


def capture(qmp, source, destination, clone=clone_apfs):
    """Capture and admit its receipt while retaining the original directory fd."""
    source_fd, directory_fd, source_identity = _open_capture_descriptors(source, destination)
    clone_fd = None
    stopped = False
    cloned = False
    primary = None
    restoration = None
    deferred = None
    final_status = None
    metadata = None
    before = None
    try:
        try:
            metadata = validate_disk(qmp, source)
            before = _coherent_status(qmp.call("query-status"))
            # Operational precondition: this export controller is the only QMP client.
            # QMP itself does not provide an exclusive lease for this sequence.
            stopped = True
            # A lost stop reply is ambiguous: cleanup must inspect a fresh connection.
            qmp.call("stop")
            paused = _coherent_status(qmp.call("query-status"))
            if paused != {"running": False, "status": "paused"}:
                raise RuntimeError("VM did not reach paused state")
            _verify_source_identity(source, source_identity, source_fd)
            validate_disk(qmp, source, metadata)
            clone(source_fd, directory_fd, destination.name)
            cloned = True
            clone_fd = os.open(destination.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                               dir_fd=directory_fd)
            _verify_clone(clone_fd, directory_fd, destination.name, source_identity)
            _verify_source_identity(source, source_identity, source_fd)
            if _coherent_status(qmp.call("query-status")) != paused:
                raise RuntimeError("VM run state changed during clone")
            validate_disk(qmp, source, metadata)
            final_status = paused
        except BaseException as error:
            primary = error
        if stopped and before == {"running": True, "status": "running"}:
            pending = []
            try:
                with _defer_termination_signals() as pending:
                    final_status = qmp.resume(source, metadata, source_identity)
            except BaseException as error:
                restoration = error
            if pending:
                deferred = _deferred_exception(pending[0])
        elif stopped:
            try:
                final_status = _coherent_status(qmp.call("query-status"))
            except BaseException as error:
                restoration = error
        if primary is not None:
            if restoration is not None:
                raise CaptureError(primary, restoration) from primary
            raise primary
        if restoration is not None:
            if deferred is not None:
                raise CaptureError(deferred, restoration) from deferred
            raise restoration
        if deferred is not None:
            raise deferred
        info, digest = _freeze_and_hash(clone_fd, directory_fd, destination.name, source_identity)
        result = {**metadata, "before": before["status"], "after": final_status["status"],
                  "sourceDevice": source_identity["device"], "sourceInode": source_identity["inode"],
                  "copyDevice": info.st_dev, "copyInode": info.st_ino,
                  "copyBytes": info.st_size, "sha256": digest,
                  "consistency": "crash-consistent, guest buffers not captured",
                  "schema": 1, "qemu": qmp.version, "privateOnly": True,
                  "source": str(source), "copy": str(destination)}
        _write_receipt(directory_fd, result)
        return result
    except BaseException as error:
        if cloned:
            try:
                os.unlink(destination.name, dir_fd=directory_fd)
                os.fsync(directory_fd)
            except FileNotFoundError:
                pass
            except OSError as cleanup:
                raise CaptureError(error, cleanup=cleanup) from error
        raise
    finally:
        for fd in (clone_fd, source_fd, directory_fd):
            _close_fd(fd)


def _write_receipt(directory_fd, result):
    receipt_name = "capture.json"
    temp_name = f".{receipt_name}.{os.getpid()}.tmp"
    temp_created = False
    published = False
    try:
        if _entry_exists(directory_fd, receipt_name):
            raise RuntimeError("capture receipt already exists")
        fd = os.open(temp_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=directory_fd)
        temp_created = True
        try:
            payload = (json.dumps(result, indent=2) + "\n").encode()
            offset = 0
            while offset < len(payload):
                written = os.write(fd, payload[offset:])
                if written == 0:
                    raise OSError("capture receipt write made no progress")
                offset += written
            os.fsync(fd)
        finally:
            _close_fd(fd)
        os.rename(temp_name, receipt_name, src_dir_fd=directory_fd, dst_dir_fd=directory_fd)
        published = True
        os.fsync(directory_fd)
    except BaseException as error:
        if published:
            try:
                os.unlink(receipt_name, dir_fd=directory_fd)
            except OSError as cleanup:
                raise CaptureError(error, cleanup=cleanup) from error
        raise
    finally:
        try:
            if temp_created and not published:
                os.unlink(temp_name, dir_fd=directory_fd)
        except OSError:
            pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--qmp", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    source, output = args.source, args.output_dir
    if not source.is_absolute() or source.resolve() != source or not source.is_file():
        parser.error("source must be an absolute regular path without symlinks")
    if not output.is_absolute() or output.resolve() != output or not output.is_dir():
        parser.error("output must be an existing absolute directory without symlinks")
    private_tmp = Path("/private/tmp").resolve()
    if private_tmp != output and private_tmp not in output.parents:
        parser.error("output directory must be under /private/tmp")
    mode = output.stat()
    if mode.st_uid != os.getuid() or stat.S_IMODE(mode.st_mode) != 0o700 or any(output.iterdir()):
        parser.error("output directory must be empty, owned by this user and mode 0700")
    if source.stat().st_dev != mode.st_dev:
        parser.error("source and destination must be on the same filesystem")
    destination = output / "private-source.qcow2"
    qmp = Qmp(args.qmp)
    try:
        result = capture(qmp, source, destination)
    finally:
        qmp.close()
    print(f"VM state restored ({result['after']}); private copy frozen and receipt saved", flush=True)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    def interrupted(_signum, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    main()

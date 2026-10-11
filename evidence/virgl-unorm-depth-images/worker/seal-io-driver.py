#!/usr/bin/env python3
"""Run the frozen sealer using identical archive bytes with memory-backed seeks.

No records or verification predicates change. Each logical member still reads its
complete physical body and passes the frozen sealer's size/SHA-256 check.
"""
import gzip
import io
from pathlib import Path
import runpy
import sys
import tarfile

original_open = tarfile.open

class MemoryTarFile(tarfile.TarFile):
    def extractfile(self, member):
        entry = member if isinstance(member, tarfile.TarInfo) else self.getmember(member)
        if entry.islnk():
            entries = self.getmembers()
            if not hasattr(self, '_physical_members'):
                self._physical_members = {item.name: item for item in entries}
            target = self._physical_members[entry.linkname]
            if not target.isfile() or target.offset >= entry.offset:
                raise ValueError('hardlink must target an earlier physical body')
            entry = target
        return super().extractfile(entry)

def memory_open(name=None, mode='r', *args, **kwargs):
    if mode == 'r:gz' and name is not None:
        body = gzip.decompress(Path(name).read_bytes())
        return MemoryTarFile.open(fileobj=io.BytesIO(body), mode='r:')
    return original_open(name, mode, *args, **kwargs)

tarfile.open = memory_open
sys.argv = ['tools/virgl-unorm-depth/seal.py', *sys.argv[1:]]
runpy.run_path(sys.argv[0], run_name='__main__')

#!/usr/bin/env python3
"""The stamp must describe the executed package; production identity stays reproducible."""
from pathlib import Path
import hashlib
import re
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO=Path(__file__).resolve().parents[2]
GEN=REPO/'tools/gen-gpu-checkpoint-build.py'
generate=runpy.run_path(str(GEN))['generate']
WEB=REPO/'web/dist'


class BuildIdentity(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='e9-diagnostic-identity-')
        self.root=Path(self.temp.name);self.package=self.root/'pkg'
        shutil.copytree(WEB/'pkg',self.package)

    def tearDown(self):
        self.temp.cleanup()

    def check(self,output,package=None):
        command=[sys.executable,str(GEN),'--runtime-root',str(WEB),'--output',str(output),'--check']
        if package is not None:command+=['--wasm-package-root',str(package)]
        return subprocess.run(command,text=True,capture_output=True)

    def changed_wasm(self):
        wasm=self.package/'wasm_vm_wasm_bg.wasm'
        wasm.write_bytes(wasm.read_bytes()+b'\x00\x01\x00') # valid empty custom section
        return wasm.read_bytes()

    def test_existing_production_stamp_is_reproduced(self):
        stamp,_,_=generate(WEB)
        self.assertEqual(stamp.encode(),(WEB/'gpu-checkpoint-build.js').read_bytes())

    def test_actual_diagnostic_wasm_and_snippets_determine_the_identity(self):
        before=(WEB/'gpu-checkpoint-build.js').read_bytes();wasm=self.changed_wasm()
        stamp,identity,_=generate(WEB,self.package)
        self.assertIn(hashlib.sha256(wasm).hexdigest(),stamp)
        self.assertIn('SOFTWARE_CHECKPOINT_WASM_BYTES='+str(len(wasm)),stamp)
        self.assertNotIn(identity,before.decode())
        self.assertEqual(before,(WEB/'gpu-checkpoint-build.js').read_bytes())

    def test_both_mixed_stamp_directions_are_rejected(self):
        self.changed_wasm();stamp,_,_=generate(WEB,self.package)
        diagnostic=self.root/'diagnostic.js';diagnostic.write_text(stamp)
        self.assertNotEqual(self.check(WEB/'gpu-checkpoint-build.js',self.package).returncode,0)
        self.assertNotEqual(self.check(diagnostic).returncode,0)
        self.assertEqual(self.check(diagnostic,self.package).returncode,0)

    def test_hand_relabeling_a_normal_stamp_does_not_create_diagnostic_provenance(self):
        old=(self.package/'wasm_vm_wasm_bg.wasm').read_bytes();new=self.changed_wasm()
        stamp=(WEB/'gpu-checkpoint-build.js').read_text().replace(hashlib.sha256(old).hexdigest(),hashlib.sha256(new).hexdigest())
        stamp=stamp.replace('SOFTWARE_CHECKPOINT_WASM_BYTES='+str(len(old)),
            'SOFTWARE_CHECKPOINT_WASM_BYTES='+str(len(new)))
        output=self.root/'relabeled.js';output.write_text(stamp)
        self.assertNotEqual(self.check(output,self.package).returncode,0)

    def test_mutated_or_missing_diagnostic_snippet_never_falls_back(self):
        stamp,_,_=generate(WEB,self.package);output=self.root/'stamp.js';output.write_text(stamp)
        glue=(self.package/'wasm_vm_wasm.js').read_text()
        member=re.search(r'''from\s*['"](\./snippets/[^'"]+)['"]''',glue).group(1)
        snippet=self.package/member;snippet.write_text(snippet.read_text()+'\n// changed diagnostic input\n')
        self.assertNotEqual(self.check(output,self.package).returncode,0)
        snippet.unlink()
        with self.assertRaisesRegex(RuntimeError,'Missing worker runtime input'):generate(WEB,self.package)


if __name__=='__main__':unittest.main(verbosity=2)

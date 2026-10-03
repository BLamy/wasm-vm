"""Retain the verifier's attacks against genuine, hash-bound guest captures."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest


class CorpusVerifierTests(unittest.TestCase):
    def test_real_capture_continuation_and_provenance_mutations(self):
        root = Path(__file__).resolve().parents[3]
        script = root / "evidence/virgl-corpus/verifier/attack_captures.py"
        spec = importlib.util.spec_from_file_location("verifier_capture_attacks", script)
        attacks = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(attacks)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            attacks.main()
        report = json.loads(output.getvalue())
        self.assertEqual(len(report["results"]), 4)
        self.assertTrue(all(result["result"] == "HELD" for result in report["results"]))


if __name__ == "__main__":
    unittest.main()

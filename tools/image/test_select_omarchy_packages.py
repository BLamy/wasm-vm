import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("selection", Path(__file__).with_name("select-omarchy-packages.py"))
selection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(selection)


class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def package(self, name, depends=(), provides=()):
        directory = self.root / (name + "-1")
        directory.mkdir()
        body = {"NAME": [name], "VERSION": ["1.0"], "SIZE": ["100"],
                "DEPENDS": list(depends), "PROVIDES": list(provides)}
        (directory / "desc").write_text("\n".join("%" + k + "%\n" + "\n".join(v) + "\n" for k, v in body.items()))

    def test_closed_selection_keeps_versions_and_omits_unrelated(self):
        self.package("desktop", ["lib>=1.0", "font"])
        self.package("lib")
        self.package("fontpkg", provides=["font"])
        self.package("unrelated-compiler")
        result = selection.select(self.root, {"seeds": ["desktop"]})
        self.assertEqual(result["packages"], ["desktop", "fontpkg", "lib"])
        self.assertEqual(result["installedBytes"], 300)
        self.assertFalse(result["versionConstraintsChecked"])

    def test_missing_and_ambiguous_dependency_refused(self):
        self.package("desktop", ["font"])
        with self.assertRaisesRegex(ValueError, "missing or ambiguous"):
            selection.select(self.root, {"seeds": ["desktop"]})
        self.package("font1", provides=["font"])
        self.package("font2", provides=["font"])
        with self.assertRaisesRegex(ValueError, "missing or ambiguous"):
            selection.select(self.root, {"seeds": ["desktop"]})
        result = selection.select(self.root, {"seeds": ["desktop"], "providers": {"font": "font2"}})
        self.assertEqual(result["packages"], ["desktop", "font2"])

    def test_cycles_terminate(self):
        self.package("one", ["two"])
        self.package("two", ["one"])
        self.assertEqual(selection.select(self.root, {"seeds": ["one"]})["packages"], ["one", "two"])


if __name__ == "__main__":
    unittest.main()

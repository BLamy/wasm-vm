"""Bounded attacks against false compatibility claims in the decision gate."""
from copy import deepcopy
import json
import unittest

import verify


class ContractGate(unittest.TestCase):
    def setUp(self):
        self.contract = verify.read_json(verify.ROOT / 'docs/gpu-3d-contract.json')
        self.browser = verify.read_json(verify.ROOT / 'evidence/virgl-contract/browser/report.json')
        self.totals = {key: {name: row['corpusOccurrences'] for name, row in entries.items()}
                       for key, entries in self.contract['matrix'].items()}
        self.shaders = {key: {'stage': value['stage']} for key, value in self.contract['capturedShaders'].items()}
        self.vertices = {key: value['corpusOccurrences'] for key, value in self.contract['vertexFormats'].items()}

    def check(self, contract):
        verify.check_matrix(contract, self.totals, self.contract['captureManifests'], self.shaders, self.vertices)

    def test_missing_opcode_and_false_support_rejected(self):
        for action in ('delete', 'count', 'supported'):
            changed = deepcopy(self.contract)
            row = changed['matrix']['opcodes']['DRAW_VBO']
            if action == 'delete': del changed['matrix']['opcodes']['DRAW_VBO']
            elif action == 'count': row['corpusOccurrences'] += 1
            else: row['status'] = 'supported'
            with self.subTest(action=action), self.assertRaises(ValueError): self.check(changed)

    def test_caps_precise_and_depth_overclaims_rejected(self):
        for action in ('capset', 'precise', 'depth', 'shader', 'vertex'):
            changed = deepcopy(self.contract)
            if action == 'capset': changed['production']['capsets'] = [2]
            elif action == 'precise': changed['matrix']['shaderInstructions']['MUL_PRECISE']['status'] = 'implementable'
            elif action == 'depth': changed['matrix']['resourceFormats']['17']['status'] = 'implementable'
            elif action == 'shader': next(iter(changed['capturedShaders'].values()))['currentBridge'] = 'supported'
            else: del changed['vertexFormats']['29']
            with self.subTest(action=action), self.assertRaises(ValueError): self.check(changed)

    def test_unqualified_browser_and_insufficient_ubo_rejected(self):
        for action in ('browser', 'gpu', 'ubo', 'qualifier', 'errors', 'scope', 'pixels'):
            changed = deepcopy(self.browser)
            if action == 'browser': changed['browser']['version'] = '999.0'
            elif action == 'gpu': changed['acceptance']['renderer']['renderer'] = 'SwiftShader'
            elif action == 'ubo': changed['backendProbes']['limits']['MAX_VERTEX_UNIFORM_BLOCKS'] = 12
            elif action == 'qualifier': changed['backendProbes']['probes'][0]['precise']['compiled'] = True
            elif action == 'errors': changed['browserErrors']['console'] = ['WebGL error']
            elif action == 'scope': changed['capturedGuestShadersSupported'] = True
            else: changed['backendProbes']['probes'][1]['cases'][0]['observed'][0] ^= 1
            with self.subTest(action=action), self.assertRaises(ValueError): verify.qualify_browser(self.contract, changed)

    def test_stale_source_and_duplicate_json_fail(self):
        item = {'path': 'renderer/virgl-shader/bridge.c', 'size': 1, 'sha256': '0' * 64}
        with self.assertRaises(ValueError): verify.verify_files([item])
        from pathlib import Path
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'duplicate.json'
            path.write_text('{"caps": 0, "caps": 2}')
            with self.assertRaises(ValueError): verify.read_json(path)


if __name__ == '__main__':
    unittest.main()

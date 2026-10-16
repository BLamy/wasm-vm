#!/usr/bin/env python3
"""Independent, explicit predecessor-C-harness compatibility receipt entrypoint.

This calls only successor-owned validation and unchanged E5 workload/coverage
helpers. It does not invoke or impersonate the unmodified E5 full-gate receipt.
"""
import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location('dot_component_compat_native_receipt', Path(__file__).with_name('native_receipt.py'))
_native = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_native)


def verify_component(output, head):
    return _native._verify(output, head, compatibility=True)

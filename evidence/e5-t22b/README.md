# E5-T22b viewport proof

Frozen runtime and harness: `66bb2a48019d089756cdfaee3d5ea578f156bc28`.
Command: `make verify-E5-T22b > evidence/e5-t22b/acceptance.log 2>&1` (exit 0).

- 55 deterministic tests pass; no skipped or failed tests.
- Chrome 152.0.7977.76, Canvas2D and WebGL2, DPR 1 / 1.5 / 2.
  WebGL uses `--use-angle=swiftshader --enable-unsafe-swiftshader` for a
  functional pixel proof, not a performance claim.
- 58 full pixel oracles check 183,108,328 bytes, including odd dimensions,
  old-resource stride/clipping/black padding, context replacement, and two
  matching partial frames coalescing before one animation callback.
- Live DPR swaps and the actual 50-change / five-second storm reach their final
  modes; the storm sends one extra request. Disposal prevents later requests.
- The diagnostic uses synthetic frames and a real paused module-worker GPU.
  The main app's real boot ownership path accepts its initial 1122x240 viewport
  through the same eight-byte paused guest fixture. This is not a Linux boot or
  proof of compositor mode adoption, which remains T22c-d.
- Built main demo: 126 passed, 0 failed, no collected console/page/HTTP errors.

SHA256:

| Artifact | Digest |
| --- | --- |
| viewport-proof.json | d273f19eb6f5b7ce92505d049fada88dc73ee79f02776a3be83478cd66587690 |
| acceptance.log | 703d8693242638966c4c0b08d64a39a9d9b80e2ef5c7a9d039ecce24f9017a43 |
| web/dist/pkg/wasm_vm_wasm_bg.wasm | 563fb01ba0eb5bcfbf5de2b0f76471881f06f165aa0ff56380edc14acb9d05fc |

The JSON binds runtime/harness files and every screenshot. T22a's unchanged
architectural hotplug boundary and guest trace/digest carry forward; this task
changes no Rust, guest resource bounds, or WASM bytes.

`initial/` preserves the earlier worker recording at `2da168d7`. The verifier
refuted a coalesced matching-frame transition that recording did not cover;
`verifier/pre-handoff-findings.md` and the two original attack reports preserve
that failure. The final implementation moves the full-repaint decision from
frame receipt to successful backend delivery and retains the partial fast path
after the first actual paint. The deterministic test and all six browser cases
now include that sequence. Initial evidence is not the final claim.

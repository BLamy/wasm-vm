# Actual desktop result: physical PASS, visible FAIL

Frozen source: 2e61bf3e971595741c627e8b68fcaee055c27945.
Built WASM: 7d7b300003cf68076c28958694062dacf3c879efe921bc631bade568ee143bdf.

The worker personally opened the actual `final/response/desktop/desktop-keyboard.png`.
It shows only the old empty `[omarchy@omarchy-demo ~]$` prompt. The physical
command and returned prompt are absent. SHA256 is
431be977157bf77dcd21ca8bf3b640bce9e02dc8c54f09a30d58af78a8195b24,
identical to the negative AS images.

The independently read nonce160cbfd4ae8e0c08 arrived at23:16:58.815Z,
87.921seconds after Enter23:15:30.894Z. After that nonce, the presentation
counter increased4→5; the image was captured23:17:14.778Z, within the unchanged
20second capture budget. Geometry stayed1280×800, resource1280×832. There were
128trusted key events, with independent raw-wire acknowledgments and no
profiler or guest input observer.

The acceptance command and deterministic GPU checks passed. Their `passed`
and `machineAcceptance` fields do not assert visual success. The response
receipt explicitly retains `desktopAcceptance:false` and
`visualInspectionRequired:true`. **Desktop responsiveness remains unsolved.**
Q must remain gated. The source-offset bug has its own failing-old/passing-new
proof, but does not account for this remaining stale image.

The pristine clone produced the same result with nonce 6adf405f616e1efe in
90.370 seconds and a post-nonce capture at 16.455 seconds. The worker also
personally opened that actual PNG; it is the same empty prompt with the same
SHA256. Both runs had zero browser errors and closed their owned browsers
normally within the original cleanup budget. The clone independently rebuilt
the exact committed WASM and passed the same device, harness and 127-case live
ISA checks. These are reproducibility findings, not a visual pass.

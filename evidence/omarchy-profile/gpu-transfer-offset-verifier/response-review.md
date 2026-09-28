# Actual AT response: physical PASS, visible FAIL

I personally viewed the final response PNG. It shows the original empty
`[omarchy@omarchy-demo ~]$` prompt. The typed `printf` command and returned
prompt are absent. The cold-run PNG is byte-for-byte identical, so it has the
same negative result. Both are also identical to the previously refuted AS
response image, SHA256
`431be977157bf77dcd21ca8bf3b640bce9e02dc8c54f09a30d58af78a8195b24`.

This is a failed visible-responsiveness prediction, not a missing input or
missing-frame finding. The corrected GPU offset does not solve the desktop.

| Independently checked evidence | Final | Pristine clone |
| --- | --- | --- |
| Report SHA256 | 9267a589a00aedba038dc9a3b36ad9b823e002a94530073c438c590a38c2eb19 | 99249c0d6ed8f4d901ceff13f9cd4876e8f05d676de9639dc2175ec805c61c4d |
| Trusted physical key events / acknowledged key+sync calls | 128 / 256 | 128 / 256 |
| Completed independent file reads / nonce replies / pending reads | 27 / 1 / 0 | 27 / 1 / 0 |
| Raw nonce arrival after Enter | 87.920 s | 90.369 s |
| New post-nonce presented frames | 4 → 5 | 4 → 5 |
| Capture elapsed within original 20 s | 15.963 s | 16.455 s |
| Normal cleanup | 0.166 s | 0.162 s |

Both reports bind frozen source
`2e61bf3e971595741c627e8b68fcaee055c27945`, corrected WASM
`7d7b300003cf68076c28958694062dacf3c879efe921bc631bade568ee143bdf`,
the exact AR pair, and the AQ kernel. Each has 45 checked helper identities,
96 successful served-resource rows and 67 distinct git-backed resources.
Startup300s, typing60s, Enter+120s, capture20s and cleanup30s remain intact.
The read-only kernel-note identity check precedes the Foot property read and
trusted keyboard input. No profiler, guest observer or checkpoint is enabled.

The final report records nonce `160cbfd4ae8e0c08` at report.json:25906 and
keyboard receipt at:27621. The post-nonce baseline timestamp is at:27061 and
response-image timestamp at:27123. Frame5 reports damage rectangle
(10,36,1260,754) within the 1280×832 resource, presented into the original
1280×800 fixed viewport. Counters and damage thus advance while the actual
image remains stale. `check-recording.mjs`, final-recording.json and
cold-recording.json provide repeatable byte, command-order and deadline checks.

Q must stay gated. AU may measure the actual Worker display bytes against
the canvas to locate the stale boundary. An unbound scanout remains an
unproven hypothesis; this review does not assert that it is the cause.

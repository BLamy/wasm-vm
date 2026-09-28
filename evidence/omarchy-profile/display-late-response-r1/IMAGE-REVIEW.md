# E5.5-T03av image review

The five PNGs below are the real Chromium screenshots taken after the original
product verdict. Their hashes are bound in `response/run.json` and independently
recomputed by the verifier.

| checkpoint | image SHA-256 | visual result |
| ---: | --- | --- |
| 0 ms | `431be977157bf77dcd21ca8bf3b640bce9e02dc8c54f09a30d58af78a8195b24` | The original empty shell prompt; no typed command. |
| 40,000 ms | `d8ed68d5cc23a908ee07ca1b831114f2ce5b237605cb4301b64985934c1dbc62` | Still the old empty prompt, with only a small cursor-region update. |
| 80,000 ms | `14b165814f6c1f8ae3baeea1585fa565677bc6c9035bc9abcf16c5b63d33b970` | The typed `printf` command and the returned prompt are visible. |
| 120,000 ms | `14b165814f6c1f8ae3baeea1585fa565677bc6c9035bc9abcf16c5b63d33b970` | Same visible command and returned prompt. |
| 160,000 ms | `14b165814f6c1f8ae3baeea1585fa565677bc6c9035bc9abcf16c5b63d33b970` | Same visible command and returned prompt. |

The original product screenshot remains unchanged and the report keeps
`desktopAcceptance: false`. The later screenshots demonstrate late rendering
only; they do not turn the original 20-second capture into a responsive pass.

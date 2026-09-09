# E5-T26p verifier novel attack r2 — final formatted source pins

This supersedes r1 for execution because `rustfmt --edition 2024` changed only the shared support
file. The prediction and commands remain exactly those in `novel-attack-r1-pins.md`.

Canonical admission:

- native old/candidate equality result:
  `e85693bb07f4726252b9930d31a3c7f21c213ae27d70af1c31dc572f57d29385`
- old/candidate/golden stdout:
  `5587b4d8fc786ea48a87a2c004466fe7fb2b9a7630c408548fcb264414446cc2`
- actual-WASM shared-producer log:
  `dbeefd2e7f15c5e4a8b85b6eb8ea952c432fc6d3226f0f25ed737b9fe362f995`
- producer: `62ce60205676c1ed59b2e11395c36337278cdd65d6fd9d4f56be4a4e13e7c5c9`
- WASM wrapper: `3b051dcbd5dd4e15877ec465e8af7a6b9bae26dfd5ab0837f9314e71a9cc8d18`

Final verifier sources:

```text
46badec8faabdc9bacb30a2f35545015e7b50c52611de54e7af53d2a6f1af748  crates/core/tests/retirement_capture_verifier.rs
b23c2e5e0034cb0f852bbf96f8ecf51b28c098a22aeba7b5993dae0207127a48  crates/core/tests/support/retirement_capture_verifier_support.rs
d7645b3c4805532dd63319a5904a682b85b4b0457fb9de2aee0d5e965996b57a  crates/wasm/tests/retirement_capture_verifier.rs
```

Runtime remains frozen:

```text
ab15c6a854441fc99f28a3c2e34d60fea3c5d2450d2db3577f1b185a7be7cd39  crates/core/src/hart/mod.rs
9e2d235163d528112ab0375886e2bdf4e602c0dbdceaf7e486abad0b6d78b053  crates/core/src/lib.rs
676941521e8882e17b242384ce7d2a737918750b46ec6b302f120d5cfaa92034  crates/wasm/src/lib.rs
```

The r1 native log predates final formatting and is retained but not the final verifier run.

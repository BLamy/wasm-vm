# Bounded F diagnostic helpers — 34 tests

Harness/test source frozen at `078de2df`; recorded while HEAD was `18d53058`.
The intervening sound-only task changes do not affect these extracted JavaScript
helpers. This recording is a harness test, not guest or F acceptance evidence.

```sh
script -q evidence/e5-t26f/diagnostic-harness-078de2df/node-tests.log \
node --test tools/verify/e5-t26f-browser-roundtrip.test.mjs
```

Exit 0: 34 passed, 0 failed/skipped. The suite covers bounded diagnostic profile
binding, physical-command/key-delay overrides restricted to reuse, unchanged
original timing boundaries, deferred coherence ordering, timeout PCM retention,
and non-verbose cold setup preserving stderr and conditional playback success.

SHA-256:

- Runner: `e0e435d3dc8bcc025b789a4b8310a66e81204c13e051b916b7098df78593f508`.
- Tests: `fa21987e5aefc9bac0260962a106734cb0fa63cc9f4776a94c87dec8095dc5c6`.
- Raw log: `84e8b91f555ae5974cf3e3e917384fd1636a6c20ed4ca1067b437e1a4b582860`.

The sealed earlier checkpoint still contains its creator's verbose command. New
cold setups omit that temporary output; no old checkpoint is retroactively
represented as exercising the new setup. Reuse remains diagnostic-only.

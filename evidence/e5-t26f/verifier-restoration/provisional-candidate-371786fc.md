# E5-T26f fresh critic — provisional candidate `371786fc`

This is a retained-evidence critique, not a final verifier verdict. Candidate
`371786fc2a988381bef1a7f83fd7dca2bba07cf9` ended in failure before the worker made an
implemented claim. The task status is unchanged.

## Finding: restored playback does not reach the fresh browser PCM ring

**Prediction P4 — FAILED.** After the delayed real gesture and the newly typed `sh /tmp/a`, the
restored guest must publish non-silent PCM into the page-owned ring and complete all required
interaction within two seconds of `normalRestore.result.completedAt`.

- The whole-machine portion held: the restored blob SHA-256 is
  `043aa6681b5836fe274f3554cedf54ada8926e6229759b1317f09a95bd827970`; saved and first-present
  CRC are both `3079a40f`; the only boot states are `fetching`, `instantiating`, and `restored`;
  and the fresh agent handshake is generation 2. Citation: failure JSON lines 153-234.
- Real post-restore input held: the guest tablet frame rendered at `(684,392)` with 94 matched
  cursor pixels, observed 1763.55 ms after the restore completion boundary. Citation: failure
  JSON lines 286-320.
- The command was not a green-pixel false positive. The screenshot visibly contains, in the
  restored upper terminal, `sh /tmp/a`, ALSA's “Playing raw data” format line, the green
  `e5t26f-aplay` token, and the next shell prompt. The saved `/tmp/a` emits its token only through
  `aplay ... && printf ...` (failure JSON lines 98-115), and the restored command records 20/20
  keyboard/DOM events with an exact input sequence (lines 326-344 and 766-807).
- Despite that successful guest-visible completion, the fresh page ring's producer `writeIndex`
  was `0` before the command (lines 321-325) and the immediate completion observation reported
  no written frames, tripping the exact assertion at harness line 777 (failure JSON lines
  346-350). The page's later `renderedFrames = 722048` only proves that the AudioWorklet clock ran;
  the observation deliberately reads the producer index and SAB payload because worklet silence
  also advances that clock (`web/desktop-terminal.js:315-350`).
- The two-second criterion also remains failed independently of PCM: the cursor alone arrived at
  1763.55 ms, and the reported post-restore command then took about 13 seconds. The harness would
  reject the final boundary at line 824 if the earlier PCM assertion did not stop the run.

**Classification.** This is not evidence of a guest shell/command failure and not evidence of a
marker detector false positive. It is evidence that no new guest PCM reached the browser ring.
The retained capture does **not** distinguish (a) a lost/replaced `SharedAudioSink` attachment from
(b) an attached sink whose restored virtio-snd stream/TX queue never calls `push`: the harness
queries `audioOutputReady()` only after the failing assertion (`tools/verify/e5-t26f-browser-roundtrip.mjs:788-800`).

**Narrow worker ask.** Keep the zero/non-silent PCM assertion and the original two-second boundary.
At the immediate completion sample, retain `audioOutputReady`, ring cursors, and any already
available output stream/TX-queue state before asserting. Repair only the restored playback data
path demonstrated by those values, then rerun the same candidate proof until the newly typed
command, non-silent PCM producer delta, rendered-frame delta, cursor/focus, and gesture all finish
within two seconds. Do not treat `aplay` exit, the green token, or render-clock growth as PCM proof.

## Carried and deferred predictions

- **HELD at the reached boundary:** exact candidate identity; persisted whole-machine resume; no
  reboot/reprobe; matching normal first-present CRC; fresh generation-2 HELLO; real restored
  pointer/focus; typed guest-visible terminal command; bridge ownership and deferred-audit Node
  sabotage checks recorded in this verifier directory.
- **NEEDS EVIDENCE because execution stopped early:** completed normal coherence audit; all four
  drag save phases; moving-drag restore with matching CRC and no held button; second reload; final
  stale/mismatched-generation audit. No conclusion is drawn about those unexecuted phases.

## Artifact digests

- Failure JSON: `8d9827bc6efc79d0b26bf85768592f52c3aaadb87a0a1bb2672c62193195b65a`
- Failure screenshot: `965ab8b578c959dd9b6b3c8a83050dc73a660d91f949a1a1897f10d62a2d247b`
- Server log: `a3eebadf64e183ebe0dfa27acb7c9d0e66a3e45e4956454074d6995df256fb33`
- Pre-evidence predictions: `35a0b99ebb4f5bf0e264033adbdf25218b9f7f03518d1ccc2a8227ed9473c6e9`
- Narrow Node run: `28dbe6bead657f0efbfe6aa236e68e985e9387f94b7fea4e7e06d67061ad06f8`
- Bridge ownership sabotage: `153e10061c228c9216b0bfb21c3252d6e2fe409a5087e89d643670fb5517d482`
- Deferred-audit sabotage: `490acdd95484f28199a157dba91bd65d558f6b218b9603f93bf6d380c9aab877`
- Static harness audit: `7ad08c6c7f53341ecb4ae2c3c3f5618c4f55cf4a6886137b47a100cc36959b99`

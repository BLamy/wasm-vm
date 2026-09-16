# E5.5-T03au independent verifier predictions

Written before inspecting any AU captured pixels or worker conclusions. Starting
head is activation `81527e42`; AT was verified at `376e0992`. This is a local,
medium-risk diagnostic. There is no responsive-desktop acceptance in this task.

1. **P1 provenance and unchanged product.** The recording will serve AT WASM
   SHA256 `7d7b300003cf68076c28958694062dacf3c879efe921bc631bade568ee143bdf`
   and the AR kernel, RAM snapshot, and disk delta pinned by the existing guards.
   The implementation diff will touch harness/fixtures only. It will not change
   input, guest configuration, GPU selection, rendering resolution, or budgets.
2. **P2 private observational copies.** A display arriving at the installed
   observer will retain its actual time, local receipt sequence, scanout, format,
   resource dimensions and rectangle. The stored pixel bytes must be independent
   of the original buffer and metadata. Mutating/transferring the original after
   receipt cannot change evidence. Original worker events and outbound transfer
   lists must remain unchanged. Disabled observation must retain no frame bytes.
3. **P3 finite capture and cleanup.** An adversarial excess frame count/byte
   count cannot exceed the fixed retention budget. Truncation/dropped/invalid
   records must not be silently treated as complete evidence. Export will happen
   after the product verdict and within the original 30-second cleanup window;
   disposal clears private retention and the browser is closed.
4. **P4 actual response provenance.** Real physical key events and their acks
   will precede an independent exact nonce read after Enter, within 120 seconds.
   Startup/typing/capture remain 300/60/20 seconds. There must be a presented
   post-nonce frame for a decisive final worker-to-canvas attribution; otherwise
   the verdict must state the proof gap.
5. **P5 predicted wire/canvas relation.** Source inspection before pixels shows
   the fixed viewport uses native top-left cropping, never scaling: resource
   1280x832 becomes top 1280x800. Format 2 (`B8G8R8X8_UNORM`) sets alpha to 255;
   little-endian input bytes B,G,R,X become R,G,B,255 in Canvas RGBA. Format 1
   retains alpha (browser premultiplication can round translucent channels).
   `fitFrameToViewport` returns full viewport damage for size mismatch, so each
   such frame independently predicts all visible pixels. On a final completed
   Canvas2D present with format 2 and no intervening frame, independently
   normalized/cropped worker bytes should exactly equal canvas readback. If they
   match yet the real image remains the old prompt, stale pixels were already in
   the incoming worker frame. If they differ, attribution is at presentation or
   capture ordering, and we must not blame an upstream boundary without proof.
6. **P6 scanout distinction.** Inspection shows current presentation accepts
   both numeric and null scanout metadata. A null scanout frame can reach the
   backend, so the diagnostic must retain this distinction and cannot assume
   every received frame is the intended bound output. The actual selected frame
   and later receipt ordering must be explicit.
7. **P7 bounded novel attack.** Use a frame containing nontrivial BGRA bytes,
   nonzero X padding, nonzero rectangle origin, and an off-viewport sentinel.
   Transfer/detach or mutate original pixel and metadata storage after receipt.
   Private evidence must keep the original bytes/metadata; independent crop and
   normalization must exclude the sentinel. A mutation/drop of the captured
   matching frame must either change the comparison result or produce an
   evidence-gap result, never the same claimed match.
8. **P8 product honesty.** Personally inspect the real PNG. A nonce, frame
   count increment, byte match, or successful diagnostic command must never be
   described as desktop responsiveness. Preserve AT's old image and keep Q gated
   on a later uninstrumented physical and visible pass.

Read before these predictions: AGENTS.md, full AU task, AT runtime manifest,
`web/src/sink/{presentation,viewport,canvas2d,present-backend}.js`, and the
display callback in `web/linux-worker-protocol.js`. No AU evidence inspected.

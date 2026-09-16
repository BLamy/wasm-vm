# AS r1: physical command passes; visible response fails

Frozen head3d9520ba0cdc67e94fc099625b718d261a0bc07d. All38 affected harness
tests passed; the original-budget physical run completed and closed normally.
AO runtime and the exact verified AR pair are unchanged.

Physical input is now proven:128 trusted DOM key events match128 keyboard calls
and128 ordered sync acknowledgments. Enter22:21:18.520Z; independent readback
returns exact nonce9068f97544f92247 at22:22:43.312Z, 84.792 seconds after Enter
and before Enter+120s. The filename08178bcacc65db37 is independently random.
26 reads complete, none pending; only the physical command carries the nonce.

I personally viewed prepared-direct.png and desktop-keyboard.png. The latter
(SHA431be977157bf77dcd21ca8bf3b640bce9e02dc8c54f09a30d58af78a8195b24)
still shows only the empty old prompt. The typed command and returned prompt
are absent. Thus desktopAcceptance=false remains correct despite the narrower
machine check passing on nonce plus frame counters3→4.

Measured next proof action: take a new presentation baseline AFTER the nonce
response, then demand a subsequently presented frame within the SAME20-second
capture budget. Reserve2 seconds inside that budget for a real failure image.
The first run compared frames to the pre-input state, so a frame rendered before
command execution could satisfy its freshness check. This proof correction does
not alter kernel, runtime, pair, physical sequence, or any product deadline.
Preserve r1's physical success; the next actual image still requires personal
inspection. Q remains gated on visible response.

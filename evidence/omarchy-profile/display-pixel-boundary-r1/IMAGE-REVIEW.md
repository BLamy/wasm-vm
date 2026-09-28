# Worker image and boundary review

Frozen source: `560096cbc640e0523778217c01c7c7ad37780473`.

The worker personally viewed `response/desktop/desktop-keyboard.png`. It shows
the original empty terminal prompt, without the physically typed command or
returned prompt. Its SHA256 remains
`431be977157bf77dcd21ca8bf3b640bce9e02dc8c54f09a30d58af78a8195b24`.
Desktop responsiveness therefore still fails.

Physical nonce `31f4b69996bdd329` executed in 90.187 seconds after Enter;
the independent readback uses `/tmp/desktop-keys-522a5794746c1bb9`.
The original response and capture budgets are unchanged. The real image was
captured within 16 seconds of nonce confirmation. Cleanup finished normally.

All five observed frames belong to scanout 0, format 2, 1280 by 832 pixels.
The last frame arrived after nonce confirmation. No frames were evicted, and
all five were successfully presented with zero pending at canvas readback.
Frame 4 and frame 5 have identical complete raw buffers, SHA256
`c40efc5e5c8d199a4ab1e8c8f7015bc4b64a6a93c35340f13db5ea1ec725495b`.
Top-left cropping to the actual 1280 by 800 viewport and converting BGRX to
RGBA produces the exact actual canvas bytes, SHA256
`8938e2a32c3293dfef777fa2389fd331784dd77b9dd489ecf1d786f276ca92c4`.
No partially transparent pixels complicate this comparison.

This recording excludes browser presentation loss and unbound scanout traffic
as explanations for this stale image. It does not yet distinguish a late guest
render from stale pixels earlier in the guest/device path. The next diagnostic
must examine that upstream timing; changing the canvas cannot resolve this
observed boundary. No runtime, boot artifact, or product deadline changed.

Validation: the frozen `make verify-E5_5-T03au` passed all 39 affected recorder
tests and the actual diagnostic with the unchanged AT runtime and AR pair.
An earlier sandbox test invocation passed 38 tests but its existing local HTTP
selftest was denied `listen EPERM`; rerunning with authorized local network
access passed all 39. No broad runtime proof or new deployment is claimed.

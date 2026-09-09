# Closed attempt: setup/oracle failure, no timing result

Main ran exactly `env -u RUSTDOCFLAGS node evidence/e5-t26f/audit-elided-76eca30b/run.mjs`
at frozen HEAD `76eca30b248268e130395c53cb09da62637388a7`. The child and launcher both
exit1. This is not the two-second cap failure and is not F acceptance.

The copied baseline authenticated, physical setup delivered2458 matching key/DOM events,
and the derived snapshot retained PREPARED sound with zero pending PCM/transfers/events.
The derived envelope `dcad9779c62575c0d13c5898f5a5edc8dc75d6944b8052ddf117b6d2b6386e29`
is2634936 bytes, CRC `ed483032`; reload's first-present CRC matches, with fresh agent HELLO
and no cold boot. Delayed-gesture locked samples contain zero PCM. A real cursor renders
at684,392 (94 matched pixels) and audio unlock completes.

At `quiet-text:baseline`, the unchanged inherited `readTopmostDragTitlebar` returns no
titlebar. `typeQuietTextCommand` throws before typing play. `postRestoreStart` is
985.8550000190735, but there is **no postRestoreEnd** and no fresh playback/completion proof.
The launcher's expected success/cap raw lookup fails rather than fabricating a timing result.
All actual failure artifacts and the failed attempt remain retained.

Main viewed both PNGs: the cleared upper terminal contains the readiness text at its top;
the lower terminal's old success token remains outside the intended upper region. This
visual observation motivates inspection of the detector, not a proven latency cause.

After closure, Main checked all invocation source pins: no drift; HEAD unchanged; generated
driver remains `6679ef040cdce8d4a3a67a4ce02f08c87188ed049fb8f1e0835292020ffae133`.
Raw failure SHA256: `04441cae09b3c2df12b8f1703c9848e6b6a086ef8aff631bc42d25aa982c7ea1`.
Failure PNG SHA256: `80ee82a2385afd431050fb803634bb69748b8199eb3d84bd751d7a32ab7edc2d`.
Prepared PNG SHA256: `9d594bbbd2704e853ae8ed9bb114b1ba0953e0e1b947cc47d1b035f242801ed8`.
Run log SHA256: `7bae69d9f2c7723b1a035382ebad6f9b61c3538417f3938c5115f1e8e368842b`.

Every diagnostic remains `acceptance:false`, `fVerified:false`,
`postIdentityValidated:false`. No production, image, runtime or original sealed-profile
mutation occurred. No combined validation/reporting materiality conclusion is available.

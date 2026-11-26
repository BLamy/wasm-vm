---
id: E5-T39
epic: 5
title: Show a boot failure on the desktop page instead of a black screen
priority: 0.387662
status: pending
depends_on: [E4-T40d]
estimate: S
risk: low
capstone: false
---

## Boundary

`web/` desktop-mode page only (`?desktop=1`).

Found by the E4-T40d verifier: when the boot fails before a machine exists (for example
`?decodedCacheEntries=65536`, refused by validation 0.57 s after load), the desktop page stays
black. The error reaches only the hidden `#status` element and the `wvm:guest-error` event.
Show the failure where the user is looking: the boot overlay should end in an error state with
the message and a reload control. This predates E4-T40d.

## Deterministic acceptance

A Playwright run loading `?guest=replay-desktop&desktop=1&decodedCacheEntries=65536` finds a
visible element containing the validation error within 5 s and no running guest; a normal
load still reaches the desktop with the overlay hidden.

## Adversarial verification

Low risk: inspect the direct result.

## Verification log

---
id: E5-T34d
epic: 5
title: Surface whole-image prefill failures on the Replay desktop boot overlay
priority: 0.3874
status: pending
depends_on: [E5-T34c]
estimate: S
risk: low
capstone: false
---

## Boundary

Follow-up from the E5-T34c verifier's corrupt-image attack. With a right-sized
image of the wrong SHA-256 served, the prefill correctly fails closed: no chunk or
Range fallback and no kernel start. But the Replay desktop overlay stays on
"Booting Replay desktop…" indefinitely and shows no error. Route the prefill or
whole-image integrity failure to a visible, specific error on the desktop boot
overlay and in the boot state. Do not change the fail-closed behaviour.

## Deterministic acceptance

A Playwright run of the built page serves a corrupted `.img.gz`, then a truncated
one. Each must show a visible error naming the integrity or size failure within the
download time plus a bounded margin, make zero chunk or Range requests, and produce
no unhandled console errors other than the reported failure.

## Adversarial verification

Low risk: inspect the direct result.

## Verification log

(empty)

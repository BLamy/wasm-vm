---
id: E5-T43g
epic: 5
title: The page shows when the relay closes the Replay desktop's network
priority: 0.3876633
status: pending
depends_on: [E5-T43f]
estimate: S
risk: medium
capstone: false
---

## Boundary

The browser WebSocket transport's closed state reaches the page (worker status to the network chip);
the Replay desktop shows that the network is gone. No reconnect (the token has expired by then);
a reload brings it back.

## Deterministic acceptance

Moved here from E5-T43a's round-4 verifier, which needs the online page: a desktop left untouched for
31 minutes has its relay session closed by the 30-minute idle limit; the page shows that the network
is gone (the relay's Close reaches it); a reload brings it back (`node` fetch 200 again).

## Adversarial verification

Medium risk. Attack list: a session in use past the token's 10-minute lifetime keeps working (the
token is checked only at HELLO); the relay restarting under an open session; the indicator on a
page that never had networking (`?net=0`) says off, not gone.

## Verification log

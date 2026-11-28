# E5-T43a round 4 — verifier predictions (written before any run)

Head `091cb8ab1` (claim), code `edaf2824b`, refutation `22765c88a`. Live: https://wasm-vm-relay.brett-lamy.workers.dev (`relay-5`).
Read so far: task file, `git diff 22765c88a..HEAD -- crates deploy`, `driver.rs` run loop and quota paths, r3 scripts.

## Round 3 demand (1): finished connections are dropped
- S1 local (native wvrelay at this head, loopback, throwaway secret; r3 `local-hold.mjs` adapted): every finished
  connection whose client never answers Close — no HELLO (Close at ~10.0 s), refused at the per-client cap (Close at ~0 s),
  and an authenticated session ended by a protocol error (an undecodable frame) — is ended by the server's TCP FIN/RST
  within Close + CLOSE_GRACE (2 s) + 0.5 s. At 62 s, server-side ESTABLISHED sockets = live sessions only (4), not 4 + N.
- S2 live (raw TLS, never answers Close): the client receives exactly one WebSocket Close frame (relay's), then nothing
  more and no TCP end within 30 s (as the worker says; the edge holds the client half). Prediction for the distinguisher:
  after the container side is gone, binary frames the raw client sends (a valid HELLO, an OPEN) produce NO further bytes
  (no relay HELLO, no OPEN_OK) — a held edge connection cannot reach wvrelay again.
- S3 live: while N=16 raw never-answering finished connections are held at the edge, 4 new authenticated sessions from this
  client are served and one gets HTTP 200 from example.com:80; a 5th is refused (the held ones take no place).
  Caveat (stated now): refused/no-HELLO connections never took a place even in round 3, so S3 cannot by itself prove the
  container dropped them; the proof of the container drop is S1 + the deployed binary being the round-4 build (S4).
- S4 the gitignored `deploy/cloudflare-relay/wvrelay` contains the round-4-only string `relay_session_idle_closed`.

## Round 3 demand (2): per-client cap proven per client
- C1 unit `the_session_cap_is_per_client_name` passes; mutants "header ignored" and "no length limit" are KILLED.
- C2 an EMPTY `x-wvrelay-client:` header is not tested (the filter `!value.is_empty()`); a mutant dropping that half
  SURVIVES. (Minor; the Worker never sends an empty header.)
- C3 live from a second address: this machine has no IPv6 and one IPv4 egress, so I predict I cannot run it. If so: NEEDS
  EVIDENCE stays open on the live half only, unless the code read of the Worker + unit proof is judged sufficient.

## Round 3 demand (3): bytes over time and the idle lockout
- B1 user decision recorded in the file ("Add both caps"). HELD as acceptance of the hourly byte cap + 30-min idle close.
- B2 hourly window is a fixed clock hour, not sliding: a client can move up to 2 × 5 GiB within seconds across an hour
  boundary (H:59:59 / H+1:00:00). The claim says "per clock hour", so this is consistent; observation, not refuting.
- B3 unit `a_client_byte_budget_per_clock_hour` kills: `<=`→`<`, no retain (never resets), hour = now/86400.
- B4 the idle timer: a session that sends only WINDOW frames (no bytes) is kept indefinitely (any decoded inbound frame
  refreshes `last_activity`); a session that sends nothing is closed by the relay between 30:00 and 30:30 after its last
  frame (ws close code 1000 at the client). Live run: 4 sessions (A idle with an open stream, D idle without, B and C
  WINDOW every 5 min). At ~31 min A and D are closed, B and C open; two new sessions are then served and a third refused
  (A's and D's places freed by the idle close).
- B5 idle close takes the same exit path as a client disconnect (break → reap streams → release_all_quota_streams →
  close_session). Mutant "idle break → return (skip cleanup)" — I predict it SURVIVES the suite (no test checks the place
  or the token streams after an idle close). Sufficiency gap if so.
- B6 mutant "outbound data does not refresh activity" (remove the refresh in record_quota_bytes) SURVIVES (the active-session
  test only sends inbound frames).
- B7 1024 total as a lockout: the claim states "256 IPv4 addresses (or /48s) each holding 4 sessions can still fill all
  1024 places". With the idle limit the attacker needs one frame per session per < 30 min — trivial. Stated: HELD as a
  stated limit. Whether 1024 × 64 streams fits one basic container is not measured by anyone (not checked; no load).

## Worker's six mutants (rerun, scratch copy)
- M1 no forced close, M2 client header ignored, M3 no header length limit, M4 idle check never closes, M5 client bytes not
  checked, M6 inbound frames do not refresh activity: all KILLED.

## Gates
- G1 `cargo test -p wasm-vm-slirp --features native --lib` 277 passed; wvrelay smoke/token-rejection pass; clippy clean.
- G2 smoke.mjs against live passes (happy path, refusals) — carried forward from rounds 1–3 if it passes again.
- G3 no secret value in the round-4 diff or my evidence.

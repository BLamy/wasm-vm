# T03l actual observation — service isolation held, desktop input unproven

Command: `node tools/verify/omarchy-desktop-services.mjs evidence/omarchy-profile/desktop-services-r1`

Recorded head: `3f80aa9cd0843662d4c1764a425d051ec8efb489`.
Runtime/dist: `ed550aa8`, unchanged by the subsequent recorder/test corrections.
The pinned R3 image/pair, divider64, LP1, JIT512, cache4096/repack-off24 and
recyclingOFF remained unchanged. Profiling and admission observation were off.

The300-second startup interval was08:47:31.376–08:52:31.376 UTC on2026-09-14.
The actual desktop-ready event occurred at211.898 seconds. The subsequent
recorder-only mapped-client query did not finish by the startup deadline.
The child and parent exited1, normal owned cleanup completed by08:52:32.161,
and the watchdog did not fire. **No physical keys were attempted**; this did
not exercise the120-second input acceptance. It is not a usability success.

The winning session was `{key:"omarchy",generation:1}`. Raw Worker traffic has
zero `sendAgentInput` calls and no Explorer/container RPCs. Only the real
layers query and the recorder's clients query reached the serial bridge:

- Layers sent08:47:46.618; actual BEGIN08:48:18.389;
  END08:51:03.276, exit0. BEGIN→END164.887 seconds.
- Clients sent08:51:20.227; actual BEGIN08:51:28.741; no END by the cap.

Final state:2 received/presented frames, zero pending/dropped presentation
frames,2,111,984,581 retired instructions,285.075 seconds spent inside VM
slices, zero fetch-wait time, no application errors. VM slice time is elapsed
time, not CPU-utilization attribution. These results identify neither a full
root cause nor a performance improvement over T03k.

The coordinator personally opened the intermediate, desktop and failure PNGs.
The final screenshots visibly show the Omarchy bar and Foot terminal with no
overlay; both hash to
`97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f`.
This matches the prior final desktop image and does not prove new input.

`node evidence/omarchy-profile/desktop-services-r1/audit.mjs` independently
checks the recorded source/helper hashes against Git at the frozen head,
93 served bodies/86 requested resources, R3 pins, policy, deadlines, raw
traffic and PNG hashes. Output is `audit.json`; the report SHA-256 is
`904c0125317ca9b8093768223050c085ac861a1565ec2d316c88af8237ad9aa1`.
The first offline audit expected an explicit null optional exit-error field;
it was corrected to accept the absent no-error field. No browser was rerun.

The real CLI-r4 recording separately passed with the same runtime: BusyBox
fast restore, actual/root Explorer, RPC arithmetic/serialization/nonzero exit,
wrong-nonce rejection, streaming and stop-barrier recovery. It finished in
27.858 seconds with no browser errors; process exit0 and no surviving owned
browser/server were observed. Its screenshot and report are under
`../desktop-services-gates/cli-r4/`.

The service fix is submitted for independent review. The broader T03d goal
remains unresolved; no production promotion, merge, or Epic6 work occurred.

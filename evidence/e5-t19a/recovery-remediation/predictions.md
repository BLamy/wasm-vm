# E5-T19a PCM recovery remediation — pre-evidence predictions

Recorded after orienting on the full `6a21a0be..9e8e1c22` diff and before reading worker gate evidence. Runtime/code freeze: `9e8e1c22423f935e2e918a687cc6633e1356869c`. This is an interim review: Tesla's supplemental capture-release test and final exact-head submission are still pending, so no clean clone or verdict is due yet.

Scoped identity:

- implementation/test/Makefile diff SHA-256: `67d9db4c66aadc30bfe45fe9988ba00dfbca0bed8ec7c24dbe87a2bdce83f6eb`
- `snd/mod.rs` SHA-256: `7e70cdd9774499a217ee6a57e81a67dcfee513e978521409b0b8b5f097b94802`
- `snd/snapshot.rs` SHA-256: `78664c364542ea7099bcf038737832d950ad39954e8312d8c963b28043cc1115`
- `virtio_snd.rs` SHA-256: `8fca257d2cd3d90d0db7654951454d5135a493508d6be8fc9feca0e1688de357`
- `desktop_machine_audio_resume.rs` SHA-256: `e11839d5d5b89adc3b65f5f788adf1de2c6030a5a4a22f53f2abb2c2c19b8412`
- `Makefile` SHA-256: `3db96c981343a11ba99f9c8cffe32bedfbd9eeeea01ba987a0a5be76d20fce43`

Predictions:

1. **Full OASIS table.** The independently transcribed 5-state/6-request matrix accepts the four formerly wrong cells: Released/PREPARE, SetParams/SET_PARAMS, Prepared/SET_PARAMS, and Prepared/PREPARE. Every accepted request reaches its command-defined next state; every rejected cell preserves byte-exact state.
2. **Never-configured distinction.** Although the configured Released row permits PREPARE, power-on, reset, and disabled-capture streams have no retained parameters and reject PREPARE atomically. A legal SET_PARAMS remains usable immediately afterward.
3. **Linux recovery and fresh output.** Real control/event/TX queues reproduce successful PCM, XRUN, STOP, RELEASE, and PREPARE without another SET_PARAMS; the retained configuration then drives a new, exactly-once, bit-exact PCM period into the live sink.
4. **Repeated setup remains bounded.** Repeated valid SET_PARAMS/PREPARE works at minimum and maximum legal buffer/period boundaries. Invalid IDs, truncations, rates, formats, alignment, padding, and host-rate mismatches remain BAD_MSG without changing lifecycle state, retained parameters, pending transfers, or codec bytes. SET_PARAMS while I/O remains pending is rejected.
5. **RELEASE response ordering.** For playback and capture, accepted RELEASE drains all pending I/O and publishes their used entries/status before the RELEASE response is written or acknowledged. A following PREPARE in the same controlq drain sees zero pending I/O and retained parameters. The aliased-response fixture must fail if response publication is moved before the flush.
6. **Codec compatibility and atomicity.** Sound snapshot wire version remains 1. Old Released-without-params payloads remain accepted; configured Released-with-params round-trips for enabled output/capture; malformed retained parameters, missing parameters in non-Released states, and disabled-capture retained state are rejected before mutation. Reset and capture disable erase retained configuration.
7. **Capture symmetry is not yet proven.** The frozen runtime implements capture flushing, but final sufficiency waits for Tesla's real pending-capture RELEASE/ACK/PREPARE fixture. Playback-only evidence cannot close this changed branch.
8. **Sabotage and novel attack.** Reinstating parameter erasure on RELEASE must fail Linux recovery/codec tests. Independently, a valid retained configuration followed by a rejected repeated SET_PARAMS must still allow PREPARE and fresh PCM; this guards against partial mutation not visible in a status-only matrix.
9. **Submission boundary.** The 49-test integration claim and 8/8 codec precheck are provisional. Final assessment requires the committed supplemental capture fixture, exact-head `make verify-E5-T19a`, one effective sabotage, the bounded novel attack, and exactly one scrubbed local clean clone. The unrelated GPU test feature configuration is outside this remediation.

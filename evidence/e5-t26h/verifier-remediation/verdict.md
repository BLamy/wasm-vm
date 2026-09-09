# E5-T26h remediation verdict

VERDICT: refuted

Frozen remediation: `611e0f34952106bbafef828c304d697d20c34da3`.

The two original refutations are repaired, and legacy prevalidation/shared sparse parsing hold.
The related new attack fails: an actual T23d HELLO frame posted to the agent transmit ring before
save is re-armed after resume, delivered into the fresh host generation, and accepted by
`confirm_virtio_console_agent_hello`. This violates the stale-session-byte/fresh-HELLO boundary.

Required remediation: preserve descriptor completion plus control-transmit and serial-transmit
continuity, but discard the pending agent descriptor's pre-resume application-session TX payload
before `stage_agent_output` forwards it into the fresh Channel. Require a HELLO generated after
resume before `agent_ready_for_restore` can become true.

Evidence digests:

- worker remediation: `07d8a5beb3e2f9ea8ddac8b5e18f380cc4e4cfbed7d538951c06b7b97b2d26ef`
- focused regressions: `21918cf2f591ff07089bc7e62231ec51ce742a2e364726c1ef5889eb3f0e5da9`
- stale pending HELLO: `bf6bf7034b5da0f6bccec9fcd20b4a3fdec76f35af7c99667aa8be5d890490d6`
- predictions: `1fc8723bc0c6da3b40d45f2a5b408ceb9955f6153274006eb929fc993b4d1e1b`
- promoted critic test: `3bce55401cc6827c6ab3909d3bc68bfa7e65351ac15dfedd54521b059f43d474`

# E5-T26p isolated reservation-effect sabotage r1

Scratch is a `git archive` extraction, not a clone:
`/private/tmp/e5-t26p-verifier-sabotage.TO5uZI`, archived from
`d7d308a58825e6856db532822e36e1681230027a` and overlaid only with the frozen three runtime
files and final producer.

Pre-mutation pins:

```text
ab15c6a854441fc99f28a3c2e34d60fea3c5d2450d2db3577f1b185a7be7cd39  crates/core/src/hart/mod.rs
9e2d235163d528112ab0375886e2bdf4e602c0dbdceaf7e486abad0b6d78b053  crates/core/src/lib.rs
676941521e8882e17b242384ce7d2a737918750b46ec6b302f120d5cfaa92034  crates/wasm/src/lib.rs
62ce60205676c1ed59b2e11395c36337278cdd65d6fd9d4f56be4a4e13e7c5c9  crates/core/examples/retirement_capture_baseline.rs
```

Single mutation: remove only `self.resv = None` from the shared successful-store overlap block
after `execute`'s instruction match. Mutant Hart SHA-256:
`8e15f642b054c021e99e1c6579624071ee4053ce7fd7328ffff7928d99078a1d`.
The SC.W/SC.D arm-local reservation consumption remains present before each fallible store at
scratch lines 1550 and 1570.

Expected result: the producer must fail an independent overlap-reservation assertion, or its
stdout must differ from old-source golden
`5587b4d8fc786ea48a87a2c004466fe7fb2b9a7630c408548fcb264414446cc2`.
Afterward the scratch Hart file must be restored to the pre-mutation hash. No workspace runtime
file may change.

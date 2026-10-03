# Independent binding predictions (before worker outputs)

Parent: E6-T12e4c1 independent verifier. This helper read the task, runtime diff,
and the two historical fixture diffs before opening any worker or cold results.

1. Exactly six formerly unsupported complete input texts become supported: the
   two raw FSLT cases and the four integer FSLT/FSGE cases. New positive fixtures
   preserve those texts and stage fields byte for byte, explicitly identify their
   parent source and name, and carry the new v3 profile.
2. Each of the six historical replacement negatives changes only the relevant
   opcode/name (FSLT -> FSEQ, FSGE -> FSNE), retains the original stage and error
   expectation, and rejects with the original complete error object. All other
   historical fixtures and their complete translation results remain exact.
3. Existing historical receipt implementations remain unchanged. Any new adapter
   carries unchanged results only by concrete fixture identity and digest, never
   by weakening earlier success/error or coverage assertions.
4. Frozen worker and cold reports bind the intended commit, every source and
   artifact they cite, complete byte digests, actual native/browser executable
   coverage, and actual failure/recovery records. Current runtime source equals
   frozen evidence source. Cold starts and ends clean with a scrubbed environment.
5. Any shared prior evidence is carried only where code, dependency boundaries,
   and evidence digests are unchanged. Newly accepted inputs receive fresh proof;
   all 19 original inputs retain their previous complete results.
6. The recorded acceptance command, counts, bounds, and production-disabled claim
   agree with the task and checked evidence. Missing proof is reported rather
   than inferred from a successful script exit.

Each prediction will be marked HELD, FAILED, or NEEDS EVIDENCE with concrete file,
line, and digest citations in binding-notes.md and binding-audit.json.

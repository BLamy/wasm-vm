# Defensive-path predictions before additional execution

The first changed-range audit left six exception/idempotency ranges. The following
faults affect trusted host capabilities only, never substitute GPU bytes or signals.

- A staged read release that deletes native objects and then throws must return a
  structured backend error while still releasing charged scratch/references.
  Store disposal must aggregate the same error and finish clearing all accesses.
- Repeating the backend's release of an already released read must do nothing;
  the second call must not delete any additional GL object.
- A trusted fence allocator throwing a programmer exception propagates that exact
  exception both during ordinary final fencing and while fencing a semantic
  failure. Explicit disposal afterward releases renderer ownership.
- A one-shot Uint8Array allocation exception during the moved synchronous gather
  path propagates unchanged and returns the scratch reservation before publication.

The normal APIs and actual GL objects remain in use around each injected failure.

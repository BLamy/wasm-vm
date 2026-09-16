# Changed-hunk sufficiency

Frozen implementation: `9cc377180921be98f904c3689a1d7c48b9df3947`.
The actual recording is a negative input result. Synthetic tests establish
harness behavior only and never establish guest response.

| Changed scope | Execution or disposition |
| --- | --- |
| `omarchy-prepared-direct-state.mjs:6–24`, immutable pins and source validator | The actual wrapper and child both accept the exact independently hashed AJ pair. The novel attack rejects old and mixed pairs; the recorded worker test checks every size/hash and image shape. Constants/import declarations are exercised by their consumers. |
| State helper `:27–41`, eight-property/active-Foot parser | Actual raw reply proves every affirmative scalar and exact Foot field. Worker tests plus the independent partial-wire attack cover false/missing/error/extra content, altered Foot, and receipt-versus-wire disagreement. |
| State helper `:43–56`, bounded read request | Actual request runs once, within the original startup deadline. The independently rerun pure tests execute expired and late responses and the error/finally paths. |
| State helper `:58–88`, wire audit and classification | Actual confirmed configuration passes. Pure tests execute not-reached and unproven configuration paths and reject physical input after failed configuration. Independent attack rejects forged/partial and late wire. |
| `omarchy-prepared-direct-input.mjs:16–70`, wrapper | Actual pair/WASM checks, clean environment, spawn, owned close, raw audit, original presentation, after-Enter fence, and explicit nonacceptance all execute. `wrapper-test.mjs` executes the actual wrapper body with synthetic I/O for wrong pair size/hash, wrong WASM, watchdog cleanup, auditor exception, late fence, negative, and synthetic positive paths. It verifies both successful orchestration paths still require personal image inspection. |
| `omarchy-desktop-live.mjs` prepared flag/source/scope/report additions and `:1237–1242`, `:1292`, `:1320`, cleanup | Actual report has prepared mode, frozen helper identities, exact prepared source, one saved-property read, original presentation, the prepared screenshot, complete physical sequence, acknowledged input fence, and owned browser client close. Actual-source user-input fixtures separately execute the new synthetic success path, bad properties, late readback, and stale presentation. |
| `omarchy-input-audit.mjs:7,12–14,30–31` | Actual prepared negative and independent synthetic complete control execute the new trusted-mode/source branch. Wrong opt-in and mixed-pair attacks reject. `audit-source.py` proves all earlier physical/deadline/nonce audit statements are unchanged from AI. |
| Fixture bindings and new tests | Worker frozen 73-test run passes without skips, plus two syntax checks. Verifier independently reran the 14 pure prepared-state/actual-source user-input tests; all pass. No browser is created by those fixtures. |
| Task/gate scripts and metadata | `record.py` and `freeze.py` match frozen Git bytes; timestamps prove gates and freeze preceded the actual launch. Task and claim text are metadata, audited against raw evidence. |

No changed executable hunk remains unsupported for the bounded diagnostic.
Existing runtime, serialized pair format, physical wire capture, cold-clone,
and deployment evidence carry by the identities in `prerequisites.json` and
`source-audit.json`. No new runtime, deployment, or responsiveness claim is made.

## Permanent artifact

Keep the committed prepared-state tests and actual-source prepared-input
fixture. The independent attack is a reproducible verifier artifact; it adds
no production behavior. The exact failed run is retained as a measured
control for a separately activated follow-up.

## Verifier fixture corrections

The source scanner initially resolved a browser `Runtime.evaluate` import as
a Node file; the wrapper fixture initially omitted one object-closing brace.
Both verifier-only errors were corrected and rerun successfully. Their causes
are preserved in `source-audit-correction.json` and
`wrapper-fixture-correction.json`; neither changed worker code or evidence.

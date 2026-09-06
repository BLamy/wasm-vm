# Visual inspection

- `evidence/e5-t25a/browser/chromium-gated.png`: decoded at its original resolution and
  visually inspected. The wasm-vm roadmap page renders without a blank/error overlay; header,
  progress panel, filters, timeline, and task rows are legible.
- `evidence/e5-t25a/demo/demo-suite.png`: decoded at its original resolution and visually
  inspected. The demo shows TOTAL 126, PASSED 126, FAILED 0, DONE 126, green test groups,
  and the verified E5-T22g roadmap detail. No visual crash or error overlay is present.

The visual observations are supplementary. Exact counters and empty browser/HTTP error arrays
come from the hashed JSON in `integrity-results.json:91-99`.

# T03 narrow publication-harness predictions

Written after reading diff 54a270afbd17758e4edddb4f332123fc5d380037 and before opening the corrected public-run result. Carry all P1–P9 product/cold results forward: runtime, dependencies and promoted critic helper are unchanged since c51133ca.

- H1 — A 304 for a selected public path is accepted only after this run has SHA-verified an HTTP-200 response body for that same path against the committed local dist. The revalidation receipt retains its exact URL and previously verified hash. A fresh 304 without such a body, a wrong 200 body, or another failure status still records an error.
- H2 — Only an error whose exact console location URL equals https://wasm-vm.pages.dev/favicon.ico and whose text contains status 404 is exempted, and it remains recorded under ignoredFaviconErrors. Script errors mentioning favicon/404, another origin/path/query, and favicon 500 remain failures. Raw new trace console errors will contain no non-exempt error.
- H3 — The corrected process exits normally after saving trace, precise coverage, report and the closed persistent profile. The finalizer closes the owning persistent context once; it no longer calls Browser.close on its already-closed browser.
- H4 — The corrected public result remains non-development, binds exact harness head 54a270af, reports status passed, 127/0 CPU suite, four actual crash cuts, twenty two-tab races, all promoted critic cases and the existing retained-factory restore/fresh draw. The runtime/source digests remain those already proven. No new cold clone or unrelated gates are needed.
- H5 — All 59 selected public file hashes in the independent publication byte receipt match deployed/local dist, including retained runtime files. The permitted HTTP-304 and favicon-404 changes explain the earlier checker failure without masking a product failure.

Before inspecting the corrected result, use the exact source callbacks in an isolated Node VM to test the H1/H2 reject/accept boundaries. This leaves source, runtime, tracked tests and the ongoing browser run untouched.

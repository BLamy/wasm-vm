# Website and Docstream implementation

This change runs in the isolated `codex/website-docstream` worktree at `/Users/blamy/.codex/worktrees/website-docstream/wasm-vm`. The documentation publication baseline is `2691b24e6c00478f8d69f81180b6827761de246a`. Authored guides come from the new source files; every reference and archive digest comes from immutable Git blobs at that baseline, even when a later integration checkout contains newer task records.

## Product result

The marketing root uses an editorial layout, real guest-launcher entry points, nearby evidence and raw measurements, and an interactive Three.js cutaway of CPU, RAM, virtual devices and the Linux guest. It is an actual perspective scene with solid meshes, material shading, lights, instanced pins, physical selection outlines and layer movement. It explains the host/guest architecture; it does not purport to execute guest GPU commands.

The original background fragment shader is byte-identical, SHA-256 `7c02808459cd4af76ec975490232d401bf5b77d58729eb77b51e7f78a05d6742`. Its lifecycle now follows reduced motion, visibility and the scene's pause button. Both scenes cap rendering at 30 frames per second. The cutaway caps pixel ratio at 1 on mobile and 1.5 on desktop, pauses offscreen, and retains text controls when WebGL is unavailable. That rendering budget is an implementation setting, not a guest performance claim.

Products, security, work market and roadmap clearly distinguish the existing machine from proposed ProofMesh surfaces. Native diagnostic rates, browser workload campaigns, unavailable cells and selected network providers keep their original scopes. No raw benchmark JSON or runner was edited.

## Docstream release and features

The official npm `latest` tag was checked on 2026-10-13 and resolves to exact `@brett_lamy/docstream@1.8.0`. The package integrity is `sha512-6NcNuwY8yllre6A3rRoofwFR2fl+cd9a86eCXoO6D7j7XW2ANUbocsNbvN1VS9UT/PvSyyZHbyWZ7+E+8w/D+A==`.

Primary sources: [npm release](https://www.npmjs.com/package/@brett_lamy/docstream/v/1.8.0), [official registry](https://registry.npmjs.org/@brett_lamy/docstream), and the installed release README/declaration files. Copies of the registry metadata and README are retained in `design/sources`.

The implementation uses `DocsRenderer`, lossless `parseMarkdown` / `serializeMarkdown`, `documentOutline`, `DocPageActions`, named code fences, hints, tabs, steppers, expandables and `content-ref` navigation. A file-backed architecture demo uses a read-only resolver exposing its actual React source, with Linux and bare-metal entry-point controls. It does not boot an arbitrary playground runtime or share a page to an AI service. Heavy syntax, diagram, math and replay features remain in lazy chunks; `features/` avoids the existing service worker's reserved disk `chunks/` path.

The reader provides full-body search, reference-subject filtering, source/Markdown access, page outlines, legacy URL aliases, mobile navigation, unknown-page recovery and a searchable archive ledger. The generated corpus includes 15 guide pages (14 handwritten field guides plus generated coverage) and 139 complete references: 154 rendered pages. Every one of the 1,533 baseline prose files has a document-by-document disposition: 110 rewritten publications, 1,879 preserved records (including 456 auxiliary legal/specification/trace records), plus six obsolete static web documentation pages with working replacements.

`design/documentation-migration.json` is the complete ledger. Current user/contributor guides are newly written; complete reference publications gain Docstream structure, named code, resolved navigation, related guides and provenance without losing technical paragraphs. Task state, verification logs, operating policy, protocol byte contracts, legal/provenance, upstream specifications and dated measurements retain their exact authoritative sources. Historical graphics, shader prerequisites, container audits/surveys and retired rr tooling are visibly named snapshots and link to current guides. The reader does not restate old v5 limits as today's graphics API.

## Direct acceptance

Run in this isolated worktree:

```sh
cd web
npm ci --no-audit --no-fund
npm run build:docs
npm run check:docs
```

The receipt `design/docs-validation.json` accounts for all baseline prose blobs, validates every published digest, parses and round-trips all 154 pages byte for byte, checks 225 local links including Docstream content references, and preserves all 181 original reference code blocks. It also compares the original shader source exactly. Changed JavaScript, Python and shell sources pass their syntax parsers.

```sh
node --check tools/build-docs.mjs
node --check tools/check-docs.mjs
node --check web/hero-scene.js
node --check web/landing-page.js
node --check web/landing.js
node --check web/landing-benchmarks.js
bash -n tools/build-web-dist.sh
python3 tools/check-docs-dist.py .design-tmp/dist-smoke/web/dist
```

The assembly smoke uses the exact changed `build-web-dist.sh` and finalizer in `.design-tmp/dist-smoke`, with `make web-build` deliberately replaced by the already present baseline preview Wasm/npm assets. This checks the changed packaging boundary without rebuilding or publishing an older graphics runtime. `design/dist-validation.json` records all 154 production-page hashes, 1,995 ledger entries, unchanged code examples/raw benchmark bytes, app/root route rewriting, vendored Three, actual shipped script cache identities, lazy feature assets and the 25 MiB file boundary. It is an assembly proof, not a new emulator or guest-GPU proof.

## Independent review and evidence

The separate `design_critic` session applies the rubric in `design/BRIEF.md` to rendered screenshots, content, source and live interactions. Round 1 scored 8/25 and demanded concrete changes to model selection, truthful display copy, mobile controls/table affordances and runnable preview packaging. Those changes were implemented. Round 2 found that the Markdown viewer downloaded a file instead of opening text; the fix uses Docstream's built-in text/plain Blob viewer and an explicit separate download. The source-aware titles and bounded auxiliary ledger were also refined. Round 2 scored 5/25 and was refuted for that view defect. Round 3 passed at **4/25**, category scores 1/0/1/1/1, with no blocking finding. Independent evidence and verdicts are retained in `design/reviews`; the failed early captures/selectors are preserved with their rejection or correction, not silently discarded.

The critic's browser fallback is an explicitly owned Playwright Chrome process with its own temporary user-data directory. Parent authorized that fallback when the critic's new session could not resolve IAB. It never attaches to, navigates, terminates or closes the existing graphics browser. It records desktop/mobile screenshots and continuous JSON witnesses, then closes only its own browser. No guest GPU or new performance measurement is run.

## Integration boundary

The pre-commit web rebuild is deliberately deferred with `SKIP_WEB_BUILD=1`, as authorized by the parent coordinating the D63 graphics verifier. This branch does not alter any existing `web/dist`, graphics task, queue, runtime source, PR stack or Cloudflare deployment. The parent integrates these source commits above the continuing graphics stack, builds a coherent final `web/dist`, runs the production packaging check, and deploys that coherent build after its graphics lease releases. This isolated branch must not deploy its older preview Wasm.

## Frozen source and clean build

Marketing source commit: `4ca90eb9`. Documentation/build source commit: `86207221de1dadb79748b341762f37c1980c850e`. The complete source digest manifest is `design/source-digests.json`.

A pristine sparse clone at that exact source head ran pinned `npm ci`, `build:docs` and `check:docs` with `NODE_OPTIONS` / `NPM_CONFIG_NODE_OPTIONS` unset. All 330 generated corpus/bundle files are byte-identical to the reviewed build, and no tracked source changed. `design/cold-docs-validation.json` records the exact commands, checks, file digests and expected generated receipts. This is a clean documentation build proof; it does not claim a newly built emulator or coherent deployed graphics runtime.

## Final independent artifacts

- Final verdict: `design/reviews/critic-03.md`. The preceding failed rounds remain in `critic-01.md` (8/25) and `critic-02.md` (5/25, Markdown view refuted).
- Live final witness: `design/reviews/critic-03-runtime-witness.md`; carried-forward complete flows are in the round-2 launch, reader, controls and boundary witnesses.
- Desktop scene: `design/reviews/critic-03-back-devices.jpg` (1280×720). Mobile scene/reduced motion: `design/reviews/critic-03-reduced-mobile.jpg` (390×844).
- Desktop reader: `design/reviews/critic-03-reader-desktop.jpg` (1280×720). Mobile reader: `design/reviews/critic-02-reader-mobile-live.jpg` (390×844).
- Plain-text view and fallback: `critic-03-markdown-view.jpg` and `critic-03-no-webgl.jpg`.

The independent final checks confirm 1,989 immutable non-obsolete baseline records plus six replaced HTML entries, all complete reference bodies, actual BF-cache scene/control survival, exact Markdown text view, file-backed code, stable reduced-motion captures and a functional no-WebGL fallback. Normal reviewed browser paths record zero console errors; context-creation failures are expected only in the explicitly WebGL-disabled fallback drill. The remaining optional craft improvement is larger mobile source-provenance text/tap targets; the passing reviewer found no blocking defect.

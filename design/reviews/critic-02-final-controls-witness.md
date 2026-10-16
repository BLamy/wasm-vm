# Independent Chrome final control and production-route witness

```json
{
  "started": "2026-10-13T15:22:21.080Z",
  "ownership": {
    "profile": "/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-critic-final-1ck17c",
    "existingChromeAttached": false
  },
  "steps": [
    {
      "step": "TOC recheck",
      "time": "2026-10-13T15:22:22.132Z",
      "url": "http://127.0.0.1:4186/docs.html?review=2-final#product-direction",
      "state": {
        "id": "product-direction",
        "text": "Product direction",
        "top": 1660.578125,
        "bottom": 1693.078125,
        "visible": false
      },
      "links": [
        {
          "text": "Pick a starting point",
          "href": "#pick-a-starting-point"
        },
        {
          "text": "Current scope",
          "href": "#current-scope"
        },
        {
          "text": "Read beyond the guides",
          "href": "#read-beyond-the-guides"
        },
        {
          "text": "Product direction",
          "href": "#product-direction"
        }
      ]
    },
    {
      "step": "actual copy control",
      "time": "2026-10-13T15:22:24.113Z",
      "name": "Copy page as Markdown",
      "bytes": 2551,
      "sha256": "777ff354c4641d7d6a07b4394bf73497daf7d21ce918018610a395223561deb8",
      "equalsCurrentMarkdown": true
    },
    {
      "step": "actual page menu",
      "time": "2026-10-13T15:22:24.366Z",
      "text": "Copy as Markdown\nCopy this page, demos included\nView as Markdown\nOpen the page as plain text"
    }
  ],
  "errors": [],
  "httpErrors": [],
  "failure": {
    "message": "locator.innerText: Target page, context or browser has been closed",
    "url": "http://127.0.0.1:4186/docs.html?review=2-final#product-direction",
    "body": "Skip to document\nwasm—vm / docs\nOpen demo ↗\nSource ↗\nSearch documentation\n⌘ / Ctrl K\nReference subject\nAll subjects\nArchitecture\nBoot and images\nBuild and integration\nDisplay and input\nGraphics\nNetworking\nPerformance\nProduct proposals\nStorage\nVerification\nSTART HERE\nThe field guide\nBoot your first guest\nUSE THE MACHINE\nArchitecture\nEmbed the machine\nStorage and persistence\nNetworking\nDisplay, input, and audio\nGuest graphics: the admitted boundary\nContainers\nBUILD AND PROVE\nReproduce a claim\nRead the measurements\nWork in the repository\nDocs and explainers\nDocumentation coverage\nPRODUCT DIRECTION\nProposed product layer\nREFERENCE LIBRARY\nwasm-vm\nBuild and integration\nIn-guest micro-benchmarks: CoreMark + Dhrystone (E4-T03)\nPerformance\nPerf-regression runner setup (E4-T27)\nPerformance\nE4-T19 — cross-browser WebAssembly module-cost matrix\nPerformance\nresults — E4-T19 cost matrix\nPerformance\nRISCOF known-exclusion list (E1-T20; emptied E1-T26)\nVerification\nRISCOF architectural compliance (E1-T20)\nVerification\nName of the Plugin. All entries are case sensitive. Including the name.\nVerification\nName of the Plugin. All entries are case sensitive. Including the name.\nVerification\nE4-T25 lockstep/fuzz regression corpus\nArchitecture\nwasm-vm-wasm-emit (E4-T07)\nArchitecture\nRelease assurance boundary\nBuild and integration\nADR 0002 — SBI firmware: built-in Rust SBI, OpenSBI kept as an M-mode testcase\nArchitecture\nwasm-vm agent channel protocol\nBuild and integration\nBrowser audio ring contract (E5-T20a)\nDisplay and input\nPerformance baselines (E0-T24)\nPerformance\nBoot debugging playbook (E2-T14)\nBoot and images\nEpic 0 capstone — Hello from RV64, byte-for-byte against Spike\nBuild and integration\nClipboard policy\nDisplay and input\nHistorical nine-image container matrix\nBoot and images\nHistorical guest kernel container audit\nBoot and images\nDisplay-server decision\nDisplay and input\nLevel-4 capstone procedure (E4-T28f)\nBuild and integration\nNetwork provider deployment\nNetworking\nChunked disk-image format (E3-T01)\nBoot and images\nCopy-on-write block overlay (E3-T04)\nStorage\nBounded host/guest file transfer\nStorage\nE3-T18 HTTP fast-path evaluation\nNetworking\nDisk-image build pipeline v2 (E3-T11)\nBoot and images\nSlirp — user-mode network for the guest (E3-T14)\nNetworking\nSoftFloat backend decision (E1-T05)\nArchitecture\nBrowser Tailscale Worker protocol\nNetworking\nWebSocket TCP/UDP proxy — framing protocol (E3-T16 / E3-T14)\nNetworking\nDesktop boot-order proof\nDisplay and input\nDesktop bring-up playbook\nDisplay and input\nBrowser display modes\nDisplay and input\nE4-T22 — CPU worker on SharedArrayBuffer: build, isolation & deployment\nArchitecture\nEmbedding wasm-vm\nBuild and integration\nHistorical graphics decision\nGraphics\nImage artifacts\nBoot and images\nBrowser keyboard input\nDisplay and input\nJIT architecture — tiering, block shape, ABI, side exits, invalidation, budgets (E4-T06)\nArchitecture\nJIT F/D floating-point policy — the measured decision (E4-T15)\nArchitecture\nThe wasm-vm guest kernel (E2-T12)\nBoot and images\nLevel 1 compliance gate report — THRESHOLD MET\nBuild and integration\nBoot-time performance baseline (E2-T25)\nPerformance\nLevel-4 capstone measurement contract (E4-T28a)\nPerformance\nCursor-plane integration proof\nPerformance\nDisplay-server workload contract (E5-T16a)\nPerformance\nE4-T34 JIT retrospective: what worked, what failed, and the next bets\nPerformance\nFlamegraphs of the emulator itself (E4-T02)\nPerformance\nBrowser JIT register handoff — October 2026\nPerformance\nLevel-1 interpreter performance baseline (E1-T23)\nPerformance\nLevel-3 interpreter performance baseline (E4-T04)\nPerformance\nPerf overhaul (2026-09)\nPerformance\nPresentation path measurements\nPerformance\nThe \"wasm-vm virt\" machine platform (E2-T01)\nArchitecture\nProofMesh API contract\nProduct proposals\nProofMesh product roadmap\nProduct proposals\nProofMesh\nProduct proposals\nAlpine riscv64 rootfs (E2-T18)\nBoot and images\nBrowser timekeeping (E2-T23)\nArchitecture\nCanonical instruction-trace format (v1)\nBuild and integration\nBrowser host chrome\nDisplay and input\nHistorical shader prerequisite proposal\nGraphics\nvirtio-snd T19a control contract\nDisplay and input\nE4-T23 — Split-device placement: what runs where, and why\nArchitecture\nFuzzing scaffold (E0-T21)\nVerification\nGolden bare-metal guest binaries (E0-T14)\nVerification\nBounded VirGL command decoder\nGraphics\nAsynchronous renderer jobs\nGraphics\nSingle-target normalized blending\nGraphics\nBounded renderer reuse\nGraphics\nCompact floating vertex fetch\nGraphics\nProof-only VirtIO 3D control bridge\nGraphics\nBounded VirGL triangle draws\nGraphics\nOriginal floating image consumer\nGraphics\nOriginal floating image storage\nGraphics\nFloat vertex fetch boundary\nGraphics\nSelected original integer image consumer\nGraphics\nOriginal integer image storage\nGraphics\nStandard pure integer vertex inputs\nGraphics\nOriginal R11G11B10 image consumer\nGraphics\nOriginal R11G11B10 image storage\nGraphics\nPacked normalized images readme\nGraphics\nOriginal packed vertex fetch\nGraphics\nVirGL resources and transfers\nGraphics\nScalar floating vertex fetch\nGraphics\nExplicit retained scanout proof\nGraphics\nSelected original RGB9E5 images\nGraphics\nStandard shader bindings\nGraphics\nBounded VirGL objects and state\nGraphics\nProof-only ordered submission bridge\nGraphics\nOriginal texture operation consumer\nGraphics\nInteger images\nGraphics\nBounded VirGL shader bridge\nGraphics\nStandard\nGraphics\nFuzz regression corpus (E1-T21)\nVerification\nStress validation (E2-T24)\nVerification\nDifferential trace harness (E0-T20)\nVerification\ntools/fuzz — differential fuzzer vs Spike (E1-T21)\nVerification\nFuzzer sensitivity fixtures (E1-T21)\nVerification\nPrepared Omarchy image\nBoot and images\nPinned in-place display adaptation\nBoot and images\ntools/perf — perf-overhaul benchmark harness\nPerformance\nHistorical rr tooling\nVerification\nReference RISC-V toolchain (E0-T13)\nBuild and integration\nVerifier runbook (E0-T25)\nVerification\nOriginal 92cb draw geometry\nGraphics\nOriginal 92cb physical first-power domain\nGraphics\nOriginal 92cb raster domain\nGraphics\nReal guest VirGL reference captures\nGraphics\nNative recorder contract harness\nGraphics\nGuest graphics capture workloads\nGraphics\nRenderer cache evidence\nGraphics\nRaster readme\nGraphics\nVirgl compiler bounds\nGraphics\nExact raw bank consumer — E6-T12g6m3a\nGraphics\nPrivate exact-word compiler transaction — E6-T12g6m3b\nGraphics\nVirgl exponent logarithm\nGraphics\nVirgl fragment coordinates\nGraphics\nFragment discard and surviving predecessors\nGraphics\nVirgl gears shaders\nGraphics\nCanonical hexadecimal FLT32 proof\nGraphics\nMaterialized known arithmetic\nGraphics\nVirgl known branches\nGraphics\nMinimum selection evidence — E6-T12g6g1\nGraphics\nVirgl original corpus\nGraphics\nVirgl original programs\nGraphics\nVirgl power\nGraphics\nInstruction-local precise fraction evidence\nGraphics\nVirgl required formats\nGraphics\nInstruction-local numeric saturation evidence\nGraphics\nFinite scalar evidence — E6-T12g6f\nGraphics\nPrivate signed conversion evidence\nGraphics\nPrivate signed comparison and maximum proof\nGraphics\nVirgl sine\nGraphics\nBrowser demo (E0-T23)\nBuild and integration\n@tailscale/connect\nNetworking\nArchive ledger\n1,533\nDocstream 1.8.0\nCorpus and provenance →\nField guide\n/\nGuides\nGuide\nSource: web/docs-source/guides/overview.md ↗\nCopied\nCopy as Markdown\nCopy this page, demos included\nView as Markdown\nOpen the page as plain text\nPortable Markdown\nA field guide to wasm-vm\n\nwasm-vm executes a RISC-V computer in Rust and WebAssembly. An unmodified Linux kernel runs above its CPU, memory, interrupt controllers, and virtual devices. Start with the browser demo, then follow the boundary you need to understand.\n\nPick a starting point\nYou want to…\tStart here\nBoot a guest and use its console\tGet started\nPut the machine inside your application\tEmbed the machine\nUnderstand CPU, memory, and devices\tArchitecture\nKeep changes across reloads\tStorage and persistence\nConnect the guest to a network\tNetworking\nUse the display and input paths\tDesktop and input\nUnderstand admitted guest graphics work\tGraphics boundary\nReproduce a result or contribute a change\tVerification\nInterpret the published measurements\tPerformance\nCurrent scope\n\nThe public demo loads generated WebAssembly assets and named guest artifacts. The Level 1 report records 395 Sail architectural tests with zero exclusions. Storage, networking, display, JIT, and container work have their own acceptance criteria and evidence; a passing architectural baseline does not make every product surface complete.\n\nThe @agent-wasm/* packages belong to a separate host-side project. This repository builds WasmMachine and WasmLinux as relative browser assets. There is no verified @wasm-vm/sdk npm release in this checkout.\n\nRead beyond the guides\n\nThe reference library contains the detailed technical documentation from this repository, including device contracts, renderer boundaries, build runbooks, and dated measurements. Every page exposes its original source and Markdown. Search matches titles, paths, and page content; the Reference section also supports a subject filter.\n\nDocumentation coverage accounts for every tracked prose file. Task logs, evidence, operating policy, protocols, legal text, and upstream specifications keep their authoritative source intact.\n\nProduct direction\n\nPasskey-encrypted volumes, peer distribution, and the ProofMesh work market are proposed product work. Their specifications are readable here with that scope stated explicitly.\n\nDocumentation coverage →\nInspect the source ↗\n\nON THIS PAGE\n\nPick a starting point\nCurrent scope\nRead beyond the guides\nProduct direction\nSource boundary\n\nReports retain their original revision, workload, and evidence. A reader page does not refresh a verification claim."
  },
  "finished": "2026-10-13T15:22:25.146Z"
}
```

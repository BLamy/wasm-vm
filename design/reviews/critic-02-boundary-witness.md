# Independent file-code, lifecycle, and production witness

```json
{
  "started": "2026-10-13T15:24:36.283Z",
  "steps": [
    {
      "step": "Code expanded",
      "expanded": "true",
      "path": "Linux guest\nBare-metal ELF\nYour application\nA browser UI loads a RISC-V ELF and sets a byte callback.\nWasmMachine\nGenerated wasm-bindgen wrapper with run and step budgets.\nRV64 execution\nInterpreter or supported JIT blocks, architectural state, precise traps.\nBare-metal ELF\nGuest instructions execute without a Linux kernel.\n\nThis diagram explains the API boundary. Open the demo for actual guest execution."
    },
    {
      "step": "actual code bytes",
      "matches": true,
      "length": 1499
    },
    {
      "step": "production quickstart",
      "url": "http://127.0.0.1:4188/docs.html?page=quickstart",
      "heading": "Boot your first guest"
    },
    {
      "step": "production landing Back",
      "failed": "page.goBack: Timeout 12000ms exceeded.\nCall log:\n\u001b[2m  - waiting for navigation until \"domcontentloaded\"\u001b[22m\n\u001b[2m    - navigated to \"http://127.0.0.1:4188/?review=2-final\"\u001b[22m\n",
      "url": "http://127.0.0.1:4188/?review=2-final",
      "body": "Skip to content\nwasm\n—\nvm\n/\nThe machine\nMeasurements\nDocumentation\nSource ↗\nOpen demo ↗\n\nRV64GC · RUST → WEBASSEMBLY\n\nA Linux machine.\nIn a browser tab.\n\nAn unmodified Linux guest, running on a RISC-V computer built in Rust. The CPU executes on your device. The browser is its home.\n\nOpen the machine\n↗\nStart with the field guide →\n\nNo remote CPU. Boot images download on demand; networking uses the provider you select.\n\nInside the virtual machine\n3D ARCHITECTURE MODEL\n01 / RV64GC core\nFIG. 01 / HOST → VIRT → LINUX\nPause motion\n01\nCPU\n02\nMemory\n03\nDevices\n04\nLinux\nRV64GC core. Guest instructions retire through a Rust interpreter; a JIT accelerates supported blocks. Inspect the architecture →\nARCHITECTURE BASELINE\n395 Sail compliance tests\n\nThe Level 1 report records native and WebAssembly results with zero exclusions. It defines a tested boundary, with reproducible commands.\n\nRead the report ↗\n01 / THE MACHINE\nHardware in software.\nLinux above it.\n\nBrowser APIs sit below the guest. Linux sees a CPU, memory, interrupts, and devices through the virtual platform.\n\n01\nExecute real RISC-V binaries\n\nRun a bare-metal ELF or boot a kernel. RV64GC, privileged state, precise traps, and virtual memory form the architectural boundary.\n\nCPU & platform →\n02\nKeep a writable disk\n\nChunked disk images fetch the blocks the guest needs. An IndexedDB copy-on-write overlay keeps local changes across reloads.\n\nDisk & persistence →\n03\nUse a terminal or a desktop\n\nThe workbench offers serial and display views with guest keyboard and pointer input. Guest GPU offload remains partial; default production acceleration is disabled.\n\nDisplay & input →\n04\nInspect what is proven\n\nGuest traces, state digests, and differential tests make execution inspectable. Container import and booted execution carry separate proof boundaries.\n\nEvidence & limits →\n02 / TRY IT\nYour device does\nthe execution.\n\nOpen the launcher and choose a guest image. After it boots, the console shows output produced by the machine. Use the full workbench or open an embedded session here.\n\nBoot modes and prerequisites →\nGuest console / ttyS0\nNot started\n\nOpen the demo, then choose a guest to see its output.\n\nStart an embedded session ↗\nLoads the workbench; choosing a guest fetches its boot artifacts.\nOpen the full workbench ↗\n03 / MEASUREMENTS\nEvery number has\na workload behind it.\n\nFile I/O, HTTP boundaries, and steady-state compute tell different stories. The September 2026 campaign remains intact below, including unsuppo"
    },
    {
      "step": "production initialized",
      "url": "http://127.0.0.1:4188/app.html#ide",
      "version": "core 0.0.1",
      "isolated": true,
      "api": {
        "runBusybox": "function",
        "exec": "function"
      },
      "launcher": "RISC-V GUEST LAUNCHER\n\nChoose an operating system\n\nEach option boots a real guest in this browser. Warm images restore in seconds when their identity matches the current kernel and disk; Omarchy is the graphical desktop image and uses its own immutable chunk set.\n\nOmarchy\nOpen the Hyprland desktop with Foot and the Omarchy shell, fitted to your window. Experimental software rendering: input can take minutes to appear.\nready · 4 GiB desktop\nAlpine + Node.js\nContainer-capable Alpine with Node and npm already installed.\nready · fast restore\nAlpine Linux\nSmall container-capable Alpine host with lazy disk chunks and persistence.\nready · fast restore\nBusyBox Linux\nMinimal initramfs shell with a verified fast restore and no disk download.\nready · fast restore\n\nSelect a guest to start the shared VM."
    },
    {
      "step": "in-app Docs",
      "url": "http://127.0.0.1:4188/app.html#docs",
      "heading": "A field guide to wasm-vm",
      "apiRetained": true
    },
    {
      "step": "page products",
      "heading": "What runs today.\nWhat we plan to build.",
      "scope": "Product proposal / not a deployed product surface"
    },
    {
      "step": "page security",
      "heading": "Name the boundary.\nThen prove the claim.",
      "scope": "Current boundaries / proposed encrypted product layer"
    },
    {
      "step": "page work-market",
      "heading": "Freeze the question.\nPay for a proven result.",
      "scope": "Product proposal / not a deployed product surface"
    },
    {
      "step": "page roadmap",
      "heading": "One boundary\nat a time.",
      "scope": "Product proposal / not a deployed product surface"
    },
    {
      "step": "phone security",
      "width": 390,
      "docWidth": 390
    }
  ],
  "errors": [
    {
      "url": "http://127.0.0.1:4188/app.html",
      "text": "Failed to load resource: the server responded with a status of 404 (File not found)"
    }
  ],
  "httpErrors": [],
  "finished": "2026-10-13T15:24:53.822Z"
}
```

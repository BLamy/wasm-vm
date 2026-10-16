# Independent Chrome landing and launch witness

```json
{
  "started": "2026-10-13T15:05:49.952Z",
  "ownership": {
    "process": "fresh Playwright launchPersistentContext",
    "profile": "/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-design-critic-F75nDL",
    "existingChromeAttached": false
  },
  "steps": [
    {
      "step": "desktop landing",
      "url": "http://127.0.0.1:4186/landing.html?review=2-final",
      "title": "wasm-vm — A Linux machine in your browser",
      "text": "RV64GC · RUST → WEBASSEMBLY\n\nA Linux machine.\nIn a browser tab.\n\nAn unmodified Linux guest, running on a RISC-V computer built in Rust. The CPU executes on your device. The browser is its home.\n\nOpen the machine\n↗\nStart with the field guide →\n\nNo remote CPU. Boot images download on demand; networking uses the provider you select.\n\nInside the virtual machine\n3D ARCHITECTURE MODEL\n01 / RV64GC core\nFIG. 01 / HOST → VIRT → LINUX\nPause motion\n01\nCPU\n02\nMemory\n03\nDevices\n04\nLinux\nRV64GC core. Guest instructions retire through a Rust interpreter; a JIT accelerates supported blocks. Inspect the architecture →"
    },
    {
      "step": "layer memory",
      "label": "02 / Guest RAM",
      "caption": "Guest memory. WebAssembly linear memory holds guest RAM. Linux translates virtual addresses through the emulated MMU. Read the memory boundary →",
      "states": [
        {
          "layer": "cpu",
          "pressed": "false"
        },
        {
          "layer": "memory",
          "pressed": "true"
        },
        {
          "layer": "devices",
          "pressed": "false"
        },
        {
          "layer": "linux",
          "pressed": "false"
        }
      ]
    },
    {
      "step": "layer devices",
      "label": "03 / Virtual devices",
      "caption": "Virtual devices. Interrupt controllers, UART and virtio devices connect the guest to explicit browser-side storage and network providers. Read the device boundary →",
      "states": [
        {
          "layer": "cpu",
          "pressed": "false"
        },
        {
          "layer": "memory",
          "pressed": "false"
        },
        {
          "layer": "devices",
          "pressed": "true"
        },
        {
          "layer": "linux",
          "pressed": "false"
        }
      ]
    },
    {
      "step": "layer linux",
      "label": "04 / Linux guest",
      "caption": "Unmodified Linux. The kernel and userland run as RISC-V binaries above the virtual platform. Boot images and modes are chosen by the loader. Read the boot guide →",
      "states": [
        {
          "layer": "cpu",
          "pressed": "false"
        },
        {
          "layer": "memory",
          "pressed": "false"
        },
        {
          "layer": "devices",
          "pressed": "false"
        },
        {
          "layer": "linux",
          "pressed": "true"
        }
      ]
    },
    {
      "step": "phone model",
      "dimensions": {
        "width": 390,
        "docWidth": 390,
        "pauseHeight": 44
      }
    },
    {
      "step": "embedded launcher",
      "frameUrl": "./index.html?embed=1&noAutoBoot#ide",
      "state": "Demo session open",
      "launcher": "RISC-V GUEST LAUNCHER\n\nChoose an operating system\n\nEach option boots a real guest in this browser. Warm images restore in seconds when their identity matches the current kernel and disk; Omarchy is the graphical desktop image and uses its own immutable chunk set.\n\nOmarchy\nOpen the Hyprland desktop with Foot and the Omarchy shell, fitted to your window. Experimental software rendering: input can take minutes to appear.\nready · 4 GiB desktop\nAlpine + Node.js\nContainer-capable Alpine with Node and npm already installed.\nready · fast restore\nAlpine Linux\nSmall container-capable Alpine host with lazy disk chunks and persistence.\nready · fast restore\nBusyBox Linux\nMinimal initramfs shell with a verified fast restore and no disk download.\nready · fast restore\n\nSelect a guest to start the shared VM.",
      "version": "core 0.0.1",
      "buttons": [
        {
          "guest": "omarchy",
          "disabled": false
        },
        {
          "guest": "node-alpine",
          "disabled": false
        },
        {
          "guest": "alpine",
          "disabled": false
        },
        {
          "guest": "busybox",
          "disabled": false
        }
      ]
    }
  ],
  "errors": [],
  "failure": {
    "message": "page.waitForFunction: Timeout 15000ms exceeded.",
    "stack": "page.waitForFunction: Timeout 15000ms exceeded.\n    at /Users/blamy/.codex/worktrees/website-docstream/wasm-vm/[eval1]:34:13"
  },
  "finished": "2026-10-13T15:06:07.035Z"
}
```

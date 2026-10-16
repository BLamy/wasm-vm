# How the machine fits together

The browser runs the emulator. The emulator presents a RISC-V virtual platform. The guest kernel and userland execute above that platform as RISC-V binaries.

## Follow the execution layers

{% demo src="architecture/layers" title="Execution layers" description="Select an entry point to see the actual host/guest boundary. This is an architecture explanation." status="Interactive explanation" %}

## CPU and memory

The interpreter implements RV64GC plus privileged state and precise traps. Guest virtual memory translates through the emulated MMU; host WebAssembly linear memory holds the guest RAM. The Level 1 report records the architectural compliance boundary for native and WebAssembly builds.

The JIT translates supported blocks. Its ABI, side exits, invalidation, budgets, and floating-point policy are specified separately. A hot-loop diagnostic is not a prediction about a complete Linux workload.

## Virtual platform

The `wasm-vm virt` platform includes CLINT, PLIC, a 16550-compatible UART, virtio devices, and a goldfish RTC. Device-specific contracts describe what each surface admits and rejects. The device-tree generator and memory map are part of the platform boundary.

The guest retirement clock and browser wall clock serve different purposes. Consult the [timekeeping contract](./docs.html?page=reference-docs-timekeeping) when changing timers, cooperative scheduling, or idle behavior.

## Worker placement

The split-device architecture keeps CPU work and UI/device work behind explicit channels. SharedArrayBuffer paths depend on browser isolation. The worker protocol is an implementation boundary, not an installable public VM SDK.

{% hint style="info" %}
The 3D homepage model is a cutaway illustration of these layers. Launch the demo for guest execution and use traces or state digests for correctness claims.
{% endhint %}

## Detailed contracts

- [Virtual platform](./docs.html?page=reference-docs-platform)
- [JIT architecture](./docs.html?page=reference-docs-jit-architecture)
- [JIT floating-point policy](./docs.html?page=reference-docs-jit-fp-policy)
- [Worker device placement](./docs.html?page=reference-docs-worker-devices)
- [CPU workers and isolation](./docs.html?page=reference-docs-e4-t22-cpu-worker-coop-coep)
- [Canonical instruction trace format](./docs.html?page=reference-docs-trace-format)

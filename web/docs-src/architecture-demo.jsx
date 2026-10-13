import React, { useState } from "react";

const paths = {
  linux: [
    ["Your application", "A browser UI consumes output bytes and sends input."],
    ["Linux loader", "Artifact fetch, SHA-256 checks, boot options, controller lifecycle."],
    ["WasmLinux", "Rust CPU, guest RAM, MMU, interrupts, and virtual devices."],
    ["RISC-V guest", "Unmodified Linux kernel and the selected userland image."],
  ],
  elf: [
    ["Your application", "A browser UI loads a RISC-V ELF and sets a byte callback."],
    ["WasmMachine", "Generated wasm-bindgen wrapper with run and step budgets."],
    ["RV64 execution", "Interpreter or supported JIT blocks, architectural state, precise traps."],
    ["Bare-metal ELF", "Guest instructions execute without a Linux kernel."],
  ],
};

export default function ArchitectureDemo() {
  const [path, setPath] = useState("linux");
  return <div className="architecture-demo">
    <div className="architecture-demo-options" role="group" aria-label="Choose the execution entry point">
      <button type="button" aria-pressed={path === "linux"} onClick={() => setPath("linux")}>Linux guest</button>
      <button type="button" aria-pressed={path === "elf"} onClick={() => setPath("elf")}>Bare-metal ELF</button>
    </div>
    <ol aria-live="polite">{paths[path].map(([title, detail]) => <li key={title}><strong>{title}</strong><span>{detail}</span></li>)}</ol>
    <p>This diagram explains the API boundary. Open the demo for actual guest execution.</p>
  </div>;
}

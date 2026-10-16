# Marketing and documentation redesign

The audience is a developer deciding whether to try a browser Linux machine or embed its generated WebAssembly module. The first screen must explain that the browser executes a RISC-V computer; the next action opens the working demo. Readers can then inspect the architecture, measured costs, and reproducible evidence.

## Constraints

- Keep the existing `web/landing.js` fragment shader. Improve its lifecycle and mobile rendering budget, without replacing its visual algorithm.
- Add a real Three.js scene: perspective camera, three-dimensional meshes, lighting, material shading, and interactive layer selection. The model explains the virtual machine's layers; it is an architecture illustration.
- No invented performance, broad GPU support claims, scripted console output, or blanket privacy promises. Networking and artifact downloads have explicit boundaries.
- Preserve every raw benchmark JSON result, runner, sample policy, unavailable cell, and evidence link.
- Move the documentation reader to the latest official `@brett_lamy/docstream` release. Account for every tracked prose document in an inventory. Preserve operating policy, task logs, source protocols, legal provenance, third-party specifications and immutable evidence.
- Implement in `/Users/blamy/.codex/worktrees/website-docstream/wasm-vm` on `codex/website-docstream`. No deployment or PR stack operation from this branch.

## Visual direction

An engineering field guide: generous editorial typography, numbered sections, fine dividers, restrained cyan, and a three-dimensional cutaway with useful labels. The existing dark cyan/green shader remains the background. Architecture and evidence replace the previous card catalogue and decorative metrics.

## Independent AI-slop rubric

Each category scores from 0 (specific and deliberate) to 5 (generic or misleading). The total is 0–25, where lower is better. A round passes only at 5 or below, with no category above 2 and no false claim or broken primary flow.

1. **Generic composition:** repeated rounded cards, pill overload, interchangeable SaaS hero, gratuitous gradients or glow.
2. **Empty language:** vague superlatives, unsupported absolutes, repeated promises or copy without a concrete referent.
3. **Decorative simulation:** pretend console output, non-functional controls, 3D that does not explain the product, fake data.
4. **Evidence distance:** claims without nearby scope, raw sources or proof; benchmark units and caveats lost.
5. **Craft defects:** awkward hierarchy, crowded screens, clipped mobile content, inaccessible controls, uncontrolled motion.

A fresh critic reviews actual screenshots and content, cites locations, requests concrete improvements, and rechecks subsequent rounds. The worker does not grade itself.

## Initial audit

Production captured in the current session at `https://wasm-vm.pages.dev/` and `/docs.html`.

- The homepage puts an oversized gradient headline above an emoji card catalogue. The shader is distinctive, but the layout around it is interchangeable (`00-current-home-desktop.jpg`).
- The homepage implies complete OCI execution while the documentation explicitly bounds that capstone. It also claims nothing leaves the tab despite optional networking, and presents a canned terminal transcript (`00-current-home-desktop.jpg`, captured DOM).
- Docs begin with a large overview and card grid. Deep technical pages are GitHub links; no corpus search or local document navigation is provided (`00-current-docs-desktop.jpg`).
- The public package examples pin Docstream 0.3.7. The official npm `latest` tag is 1.8.0 on 2026-10-13.

Screenshots prove layout and visible copy, not full accessibility or emulator correctness.

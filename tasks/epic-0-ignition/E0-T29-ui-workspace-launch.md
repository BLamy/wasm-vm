---
id: E0-T29
epic: 0
title: Launcher and workspace on the shared interface — one obvious start, advanced behind disclosure
priority: 0.2
status: pending
depends_on: [E0-T28]
estimate: S
risk: medium
capstone: false
---

## Boundary

Second slice of the site redesign (parent E0-T31). Rebuild the app shell's launcher and
workspace chrome (`web/index.html`, the launcher/session/config parts of `web/ide.js` and
`web/main.js` that render DOM) on the E0-T28 components so a first-time visitor can start a
machine with one decision. The shipped launcher today exposes 14+ technical validation
disclosures and large session timeline/library forms in the first view
(`evidence/ui-redesign/06-current-live-launcher.jpg`).

- First view: choose a guest and start it. Guest descriptions are short and accurate; the
  graphics backend choice defaults sensibly and moves into an "Advanced" disclosure.
- Validation probes, session/timeline/library forms, network and storage configuration, and
  diagnostic routes move behind user-oriented navigation (library `Segmented`/`Tabs`, `Sheet`,
  `Disclosure`, `List`), not deleted.
- Real engine surfaces stay native: the guest canvas, xterm, GPU/desktop surfaces are not
  wrapped or restyled beyond their containers.
- Phone layout: the launcher and a running terminal are usable at 390 px without horizontal
  overflow; controls meet 44 px touch targets where the library provides them.

Every DOM id, data attribute and `window.wvmDemo`/test hook that runtime code or the Playwright
suite reads keeps working; no change to storage keys, networking, keyboard capture, CPU/JIT
selection, desktop boot, guest restore or compatibility semantics. No Rust changes.

## Deterministic acceptance

`bash tools/verify-ui-workspace.sh` (to be written with the slice). It must: rerun the E0-T28
checks; enumerate every id/hook the runtime JS and existing specs query and assert each is
present and wired after the redesign; boot BusyBox from the launcher in Playwright at desktop
and 390 px widths and reach the shell prompt; assert the first view contains no more than one
primary action and that each formerly visible advanced control is reachable within two
interactions; and run the ordinary in-browser suite to its current pass count with zero browser
errors.

Carry-forward from the E0-T28 latest-source review: at 390 px, boot a real BusyBox guest,
write a unique guest-file marker, keyboard-activate **Case studies** in the phone menu, close
the new page and dismiss the menu. An ordinary tap on the terminal must focus the actual
xterm textarea, and trusted keyboard input must read the preserved marker. Do not call
`wvmDemo.focusTerminal()`, `locator.focus()` or another programmatic focus helper to make that
return path pass. Preserve the same guest/controller/session; this phone-focus criterion is
required before the combined mobile grade.

## Adversarial verification

Medium risk. Attack: (1) find any runtime id/hook referenced by JS or a spec that the new markup
lost or detached from its handler; (2) boot a guest, switch views, and confirm keyboard input
still reaches the guest and Escape/shortcut handling is not eaten by library overlays;
(3) reload with a persisted session and confirm restore still offers the same choices;
(4) at 390 px, operate every moved control. One bounded novel attack of the verifier's choosing.

## Verification log

### 2026-10-30 — fresh foundation verifier — terminal return carried into this slice

On foundation product `9347dd4bc`, real phone Case studies keyboard navigation preserves the
BusyBox controller, session generation 1, document, IDE and guest file. However, after popup
close → return → Escape → ordinary `#term` tap, focus stays on Menu and typing emits no serial
echo. `web/terminal.js` is byte-identical to PR626 (SHA-256
`fca4f0c080aad34b5d38121ffe9160275869a279f98fa28a20f6ea1c27b55eae`).
The foundation's focus-only API makes subsequent trusted `cat` return the preserved marker,
which proves machine survival but does not satisfy ordinary phone interaction.

Receipts: `target/ui-verifier/foundation-626/first-phone-real-guest-nav.{json,zip}` records
the initial failure; `phone-real-guest-nav.json` records Menu focus after the tap, actual xterm
focus after the explicit helper, and successful `foundation-survival-626` readback. The
promoted `web/tests/ui-foundation-guest-navigation.spec.js` isolates navigation survival with
explicit focus; this slice must add or strengthen the normal tap proof above on the latest
source. No terminal implementation was changed by the verifier; this is not a final waiver.

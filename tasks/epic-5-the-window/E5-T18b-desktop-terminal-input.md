---
id: E5-T18b
epic: 5
title: Prove WM terminal launch and keyboard input
priority: 518.2
status: in-progress
depends_on: [E5-T18a]
estimate: S
risk: high
capstone: false
---

## Goal

Prove that a user can launch the configured terminal from the WM menu and type a command
through the existing guest input path.

## Boundary

This slice owns WM-menu terminal launch, window focus, keyboard delivery, and terminal text
rendering. Cursor/DPR geometry, compositor crash recovery, and playbook consolidation are
separate slices.

## Deliverables

- A deterministic terminal interaction harness built on the T18a ready-desktop fixture.
- Input evidence showing the menu selection, focused terminal, typed command, and rendered output.
- Any required image/startup configuration changes, rebuilt through the committed builder.

## Acceptance criteria

- [ ] The local desktop harness selects Terminal from the WM menu and opens the configured
      foot/xterm window.
- [ ] The focused terminal accepts a deterministic command through the T12 input path and
      renders the expected ls output without dropped, duplicated, or reordered keystrokes.
- [ ] Repeating the open/type/close flow leaves the desktop responsive and produces no
      unexpected console or guest errors.

## Verification command

make verify-E5-T18b

## Adversarial verification

Repeat the menu/open/type/close flow with focus changes and a rapid but bounded input burst.
Verify that a terminal opened after another window was focused still receives the complete
command and output. A silent focus loss, missing character, or stale terminal window refutes
the slice. WebKit and independent machines are out of scope.

## Verification log

### 2026-09-05 — coordinator — planned

This S slice freezes the typed-terminal user path on top of the cold-boot contract.

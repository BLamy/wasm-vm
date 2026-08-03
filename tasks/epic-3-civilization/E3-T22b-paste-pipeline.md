---
id: E3-T22b
epic: 3
title: Paste pipeline — bracketed-paste framing, newline normalization, chunked injection
priority: 322.2
status: verified
depends_on: [E2-T22]
estimate: S
risk: medium
capstone: false
---

## Goal
Host paste injects into the guest tty: when the guest has enabled bracketed paste (DECSET 2004,
tracked by xterm.js) the text is wrapped in `ESC[200~ … ESC[201~`; newlines normalize to CR; large
pastes chunk against the tty ring so no bytes drop; and an embedded end-marker in hostile pasted
content cannot terminate bracketing early (the paste-injection CVE class).

## Context
Split from **E3-T22**. The framing + normalization + end-marker-stripping is deterministic and
node-unit-testable, separate from the OSC 52 copy path (E3-T22a) and the browser E2E (E3-T22d).

## Deliverables
- A pure `framePaste(text, {bracketed})`: newline → CR normalization, and when `bracketed`, wrap in
  `ESC[200~…ESC[201~` with any embedded `ESC[201~` stripped/neutralized so the remainder can never
  escape the bracket and execute.
- Chunked injection through the existing `web/terminal.js` backpressure queue (reuse the INPUT_CHUNK
  pacing) keyed off the live mode-2004 state.

## Acceptance criteria
- [x] `make verify-E3-T22b` (node --test): CRLF/LF/CR all normalize to CR; bracketed mode wraps
  exactly once; content containing `ESC[201~` is neutralized (no early bracket termination).
- [x] A multi-megabyte paste frames + chunks without loss or reorder (byte-identical reassembly).
- [x] With mode 2004 unset, no bracket markers are added (documented fallback).

## Adversarial verification
Paste `\x1b[201~rm -rf /\n` outside/inside bracketed mode — the end-marker must not split the frame
such that the tail executes. Race a paste against rapid 2004 toggling — the framing decision uses one
consistent snapshot, never a torn half-bracket.

## Verification log
- 2026-08-03 — `make verify-E3-T22b`: **OK** (8 node --test cases). `web/paste.js` is a pure module:
  `framePaste(text, {bracketed})` normalizes CRLF/LF/CR → a single CR, and when `bracketed` wraps in
  `ESC[200~ … ESC[201~` after neutralizing every embedded `ESC[201~` (paste-injection defense — a
  hostile `safe␛[201~rm -rf /` stays inert data inside the bracket; only our own end marker survives,
  and it is last). Mode-2004-unset adds no markers (documented fallback). A 2 MB paste frames
  byte-identically (stripping the wrapper recovers the normalized input exactly; one `\n`→`\r` keeps
  length). Wired into `web/terminal.js`: `ignoreBracketedPasteMode: true` (xterm never double-wraps),
  a capture-phase DOM `paste` interceptor that frames via `framePaste` with a ONE-SHOT snapshot of the
  live `term.modes.bracketedPasteMode` (no torn half-bracket on a mid-paste toggle) and feeds through
  the existing backpressure/chunk queue, plus a `pasteText()` controller method for the E2E. The
  in-browser paste E2E (1 MB paste → `cat > file` sha256, zero-commands-until-Enter) is the E3-T22d
  capstone; the chunk/reorder guarantee is the E2-T22 tty-queue's own proof.

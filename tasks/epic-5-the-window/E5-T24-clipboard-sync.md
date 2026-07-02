---
id: E5-T24
epic: 5
title: Bidirectional clipboard sync through the guest agent
priority: 524
status: pending
depends_on: [E5-T18, E5-T23]
estimate: M
capstone: false
---

## Goal
Copy in the guest, paste on the host; copy on the host, paste in the guest — text
clipboard synced both directions through T23's agent with loop suppression, size
limits, and honest handling of the browser clipboard-permission model.

## Context
Guest side (assuming T16 chose Wayland): agent runs `wl-paste --watch <notify>` (or
polls `wl-paste` with a clipnotify-style trigger; X11 fallback: `xclip`) to detect
guest copies → sends CLIP_SET frame to host; host→guest paste: agent pipes payload into
`wl-copy`. Host side is where the browser fights us: `navigator.clipboard.writeText`
requires a user-gesture-adjacent secure context (we already require crossOriginIsolated
for SAB, which implies secure) — Chrome allows write from any transient activation;
Firefox is stricter. Policy: guest-copy events stage the text host-side and write to
the OS clipboard immediately when permitted, else on the next user gesture (staged
indicator in the T08 chrome); host-copy → we cannot poll `clipboard.readText` without
permission prompts, so we sync on explicit events: `paste` events on the canvas
(Ctrl+V/middle-click gives us clipboardData without any permission) push to the guest
*before* the keystroke is delivered (ordering matters — the guest paste must find the
new content already in wl-copy). Loop suppression: content-hash echo guard with a
2-entry history both sides. Limits: 256 KiB, UTF-8 text/plain only in v1 (images
noted as future work); oversize → truncate-with-marker or reject per documented policy.

## Deliverables
- Agent: CLIP_SET/CLIP_GET message types + wl-clipboard integration (child-process
  handling that survives wl-paste crashes) behind the T23 capability bitmap.
- Host: clipboard service with gesture-staging, paste-event interception ordered ahead
  of key delivery, echo guard, size enforcement, staged/synced indicator.
- Playwright tests for both directions (Chromium grants clipboard perms headlessly;
  Firefox caveats documented + manual protocol).
- `docs/clipboard.md`: permission matrix per browser, policies, limits.

## Acceptance criteria
- [ ] Guest → host: select text in foot (auto-copies to Wayland selection... verify
      chosen terminal's behavior; else `echo test | wl-copy`), then within 1 s host
      Ctrl+V in a textarea outside the VM pastes it (Chromium, permission granted).
- [ ] Host → guest: copy in a host app, click the canvas, Ctrl+Shift+V in foot pastes
      it — first try, correct ordering (no "previous clipboard" paste).
- [ ] 3-byte and 256 KiB payloads survive round-trips byte-exact (UTF-8 with emoji +
      CRLF content); 257 KiB triggers the documented oversize behavior.
- [ ] Copy the same string alternately host/guest 20x: echo guard prevents any
      feedback loop (agent traffic counter shows ≤ 1 frame per user action).
- [ ] With clipboard permission denied in the browser: guest copies stage with
      indicator; a user gesture flushes; nothing throws.

## Adversarial verification
Attack ordering: script host-copy → immediate canvas Ctrl+Shift+V with < 50 ms gap 100x
— any stale paste refutes (this catches the async race between CLIP_SET and key
delivery). Attack the guard: craft the pathological case — host and guest legitimately
copy identical strings in alternation — sync must still occur when a *different* string
follows (guard must hash content+direction+generation, not just content). Attack the
agent's children: kill wl-paste mid-watch, copy in guest — sync must self-heal ≤ 5 s.
Paste a 256 KiB string into a guest terminal (bracketed paste flood) — no input-queue
overflow (T10's bounded ring must not drop *key* frames while the paste goes via
clipboard, not keystrokes). Binary/invalid-UTF8 in the guest clipboard (wl-copy of
/dev/urandom bytes): host must reject/sanitize per doc, never throw. Verify nothing
syncs while the canvas lacks focus (privacy: no background host-clipboard reads —
audit via a clipboard-read spy).

## Verification log
(empty)

# Independent verifier predictions — 2026-09-06

Oriented on AGENTS.md, full task, and diff debd0406..2da168d7372dadbad60957adf622471915d8cc7d before opening worker evidence. Frozen implementation head 2da168d7. Worker final handoff remains pending; no verdict/status/commit before that handoff.

- P1: 641x481 CSS at DPR 1.5 requests 962x722; tiny and oversized extents clamp to 320x240 and 4095x4095; hidden panes request nothing. Silent DPR changes are detected by the scalar watcher and followed by a 250 ms trailing request. Only explicit zero bypasses debounce.
- P2: Fifty changes spaced 100 ms apart produce no request before the final 250 ms deadline, then the final mode. Old completions cannot overwrite newer intent; disposal leaves no timer, observer or media listener able to initiate another request.
- P3: For every target pixel (x,y), output equals source[y*sourceWidth+x] within the overlapping rectangle and opaque black outside it. The first matching resource erases bars even with partial damage. CSS canvas extent equals backing extent / DPR.
- P4: Actual Chrome Canvas2D and WebGL2 produce the oracle at DPR 1, 1.5 and 2. Resize invalidates pending old frame plans. Context loss replaces the canvas and immediately replays the retained clipped/padded image before any new frame submission.
- P5: Pointer normalization uses old resource extent / current DPR, with padded coordinates clamped to 32767; documentation states clamps and next-mode-set caveat. T22a architecture and TRANSFER bounds remain byte-identical.

Bounded novel attack: run an independent odd-size mixed shrink/grow sequence through both real backends, including two partial matching-resource submissions in one animation-frame interval. Inspect pixels after drain and after context replacement without submitting a repair frame. Also sample pointer mapping in padding. Expected: no old bars/stale pixels survive, no scaling/shear, and replacement preserves pixels. This composes scheduling and transition paths the worker checks separately.

Scope excludes compositor adoption, performance, cold clone, unrelated Rust/CI, deployment, merge, ssh dev, rr, WebKit and other machines. Writes remain under verifier evidence until final handoff (plus any later authorized test/log/status metadata).

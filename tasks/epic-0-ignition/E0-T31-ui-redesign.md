---
id: E0-T31
epic: 0
title: Redesign the entire site on @brett_lamy/ui (planning parent)
priority: 0.4
status: cancelled
depends_on: [E0-T27]
estimate: L
capstone: false
---

## CANCELLED — split into ordered S tasks

Planning container for the user-requested redesign: the easiest possible start, far less
confusing configuration, `@brett_lamy/ui` for every control, strong typography without generic
aesthetics, excellent phone layouts, an engaging homepage and short honest copy. An independent
grader scores each requested dimension; the redesign is not done until every dimension reaches at
least 8/10.

Replaced by, in order:

1. [E0-T28](./E0-T28-ui-foundation.md) — shared interface foundation: pinned library, build,
   tokens, shared nav, interface kit.
2. [E0-T29](./E0-T29-ui-workspace-launch.md) — launcher and workspace: one obvious start,
   advanced configuration behind disclosure, every runtime hook intact.
3. [E0-T30](./E0-T30-ui-homepage-public.md) — homepage and public pages: honest copy, the
   architecture model kept.

Constraints carried by every slice: no Rust changes; existing runtime behavior, evidence, tests,
storage, networking, keyboard, CPU/JIT, desktop boot, guest restore and compatibility semantics
unchanged; offline/no-CDN assets; diagnostic routes preserved; no GitHub Actions; no merge or
deploy without explicit authorization.

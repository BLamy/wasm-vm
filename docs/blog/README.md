# The Loop — a blog series

How I got an AI agent to build a RISC-V Linux emulator in Rust/WASM, one verified task at
a time — and why the interesting part isn't the emulator, it's the loop.

This series is about the *framework*: the documents, queue, protocol, and tooling that let
an agent run for hundreds of iterations without drifting, lying to itself, or declaring
victory early. The emulator is just the proof it works.

1. **[Part 1 — The Loop](part-1-the-loop.md)** — why "build me a Linux emulator" fails, and
   the shape of a loop that doesn't.
2. **[Part 2 — The Map](part-2-the-map.md)** — a roadmap an agent can steer by: levels,
   capstones, and decisions made once.
3. **[Part 3 — The Queue](part-3-the-queue.md)** — tasks as the unit of iteration: one
   markdown file per task, one script to order them all.
4. **[Part 4 — The Adversary](part-4-the-adversary.md)** — the worker/verifier split: no
   task is done until a hostile fresh session fails to break it.
5. **[Part 5 — The Evidence](part-5-the-evidence.md)** — recordings, not claims: guest
   instruction traces, rr time-travel debugging, and differential oracles.
6. **[Part 6 — The Ratchet](part-6-the-ratchet.md)** — compounding gates, verifying the
   verifier, and the numbers after 54 verified tasks.

Everything quoted in these posts is a real artifact in this repository:
[`ROADMAP.md`](../../ROADMAP.md), [`AGENTS.md`](../../AGENTS.md),
[`tasks/`](../../tasks/), [`tools/build_queue.py`](../../tools/build_queue.py),
[`tools/verify/`](../../tools/verify/), [`tools/rr/`](../../tools/rr/).

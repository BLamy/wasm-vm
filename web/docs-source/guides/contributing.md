# Work in the repository

Read the operating manual before taking a task. The queue, roadmap, and verification logs are executable coordination state; documentation style changes must not rewrite their historical claims.

## Choose and prove a task

[AGENTS.md](https://github.com/BLamy/wasm-vm/blob/main/AGENTS.md) defines the worker/critic roles, one-task active lane, dependency gating, risk tiers, evidence requirements, and status transitions. [tasks/QUEUE.md](https://github.com/BLamy/wasm-vm/blob/main/tasks/QUEUE.md) lists eligible work.

Only a fresh verifier can set `verified`. A worker submits the diff, a concrete claim, and recorded evidence. Run the policy check before regenerating the queue after a task status change.

## Browser changes

Surface browser-reachable capabilities in the demo and roadmap manifest, verify the built page, and retain a screenshot and console result. Build locally. The pre-commit hook assembles `web/dist`; Cloudflare Pages is the deployment target. GitHub Actions remains disabled.

## Pull requests

The repository uses GitHub-native stacked pull requests through non-interactive `gh stack` commands. Keep foundational changes below their dependents. A verified task or request to push does not authorize merging; merge only on an explicit current request, following the operating manual.

## Documentation source

The authored field guides live in `web/docs-source/guides`. The build migrates the complete repository reference corpus into portable Docstream pages, preserves detailed source paragraphs and code, resolves repository links, and generates the migration ledger. The latest exact package pin is in `web/package.json`.

```sh title="Build and check documentation"
cd web
npm ci --no-audit --no-fund
npm run build:docs
npm run check:docs
```

The reader serves its generated assets from `web/docs-content` and `web/docs-bundle`. A standalone frontend preview can serve `web/` without rebuilding the Rust machine, while final integration uses the coherent `make web-dist` build.

## Reference runbooks

The Reference library covers toolchain setup, differential fuzzing, stress validation, image builders, compliance, benchmarks, and every bounded VirGL verification tool. Archived rr/remote-host commands remain visible with a current-policy notice.

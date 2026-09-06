// E5-T25b: editor-facing TypeScript entrypoint for the browser-consumed JavaScript harness.
// The no-bundler page imports desktop-perf.js directly; keeping this projection as a re-export
// prevents two independent aggregation implementations from drifting.
export * from "./desktop-perf.js";

// Build the shared interface bundle (web/ui/src → web/ui.js + web/ui.css + web/ui-assets/).
// Same esbuild and React that tools/build-docs.mjs uses; no second toolchain.
//
//   cd web && npm run build:ui
//
// Deterministic: no timestamps or absolute paths reach the output, so two builds from the same
// lockfile produce identical bytes (tools/verify-ui-foundation.sh checks this). Pages reference
// ./ui.js?rev=<sha> and ./ui.css?rev=<sha>; the revs are restamped here from the emitted bytes.
import { build } from "../web/node_modules/esbuild/lib/main.js";
import { readFile, readdir, rm, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(repo, "web");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Package JS modules import their own CSS as a side effect (docstream's markdown styles, KaTeX).
// esbuild keeps those stylesheets even when tree-shaking removes every byte of the importing
// module, which would ship ~145 KB of CSS for components we never render. Stub CSS imported from
// package JS, record each one, and fail below if any recorded importer contributed code to ui.js —
// i.e. stubbing only ever removes styles for modules that are not in the bundle.
const stubbedCss = [];
const dropUnusedPackageCss = {
  name: "drop-unused-package-css",
  setup(b) {
    b.onResolve({ filter: /\.css$/ }, (args) => {
      if (args.kind !== "import-statement" || !/node_modules\/.+\.m?js$/.test(args.importer)) return undefined;
      stubbedCss.push({ css: args.path, importer: path.relative(web, args.importer) });
      return { path: `${path.relative(web, args.importer)}::${args.path}`, namespace: "stubbed-css" };
    });
    b.onLoad({ filter: /.*/, namespace: "stubbed-css" }, () => ({ contents: "", loader: "css" }));
  },
};

await rm(path.join(web, "ui-assets"), { recursive: true, force: true });
const result = await build({
  plugins: [dropUnusedPackageCss],
  absWorkingDir: web,
  entryPoints: { ui: "ui/src/index.jsx" },
  outdir: web,
  bundle: true,
  format: "esm",
  splitting: false,
  treeShaking: true,
  minify: true,
  legalComments: "eof",
  target: ["es2022", "chrome111", "firefox113", "safari16.4"],
  jsx: "automatic",
  metafile: true,
  assetNames: "ui-assets/[name]-[hash]",
  loader: { ".woff2": "file", ".woff": "file", ".ttf": "file" },
  // Optional peers of the library that only modules we never import reach (pglite storage,
  // tailscale networking). Left unresolved; tools/verify-ui-foundation.sh asserts they are absent
  // from the emitted bundle.
  external: ["@electric-sql/pglite", "@electric-sql/pglite-tools", "@agent-wasm/tailscale-connect"],
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

const reports = path.join(repo, "target/ui-build");
await mkdir(reports, { recursive: true });
await writeFile(path.join(reports, "metafile.json"), JSON.stringify(result.metafile, null, 2) + "\n");

const shipped = result.metafile.outputs["ui.js"].inputs;
const live = stubbedCss.filter(({ importer }) => (shipped[importer]?.bytesInOutput ?? 0) > 0);
if (live.length) {
  throw new Error(`[build-ui] stubbed CSS belongs to bundled modules: ${JSON.stringify(live, null, 2)}`);
}

const js = await readFile(path.join(web, "ui.js"));
const css = await readFile(path.join(web, "ui.css"));
const jsRev = sha(js).slice(0, 12);
const cssRev = sha(css).slice(0, 12);

// Which library modules made it into the bundle (tree-shaking evidence).
const libraryModules = Object.entries(shipped)
  .filter(([p, info]) => info.bytesInOutput > 0 && p.includes("node_modules/@brett_lamy/ui/dist/") && p.endsWith(".js"))
  .map(([p]) => p)
  .map((p) => p.slice(p.indexOf("@brett_lamy/ui/dist/") + "@brett_lamy/ui/dist/".length))
  .sort();
const assets = (await readdir(path.join(web, "ui-assets"))).sort();
const report = {
  "ui.js": { bytes: js.length, sha256: sha(js) },
  "ui.css": { bytes: css.length, sha256: sha(css) },
  assets: Object.fromEntries(await Promise.all(assets.map(async (a) => [a, (await readFile(path.join(web, "ui-assets", a))).length]))),
  libraryModules,
  stubbedCss: [...new Set(stubbedCss.map((s) => `${s.importer} -> ${s.css}`))].sort(),
};
await writeFile(path.join(reports, "report.json"), JSON.stringify(report, null, 2) + "\n");

for (const name of (await readdir(web)).filter((n) => n.endsWith(".html")).sort()) {
  const file = path.join(web, name);
  const html = await readFile(file, "utf8");
  const next = html
    .replace(/\.\/ui\.js(?:\?rev=[a-f0-9]+)?/g, `./ui.js?rev=${jsRev}`)
    .replace(/\.\/ui\.css(?:\?rev=[a-f0-9]+)?/g, `./ui.css?rev=${cssRev}`);
  if (next !== html) await writeFile(file, next);
}

console.log(`[build-ui] ui.js ${js.length} B (rev ${jsRev}), ui.css ${css.length} B (rev ${cssRev}), ${libraryModules.length} library modules, ${assets.length} font files`);

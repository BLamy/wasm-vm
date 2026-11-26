// Verifier (E5-T37b, A4/H1): run the ACTUAL startLinuxBoot source (as web/tests/omarchy-seeded-loader.test.mjs
// does) with the real guest-clock validators and recording stubs for everything that would fetch,
// and see which option sets the "paced" gate refuses before the first fetch.
import { readFileSync } from "node:fs"; import vm from "node:vm"; import path from "node:path"; import { pathToFileURL } from "node:url";
const web = path.resolve(process.argv[2]);
const loader = readFileSync(path.join(web, "loader.js"), "utf8");
const gc = await import(pathToFileURL(path.join(web, "guest-clock.js")).href);
const dc = await import(pathToFileURL(path.join(web, "decoded-cache.js")).href);
const a = loader.indexOf("export async function startLinuxBoot("), b = loader.indexOf("\nexport function resolveSlirpProvider", a);
const src = loader.slice(a, b).replace("export async function startLinuxBoot(", "async function startLinuxBoot(").replaceAll("import.meta.url", JSON.stringify(pathToFileURL(path.join(web, "loader.js")).href));
async function attempt(opts) {
  const reached = [];
  const reach = (name) => (...args) => { reached.push(name); throw new Error(`REACHED ${name}`); };
  const sandbox = { ...gc, ...dc, isLoopbackOrigin: () => true, resolveSlirpProvider: () => ({ provider: "offline" }),
    fetch: reach("fetch"), fetchVerifiedBootAsset: reach("fetchVerifiedBootAsset"), fetchWholeImage: reach("fetchWholeImage"), init: reach("wasm init"),
    TextEncoder, TextDecoder, URL, URLSearchParams, location: { search: "", href: "http://127.0.0.1/" }, navigator: { locks: undefined, storage: {} },
    console: { warn() {}, log() {}, error() {} }, performance: { now: () => 0 }, setTimeout: () => {}, Error, TypeError, RangeError, Number, Boolean, String, Object, JSON, Promise };
  const states = [];
  try { await vm.runInNewContext(`(${src})`, sandbox)({ onState: (s) => states.push(s), onError: () => {}, ...opts }); return { outcome: "RESOLVED?" }; }
  catch (e) { const m = String(e?.message ?? e); return { outcome: /^REACHED /.test(m) ? `admitted (went on to: ${m.slice(8)})` : /is not defined/.test(m) ? `admitted (went past the gates: ${m})` : `refused: ${m}`, fetchesBeforeRefusal: reached.length }; }
}
const W = { mode: "chunked", wholeImageUrl: "http://127.0.0.1/whole.img.gz", wholeImageSha256: "a".repeat(64), manifestUrl: "m", imageManifestUrl: "i", bootProfileUrl: null };
const cases = [
  ["the Replay desktop's shape: paced, persist false, whole image", { ...W, interactiveClock: "paced", persist: false }],
  ["paced, persist omitted (the option's default is false)", { ...W, interactiveClock: "paced" }],
  ["paced, persist true", { ...W, interactiveClock: "paced", persist: true }],
  ["paced, persist null", { ...W, interactiveClock: "paced", persist: null }],
  ["paced, persist 0", { ...W, interactiveClock: "paced", persist: 0 }],
  ["paced, persist 'false'", { ...W, interactiveClock: "paced", persist: "false" }],
  ["paced, no whole image (lazy chunked)", { ...W, wholeImageUrl: undefined, wholeImageSha256: undefined, interactiveClock: "paced", persist: false }],
  ["paced, wholeImageUrl null", { ...W, wholeImageUrl: null, interactiveClock: "paced", persist: false }],
  ["paced, initramfs mode (default), no whole image", { interactiveClock: "paced", persist: false }],
  ["paced, disk mode with a wholeImageUrl", { ...W, mode: "disk", interactiveClock: "paced", persist: false }],
  ["paced, guestClock wall", { ...W, interactiveClock: "paced", persist: false, guestClock: "wall" }],
  ["paced + accelerated graphics (virgl, worker, whole image, persist false)", { ...W, interactiveClock: "paced", persist: false, virgl: true, workerMode: true, bootSnapshot: false }],
  ["paced + networking (slirpNet), whole image, persist false", { ...W, interactiveClock: "paced", persist: false, slirpNet: true }],
  ["paced + microphone, whole image, persist false", { ...W, interactiveClock: "paced", persist: false, enableMic: true }],
  ["paced-on-keyboard without accelerated graphics", { ...W, interactiveClock: "paced-on-keyboard", persist: false }],
  ["no policy, persist true (another guest)", { ...W, persist: true }],
];
const out = []; for (const [name, opts] of cases) out.push({ name, ...(await attempt(opts)) });
console.log(JSON.stringify(out, null, 1));

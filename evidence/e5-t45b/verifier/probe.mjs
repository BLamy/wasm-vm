// E5-T45b verifier probe: runs commands through the page's serial shell on the published desktop.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const [base, out] = process.argv.slice(2);
const repo = "/Users/blamy/Documents/Codex/wasm-vm";
const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
const errors = [];
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("favicon")) errors.push(m.text().slice(0, 300)); });
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
await page.addInitScript(() => { window.addEventListener("wvm:desktop-ready", () => { window.__r = performance.now(); }); });
const url = `${base}/app.html?guest=replay-desktop&desktop=1&net=0#ide`;
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.__r !== undefined && document.getElementById("omarchy-boot-overlay")?.hidden === true, null, { timeout: 1_800_000, polling: 250 });
const report = { url, readyS: (Date.now() - t0) / 1000, manifest: await (await fetch(`${base}/artifacts-replay-desktop.json`)).json().then(j => j.artifacts.bootSnapshot.url), cmds: [] };
const N = "/opt/replay-node-26/bin/node";
const T = (c) => `s=$(cut -d' ' -f1 /proc/uptime); ${c}; e=$(cut -d' ' -f1 /proc/uptime); echo "GUEST_S $s $e"`;
const cmds = [
  `sha256sum ${N}; ls -la /run/replay-node 2>&1; echo "NODE_OPTIONS=[$NODE_OPTIONS]"; cat /usr/local/bin/node; id`,
  `${N} -p 'JSON.stringify({snap:process.config.variables.node_use_node_snapshot,cc:process.config.variables.node_use_node_code_cache,v:process.version,execPath:process.execPath,arch:process.arch})'`,
  `NODE_DEBUG_NATIVE=CODE_CACHE ${N} -e 'require("https");require("worker_threads");require("child_process")' > /tmp/cc.log 2>&1; echo exit=$?; wc -l < /tmp/cc.log; echo accepted=$(grep -c 'is accepted' /tmp/cc.log) rejected=$(grep -ci 'reject' /tmp/cc.log) without=$(grep -c 'without cache' /tmp/cc.log) withcache=$(grep -c 'with cache' /tmp/cc.log); grep -i -m3 'reject\\|without' /tmp/cc.log; head -3 /tmp/cc.log`,
  `/usr/local/bin/node -e 'console.log(42)'; echo exit=$?`,
  T(`${N} -e 0`), T(`${N} -e 0`), T(`${N} -e 0`),
  T(`${N} --no-node-snapshot -e 0`), T(`${N} --no-node-snapshot -e 0`), T(`${N} --no-node-snapshot -e 0`),
  `${N} -e 'const {Worker}=require("worker_threads");const w=new Worker("const p=require(\\"worker_threads\\").parentPort;p.postMessage(\\"worker-ok \\"+require(\\"os\\").arch()+\\" \\"+process.versions.node)",{eval:true});w.on("message",m=>console.log(m));w.on("exit",c=>console.log("worker-exit",c))'; echo exit=$?`,
  `NODE_DEBUG_NATIVE=CODE_CACHE ${N} -e 'const {Worker}=require("worker_threads");new Worker("require(\\"zlib\\")",{eval:true}).on("exit",c=>console.log("wexit",c))' > /tmp/wcc.log 2>&1; echo exit=$?; echo accepted=$(grep -c 'is accepted' /tmp/wcc.log) rejected=$(grep -ci 'reject' /tmp/wcc.log) without=$(grep -c 'without cache' /tmp/wcc.log); tail -1 /tmp/wcc.log`,
  `${N} -e 'const cp=require("child_process");console.log(cp.execFileSync(process.execPath,["-p","6*7"]).toString().trim(), process.execPath); console.log(cp.execSync("node -p process.execPath",{env:{PATH:"/usr/local/bin:/usr/bin:/bin"}}).toString().trim()); const r=cp.spawnSync(process.execPath,["-e","process.exit(3)"]);console.log("status",r.status)'; echo exit=$?`,
  `NODE_DEBUG_NATIVE=CODE_CACHE ${N} -e 'require("child_process").execFileSync(process.execPath,["-e","require(\\"http\\")"],{stdio:"inherit"})' > /tmp/ccc.log 2>&1; echo exit=$?; echo accepted=$(grep -c 'is accepted' /tmp/ccc.log) rejected=$(grep -ci 'reject' /tmp/ccc.log) without=$(grep -c 'without cache' /tmp/ccc.log)`,
  `cd /tmp && echo 'globalThis.x=41+1; require("v8").startupSnapshot.setDeserializeMainFunction(()=>console.log("from-user-snapshot", globalThis.x))' > /tmp/e.js && ${N} --snapshot-blob /tmp/s.blob --build-snapshot /tmp/e.js; echo build=$?; ls -l /tmp/s.blob; ${N} --snapshot-blob /tmp/s.blob; echo run=$?; rm -f /tmp/s.blob /tmp/e.js`,
  `su -s /bin/sh $(awk -F: '$3==1000{print $1}' /etc/passwd) -c '/usr/local/bin/node -e "console.log(\\"user\\", process.getuid(), require(\\"os\\").userInfo().username)"' 2>&1; echo exit=$?`,
];
for (const c of cmds) {
  const t = Date.now();
  let r;
  try { r = await page.evaluate((c) => window.wvmDemo.exec(c, 600_000, { quiet: true }), c); } catch (e) { r = { error: String(e) }; }
  report.cmds.push({ cmd: c, wallMs: Date.now() - t, ...r });
  console.log("$", c.slice(0, 120)); console.log(JSON.stringify(r).slice(0, 1500));
}
report.consoleErrors = errors;
fs.writeFileSync(out, JSON.stringify(report, null, 2));
await page.screenshot({ path: out.replace(/\.json$/, ".png") });
await browser.close();

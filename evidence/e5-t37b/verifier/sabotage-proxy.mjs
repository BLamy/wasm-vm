// Verifier (E5-T37b, novel attack): serve the committed bundle from :8125 unchanged, except one
// file whose text is mutated in memory. Nothing in the checkout is touched.
//   node sabotage-proxy.mjs <port> <path> <find> <replace>
import http from "node:http";
const [port, target, find, replace] = process.argv.slice(2);
const upstream = { host: "127.0.0.1", port: 8125 };
let hits = 0;
http.createServer((req, res) => {
  const pathname = req.url.split("?")[0];
  const up = http.request({ ...upstream, method: req.method, path: req.url, headers: { ...req.headers, host: "127.0.0.1:8125" } }, (r) => {
    if (pathname !== target || r.statusCode !== 200) { res.writeHead(r.statusCode, r.headers); r.pipe(res); return; }
    const chunks = []; r.on("data", (c) => chunks.push(c)); r.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.split(find).length !== 2) { res.writeHead(500); res.end("sabotage target text not found exactly once"); console.error("MUTATION NOT APPLIED"); return; }
      const body = Buffer.from(text.replace(find, replace), "utf8"); hits += 1;
      console.error(`served mutated ${pathname} (${hits})`);
      res.writeHead(200, { ...r.headers, "content-length": String(body.length) }); res.end(body);
    });
  });
  up.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(up);
}).listen(Number(port), "127.0.0.1", () => console.error(`sabotage proxy on http://127.0.0.1:${port} -> :8125, mutating ${target}`));

#!/usr/bin/env node
// Local preview. Serves the repo and stands in for the Netlify functions:
// content is read from content.json (GET only; the admin POST path is not
// emulated), and the rota function runs for real from its source against an
// in-memory store that lasts for the life of the process. Both rota functions
// run, each with its own store. The admin password for bootstrapping either one
// locally is "local" unless ADMIN_PASSWORD is set.
//
//   node tools/serve.mjs [port] [content-file]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize, join } from "node:path";
import { createHandler, memoryStore } from "../netlify/src/rota.mjs";
import { createHandler as createForoige, memoryStore as foroigeStore } from "../netlify/src/foroige.mjs";

process.env.ADMIN_PASSWORD ||= "local";
const rota = createHandler((() => { const s = memoryStore(); return () => s; })());
const foroige = createForoige((() => { const s = foroigeStore(); return () => s; })());

const port = Number(process.argv[2]) || 8899;
const contentFile = process.argv[3] || "content.json";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".txt": "text/plain", ".pdf": "application/pdf",
  ".webmanifest": "application/manifest+json" };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const fn = url.pathname.includes("/.netlify/functions/rota") ? rota
    : url.pathname.includes("/.netlify/functions/foroige") ? foroige : null;
  if (fn) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const init = { method: req.method, headers: req.headers };
    if (chunks.length) init.body = Buffer.concat(chunks);
    const out = await fn(new Request(url, init));
    res.writeHead(out.status, Object.fromEntries(out.headers));
    return res.end(Buffer.from(await out.arrayBuffer()));
  }
  if (url.pathname.includes("/.netlify/functions/content")) {
    try {
      const body = JSON.parse(await readFile(contentFile, "utf8"));
      body.source = "local";
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify(body));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: String(e.message || e) }));
    }
  }
  // Keep the path inside the repo: strip leading slashes after normalising.
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const file = join(process.cwd(), rel || "index.html");
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}).listen(port, () => console.log(`http://127.0.0.1:${port}  (content from ${contentFile})`));

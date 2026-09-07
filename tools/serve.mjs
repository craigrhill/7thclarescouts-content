#!/usr/bin/env node
// Local preview. Serves the repo and stands in for the Netlify content
// function, so the app loads real content.json instead of falling back to
// defaults.js. GET only; the admin POST path is not emulated.
//
//   node tools/serve.mjs [port] [content-file]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize, join } from "node:path";

const port = Number(process.argv[2]) || 8899;
const contentFile = process.argv[3] || "content.json";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
  ".pdf": "application/pdf", ".webmanifest": "application/manifest+json" };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
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

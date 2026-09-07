// Source for netlify/functions/content.mjs. Do not edit the built file; edit
// this and run `npm run build:function`, which bundles @netlify/blobs in so the
// deployed function stays self-contained and the zip-drop fallback keeps working.
//
// GET  returns the content. If GITHUB_REPO and GITHUB_TOKEN are set it reads
//      content.json from that repo (branch GITHUB_BRANCH, default main) and
//      reports source: "github"; otherwise Netlify Blobs, source: "blobs".
//      The fallback is silent, so that field is the only reliable signal.
// POST saves it. Needs the x-admin-password header. ?check=1 only verifies
//      the password and reports which source is in use.
import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";

const BUILT_IN_HASH = "e5aea01f131ba1b26c0c87bb21822cc93e73039466bf15f6cae3a1b77ac1235d";
const STORE = "site-content";
const KEY = "content";
const FILE = "content.json";
const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-password",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers });
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const gh = () => {
  const repo = process.env.GITHUB_REPO, token = process.env.GITHUB_TOKEN;
  if (!repo || !token) return null;
  const path = process.env.GITHUB_PATH || FILE;
  return { url: `https://api.github.com/repos/${repo}/contents/${path}`, token, branch: process.env.GITHUB_BRANCH || "main" };
};
const ghHeaders = (t) => ({ Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json", "User-Agent": "7thclare-app", "X-GitHub-Api-Version": "2022-11-28" });
async function ghRead(g) {
  const r = await fetch(`${g.url}?ref=${g.branch}&t=${Date.now()}`, { headers: ghHeaders(g.token) });
  if (r.status === 404) return { data: null, sha: null };
  if (!r.ok) throw new Error(`GitHub read failed: ${r.status}`);
  const j = await r.json();
  const text = Buffer.from(j.content.replace(/\n/g, ""), "base64").toString("utf8");
  return { data: JSON.parse(text), sha: j.sha };
}
async function ghWrite(g, data, message) {
  const { sha } = await ghRead(g);
  const body = { message, content: Buffer.from(JSON.stringify(data, null, 2)).toString("base64"), branch: g.branch };
  if (sha) body.sha = sha;
  const r = await fetch(g.url, { method: "PUT", headers: { ...ghHeaders(g.token), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`GitHub write failed: ${r.status} ${await r.text()}`);
}
export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers });
  const g = gh();
  if (req.method === "GET") {
    try {
      if (g) {
        const { data: data2 } = await ghRead(g);
        if (data2) return json(200, { ...data2, source: "github" });
      }
      const data = await getStore(STORE).get(KEY, { type: "json" });
      return json(200, data ? { ...data, source: "blobs" } : { empty: true, source: g ? "github" : "blobs" });
    } catch (e) {
      return json(500, { error: String(e.message || e) });
    }
  }
  if (req.method === "POST") {
    const given = req.headers.get("x-admin-password") || "";
    const envPw = process.env.ADMIN_PASSWORD;
    const ok = envPw ? safeEqual(given, envPw) : safeEqual(createHash("sha256").update(given).digest("hex"), BUILT_IN_HASH);
    if (!ok) return json(401, { error: "Wrong password." });
    const url = new URL(req.url);
    if (url.searchParams.get("check")) return json(200, { ok: true, source: g ? "github" : "blobs" });
    let body;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "Body must be JSON." });
    }
    if (!body || typeof body !== "object") return json(400, { error: "Invalid content." });
    delete body.source;
    body.updatedAt = (new Date()).toISOString();
    body.updatedBy = "admin";
    try {
      if (g) await ghWrite(g, body, `Admin save ${body.updatedAt}`);
      else await getStore(STORE).setJSON(KEY, body);
      return json(200, { ok: true, updatedAt: body.updatedAt, source: g ? "github" : "blobs" });
    } catch (e) {
      return json(500, { error: String(e.message || e) });
    }
  }
  return json(405, { error: "Method not allowed." });
};

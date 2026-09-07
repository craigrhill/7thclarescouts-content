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
// A subscription feed, so a parent's calendar keeps itself up to date instead
// of holding a snapshot that goes stale. Public and read only: ?ics=1, with an
// optional &section= to take just one section plus whole-group events.
const icsEsc = (s) => String(s ?? "").replace(/([\\,;])/g, "\\$1").replace(/\r?\n/g, "\\n");
const icsDay = (d) => String(d).replace(/-/g, "");
const dayAfter = (d) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
// RFC 5545 wants lines folded at 75 octets, continued with a leading space.
const fold = (line) => {
  const out = []; let s = line;
  while (Buffer.byteLength(s, "utf8") > 75) {
    let cut = 75;
    while (cut > 1 && Buffer.byteLength(s.slice(0, cut), "utf8") > 75) cut--;
    out.push(s.slice(0, cut)); s = " " + s.slice(cut);
  }
  out.push(s); return out;
};
export function toICS(events, name, host) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//7th Clare Scouts//Calendar//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:" + icsEsc(name), "X-WR-TIMEZONE:Europe/Dublin"];
  for (const e of events) {
    if (!e || !e.date || !e.title) continue;
    const uid = (e.countyId || (e.date + "-" + String(e.title).toLowerCase().replace(/[^a-z0-9]+/g, "-"))) + "@" + host;
    lines.push("BEGIN:VEVENT", "UID:" + uid, "DTSTAMP:" + stamp,
      "DTSTART;VALUE=DATE:" + icsDay(e.date), "DTEND;VALUE=DATE:" + icsDay(dayAfter(e.endDate || e.date)),
      "SUMMARY:" + icsEsc(e.title));
    if (e.location) lines.push("LOCATION:" + icsEsc(e.location));
    const desc = [e.details, e.time ? "Time: " + e.time : ""].filter(Boolean).join("\n\n");
    if (desc) lines.push("DESCRIPTION:" + icsEsc(desc));
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.flatMap(fold).join("\r\n") + "\r\n";
}

export default async (req) => {
  // A 204 must not carry a body, even an empty string: the Fetch spec makes the
  // Response constructor throw, which turned every CORS preflight into a 502.
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const g = gh();
  if (req.method === "GET" && new URL(req.url).searchParams.get("ics")) {
    try {
      const url = new URL(req.url);
      const want = (url.searchParams.get("section") || "").trim().toLowerCase();
      let data = null;
      if (g) data = (await ghRead(g)).data;
      if (!data) data = await getStore(STORE).get(KEY, { type: "json" });
      if (!data) return json(404, { error: "No calendar yet." });
      const all = Array.isArray(data.events) ? data.events : [];
      // A section feed carries that section's events plus anything group-wide.
      const list = want ? all.filter((e) => !e.section || e.section === want) : all;
      const names = (data.settings && data.settings.sections) || [];
      const label = want ? (names.find((s) => s.key === want) || {}).name || want : "All sections";
      return new Response(toICS(list, "7th Clare Scouts: " + label, url.host), {
        status: 200,
        headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "public, max-age=900", "Access-Control-Allow-Origin": "*" }
      });
    } catch (e) {
      return json(500, { error: String(e.message || e) });
    }
  }
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

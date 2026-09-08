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
//
// Photos live in their own Blobs store, not in the repo:
//   POST ?photo=1        x-admin-password, body is the image itself  { id, url }
//   GET  ?photo=<id>     public, cached forever, since the id is the hash
//   POST ?photos=list    x-admin-password                            { photos }
//   POST ?photos=prune   x-admin-password, body { keep: [id] }       { removed }
import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";

// The deployed function talks to Netlify Blobs. The local preview and the
// offline harness put a store of their own in front of it, which is the only
// way to exercise the upload path without a Netlify account.
let stores = (name) => getStore(name);
export function useStore(fn) { stores = fn; }

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
// ---- photos ----
// Uploads land in a Blobs store rather than the repo: even after the browser
// has shrunk it a photo is a few hundred kilobytes, and git is the wrong place
// for that. The name is the hash of the bytes, so the same photo uploaded twice
// is stored once, and a URL can be cached forever because its contents can
// never change.
const PHOTO_STORE = "photos";
const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_PHOTO = 5 * 1024 * 1024;
const PHOTO_ID = /^[0-9a-f]{32}\.(jpg|png|webp)$/;
const photoId = (bytes, ext) => createHash("sha256").update(bytes).digest("hex").slice(0, 32) + "." + ext;
// A photo uploaded moments ago may not be in the content document yet, so
// tidying up never touches anything younger than this.
const PRUNE_GRACE = 60 * 60 * 1000;

// A subscription feed, so a parent's calendar keeps itself up to date instead
// of holding a snapshot that goes stale. Public and read only: ?ics=1, with an
// optional &section= to take just one section plus whole-group events.
const icsEsc = (s) => String(s ?? "").replace(/([\\,;])/g, "\\$1").replace(/\r?\n/g, "\\n");
const icsDay = (d) => String(d).replace(/-/g, "");
const dayAfter = (d) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
// An event carries 24 hour times when someone has set them, and is all day when
// nobody has. A calendar app can only put an event at the right hour if it is
// told the hour and the zone, so a timed one is written against a VTIMEZONE for
// Europe/Dublin rather than as a floating time that would drift for anyone
// abroad. Legacy events have only the free text a leader typed; that still goes
// in the description, where it is at least readable.
const isTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || "");
const icsAt = (d, t) => icsDay(d) + "T" + t.replace(":", "") + "00";
// An event with a start and no end runs an hour, the same guess a calendar app
// makes, held back from crossing midnight.
const hourAfter = (t) => { const [h, m] = t.split(":").map(Number); return h >= 23 ? "23:59" : String(h + 1).padStart(2, "0") + ":" + String(m).padStart(2, "0"); };
const DUBLIN = ["BEGIN:VTIMEZONE", "TZID:Europe/Dublin",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0000", "TZOFFSETTO:+0100", "TZNAME:IST", "DTSTART:19700329T010000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0000", "TZNAME:GMT", "DTSTART:19701025T020000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
  "END:VTIMEZONE"];
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
  const usable = events.filter((e) => e && e.date && e.title);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//7th Clare Scouts//Calendar//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:" + icsEsc(name), "X-WR-TIMEZONE:Europe/Dublin"];
  if (usable.some((e) => isTime(e.startTime))) lines.push(...DUBLIN);
  for (const e of usable) {
    const uid = (e.countyId || (e.date + "-" + String(e.title).toLowerCase().replace(/[^a-z0-9]+/g, "-"))) + "@" + host;
    lines.push("BEGIN:VEVENT", "UID:" + uid, "DTSTAMP:" + stamp);
    if (isTime(e.startTime)) {
      const last = e.endDate || e.date;
      const end = isTime(e.endTime) && (last > e.date || e.endTime > e.startTime) ? e.endTime : hourAfter(e.startTime);
      lines.push("DTSTART;TZID=Europe/Dublin:" + icsAt(e.date, e.startTime), "DTEND;TZID=Europe/Dublin:" + icsAt(last, end));
    } else {
      lines.push("DTSTART;VALUE=DATE:" + icsDay(e.date), "DTEND;VALUE=DATE:" + icsDay(dayAfter(e.endDate || e.date)));
    }
    lines.push("SUMMARY:" + icsEsc(e.title));
    if (e.location) lines.push("LOCATION:" + icsEsc(e.location));
    const desc = [e.details, !isTime(e.startTime) && e.time ? "Time: " + e.time : ""].filter(Boolean).join("\n\n");
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
      if (!data) data = await stores(STORE).get(KEY, { type: "json" });
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
  if (req.method === "GET" && new URL(req.url).searchParams.get("photo")) {
    const id = new URL(req.url).searchParams.get("photo");
    if (!PHOTO_ID.test(id)) return json(400, { error: "Not a photo name." });
    try {
      const got = await stores(PHOTO_STORE).getWithMetadata(id, { type: "arrayBuffer" });
      if (!got || !got.data) return json(404, { error: "No such photo." });
      return new Response(got.data, { status: 200, headers: {
        "Content-Type": (got.metadata && got.metadata.type) || "image/jpeg",
        // The name is the hash of the bytes, so this can never go stale.
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*"
      } });
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
      const data = await stores(STORE).get(KEY, { type: "json" });
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
    if (url.searchParams.get("photo")) {
      const type = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const ext = PHOTO_TYPES[type];
      if (!ext) return json(415, { error: "A photo must be JPEG, PNG or WebP." });
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (!bytes.length) return json(400, { error: "That upload was empty." });
      if (bytes.length > MAX_PHOTO) return json(413, { error: "That photo is too big, even after resizing." });
      const id = photoId(bytes, ext);
      try {
        await stores(PHOTO_STORE).set(id, bytes, { metadata: { type, size: bytes.length, at: new Date().toISOString() } });
        return json(200, { id, url: "/photo/" + id, size: bytes.length });
      } catch (e) {
        return json(500, { error: String(e.message || e) });
      }
    }
    const photos = url.searchParams.get("photos");
    if (photos === "list" || photos === "prune") {
      try {
        const store = stores(PHOTO_STORE);
        const { blobs } = await store.list();
        const keys = (blobs || []).map((b) => b.key).filter((k) => PHOTO_ID.test(k));
        if (photos === "list") {
          const out = [];
          for (const key of keys) { const m = await store.getMetadata(key); out.push({ id: key, size: (m && m.metadata && m.metadata.size) || 0, at: (m && m.metadata && m.metadata.at) || null }); }
          return json(200, { photos: out });
        }
        let keep;
        try { keep = (await req.json()).keep; } catch { keep = null; }
        if (!Array.isArray(keep)) return json(400, { error: "Send the list of photos to keep." });
        const kept = new Set(keep.map((k) => String(k).split("/").pop()));
        const removed = [];
        for (const key of keys) {
          if (kept.has(key)) continue;
          // Young files are left alone: one may have been uploaded by someone
          // else since this list of what to keep was drawn up.
          const m = await store.getMetadata(key);
          const at = m && m.metadata && m.metadata.at ? Date.parse(m.metadata.at) : 0;
          if (at && Date.now() - at < PRUNE_GRACE) continue;
          await store.delete(key);
          removed.push(key);
        }
        return json(200, { removed });
      } catch (e) {
        return json(500, { error: String(e.message || e) });
      }
    }
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
      else await stores(STORE).setJSON(KEY, body);
      return json(200, { ok: true, updatedAt: body.updatedAt, source: g ? "github" : "blobs" });
    } catch (e) {
      return json(500, { error: String(e.message || e) });
    }
  }
  return json(405, { error: "Method not allowed." });
};

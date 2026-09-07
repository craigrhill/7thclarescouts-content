// Source for netlify/functions/rota.mjs (built by `npm run build:function`).
//
// Volunteer rota for the leaders' area. Everything lives in the private Netlify
// Blobs store "rota" and nothing here is ever published. Access is by personal
// code, which proves who someone is; a signed token then keeps them signed in
// for TOKEN_DAYS. Three roles, held as flags on a person:
//   secretary  maintains the roster: people, the sections each can cover,
//              codes. Done once, on lab/roster.html.
//   lead       runs coverage for a section: adults needed, anyone's ticks,
//              weeks off. On lab/rota.html.
//   (neither)  sees the rota and ticks only themselves.
// While no secretary exists yet (a roster created before the role did), leads
// hold the secretary's powers, so nobody is locked out by the change.
//
// Keys in the store:
//   secret          HMAC key, generated on first use, never leaves the server
//   roster          { people: [{ id, name, sections, lead, secretary, code, codeHash }] }
//                   The code itself is kept so the secretary can see it again;
//                   the store is private, and GET returns codes to secretaries only.
//   section/<key>   { required, slots: { <slotId>: { who: [personId], off, need } } }
//
// Every write is read-modify-write guarded by the document's etag, retried on
// a conflict, so two people editing at once cannot overwrite each other.
//
// API (all JSON; auth by the x-rota-token header):
//   OPTIONS                                         204
//   GET    ?sections=a,b                            { me, people, sections }
//   POST   ?a=bootstrap  x-admin-password  {name}   { person, code }   first secretary
//   POST   ?a=login                        {code}   { token, me }
//   POST   ?a=slot     {section,id,add?,remove?,off?,need?}   { section }
//   POST   ?a=required {section,required}                     { section }   lead
//   POST   ?a=person   {name,sections,lead,secretary}         { person, code }   secretary
//   POST   ?a=person-update {id,name?,sections?,lead?,secretary?}  { person }   secretary
//   POST   ?a=person-remove {id,sections}                     { people }   secretary
//   POST   ?a=recode   {id}                                   { code }   secretary
//   POST   ?a=event        {date,title,section?,...,private?}  { events }   secretary
//   POST   ?a=event-update {key,...}                           { events }   secretary
//   POST   ?a=event-remove {key,private?}                      { events }   secretary
//
// Calendar events: a public one is written into content.json, the same file
// admin.html edits, so it reaches parents and the rota alike. A "private" one
// is kept in this store under "events" and never leaves the leaders' area.
// Either way an event is identified by "date|title".
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

const STORE = "rota";
const CONTENT_STORE = "site-content", CONTENT_KEY = "content", CONTENT_FILE = "content.json";
const TOKEN_DAYS = 365; // a code signs a phone in for a year
// The admin password check is the same as in content.mjs, duplicated on purpose
// so each built function stays self-contained. Change both together.
const BUILT_IN_HASH = "e5aea01f131ba1b26c0c87bb21822cc93e73039466bf15f6cae3a1b77ac1235d";
const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-password, x-rota-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers });
const fail = (status, error) => json(status, { error });

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function adminOk(req) {
  const given = req.headers.get("x-admin-password") || "";
  const envPw = process.env.ADMIN_PASSWORD;
  return envPw ? safeEqual(given, envPw) : safeEqual(createHash("sha256").update(given).digest("hex"), BUILT_IN_HASH);
}

// ---- the public group calendar, in content.json ----
// The same GitHub-or-Blobs path content.mjs uses, duplicated so this function
// stays self-contained when bundled. Change both together.
const gh = () => {
  const repo = process.env.GITHUB_REPO, token = process.env.GITHUB_TOKEN;
  if (!repo || !token) return null;
  const path = process.env.GITHUB_PATH || CONTENT_FILE;
  return { url: `https://api.github.com/repos/${repo}/contents/${path}`, token, branch: process.env.GITHUB_BRANCH || "main" };
};
const ghHeaders = (t) => ({ Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json", "User-Agent": "7thclare-rota", "X-GitHub-Api-Version": "2022-11-28" });
async function ghRead(g) {
  const r = await fetch(`${g.url}?ref=${g.branch}&t=${Date.now()}`, { headers: ghHeaders(g.token) });
  if (r.status === 404) return { data: null, sha: null };
  if (!r.ok) throw new Error(`GitHub read failed: ${r.status}`);
  const j = await r.json();
  return { data: JSON.parse(Buffer.from(j.content.replace(/\n/g, ""), "base64").toString("utf8")), sha: j.sha };
}
// The sha passed in is the one from the read this change was based on, so a
// save by someone else in between makes GitHub reject with 409 rather than
// letting us overwrite it. Re-reading the sha here would defeat that.
const CONFLICT = "conflict";
async function ghWrite(g, data, message, sha) {
  const body = { message, content: Buffer.from(JSON.stringify(data, null, 2)).toString("base64"), branch: g.branch };
  if (sha) body.sha = sha;
  const r = await fetch(g.url, { method: "PUT", headers: { ...ghHeaders(g.token), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.status === 409 || r.status === 422) throw new Error(CONFLICT);
  if (!r.ok) throw new Error(`GitHub write failed: ${r.status}`);
}
async function readContent(storeFactory) {
  const g = gh();
  if (g) { const { data, sha } = await ghRead(g); if (data) return { doc: data, sha }; }
  const doc = await storeFactory(CONTENT_STORE).get(CONTENT_KEY, { type: "json" });
  if (!doc) throw new Error("The group calendar is not set up yet.");
  return { doc, sha: null };
}
// Read the whole content document, change only its events, write it back,
// retrying if someone else saved while we were working.
async function withContentEvents(storeFactory, fn) {
  const g = gh();
  for (let attempt = 0; ; attempt++) {
    const { doc, sha } = await readContent(storeFactory);
    const out = fn(doc);
    if (out.error) return out;
    doc.events = out.events;
    doc.updatedAt = new Date().toISOString();
    doc.updatedBy = "secretary";
    try {
      if (g) await ghWrite(g, doc, `Calendar update ${doc.updatedAt}`, sha);
      else await storeFactory(CONTENT_STORE).setJSON(CONTENT_KEY, doc);
      return out;
    } catch (e) {
      if (String(e.message) !== CONFLICT || attempt >= 2) throw e;
    }
  }
}

// ---- one-way sync from the county calendar ----
// We read the county's public feed and never write back to it. Each county
// event is held here by its own id with a decision: pending until a section
// lead approves it, approved once it has been copied onto the group calendar,
// declined if we are not going. Only sections the group actually runs count,
// so a Rovers-only county event never appears.
const COUNTY_FEED = process.env.COUNTY_FEED || "https://calendar.countyclarescouts.ie/api/events";
const countyFallback = () => ({ items: {}, syncedAt: null });

// A county event, in the shape the group calendar and the app already use.
function fromCounty(ce, ourSections) {
  const mine = (ce.sections || []).filter((s) => ourSections.includes(s));
  const e = { date: ce.start, title: oneLine(ce.name, 120) };
  if (ce.end && ce.end !== ce.start) e.endDate = ce.end;
  if (mine.length === 1) e.section = mine[0];          // several sections means whole group
  const location = oneLine(ce.location, 120); if (location) e.location = location;
  const time = oneLine(ce.time, 60); if (time) e.time = time;
  const bits = [ce.description, ce.host ? "Hosted by " + ce.host : "", ce.link].filter(Boolean);
  if (bits.length) e.details = bits.join("\n\n").trim().slice(0, 2000);
  e.countyId = ce.id;
  return e;
}
// What a lead needs to see to decide, plus enough to spot a change.
const countyStamp = (ce) => JSON.stringify([ce.start, ce.end, ce.name, ce.time, ce.location, ce.description, ce.host, ce.link, (ce.sections || []).slice().sort()]);
const relevant = (ce, ourSections) => {
  const secs = ce.sections || [];
  return secs.length === 0 || secs.some((s) => ourSections.includes(s));
};
async function fetchCounty() {
  const r = await fetch(COUNTY_FEED + (COUNTY_FEED.includes("?") ? "&" : "?") + "t=" + Date.now(), { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("The county calendar did not answer (" + r.status + ").");
  const j = await r.json();
  const list = Array.isArray(j) ? j : j.events;
  if (!Array.isArray(list)) throw new Error("The county calendar sent something unexpected.");
  return list.filter((e) => e && e.id && e.start && e.name);
}

// ---- store access with optimistic concurrency ----
async function readDoc(store, key, fallback) {
  const r = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
  return r && r.data ? { doc: r.data, etag: r.etag } : { doc: fallback(), etag: null };
}
async function update(store, key, fallback, fn) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { doc, etag } = await readDoc(store, key, fallback);
    const next = fn(doc);
    if (next === false) return doc;
    next.updatedAt = new Date().toISOString();
    const r = await store.set(key, JSON.stringify(next), etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (r.modified !== false) return next;
  }
  throw new Error("Someone else saved at the same moment. Try again.");
}
const secrets = new WeakMap();
async function secret(store) {
  if (secrets.has(store)) return secrets.get(store);
  const r = await store.getWithMetadata("secret", { type: "text", consistency: "strong" });
  let s = r && r.data;
  if (!s) {
    s = randomBytes(32).toString("hex");
    const w = await store.set("secret", s, { onlyIfNew: true });
    if (w.modified === false) s = (await store.getWithMetadata("secret", { type: "text", consistency: "strong" })).data;
  }
  secrets.set(store, s);
  return s;
}

// ---- codes and tokens ----
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
function newCode() { const b = randomBytes(8); let c = ""; for (let i = 0; i < 8; i++) c += ALPHABET[b[i] & 31]; return c.slice(0, 4) + "-" + c.slice(4); }
const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z2-9]/g, "");
const hmac = (sec, s, enc) => createHmac("sha256", Buffer.from(sec, "hex")).update(s).digest(enc);
const codeHash = (sec, code) => hmac(sec, normCode(code), "hex");
function issueToken(sec, id) {
  const payload = Buffer.from(JSON.stringify({ id, exp: Date.now() + TOKEN_DAYS * 864e5 })).toString("base64url");
  return payload + "." + hmac(sec, payload, "base64url");
}
function readToken(sec, token) {
  if (typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const want = hmac(sec, payload, "base64url");
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try { const j = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); return j.id && j.exp > Date.now() ? j : null; } catch { return null; }
}

// ---- shapes and validation ----
const rosterFallback = () => ({ people: [] });
const eventsFallback = () => ({ events: [] });
const eventKey = (e) => e.date + "|" + e.title;
const sameEvent = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T12:00:00Z"));
const oneLine = (v, n) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, n);
// Events go on the public site, so every field is checked and capped here.
function cleanEvent(b, sectionKeys, kitIds) {
  if (!isDate(b.date)) return { error: "A start date is needed." };
  const title = oneLine(b.title, 120);
  if (!title) return { error: "A title is needed." };
  const e = { date: b.date, title };
  if (b.endDate) {
    if (!isDate(b.endDate)) return { error: "That end date is not a date." };
    if (b.endDate < b.date) return { error: "The end date is before the start date." };
    e.endDate = b.endDate;
  }
  const section = oneLine(b.section, 32);
  if (section) { if (!sectionKeys.includes(section)) return { error: "Unknown section." }; e.section = section; }
  const location = oneLine(b.location, 120); if (location) e.location = location;
  const time = oneLine(b.time, 60); if (time) e.time = time;
  const kitId = oneLine(b.kitId, 32);
  if (kitId) { if (!kitIds.includes(kitId)) return { error: "Unknown kit list." }; e.kitId = kitId; }
  const details = String(b.details ?? "").trim().slice(0, 2000); if (details) e.details = details;
  return { event: e };
}
const sectionFallback = () => ({ required: 2, slots: {} });
const pub = (p, withCode) => ({ id: p.id, name: p.name, sections: p.sections || [], lead: !!p.lead, secretary: !!p.secretary, ...(withCode ? { code: p.code || null } : {}) });
const isKey = (k) => typeof k === "string" && /^[a-z0-9-]{1,32}$/.test(k);
const isSlotId = (s) => typeof s === "string" && /^[me]:\d{4}-\d{2}-\d{2}(:.{1,140})?$/.test(s);
const cleanName = (n) => String(n || "").trim().replace(/\s+/g, " ").slice(0, 60);
const cleanSections = (a) => Array.isArray(a) ? [...new Set(a.filter(isKey))] : [];
async function body(req) { try { const b = await req.json(); return b && typeof b === "object" ? b : null; } catch { return null; } }

export function createHandler(storeFactory) {
  return async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const url = new URL(req.url);
    const a = url.searchParams.get("a") || "";
    try {
      const store = storeFactory(STORE);
      const sec = await secret(store);

      // Unauthenticated entry points.
      if (req.method === "POST" && a === "bootstrap") {
        if (!adminOk(req)) return fail(401, "Wrong password.");
        const b = await body(req); const name = cleanName(b && b.name);
        if (!name) return fail(400, "A name is needed.");
        const code = newCode(); let person;
        await update(store, "roster", rosterFallback, (doc) => {
          person = doc.people.find((p) => p.name.toLowerCase() === name.toLowerCase());
          if (person) { person.lead = true; person.secretary = true; person.code = code; person.codeHash = codeHash(sec, code); }
          else { person = { id: randomBytes(4).toString("hex"), name, sections: [], lead: true, secretary: true, code, codeHash: codeHash(sec, code), createdAt: new Date().toISOString() }; doc.people.push(person); }
          return doc;
        });
        return json(200, { person: pub(person), code });
      }
      if (req.method === "POST" && a === "login") {
        const b = await body(req); const h = codeHash(sec, b && b.code);
        const { doc } = await readDoc(store, "roster", rosterFallback);
        const person = doc.people.find((p) => p.codeHash === h);
        if (!person || normCode(b.code).length < 8) { await new Promise((r) => setTimeout(r, 250)); return fail(401, "That code is not recognised."); }
        return json(200, { token: issueToken(sec, person.id), me: pub(person) });
      }

      // Everything else needs a valid token for a person still on the roster.
      const t = readToken(sec, req.headers.get("x-rota-token"));
      if (!t) return fail(401, "Please sign in.");
      const roster = await readDoc(store, "roster", rosterFallback);
      const me = roster.doc.people.find((p) => p.id === t.id);
      if (!me) return fail(401, "Please sign in.");
      const hasSecretary = roster.doc.people.some((p) => p.secretary);
      const canManage = !!me.secretary || (!hasSecretary && !!me.lead);

      if (req.method === "GET") {
        const keys = (url.searchParams.get("sections") || "").split(",").map((s) => s.trim()).filter(isKey);
        const sections = {};
        for (const k of keys) { const { doc } = await readDoc(store, "section/" + k, sectionFallback); sections[k] = { required: doc.required, slots: doc.slots, updatedAt: doc.updatedAt || null }; }
        // Leads and the secretary see everyone. Others see the people who share a section with them, which is all coverage needs.
        const mine = new Set(me.sections || []);
        const visible = (me.lead || canManage) ? roster.doc.people : roster.doc.people.filter((p) => p.id === me.id || (p.sections || []).some((k) => mine.has(k)));
        const { doc: ev } = await readDoc(store, "events", eventsFallback);
        const { doc: cd } = await readDoc(store, "county", countyFallback);
        const ourSections = new Set(keys);
        const county = Object.entries(cd.items || {})
          .filter(([, it]) => {
            if (canManage) return true;
            if (!me.lead) return false;
            const evs = (it.event.sections || []).filter((x) => ourSections.has(x));
            return evs.length === 0 || evs.some((x) => mine.has(x));
          })
          .map(([id, it]) => ({ id, status: it.status, changed: !!it.changed, gone: !!it.gone, by: it.by || null, event: it.event }));
        return json(200, { me: pub(me, canManage), people: visible.map((p) => pub(p, canManage)), sections, events: ev.events || [], county, countySyncedAt: cd.syncedAt || null });
      }
      if (req.method !== "POST") return fail(405, "Method not allowed.");
      if (a === "county-sync") {
        let content;
        try { content = (await readContent(storeFactory)).doc; }
        catch (e) { return fail(503, String(e.message || e)); }
        const ourSections = (content.settings.sections || []).map((x) => x.key);
        let feed;
        try { feed = await fetchCounty(); } catch (e) { return fail(502, String(e.message || e)); }

        const seen = new Set();
        let added = 0, changed = 0, gone = 0;
        const doc = await update(store, "county", countyFallback, (d) => {
          for (const ce of feed) {
            if (!relevant(ce, ourSections)) continue;
            seen.add(ce.id);
            const stamp = countyStamp(ce), was = d.items[ce.id];
            if (!was) { d.items[ce.id] = { status: "pending", stamp, event: ce, at: new Date().toISOString() }; added++; }
            else if (was.stamp !== stamp) { was.stamp = stamp; was.event = ce; was.changed = true; delete was.gone; changed++; }
          }
          for (const [id, it] of Object.entries(d.items)) {
            if (!seen.has(id) && !it.gone) { it.gone = true; gone++; }
            else if (seen.has(id) && it.gone) delete it.gone;
          }
          d.syncedAt = new Date().toISOString();
          return d;
        });
        // An approved event whose county details moved is updated in place, so
        // the group calendar follows the county without needing approval again.
        const following = Object.values(doc.items).filter((it) => it.status === "approved" && it.changed);
        if (following.length) {
          await withContentEvents(storeFactory, (cdoc) => {
            const list = Array.isArray(cdoc.events) ? [...cdoc.events] : [];
            for (const it of following) {
              const i = list.findIndex((e) => e.countyId === it.event.id);
              const next = fromCounty(it.event, ourSections);
              if (i >= 0) list[i] = next; else list.push(next);
            }
            list.sort((x, y) => x.date.localeCompare(y.date) || x.title.localeCompare(y.title));
            return { events: list };
          });
          await update(store, "county", countyFallback, (d) => { for (const it of following) if (d.items[it.event.id]) delete d.items[it.event.id].changed; return d; });
        }
        return json(200, { added, changed, gone, followed: following.length, syncedAt: doc.syncedAt });
      }

      const b = await body(req);
      if (!b) return fail(400, "Body must be JSON.");

      if (a === "slot") {
        if (!isKey(b.section) || !isSlotId(b.id)) return fail(400, "Bad section or slot.");
        const known = new Set(roster.doc.people.map((p) => p.id));
        const add = Array.isArray(b.add) ? b.add : [], remove = Array.isArray(b.remove) ? b.remove : [];
        if ([...add, ...remove].some((id) => !known.has(id))) return fail(400, "Unknown person.");
        if (!me.lead) {
          if ("off" in b || "need" in b) return fail(403, "Only a section lead can change that.");
          if ([...add, ...remove].some((id) => id !== me.id)) return fail(403, "You can only tick yourself.");
        }
        const doc = await update(store, "section/" + b.section, sectionFallback, (d) => {
          const s = d.slots[b.id] = d.slots[b.id] || { who: [], off: false };
          s.who = [...new Set([...s.who.filter((id) => !remove.includes(id)), ...add])].filter((id) => known.has(id));
          if ("off" in b) s.off = !!b.off;
          if ("need" in b) { const n = Number(b.need); if (n >= 1 && n <= 9 && n !== d.required) s.need = Math.round(n); else delete s.need; }
          return d;
        });
        return json(200, { section: doc });
      }

      if (a === "required") {
        if (!me.lead) return fail(403, "Only a section lead can change that.");
        if (!isKey(b.section)) return fail(400, "Bad section.");
        const n = Math.round(Number(b.required));
        if (!(n >= 1 && n <= 9)) return fail(400, "Required must be 1 to 9.");
        const doc = await update(store, "section/" + b.section, sectionFallback, (d) => { d.required = n; for (const s of Object.values(d.slots)) if (s.need === n) delete s.need; return d; });
        return json(200, { section: doc });
      }
      if (a === "county-decide") {
        const decision = String(b.decision || "");
        if (!["approve", "decline", "reset"].includes(decision)) return fail(400, "Unknown decision.");
        let content;
        try { content = (await readContent(storeFactory)).doc; }
        catch (e) { return fail(503, String(e.message || e)); }
        const ourSections = (content.settings.sections || []).map((x) => x.key);
        const { doc: cdoc } = await readDoc(store, "county", countyFallback);
        const item = cdoc.items[b.id];
        if (!item) return fail(404, "No such county event.");
        // A lead may decide for their own sections; the secretary for anything.
        const evSections = (item.event.sections || []).filter((s) => ourSections.includes(s));
        const mine = (me.sections || []);
        const allowed = canManage || (me.lead && (evSections.length === 0 || evSections.some((s) => mine.includes(s))));
        if (!allowed) return fail(403, "That is not one of your sections.");

        const status = decision === "reset" ? "pending" : decision === "approve" ? "approved" : "declined";
        await update(store, "county", countyFallback, (d) => {
          const it = d.items[b.id]; if (!it) return false;
          it.status = status; it.by = me.name; it.at = new Date().toISOString(); delete it.changed;
          return d;
        });
        // Approved events go on the group calendar; anything else comes off it.
        await withContentEvents(storeFactory, (doc) => {
          const list = (Array.isArray(doc.events) ? doc.events : []).filter((e) => e.countyId !== b.id);
          if (status === "approved") list.push(fromCounty(item.event, ourSections));
          list.sort((x, y) => x.date.localeCompare(y.date) || x.title.localeCompare(y.title));
          return { events: list };
        });
        return json(200, { id: b.id, status });
      }

      if (!canManage) return fail(403, "Only the secretary can do that.");

      if (a === "event" || a === "event-update" || a === "event-remove") {
        const isPrivate = !!b.private;
        // Apply the change to a list of events, or return an error to report.
        // Sections and kit lists are checked against the group calendar even for
        // a private event, so the two stay consistent.
        const apply = (list, content) => {
          const sectionKeys = ((content && content.settings.sections) || []).map((x) => x.key);
          const kitIds = ((content && content.kits) || []).map((k) => k.id);
          if (a === "event-remove") {
            const next = list.filter((e) => !sameEvent(eventKey(e), b.key));
            return next.length === list.length ? { error: [404, "No such event."] } : { events: next };
          }
          const { event, error } = cleanEvent(b, sectionKeys, kitIds);
          if (error) return { error: [400, error] };
          const key = eventKey(event);
          const clash = (skip) => list.some((e, i) => i !== skip && sameEvent(eventKey(e), key));
          if (a === "event") {
            if (clash(-1)) return { error: [409, "There is already an event with that date and title."] };
            return { events: [...list, event] };
          }
          const i = list.findIndex((e) => sameEvent(eventKey(e), b.key));
          if (i < 0) return { error: [404, "No such event."] };
          if (clash(i)) return { error: [409, "There is already an event with that date and title."] };
          const next = [...list]; next[i] = event; return { events: next };
        };
        const sort = (l) => l.sort((x, y) => x.date.localeCompare(y.date) || x.title.localeCompare(y.title));

        let out;
        if (isPrivate) {
          let content = null;
          try { content = (await readContent(storeFactory)).doc; } catch {}
          let err = null;
          const d = await update(store, "events", eventsFallback, (doc) => {
            const r2 = apply(doc.events || [], content);
            if (r2.error) { err = r2.error; return false; }
            doc.events = sort(r2.events); return doc;
          });
          if (err) return fail(err[0], err[1]);
          out = { events: d.events };
        } else {
          try {
            out = await withContentEvents(storeFactory, (doc) => {
              const r2 = apply(Array.isArray(doc.events) ? doc.events : [], doc);
              return r2.error ? r2 : { events: sort(r2.events) };
            });
          } catch (e) { return fail(503, String(e.message || e)); }
          if (out.error) return fail(out.error[0], out.error[1]);
        }
        return json(200, { events: out.events, private: isPrivate });
      }


      if (a === "person") {
        const name = cleanName(b.name); if (!name) return fail(400, "A name is needed.");
        const code = newCode(); let person;
        await update(store, "roster", rosterFallback, (d) => {
          if (d.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) return false;
          person = { id: randomBytes(4).toString("hex"), name, sections: cleanSections(b.sections), lead: !!b.lead, secretary: !!b.secretary, code, codeHash: codeHash(sec, code), createdAt: new Date().toISOString() };
          d.people.push(person); return d;
        });
        if (!person) return fail(409, "Someone with that name is already on the list.");
        return json(200, { person: pub(person), code });
      }
      if (a === "person-update" || a === "person-remove" || a === "recode") {
        const target = roster.doc.people.find((p) => p.id === b.id);
        if (!target) return fail(404, "No such person.");
        // The roster must always have someone who can maintain it.
        const secretaries = roster.doc.people.filter((p) => p.secretary).length;
        const losingSecretary = target.secretary && (a === "person-remove" || (a === "person-update" && "secretary" in b && !b.secretary));
        if (losingSecretary && secretaries <= 1) return fail(409, "Keep at least one secretary.");
        if (a === "recode") {
          const code = newCode();
          await update(store, "roster", rosterFallback, (d) => { const p = d.people.find((x) => x.id === b.id); if (!p) return false; p.code = code; p.codeHash = codeHash(sec, code); return d; });
          return json(200, { code });
        }
        if (a === "person-update") {
          let person;
          await update(store, "roster", rosterFallback, (d) => {
            person = d.people.find((x) => x.id === b.id); if (!person) return false;
            if ("name" in b) { const n = cleanName(b.name); if (n) person.name = n; }
            if ("sections" in b) person.sections = cleanSections(b.sections);
            if ("lead" in b) person.lead = !!b.lead;
            if ("secretary" in b) person.secretary = !!b.secretary;
            return d;
          });
          return json(200, { person: pub(person) });
        }
        const doc = await update(store, "roster", rosterFallback, (d) => { d.people = d.people.filter((x) => x.id !== b.id); return d; });
        for (const k of cleanSections(b.sections)) {
          await update(store, "section/" + k, sectionFallback, (d) => { let hit = false; for (const s of Object.values(d.slots)) { const n = s.who.length; s.who = s.who.filter((id) => id !== b.id); if (s.who.length !== n) hit = true; } return hit ? d : false; });
        }
        return json(200, { people: doc.people.map(pub) });
      }
      return fail(400, "Unknown action.");
    } catch (e) {
      return fail(500, String(e.message || e));
    }
  };
}

// In-memory store with the same surface as a Netlify Blobs store, for the
// offline harness and the local preview. Etags change on every write, and the
// conditional options behave as the real client does.
export function memoryStore() {
  const m = new Map();
  return {
    _map: m,
    async getWithMetadata(key, opts = {}) {
      const e = m.get(key); if (!e) return null;
      return { data: opts.type === "json" ? JSON.parse(e.value) : e.value, etag: e.etag, metadata: {} };
    },
    async get(key, opts = {}) { const e = m.get(key); if (!e) return null; return opts.type === "json" ? JSON.parse(e.value) : e.value; },
    async setJSON(key, value) { m.set(key, { value: JSON.stringify(value), etag: randomBytes(6).toString("hex") }); },
    async set(key, value, opts = {}) {
      const cur = m.get(key);
      if (opts.onlyIfNew && cur) return { modified: false };
      if (opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
      const etag = randomBytes(6).toString("hex");
      m.set(key, { value: String(value), etag });
      return { etag, modified: true };
    }
  };
}

export default createHandler((name) => getStore(name));

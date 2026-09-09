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
//   message         { text }  the wording the secretary sends with a link
//   admin-tries     wrong tries at the admin password, when it reopens, how
//                   many times it has shut, and the deploy that was live at
//                   the time: a newer one starts the count again
//   roster          { people: [{ id, name, sections, lead, secretary, code, codeHash }] }
//                   The code itself is kept so the secretary can see it again;
//                   the store is private, and GET returns codes to secretaries only.
//   section/<key>   { required, slots: { <slotId>: { who: [personId] } } }
//                   Only who is down for a night lives here. What it needs,
//                   and whether it is on at all, are on the night itself.
//   calendar        { entries: [{ id, section, date, title, location, details,
//                                 need, off, startTime, endTime }] }
//                   The term's meetings, kept per section by its lead. While a
//                   section has none, the pages fall back to the eight weeks
//                   worked out from its weekday.
//
// Every write is read-modify-write guarded by the document's etag, retried on
// a conflict, so two people editing at once cannot overwrite each other.
//
// API (all JSON; auth by the x-rota-token header):
//   OPTIONS                                         204
//   GET    ?sections=a,b                            { me, people, sections }   sections on your entry only
//   POST   ?a=bootstrap  x-admin-password  {name}   { person, code }   first secretary
//   POST   ?a=login                        {code}   { token, me }
//   POST   ?a=admin-login  x-admin-password          { token, me }   as the secretary
//   POST   ?a=slot     {section,id,add?,remove?}             { section }
//   POST   ?a=required {section,required?,requiredQualified?,requiredQualifiedEvents?}
//                                                            { section }   lead
//   POST   ?a=calendar {section,entries}                      { calendar }  lead of it
//   POST   ?a=person   {name,sections,lead,secretary,qualified}  { person, code }   secretary
//   POST   ?a=person-update {id,name?,sections?,lead?,secretary?}  { person }   secretary
//   POST   ?a=person-remove {id,sections}                     { people }   secretary
//   POST   ?a=recode   {id}                                   { code }   secretary
//   POST   ?a=message  {text}                                 { message }   secretary
//                        The wording that goes out with a link. Blank puts the
//                        standard one back. Only the secretary's GET carries it.
//   POST   ?a=event        {date,title,section?,...,private?}  { events }   secretary, or a lead for their section
//   POST   ?a=event-update {key,...}                           { events }   secretary, or a lead for their section
//   POST   ?a=event-remove {key,private?}                      { events }   secretary, or a lead for their section
//   POST   ?a=county-sync                        { added, changed, gone, followed, repaired }   lead
//   POST   ?a=county-decide {id,section,decision}  { status }   lead of that section
//   GET    ?a=board&section=k     (no auth)     { section, updatedAt, rows: [{n, stages}] }
//   GET    ?a=cover&section=k     (no auth)     { required, nights: [{date, title, on, ...}] }
//                        Dates and counts for the chasing link. No names, no
//                        ids, and no leaders-only events.
//   GET    ?a=badges&sections=a,b               { me, boards, canEdit }
//   POST   ?a=badge-add    {section,name}                      { board }   lead of it
//   POST   ?a=badge-rename {section,id,name}                   { board }   lead of it
//   POST   ?a=badge-remove {section,id}                        { board }   lead of it
//   POST   ?a=badge-stage  {section,id,skill,stage 0..9}       { board }   lead of it
//   GET    ?a=attendance&sections=a,b            { me, sections: {k: {youth, meetings}}, canEdit, canAdd }
//   POST   ?a=attend        {section,date,present:[ids],note?}  { meetings }   anyone on that section
//   POST   ?a=attend-remove {section,date}                      { meetings }   anyone on that section
//
// Attendance: attendance/<key> holds one record per meeting date, the ids of
// the young people who were there (from the section's badge board, which is
// where names live) and an optional note. Anyone signed in with the section
// on their roster entry can fill it in, helpers included, because it is done
// at the door on a phone by whoever is there. Nothing in it is public.
//
// Badge boards: one document per section, badges/<key>, holds the section's
// young people and the stage each holds in the nine Adventure Skills. Names
// never leave this store. The public app reads the same board through
// ?a=board, which strips names and ids and labels each row by a number that
// is never changed or reused, so a Scout can be told "you are Cub 7" and find
// their row without being named. A lead edits the boards of the sections on
// their own roster entry, the secretary edits all, and anyone signed in can
// look at the boards of their own sections.
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
// Trimmed at both ends: a password pasted into Netlify with a trailing space
// or a newline looks identical in their UI and would refuse the right password
// for ever, with nothing at all to see.
function adminOk(req) {
  const given = (req.headers.get("x-admin-password") || "").trim();
  const envPw = (process.env.ADMIN_PASSWORD || "").trim();
  return envPw ? safeEqual(given, envPw) : safeEqual(createHash("sha256").update(given).digest("hex"), BUILT_IN_HASH);
}
// The password is the one door worth guessing at: it opens the admin editor,
// and through the bridge the leaders' area, which holds children's names. So
// it is throttled. Fifteen goes before anything happens, because whoever is
// getting it wrong is almost always a leader and not an attacker; if fifteen
// were not enough the sixteenth was never going to help, so the shuttings
// after it are long. Counted in the store so it holds across function
// instances, and wiped by a correct password.
const ADMIN_TRIES = 15, ADMIN_LOCKS = [5, 15, 60];
// A deploy clears it. Only whoever owns the site can deploy, so it is a lever
// the secretary has and somebody guessing does not. With neither variable set,
// under the preview and the harness, the count simply persists.
const deployId = () => process.env.DEPLOY_ID || process.env.COMMIT_REF || "";
const triesFallback = () => ({ fails: 0, until: 0, locks: 0, deploy: deployId() });
// One gate in front of both doors the password opens. Answers with the refusal
// to send back, or null when the password was right.
async function adminGate(store, req) {
  const { doc } = await readDoc(store, "admin-tries", triesFallback);
  const stale = deployId() && doc.deploy !== deployId();
  const waitMs = stale ? 0 : (doc.until || 0) - Date.now();
  if (waitMs > 0) {
    const mins = Math.ceil(waitMs / 60000);
    return fail(429, `Too many wrong tries. The password is shut for another ${mins} minute${mins === 1 ? "" : "s"}.`);
  }
  if (!adminOk(req)) {
    await update(store, "admin-tries", triesFallback, (d) => {
      if (deployId() && d.deploy !== deployId()) { d.fails = 0; d.until = 0; d.locks = 0; }
      d.deploy = deployId();
      d.fails = (d.fails || 0) + 1;
      if (d.fails >= ADMIN_TRIES) {
        d.until = Date.now() + ADMIN_LOCKS[Math.min(d.locks || 0, ADMIN_LOCKS.length - 1)] * 60000;
        d.locks = (d.locks || 0) + 1;
        d.fails = 0;
      }
      return d;
    });
    await new Promise((r) => setTimeout(r, 250));
    return fail(401, "Wrong password.");
  }
  // Right password: the count goes, so a leader who fumbled it twice yesterday
  // does not start today part way to being shut out.
  await update(store, "admin-tries", triesFallback, (d) => (d.fails || d.until || d.locks ? triesFallback() : false));
  return null;
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
    if (out.error || out.noop) return out;
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
// Which of our sections a county event is offered to. The county naming
// several sections is an offer to each of them, not one group event: each of
// our sections decides for itself. An event naming none of ours is open to all.
function countyTargets(ce, ourSections) {
  const named = (ce.sections || []).filter((s) => ourSections.includes(s));
  return named.length ? named : ourSections.slice();
}
// A decision per section, so approving for Cubs never speaks for Beavers.
// Older items carried one status for the whole event; it is read as applying
// to every section the event was offered to, so nothing already approved
// disappears from the calendar when this is deployed.
function countyDecisions(it, targets) {
  if (it.decisions) return it.decisions;
  const d = {};
  if (it.status && it.status !== "pending") for (const k of targets) d[k] = { status: it.status, by: it.by || null, at: it.at || null };
  return d;
}
const countyStatus = (it, k, targets) => ((countyDecisions(it, targets)[k] || {}).status) || "pending";
const countyApproved = (it, targets) => targets.filter((k) => countyStatus(it, k, targets) === "approved");
function fromCounty(ce, section) {
  const e = { date: ce.start, title: oneLine(ce.name, 120) };
  if (ce.end && ce.end !== ce.start) e.endDate = ce.end;
  if (section) e.section = section;
  const location = oneLine(ce.location, 120); if (location) e.location = location;
  const time = oneLine(ce.time, 60);
  const [from, to] = readTimes(time);
  if (from) { e.startTime = from; if (to && (e.endDate || to > from)) e.endTime = to; }
  else if (time) e.time = time;
  const bits = [ce.description, ce.host ? "Hosted by " + ce.host : "", ce.link].filter(Boolean);
  if (bits.length) e.details = bits.join("\n\n").trim().slice(0, 2000);
  e.countyId = ce.id;
  // Made from the county's own id, so it is the same after every sync: an
  // event rebuilt on Thursday is the same night as the one people put
  // themselves down for on Tuesday.
  e.id = ("c" + String(ce.id).replace(/[^A-Za-z0-9._-]/g, "") + (section ? "-" + section : "")).slice(0, 40);
  return e;
}
// Whether the calendar's entries for one county event match what the
// decisions say they should be. Field order does not matter, only the values.
const entryKey = (e) => JSON.stringify(Object.keys(e).sort().map((k) => [k, e[k]]));
const sameEvents = (x, y) => x.length === y.length && x.map(entryKey).sort().join("\u0000") === y.map(entryKey).sort().join("\u0000");
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
// Where an event's ticks hang. On its own id where it has one, and on the old
// date-and-name shape where it does not, which is everything saved before ids
// existed. The page works the same out, so the two agree.
const slotIdOf = (e) => "e:" + (isEntryId(e.id) ? e.id : e.date + ":" + e.title);
const oldSlotIdOf = (e) => "e:" + e.date + ":" + e.title;
const sameEvent = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T12:00:00Z"));
const oneLine = (v, n) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, n);
// Events go on the public site, so every field is checked and capped here.
function cleanEvent(b, sectionKeys, kitIds) {
  if (!isDate(b.date)) return { error: "A start date is needed." };
  const title = oneLine(b.title, 120);
  if (!title) return { error: "A title is needed." };
  const e = { date: b.date, title };
  // A stable id, so the ticks hang off the event rather than off its date and
  // name. Anything already saved has none; it gets one the first time it is
  // edited here, and its ticks are carried across with it.
  e.id = isEntryId(b.id) ? b.id : newEntryId();
  if (b.endDate) {
    if (!isDate(b.endDate)) return { error: "That end date is not a date." };
    if (b.endDate < b.date) return { error: "The end date is before the start date." };
    e.endDate = b.endDate;
  }
  const section = oneLine(b.section, 32);
  if (section) { if (!sectionKeys.includes(section)) return { error: "Unknown section." }; e.section = section; }
  const location = oneLine(b.location, 120); if (location) e.location = location;
  // Times are 24 hour "HH:MM" so a parent's calendar can put the event at the
  // right hour. An event without them is all day, as they all were before.
  if (b.startTime) { if (!isTime(b.startTime)) return { error: "That start time is not a time." }; e.startTime = b.startTime; }
  if (b.endTime) {
    if (!isTime(b.endTime)) return { error: "That end time is not a time." };
    if (!e.startTime) return { error: "An end time needs a start time." };
    if (!e.endDate && b.endTime <= e.startTime) return { error: "The end time is not after the start time." };
    e.endTime = b.endTime;
  }
  const time = oneLine(b.time, 60); if (time && !e.startTime) e.time = time;
  const need = optNum(b.need);
  if (need !== null) { if (!(need >= 1 && need <= 9)) return { error: "Adults needed must be 1 to 9." }; e.need = need; }
  const needQ = optNum(b.needQualified);
  if (needQ !== null) { if (!(needQ >= 0 && needQ <= 9)) return { error: "That number must be 0 to 9." }; e.needQualified = needQ; }
  const kitId = oneLine(b.kitId, 32);
  if (kitId) { if (!kitIds.includes(kitId)) return { error: "Unknown kit list." }; e.kitId = kitId; }
  const details = String(b.details ?? "").trim().slice(0, 2000); if (details) e.details = details;
  return { event: e };
}
const isTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || "");
// The county's feed gives the time as free text. Read it when it is not a
// guess ("7pm", "18:30", "6:00pm to 7:30pm") so the event lands at the right
// hour for a parent; a bare "10:00" could be either end of the day, so that is
// left as the text it came as.
const TIME_RE = /(\d{1,2})[:.](\d{2})\s*(?:([ap])\.?m\.?)?|(\d{1,2})\s*([ap])\.?m\.?/gi;
export function readTimes(text) {
  const out = [];
  for (const m of String(text || "").matchAll(TIME_RE)) {
    let h = +(m[1] ?? m[4]); const min = m[2] ? +m[2] : 0, mark = (m[3] || m[5] || "").toLowerCase();
    if (h > 23 || min > 59) continue;
    if (mark === "p") { if (h < 12) h += 12; }
    else if (mark === "a") { if (h === 12) h = 0; }
    else if (h < 13) continue;
    out.push(String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0"));
    if (out.length === 2) break;
  }
  return out;
}

const sectionFallback = () => ({ required: 2, slots: {} });

// ---- the meeting calendar ----
// A meeting used to be worked out from the section's weekday: the next eight,
// for ever, with no way to say a night is off for half term, or that one of
// them is somewhere else, or that this one needs three adults. It is a list
// now, kept per section by its lead. The ticks hang off an entry's id rather
// than its date and name, so moving or renaming a night keeps everyone already
// down for it. A seeded entry carries its date as its id, so the ids the
// derived weeks produced still match and nothing is lost on the first save.
const calendarFallback = () => ({ entries: [] });
// The message that goes out with somebody's link, as the secretary words it.
// Blank means the standard wording, which lives on the page.
const messageFallback = () => ({ text: "" });
const isEntryId = (x) => typeof x === "string" && /^[A-Za-z0-9._-]{1,40}$/.test(x);
const newEntryId = () => randomBytes(4).toString("hex");
const MAX_ENTRIES = 250;
function cleanEntry(x, sectionKey) {
  if (!x || !isDate(x.date)) return { error: "Every night needs a date." };
  const e = { id: isEntryId(x.id) ? x.id : newEntryId(), section: sectionKey, date: x.date };
  const title = oneLine(x.title, 120); if (title) e.title = title;
  const location = oneLine(x.location, 120); if (location) e.location = location;
  const details = String(x.details ?? "").trim().slice(0, 2000); if (details) e.details = details;
  const need = optNum(x.need);
  if (need !== null) { if (!(need >= 1 && need <= 9)) return { error: "Adults needed must be 1 to 9." }; e.need = need; }
  const needQ = optNum(x.needQualified);
  if (needQ !== null) { if (!(needQ >= 0 && needQ <= 9)) return { error: "That number must be 0 to 9." }; e.needQualified = needQ; }
  if (x.startTime) { if (!isTime(x.startTime)) return { error: "That start time is not a time." }; e.startTime = x.startTime; }
  if (x.endTime) {
    if (!isTime(x.endTime)) return { error: "That end time is not a time." };
    if (!e.startTime) return { error: "An end time needs a start time." };
    if (x.endTime <= e.startTime) return { error: "The end time is not after the start time." };
    e.endTime = x.endTime;
  }
  if (x.off) e.off = true;
  return { entry: e };
}
// Blank is not nought. Number(null) and Number("") are both 0, so an empty box
// would read as "needs nobody" rather than "as the section does".
function optNum(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : NaN;
}
const byDate = (a, b) => a.date.localeCompare(b.date) || String(a.title || "").localeCompare(String(b.title || ""));

// Move who is down for a night from one slot id to another, in one section.
// Used where an id changes: nobody should lose their place because a name was
// fixed or the county shifted an event by a week.
async function moveSlot(store, k, from, to) {
  if (from === to) return;
  await update(store, "section/" + k, sectionFallback, (d) => {
    const s = d.slots[from];
    if (!s || !(s.who || []).length) { if (s) { delete d.slots[from]; return d; } return false; }
    const dest = d.slots[to] = d.slots[to] || { who: [], off: false };
    dest.who = [...new Set([...dest.who, ...s.who])];
    delete d.slots[from];
    return d;
  });
}
// And take one away entirely, which is what removing a night means.
async function dropSlot(store, k, id) {
  await update(store, "section/" + k, sectionFallback, (d) => {
    if (!d.slots[id]) return false;
    delete d.slots[id]; return d;
  });
}

// Coverage, like the boards, is per section: a person sees and ticks the
// sections on their own roster entry; the secretary sees all of them.
const canSeeSection = (me, canManage, k) => canManage || (me.sections || []).includes(k);

// ---- badge boards ----
const SKILLS = ["camping", "backwoods", "pioneering", "hillwalking", "emergencies", "air", "paddling", "rowing", "sailing"];
const isSkill = (x) => SKILLS.includes(x);
const badgesFallback = () => ({ next: 1, youth: [], stages: {} });
const canSeeBoard = (me, canManage, k) => canManage || (me.sections || []).includes(k);
const canEditBoard = (me, canManage, k) => canSeeBoard(me, canManage, k) && (canManage || !!me.lead);
const byNumber = (youth) => [...youth].sort((x, y) => x.n - y.n);
const boardFor = (doc) => ({ next: doc.next, youth: byNumber(doc.youth), stages: doc.stages, updatedAt: doc.updatedAt || null });
// What the public site gets: numbers and stages, nothing that names anyone.
const attendanceFallback = () => ({ meetings: {} });
const publicBoard = (k, doc) => ({ section: k, updatedAt: doc.updatedAt || null, rows: byNumber(doc.youth).map((y) => ({ n: y.n, stages: doc.stages[y.id] || {} })) });
const pub = (p, withCode) => ({ id: p.id, name: p.name, sections: p.sections || [], lead: !!p.lead, secretary: !!p.secretary, qualified: !!p.qualified, ...(withCode ? { code: p.code || null } : {}) });
const isKey = (k) => typeof k === "string" && /^[a-z0-9-]{1,32}$/.test(k);
// A slot id is the kind, then the id of the night it belongs to: "m:<entryId>"
// for a meeting, "e:<eventId>" for an event. The older shapes, "m:<date>" and
// "e:<date>:<title>", still pass: a date is a valid id, and nobody's ticks
// should stop working because the shape was widened.
const isSlotId = (s) => typeof s === "string" && /^[me]:[A-Za-z0-9._-]{1,60}(:.{1,140})?$/.test(s);
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
        const shut = await adminGate(store, req); if (shut) return shut;
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
      // The admin password stands in for the secretary's code. A device that
      // holds it can already create or replace the secretary through
      // bootstrap, so signing it in as the current secretary adds no power;
      // it saves a code being typed. admin.html keeps the password on the
      // device and the leaders' pages use it to sign in on their own.
      if (req.method === "POST" && a === "admin-login") {
        const shut = await adminGate(store, req); if (shut) return shut;
        const { doc } = await readDoc(store, "roster", rosterFallback);
        const person = doc.people.find((p) => p.secretary);
        if (!person) return fail(409, "No secretary yet. Set one up on the roster page first.");
        return json(200, { token: issueToken(sec, person.id), me: pub(person) });
      }
      if (req.method === "POST" && a === "login") {
        const b = await body(req); const h = codeHash(sec, b && b.code);
        const { doc } = await readDoc(store, "roster", rosterFallback);
        const person = doc.people.find((p) => p.codeHash === h);
        if (!person || normCode(b.code).length < 8) { await new Promise((r) => setTimeout(r, 250)); return fail(401, "That code is not recognised."); }
        return json(200, { token: issueToken(sec, person.id), me: pub(person) });
      }

      if (req.method === "GET" && a === "board") {
        const k = url.searchParams.get("section") || "";
        if (!isKey(k)) return fail(400, "Bad section.");
        const { doc } = await readDoc(store, "badges/" + k, badgesFallback);
        return json(200, publicBoard(k, doc));
      }

      // What a section still needs, for the link a lead sends round when they
      // are chasing helpers. No token, and nothing personal in it: dates and
      // counts, never a name or an id. Leaders-only events are left out
      // entirely; only what is already on the parents' calendar appears.
      if (req.method === "GET" && a === "cover") {
        const k = url.searchParams.get("section") || "";
        if (!isKey(k)) return fail(400, "Bad section.");
        const today = new Date(); today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
        const t = today.toISOString().slice(0, 10);
        const { doc: sect } = await readDoc(store, "section/" + k, sectionFallback);
        const { doc: cal } = await readDoc(store, "calendar", calendarFallback);
        const { doc: roster2 } = await readDoc(store, "roster", rosterFallback);
        const qual = new Set(roster2.people.filter((p) => p.qualified).map((p) => p.id));
        let content = null;
        try { content = (await readContent(storeFactory)).doc; } catch {}
        const count = (id) => {
          const who = ((sect.slots || {})[id] || {}).who || [];
          return { on: who.length, qualified: who.filter((x) => qual.has(x)).length };
        };
        const nights = [];
        for (const e of (cal.entries || [])) {
          if (e.section !== k || e.date < t) continue;
          nights.push({ kind: "m", date: e.date, title: e.title || "", location: e.location || "", details: e.details || "",
            startTime: e.startTime || "", endTime: e.endTime || "", off: !!e.off,
            need: e.need > 0 ? e.need : null, needQualified: Number.isFinite(e.needQualified) ? e.needQualified : null, ...count("m:" + e.id) });
        }
        for (const e of ((content && content.events) || [])) {
          if ((e.endDate || e.date) < t) continue;
          if (e.section && e.section !== k) continue;
          nights.push({ kind: "e", date: e.date, endDate: e.endDate || "", title: e.title || "", location: e.location || "",
            details: e.details || "", startTime: e.startTime || "", endTime: e.endTime || "", off: false,
            need: e.need > 0 ? e.need : null, needQualified: Number.isFinite(e.needQualified) ? e.needQualified : null,
            ...count("e:" + (isEntryId(e.id) ? e.id : e.date + ":" + e.title)) });
        }
        nights.sort((x, y) => x.date.localeCompare(y.date) || x.title.localeCompare(y.title));
        return json(200, { section: k, required: sect.required, requiredQualified: sect.requiredQualified || 0,
          requiredQualifiedEvents: sect.requiredQualifiedEvents || 0, updatedAt: sect.updatedAt || null, nights });
      }

      // Everything else needs a valid token for a person still on the roster.
      const t = readToken(sec, req.headers.get("x-rota-token"));
      if (!t) return fail(401, "Please sign in.");
      const roster = await readDoc(store, "roster", rosterFallback);
      const me = roster.doc.people.find((p) => p.id === t.id);
      if (!me) return fail(401, "Please sign in.");
      const hasSecretary = roster.doc.people.some((p) => p.secretary);
      const canManage = !!me.secretary || (!hasSecretary && !!me.lead);

      if (req.method === "GET" && a === "badges") {
        const keys = (url.searchParams.get("sections") || "").split(",").map((s) => s.trim()).filter(isKey).filter((k) => canSeeBoard(me, canManage, k));
        const boards = {}, canEdit = {};
        for (const k of keys) { const { doc } = await readDoc(store, "badges/" + k, badgesFallback); boards[k] = boardFor(doc); canEdit[k] = canEditBoard(me, canManage, k); }
        return json(200, { me: pub(me, canManage), boards, canEdit });
      }

      if (req.method === "GET" && a === "attendance") {
        const keys = (url.searchParams.get("sections") || "").split(",").map((s) => s.trim()).filter(isKey).filter((k) => canSeeBoard(me, canManage, k));
        const sections = {}, canEdit = {}, canAdd = {};
        for (const k of keys) {
          const { doc: board } = await readDoc(store, "badges/" + k, badgesFallback);
          const { doc: att } = await readDoc(store, "attendance/" + k, attendanceFallback);
          sections[k] = { youth: byNumber(board.youth).map(({ id, n, name }) => ({ id, n, name })), meetings: att.meetings, updatedAt: att.updatedAt || null };
          canEdit[k] = true; canAdd[k] = canEditBoard(me, canManage, k);
        }
        return json(200, { me: pub(me, canManage), sections, canEdit, canAdd });
      }

      if (req.method === "GET") {
        // "wanted" is the group's list, which the county filter below needs
        // to know which of a county event's sections are ours at all;
        // "keys" is the part of it this person may see.
        const wanted = (url.searchParams.get("sections") || "").split(",").map((s) => s.trim()).filter(isKey);
        const keys = wanted.filter((k) => canSeeSection(me, canManage, k));
        const sections = {};
        for (const k of keys) { const { doc } = await readDoc(store, "section/" + k, sectionFallback); sections[k] = { required: doc.required, slots: doc.slots, updatedAt: doc.updatedAt || null }; }
        // Leads and the secretary see everyone. Others see the people who share a section with them, which is all coverage needs.
        const mine = new Set(me.sections || []);
        const visible = (me.lead || canManage) ? roster.doc.people : roster.doc.people.filter((p) => p.id === me.id || (p.sections || []).some((k) => mine.has(k)));
        const { doc: ev } = await readDoc(store, "events", eventsFallback);
        const { doc: cal } = await readDoc(store, "calendar", calendarFallback);
        const msg = canManage ? (await readDoc(store, "message", messageFallback)).doc.text || "" : undefined;
        const { doc: cd } = await readDoc(store, "county", countyFallback);
        const ourSections = new Set(wanted);
        const allKeys = [...ourSections];
        const county = (!me.lead && !canManage) ? [] : Object.entries(cd.items || {})
          .map(([id, it]) => {
            const targets = countyTargets(it.event, allKeys);
            // A lead only decides for their own sections, so only those rows come back.
            const rows = (canManage ? targets : targets.filter((k) => mine.has(k)))
              .map((k) => ({ section: k, status: countyStatus(it, k, targets), by: (countyDecisions(it, targets)[k] || {}).by || null }));
            // targets is every one of our sections the county offered it to, so
            // a lead can see the others are being asked without deciding for them.
            return { id, changed: !!it.changed, gone: !!it.gone, event: it.event, targets, rows };
          })
          .filter((x) => x.rows.length);
        return json(200, { me: pub(me, canManage), people: visible.map((p) => pub(p, canManage)), sections,
          events: ev.events || [],
          // The nights themselves, for the sections this person may see.
          calendar: { entries: (cal.entries || []).filter((e) => keys.includes(e.section)), updatedAt: cal.updatedAt || null },
          county, countySyncedAt: cd.syncedAt || null, ...(msg === undefined ? {} : { message: msg }) });
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
        // Bring the group calendar back in line with the decisions. That
        // covers an approved event whose county details moved, so the calendar
        // follows the county without needing approval again, and an entry that
        // drifted from its decisions any other way, so "Check the county" is a
        // repair as much as a fetch. Entries carrying a county id we have never
        // seen are left alone.
        const want = new Map(Object.entries(doc.items)
          .map(([id, it]) => [id, countyApproved(it, countyTargets(it.event, ourSections)).map((sk) => fromCounty(it.event, sk))]));
        const following = Object.entries(doc.items).filter(([id, it]) => it.changed && want.get(id).length);
        let repaired = 0;
        await withContentEvents(storeFactory, (cdoc) => {
          const keep = [], now = new Map();
          for (const e of (Array.isArray(cdoc.events) ? cdoc.events : [])) {
            if (e.countyId && want.has(e.countyId)) { const arr = now.get(e.countyId) || []; arr.push(e); now.set(e.countyId, arr); }
            else keep.push(e);
          }
          const stale = new Set([...want.keys()].filter((id) => !sameEvents(now.get(id) || [], want.get(id))));
          if (!stale.size) return { noop: true };
          repaired = stale.size;
          for (const [id, arr] of now) if (!stale.has(id)) keep.push(...arr);
          for (const id of stale) keep.push(...want.get(id));
          keep.sort((x, y) => x.date.localeCompare(y.date) || x.title.localeCompare(y.title));
          return { events: keep };
        });
        // County events used to hang their ticks off the date and the name, so
        // the county moving one lost everyone on it. They have an id of their
        // own now, made from the county's, which no sync changes. Carry the old
        // ticks across once, the first sync after that came in.
        if (!doc.movedSlots) {
          for (const list of want.values()) for (const e of list) await moveSlot(store, e.section || ourSections[0], oldSlotIdOf(e), slotIdOf(e));
          await update(store, "county", countyFallback, (d) => { d.movedSlots = true; return d; });
        }
        // The calendar now matches the county, so an approved item no longer
        // needs its "changed" flag; a pending one keeps it for the lead to see.
        if (following.length) await update(store, "county", countyFallback, (d) => { for (const [id] of following) if (d.items[id]) delete d.items[id].changed; return d; });
        return json(200, { added, changed, gone, followed: following.length, repaired, syncedAt: doc.syncedAt });
      }

      const b = await body(req);
      if (!b) return fail(400, "Body must be JSON.");

      // The term's nights, written whole for one section at a time. Whole,
      // because it is a short list the page holds while it is being edited and
      // one write keeps the etag guard meaningful: two leads editing together
      // conflict and retry rather than interleaving halves. One section at a
      // time, because a lead may only touch their own.
      if (a === "calendar") {
        const k = b.section;
        if (!isKey(k)) return fail(400, "Bad section.");
        if (!canSeeSection(me, canManage, k)) return fail(403, "That section is not on your roster entry.");
        if (!canManage && !me.lead) return fail(403, "Only a section lead can change the nights.");
        if (!Array.isArray(b.entries)) return fail(400, "Send the whole list of nights.");
        if (b.entries.length > MAX_ENTRIES) return fail(400, "That is more nights than a term needs.");
        const seen = new Set(), list = [];
        for (const x of b.entries) {
          const { entry, error } = cleanEntry(x, k);
          if (error) return fail(400, error);
          if (seen.has(entry.id)) entry.id = newEntryId();
          seen.add(entry.id); list.push(entry);
        }
        // A night taken off the list takes its ticks with it, or they would sit
        // there invisibly and come back if the id ever did.
        const { doc: before } = await readDoc(store, "calendar", calendarFallback);
        const gone = (before.entries || []).filter((e) => e.section === k && !seen.has(e.id));
        const doc = await update(store, "calendar", calendarFallback, (d) => {
          d.entries = [...(d.entries || []).filter((e) => e.section !== k), ...list].sort(byDate);
          return d;
        });
        for (const e of gone) await dropSlot(store, k, "m:" + e.id);
        // Back come the nights for the sections this person may see, which is
        // all of them for the secretary and their own for a lead.
        const mine = canManage ? null : new Set(me.sections || []);
        return json(200, { calendar: { entries: (doc.entries || []).filter((e) => !mine || mine.has(e.section)), updatedAt: doc.updatedAt || null } });
      }

      if (a === "badge-add" || a === "badge-rename" || a === "badge-remove" || a === "badge-stage") {
        const k = b.section;
        if (!isKey(k)) return fail(400, "Bad section.");
        if (!canSeeBoard(me, canManage, k)) return fail(403, "That section is not on your roster entry.");
        if (!canEditBoard(me, canManage, k)) return fail(403, "Only a section lead can change the board.");
        let problem = null;
        const doc = await update(store, "badges/" + k, badgesFallback, (d) => {
          if (a === "badge-add") {
            // Several at once, comma separated, as the roster's add form allows.
            const names = String(b.name || "").split(",").map(cleanName).filter(Boolean);
            if (!names.length) { problem = "A name is needed."; return false; }
            for (const name of names) d.youth.push({ id: randomBytes(4).toString("hex"), n: d.next++, name, addedAt: new Date().toISOString() });
            return d;
          }
          const y = d.youth.find((x) => x.id === b.id);
          if (!y) { problem = "Not on this board."; return false; }
          if (a === "badge-rename") { const name = cleanName(b.name); if (!name) { problem = "A name is needed."; return false; } y.name = name; return d; }
          if (a === "badge-remove") { d.youth = d.youth.filter((x) => x.id !== y.id); delete d.stages[y.id]; return d; }
          if (!isSkill(b.skill)) { problem = "Unknown skill."; return false; }
          const st = Math.round(Number(b.stage));
          if (!(st >= 0 && st <= 9)) { problem = "Stage must be 0 to 9."; return false; }
          const row = d.stages[y.id] = d.stages[y.id] || {};
          if (st === 0) delete row[b.skill]; else row[b.skill] = st;
          if (!Object.keys(row).length) delete d.stages[y.id];
          return d;
        });
        if (problem) return fail(400, problem);
        return json(200, { board: boardFor(doc) });
      }

      if (a === "attend" || a === "attend-remove") {
        const k = b.section;
        if (!isKey(k)) return fail(400, "Bad section.");
        if (!canSeeBoard(me, canManage, k)) return fail(403, "That section is not on your roster entry.");
        if (!isDate(b.date)) return fail(400, "Bad date.");
        const { doc: board } = await readDoc(store, "badges/" + k, badgesFallback);
        const known = new Set(board.youth.map((y) => y.id));
        const doc = await update(store, "attendance/" + k, attendanceFallback, (d) => {
          if (a === "attend-remove") { delete d.meetings[b.date]; return d; }
          const present = [...new Set((Array.isArray(b.present) ? b.present : []).filter((id) => known.has(id)))];
          const note = String(b.note || "").trim().slice(0, 80);
          d.meetings[b.date] = { present, note, by: me.name, at: new Date().toISOString() };
          return d;
        });
        return json(200, { meetings: doc.meetings });
      }

      if (a === "slot") {
        if (!isKey(b.section) || !isSlotId(b.id)) return fail(400, "Bad section or slot.");
        if (!canSeeSection(me, canManage, b.section)) return fail(403, "That section is not on your roster entry.");
        const known = new Set(roster.doc.people.map((p) => p.id));
        const add = Array.isArray(b.add) ? b.add : [], remove = Array.isArray(b.remove) ? b.remove : [];
        if ([...add, ...remove].some((id) => !known.has(id))) return fail(400, "Unknown person.");
        // What a night needs, and whether it is on at all, belong to the night
        // itself: they are set where it is created and edited, on the Events
        // page, and are not taken here from anyone.
        if ("off" in b || "need" in b) return fail(403, "Whether a night is on, and how many adults it needs, are set with the night itself on the Events page.");
        if (!me.lead && [...add, ...remove].some((id) => id !== me.id)) return fail(403, "You can only tick yourself.");
        // A night fills up and then closes: that is what makes it first come,
        // first served for a helper. Two things stop it deadlocking. While a
        // night still wants somebody who answers the group's rule, that many
        // places are held, so the last one cannot go to somebody who does not;
        // and if a night ends up full without one anyway, somebody who does
        // can still get on it. A lead and the secretary are held to none of
        // it: the rota is where they put right what self service has left.
        // Enforced inside the read-modify-write, so two people racing for the
        // last place cannot both win.
        const wants = a === "slot" && !me.lead && !canManage && add.includes(me.id);
        let entryNeed = null, entryNeedQ = null;
        if (wants) {
          const isEvent = b.id.startsWith("e:");
          const eid = b.id.slice(2);
          let night = null;
          if (isEvent) {
            let content = null; try { content = (await readContent(storeFactory)).doc; } catch {}
            const list = [...((content && content.events) || []), ...((await readDoc(store, "events", eventsFallback)).doc.events || [])];
            night = list.find((e) => slotIdOf(e) === b.id || oldSlotIdOf(e) === b.id) || null;
          } else {
            const { doc: cal } = await readDoc(store, "calendar", calendarFallback);
            night = (cal.entries || []).find((e) => e.section === b.section && e.id === eid) || null;
          }
          if (night && night.off) return fail(409, "That night is off.");
          entryNeed = night && night.need > 0 ? night.need : null;
          entryNeedQ = night && Number.isFinite(night.needQualified) ? night.needQualified : null;
        }
        const qualIds = new Set(roster.doc.people.filter((p) => p.qualified).map((p) => p.id));
        let refused = null;
        const doc = await update(store, "section/" + b.section, sectionFallback, (d) => {
          const s = d.slots[b.id] = d.slots[b.id] || { who: [] };
          if (wants && !s.who.includes(me.id)) {
            const need = entryNeed || d.required;
            const defQ = b.id.startsWith("e:") ? (d.requiredQualifiedEvents || 0) : (d.requiredQualified || 0);
            const needQ = Math.min(entryNeedQ === null ? defQ : entryNeedQ, need);
            const on = s.who.length, q = s.who.filter((id) => qualIds.has(id)).length;
            const held = Math.max(0, needQ - q);
            const okForMe = qualIds.has(me.id) ? (on < need || held > 0) : (on < need - held);
            if (!okForMe) {
              refused = held > 0 && on < need
                ? "That night is full apart from a place held for someone the group's rule asks for."
                : "That night is full. Ask your section lead if you need to be on it.";
              return false;
            }
          }
          s.who = [...new Set([...s.who.filter((id) => !remove.includes(id)), ...add])].filter((id) => known.has(id));
          return d;
        });
        if (refused) return fail(409, refused);
        return json(200, { section: doc });
      }

      if (a === "required") {
        if (!me.lead) return fail(403, "Only a section lead can change that.");
        if (!isKey(b.section)) return fail(400, "Bad section.");
        if (!canSeeSection(me, canManage, b.section)) return fail(403, "That section is not on your roster entry.");
        const set = {};
        for (const [field, lo] of [["required", 1], ["requiredQualified", 0], ["requiredQualifiedEvents", 0]]) {
          if (!(field in b)) continue;
          const n = optNum(b[field]);
          if (!(n >= lo && n <= 9)) return fail(400, "That number must be " + lo + " to 9.");
          set[field] = n;
        }
        if (!Object.keys(set).length) return fail(400, "Nothing to set.");
        const doc = await update(store, "section/" + b.section, sectionFallback, (d) => { Object.assign(d, set); return d; });
        return json(200, { section: doc });
      }
      if (a === "message") {
        if (!canManage) return fail(403, "Only the secretary can change that.");
        const text = String(b.text ?? "").slice(0, 2000);
        const doc = await update(store, "message", messageFallback, (d) => { d.text = text.trim() ? text : ""; return d; });
        return json(200, { message: doc.text });
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
        const targets = countyTargets(item.event, ourSections);
        const k = String(b.section || "");
        if (!isKey(k)) return fail(400, "Bad section.");
        if (!targets.includes(k)) return fail(400, "The county has not offered that event to that section.");
        // A lead decides for their own sections; the secretary for any.
        if (!(canManage || (me.lead && (me.sections || []).includes(k)))) return fail(403, "That is not one of your sections.");

        const status = decision === "reset" ? "pending" : decision === "approve" ? "approved" : "declined";
        const doc = await update(store, "county", countyFallback, (d) => {
          const it = d.items[b.id]; if (!it) return false;
          it.decisions = countyDecisions(it, targets);
          if (status === "pending") delete it.decisions[k];
          else it.decisions[k] = { status, by: me.name, at: new Date().toISOString() };
          delete it.status; delete it.by; delete it.changed;
          return d;
        });
        // Rebuild every event this county event owns from the decisions, so a
        // section approving or undoing never disturbs another's, and an older
        // whole-group copy is tidied away on the first decision.
        const approved = countyApproved(doc.items[b.id], targets);
        await withContentEvents(storeFactory, (cd2) => {
          const list = (Array.isArray(cd2.events) ? cd2.events : []).filter((e) => e.countyId !== b.id);
          for (const sk of approved) list.push(fromCounty(item.event, sk));
          list.sort((x, y) => x.date.localeCompare(y.date) || x.title.localeCompare(y.title));
          return { events: list };
        });
        return json(200, { id: b.id, section: k, status });
      }

      if (a === "event" || a === "event-update" || a === "event-remove") {
        const isPrivate = !!b.private;
        // Who may change an event: the secretary, anything; a lead, events of
        // the sections on their own roster entry. Whole-group events (no
        // section) are the secretary's. Helpers may only look.
        // A county event is driven by the county and rebuilt on every sync, so
        // editing it by hand would be undone. It is decided on the County chip.
        const mayEdit = (e) => !e.countyId && (canManage || (!!me.lead && !!e.section && (me.sections || []).includes(e.section)));
        const deny = (e) => e.countyId ? [403, "That came from the county. Change it on the County chip."]
          : e.section ? [403, "Only a lead of that section can change its events."] : [403, "Only the secretary can change whole-group events."];
        // Apply the change to a list of events, or return an error to report.
        // Sections and kit lists are checked against the group calendar even for
        // a private event, so the two stay consistent.
        const apply = (list, content) => {
          const sectionKeys = ((content && content.settings.sections) || []).map((x) => x.key);
          const kitIds = ((content && content.kits) || []).map((k) => k.id);
          const touches = (e) => (e.section ? [e.section] : sectionKeys);
          if (a === "event-remove") {
            const ex = list.find((e) => sameEvent(eventKey(e), b.key));
            if (!ex) return { error: [404, "No such event."] };
            if (!mayEdit(ex)) return { error: deny(ex) };
            // Its ticks go with it. Left behind they would be invisible, and
            // would come back if the same night were ever added again.
            return { events: list.filter((e) => e !== ex), drop: [[touches(ex), slotIdOf(ex)], [touches(ex), oldSlotIdOf(ex)]] };
          }
          const { event, error } = cleanEvent(b, sectionKeys, kitIds);
          if (error) return { error: [400, error] };
          const key = eventKey(event);
          const clash = (skip) => list.some((e, i) => i !== skip && sameEvent(eventKey(e), key));
          if (!mayEdit(event)) return { error: deny(event) };
          if (a === "event") {
            if (clash(-1)) return { error: [409, "There is already an event with that date and title."] };
            return { events: [...list, event] };
          }
          const i = list.findIndex((e) => sameEvent(eventKey(e), b.key));
          if (i < 0) return { error: [404, "No such event."] };
          if (!mayEdit(list[i])) return { error: deny(list[i]) };
          if (clash(i)) return { error: [409, "There is already an event with that date and title."] };
          // Keep the id it already had unless one was sent: a save from a page
          // that does not know about ids must not shuffle everyone off it.
          if (!isEntryId(b.id) && isEntryId(list[i].id)) event.id = list[i].id;
          const next = [...list]; next[i] = event;
          // Anything saved before ids existed is on the old key. Moving it now
          // is what keeps a renamed or shifted event's leaders with it.
          const from = slotIdOf(list[i]), to = slotIdOf(event);
          return { events: next, move: from === to ? [] : [[touches(event), from, to]] };
        };
        const sort = (l) => l.sort((x, y) => x.date.localeCompare(y.date) || x.title.localeCompare(y.title));

        // Slot moves and drops are collected by apply and run after the write,
        // so a refused change never touches anybody's place.
        let after = { move: [], drop: [] };
        const collect = (r2) => { after = { move: r2.move || [], drop: r2.drop || [] }; return r2; };
        let out;
        if (isPrivate) {
          let content = null;
          try { content = (await readContent(storeFactory)).doc; } catch {}
          let err = null;
          const d = await update(store, "events", eventsFallback, (doc) => {
            const r2 = collect(apply(doc.events || [], content));
            if (r2.error) { err = r2.error; return false; }
            doc.events = sort(r2.events); return doc;
          });
          if (err) return fail(err[0], err[1]);
          out = { events: d.events };
        } else {
          try {
            out = await withContentEvents(storeFactory, (doc) => {
              const r2 = collect(apply(Array.isArray(doc.events) ? doc.events : [], doc));
              return r2.error ? r2 : { events: sort(r2.events) };
            });
          } catch (e) { return fail(503, String(e.message || e)); }
          if (out.error) return fail(out.error[0], out.error[1]);
        }
        for (const [ks, from, to] of after.move) for (const k of ks) await moveSlot(store, k, from, to);
        for (const [ks, id] of after.drop) for (const k of ks) await dropSlot(store, k, id);
        return json(200, { events: out.events, private: isPrivate });
      }

      if (!canManage) return fail(403, "Only the secretary can do that.");



      if (a === "person") {
        const name = cleanName(b.name); if (!name) return fail(400, "A name is needed.");
        const code = newCode(); let person;
        await update(store, "roster", rosterFallback, (d) => {
          if (d.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) return false;
          person = { id: randomBytes(4).toString("hex"), name, sections: cleanSections(b.sections), lead: !!b.lead, secretary: !!b.secretary, qualified: !!b.qualified, code, codeHash: codeHash(sec, code), createdAt: new Date().toISOString() };
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
            // Whatever the group asks of at least one adult on a night. The
            // wording is the secretary's, in the site's settings; here it is
            // only a flag, so the rule can change without the store moving.
            if ("qualified" in b) person.qualified = !!b.qualified;
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
// The stand-in store used by the harnesses and the local preview. It has to
// hold bytes as well as text, because the content function keeps photos in a
// store of this shape: stringifying a JPEG would quietly mangle it.
export function memoryStore() {
  const m = new Map();
  const read = (e, type) => type === "json" ? JSON.parse(e.value.toString("utf8"))
    : type === "arrayBuffer" ? e.value.buffer.slice(e.value.byteOffset, e.value.byteOffset + e.value.byteLength)
    : e.value.toString("utf8");
  const hold = (value) => Buffer.isBuffer(value) ? value : typeof value === "string" ? Buffer.from(value, "utf8")
    : ArrayBuffer.isView(value) ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    : value instanceof ArrayBuffer ? Buffer.from(value) : Buffer.from(String(value), "utf8");
  return {
    _map: m,
    async getWithMetadata(key, opts = {}) {
      const e = m.get(key); if (!e) return null;
      return { data: read(e, opts.type), etag: e.etag, metadata: e.metadata || {} };
    },
    async get(key, opts = {}) { const e = m.get(key); if (!e) return null; return read(e, opts.type); },
    async getMetadata(key) { const e = m.get(key); return e ? { etag: e.etag, metadata: e.metadata || {} } : null; },
    async list() { return { blobs: [...m.keys()].map((key) => ({ key, etag: (m.get(key) || {}).etag })) }; },
    async delete(key) { m.delete(key); },
    async setJSON(key, value) { m.set(key, { value: Buffer.from(JSON.stringify(value), "utf8"), etag: randomBytes(6).toString("hex"), metadata: {} }); },
    async set(key, value, opts = {}) {
      const cur = m.get(key);
      if (opts.onlyIfNew && cur) return { modified: false };
      if (opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
      const etag = randomBytes(6).toString("hex");
      m.set(key, { value: hold(value), etag, metadata: opts.metadata || {} });
      return { etag, modified: true };
    }
  };
}

export default createHandler((name) => getStore(name));

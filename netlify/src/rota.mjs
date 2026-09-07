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
//   roster          { people: [{ id, name, sections, lead, secretary, codeHash }] }
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
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

const STORE = "rota";
const TOKEN_DAYS = 90;
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
const sectionFallback = () => ({ required: 2, slots: {} });
const pub = (p) => ({ id: p.id, name: p.name, sections: p.sections || [], lead: !!p.lead, secretary: !!p.secretary });
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
      const store = storeFactory();
      const sec = await secret(store);

      // Unauthenticated entry points.
      if (req.method === "POST" && a === "bootstrap") {
        if (!adminOk(req)) return fail(401, "Wrong password.");
        const b = await body(req); const name = cleanName(b && b.name);
        if (!name) return fail(400, "A name is needed.");
        const code = newCode(); let person;
        await update(store, "roster", rosterFallback, (doc) => {
          person = doc.people.find((p) => p.name.toLowerCase() === name.toLowerCase());
          if (person) { person.lead = true; person.secretary = true; person.codeHash = codeHash(sec, code); }
          else { person = { id: randomBytes(4).toString("hex"), name, sections: [], lead: true, secretary: true, codeHash: codeHash(sec, code), createdAt: new Date().toISOString() }; doc.people.push(person); }
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
        return json(200, { me: pub(me), people: visible.map(pub), sections });
      }
      if (req.method !== "POST") return fail(405, "Method not allowed.");
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
      if (!canManage) return fail(403, "Only the secretary can change the roster.");

      if (a === "person") {
        const name = cleanName(b.name); if (!name) return fail(400, "A name is needed.");
        const code = newCode(); let person;
        await update(store, "roster", rosterFallback, (d) => {
          if (d.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) return false;
          person = { id: randomBytes(4).toString("hex"), name, sections: cleanSections(b.sections), lead: !!b.lead, secretary: !!b.secretary, codeHash: codeHash(sec, code), createdAt: new Date().toISOString() };
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
          await update(store, "roster", rosterFallback, (d) => { const p = d.people.find((x) => x.id === b.id); if (!p) return false; p.codeHash = codeHash(sec, code); return d; });
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

export default createHandler(() => getStore(STORE));

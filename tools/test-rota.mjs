#!/usr/bin/env node
// Offline harness for the rota function: drives the handler with an in-memory
// store and real Requests, so it covers the code and token logic, permissions,
// the last-lead guard, revocation, and the conditional-write retry. It never
// touches Netlify.
import { createHandler, memoryStore } from "../netlify/src/rota.mjs";

process.env.ADMIN_PASSWORD = "admin-for-test";
const store = memoryStore();
const handler = createHandler(() => store);
const base = "https://x.test/.netlify/functions/rota";
let pass = 0, fail = 0;
const ok = (name, got, want) => { const good = JSON.stringify(got) === JSON.stringify(want); good ? pass++ : fail++; console.log(`${good ? "PASS" : "FAIL"}  ${name}${good ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`); };
async function call(method, q, { token, admin, body: b } = {}) {
  const h = { "Content-Type": "application/json" }; if (token) h["x-rota-token"] = token; if (admin) h["x-admin-password"] = admin;
  const r = await handler(new Request(base + q, { method, headers: h, body: b ? JSON.stringify(b) : undefined }));
  const text = await r.text(); let j; try { j = JSON.parse(text); } catch { j = text; }
  return { status: r.status, j };
}

let r = await call("OPTIONS", "");                         ok("OPTIONS is 204", r.status, 204);
r = await call("GET", "?sections=scouts");                  ok("GET without token is 401", r.status, 401);
r = await call("POST", "?a=bootstrap", { admin: "wrong", body: { name: "Lead One" } }); ok("bootstrap with wrong admin password is 401", r.status, 401);
r = await call("POST", "?a=bootstrap", { admin: "admin-for-test", body: { name: "Lead One" } });
ok("bootstrap creates a lead", [r.status, r.j.person.lead, r.j.person.name], [200, true, "Lead One"]);
const leadCode = r.j.code; ok("code has the expected shape", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(leadCode), true);
ok("secret was generated in the store", store._map.has("secret"), true);
r = await call("POST", "?a=login", { body: { code: "AAAA-AAAA" } }); ok("login with a bad code is 401", r.status, 401);
r = await call("POST", "?a=login", { body: { code: leadCode.toLowerCase().replace("-", " ") } });
ok("login tolerates case and separators", [r.status, r.j.me.lead], [200, true]);
const lead = r.j.token, leadId = r.j.me.id;
r = await call("GET", "?sections=scouts,beavers", { token: lead });
ok("GET returns me, people and requested sections with defaults", [r.status, r.j.people.length, r.j.sections.scouts.required, Object.keys(r.j.sections).sort()], [200, 1, 2, ["beavers", "scouts"]]);
r = await call("GET", "?sections=scouts", { token: lead.slice(0, -2) + "zz" }); ok("tampered token is 401", r.status, 401);

r = await call("POST", "?a=person", { token: lead, body: { name: "Member One", sections: ["scouts", "bad key!"], lead: false } });
ok("lead adds a member; bad section keys dropped", [r.status, r.j.person.sections, r.j.person.lead], [200, ["scouts"], false]);
const memberCode = r.j.code, memberId = r.j.person.id;
r = await call("POST", "?a=person", { token: lead, body: { name: "member one", sections: [] } }); ok("duplicate name is 409", r.status, 409);
r = await call("POST", "?a=login", { body: { code: memberCode } }); const member = r.j.token; ok("member can log in", r.status, 200);

const slot = "m:2030-01-03";
r = await call("POST", "?a=slot", { token: member, body: { section: "scouts", id: slot, add: [memberId] } });
ok("member ticks self", [r.status, r.j.section.slots[slot].who], [200, [memberId]]);
r = await call("POST", "?a=slot", { token: member, body: { section: "scouts", id: slot, add: [leadId] } }); ok("member cannot tick someone else", r.status, 403);
r = await call("POST", "?a=slot", { token: member, body: { section: "scouts", id: slot, need: 3 } });      ok("member cannot change adults needed", r.status, 403);
r = await call("POST", "?a=person", { token: member, body: { name: "X", sections: [] } });                 ok("member cannot add people", r.status, 403);
r = await call("POST", "?a=slot", { token: lead, body: { section: "scouts", id: slot, add: [leadId], need: 3 } });
ok("lead ticks self and sets need", [r.j.section.slots[slot].who.length, r.j.section.slots[slot].need], [2, 3]);
r = await call("POST", "?a=slot", { token: lead, body: { section: "scouts", id: "m:2030-01-10", off: true } }); ok("lead marks a week off", r.j.section.slots["m:2030-01-10"].off, true);
r = await call("POST", "?a=required", { token: lead, body: { section: "scouts", required: 3 } });
ok("required updated and a matching per-slot need collapses into it", [r.j.section.required, "need" in r.j.section.slots[slot]], [3, false]);
r = await call("POST", "?a=slot", { token: lead, body: { section: "scouts", id: "e:2030-02-01:Camp", add: ["nope"] } }); ok("unknown person id is 400", r.status, 400);
r = await call("POST", "?a=slot", { token: lead, body: { section: "Scouts!", id: slot } });                ok("bad section key is 400", r.status, 400);

// Conditional-write retry: make the next conditional set fail once, as it would if someone else saved first.
const realSet = store.set.bind(store); let failed = 0;
store.set = async (k, v, o) => { if (!failed && o && o.onlyIfMatch) { failed++; return { modified: false }; } return realSet(k, v, o); };
r = await call("POST", "?a=slot", { token: lead, body: { section: "scouts", id: slot, remove: [leadId] } });
ok("a conflicting write is retried and lands", [failed, r.status, r.j.section.slots[slot].who], [1, 200, [memberId]]);
store.set = realSet;

r = await call("POST", "?a=recode", { token: lead, body: { id: memberId } }); const newCode = r.j.code;
ok("recode returns a fresh code", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(newCode) && newCode !== memberCode, true);
r = await call("POST", "?a=login", { body: { code: memberCode } }); ok("old code no longer works", r.status, 401);
r = await call("POST", "?a=login", { body: { code: newCode } });    ok("new code works", r.status, 200);
r = await call("POST", "?a=person-update", { token: lead, body: { id: leadId, lead: false } }); ok("cannot demote the only lead", r.status, 409);
r = await call("POST", "?a=person-remove", { token: lead, body: { id: leadId, sections: [] } }); ok("cannot remove the only lead", r.status, 409);
r = await call("POST", "?a=person-update", { token: lead, body: { id: memberId, sections: ["scouts", "ventures"], lead: true } });
ok("member promoted and given sections", [r.j.person.lead, r.j.person.sections], [true, ["scouts", "ventures"]]);
r = await call("POST", "?a=person-update", { token: lead, body: { id: leadId, lead: false } }); ok("now the first lead can step down", r.status, 200);
r = await call("POST", "?a=person", { token: lead, body: { name: "Y", sections: [] } });          ok("and loses lead powers at once", r.status, 403);
r = await call("POST", "?a=login", { body: { code: newCode } }); const m2 = r.j.token;
r = await call("POST", "?a=person-remove", { token: m2, body: { id: leadId, sections: ["scouts"] } });
ok("removing a person strips them from the section's ticks", [r.status, r.j.people.length], [200, 1]);
r = await call("GET", "?sections=scouts", { token: lead }); ok("removed person's token is revoked", r.status, 401);
r = await call("GET", "?sections=scouts", { token: m2 });   ok("their ticks are gone from the slot", r.j.sections.scouts.slots[slot].who, [memberId]);
ok("no code hashes leak in GET", JSON.stringify(r.j).includes("codeHash"), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

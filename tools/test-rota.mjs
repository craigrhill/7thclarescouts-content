#!/usr/bin/env node
// Offline harness for the rota function: drives the handler with an in-memory
// store and real Requests, so it covers the code and token logic, permissions,
// the last-lead guard, revocation, and the conditional-write retry. It never
// touches Netlify.
import { createHandler, memoryStore } from "../netlify/src/rota.mjs";

process.env.ADMIN_PASSWORD = "admin-for-test";
const store = memoryStore(), contentStore = memoryStore();
const stores = { rota: store, "site-content": contentStore };
const handler = createHandler((name) => stores[name]);
// A stand-in group calendar, as the content function would serve it.
await contentStore.setJSON("content", {
  settings: { sections: [{ key: "scouts", name: "Scouts" }, { key: "cubs", name: "Cubs" }, { key: "beavers", name: "Beavers" }] },
  kits: [{ id: "sionnach", title: "Sionnach" }],
  events: [{ date: "2030-05-01", title: "Existing camp", section: "scouts" }],
  notices: [{ title: "keep me" }],
});
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
r = await call("POST", "?a=admin-login", { admin: "admin-for-test" }); ok("admin-login before a secretary exists says so", [r.status, /No secretary yet/.test(r.j.error)], [409, true]);
r = await call("POST", "?a=bootstrap", { admin: "wrong", body: { name: "Lead One" } }); ok("bootstrap with wrong admin password is 401", r.status, 401);
r = await call("POST", "?a=bootstrap", { admin: "admin-for-test", body: { name: "Lead One" } });
ok("bootstrap creates a secretary who is also a lead", [r.status, r.j.person.secretary, r.j.person.lead, r.j.person.name], [200, true, true, "Lead One"]);
const leadCode = r.j.code; ok("code has the expected shape", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(leadCode), true);
ok("secret was generated in the store", store._map.has("secret"), true);
r = await call("POST", "?a=login", { body: { code: "AAAA-AAAA" } }); ok("login with a bad code is 401", r.status, 401);
r = await call("POST", "?a=login", { body: { code: leadCode.toLowerCase().replace("-", " ") } });
ok("login tolerates case and separators", [r.status, r.j.me.secretary], [200, true]);
const lead = r.j.token, leadId = r.j.me.id;
r = await call("POST", "?a=admin-login", { admin: "wrong" });          ok("admin-login with a wrong password is 401", r.status, 401);
r = await call("POST", "?a=admin-login", { admin: "admin-for-test" });
ok("the admin password signs in as the secretary, no code needed", [r.status, r.j.me.id, r.j.me.secretary], [200, leadId, true]);
r = await call("GET", "?sections=scouts", { token: r.j.token });      ok("and that token works like any other", r.status, 200);
r = await call("GET", "?sections=scouts,beavers", { token: lead });
ok("GET returns me, people and requested sections with defaults", [r.status, r.j.people.length, r.j.sections.scouts.required, Object.keys(r.j.sections).sort()], [200, 1, 2, ["beavers", "scouts"]]);
r = await call("GET", "?sections=scouts", { token: lead.slice(0, -2) + "zz" }); ok("tampered token is 401", r.status, 401);
{ // A correctly signed token whose expiry has passed is refused.
  const { createHmac } = await import("node:crypto");
  const sec = store._map.get("secret").value;
  const payload = Buffer.from(JSON.stringify({ id: leadId, exp: Date.now() - 1000 })).toString("base64url");
  const expired = payload + "." + createHmac("sha256", Buffer.from(sec, "hex")).update(payload).digest("base64url");
  r = await call("GET", "?sections=scouts", { token: expired }); ok("expired token is 401", r.status, 401);
  const future = Buffer.from(JSON.stringify({ id: leadId, exp: Date.now() + 60000 })).toString("base64url");
  r = await call("GET", "?sections=scouts", { token: future + "." + createHmac("sha256", Buffer.from(sec, "hex")).update(future).digest("base64url") });
  ok("a freshly signed unexpired token works (sanity for the expiry check)", r.status, 200); }

r = await call("POST", "?a=person", { token: lead, body: { name: "Member One", sections: ["scouts", "bad key!"], lead: false } });
ok("secretary adds a member; bad section keys dropped", [r.status, r.j.person.sections, r.j.person.lead, r.j.person.secretary], [200, ["scouts"], false, false]);
const memberCode = r.j.code, memberId = r.j.person.id;
r = await call("POST", "?a=person", { token: lead, body: { name: "Cubs Lead", sections: ["cubs"], lead: true } });
ok("secretary adds a section lead who is not a secretary", [r.status, r.j.person.lead, r.j.person.secretary], [200, true, false]);
const cubsLeadCode = r.j.code, cubsLeadId = r.j.person.id;
r = await call("POST", "?a=person", { token: lead, body: { name: "Beaver Helper", sections: ["beavers"] } }); const beaverId = r.j.person.id;
r = await call("POST", "?a=person", { token: lead, body: { name: "member one", sections: [] } }); ok("duplicate name is 409", r.status, 409);

{ // ---- badge boards: names stay private, numbers are stable, leads edit their own sections ----
  r = await call("GET", "?a=board&section=bad key");            ok("public board refuses a bad section key", r.status, 400);
  r = await call("GET", "?a=board&section=cubs");               ok("public board needs no sign-in and starts empty", [r.status, r.j.section, r.j.rows], [200, "cubs", []]);
  const bMember = (await call("POST", "?a=login", { body: { code: memberCode } })).j.token;
  const bCubs = (await call("POST", "?a=login", { body: { code: cubsLeadCode } })).j.token;
  r = await call("GET", "?a=badges&sections=scouts,cubs,beavers", { token: bMember });
  ok("a helper sees only the boards of their own sections, read-only", [r.status, Object.keys(r.j.boards), r.j.canEdit.scouts], [200, ["scouts"], false]);
  r = await call("POST", "?a=badge-add", { token: bMember, body: { section: "scouts", name: "Anyone" } });
  ok("a helper cannot add to their own section's board", [r.status, r.j.error], [403, "Only a section lead can change the board."]);
  r = await call("POST", "?a=badge-add", { token: bMember, body: { section: "cubs", name: "Anyone" } });
  ok("nor touch a section not on their roster entry", r.status, 403);
  r = await call("POST", "?a=badge-add", { token: bCubs, body: { section: "scouts", name: "Anyone" } });
  ok("a lead cannot edit a section that is not theirs either", r.status, 403);
  r = await call("POST", "?a=badge-add", { token: bCubs, body: { section: "cubs", name: " Aoife ,Bríd,, " } });
  ok("the cubs lead adds two at once, numbered from 1, names tidied", [r.status, r.j.board.youth.map((y) => [y.n, y.name])], [200, [[1, "Aoife"], [2, "Bríd"]]]);
  const aoife = r.j.board.youth[0].id, brid = r.j.board.youth[1].id;
  r = await call("POST", "?a=badge-add", { token: bCubs, body: { section: "cubs", name: " , " } });   ok("an empty name is refused", r.status, 400);
  r = await call("POST", "?a=badge-add", { token: lead, body: { section: "scouts", name: "Scout Kid" } });
  ok("the secretary can edit any section's board", [r.status, r.j.board.youth.length], [200, 1]);
  const scoutKid = r.j.board.youth[0].id;
  r = await call("POST", "?a=badge-stage", { token: bCubs, body: { section: "cubs", id: aoife, skill: "camping", stage: 3 } });
  ok("a stage is set", r.j.board.stages[aoife], { camping: 3 });
  r = await call("POST", "?a=badge-stage", { token: bCubs, body: { section: "cubs", id: aoife, skill: "juggling", stage: 3 } });  ok("an unknown skill is refused", r.status, 400);
  r = await call("POST", "?a=badge-stage", { token: bCubs, body: { section: "cubs", id: aoife, skill: "camping", stage: 10 } }); ok("stage 10 is refused", r.status, 400);
  r = await call("POST", "?a=badge-stage", { token: bCubs, body: { section: "cubs", id: "nope", skill: "camping", stage: 1 } }); ok("an unknown scout is refused", r.status, 400);
  r = await call("POST", "?a=badge-stage", { token: bCubs, body: { section: "cubs", id: aoife, skill: "sailing", stage: "7" } });
  ok("a second skill joins the row; a numeric string is fine", r.j.board.stages[aoife], { camping: 3, sailing: 7 });
  r = await call("POST", "?a=badge-stage", { token: bCubs, body: { section: "cubs", id: aoife, skill: "camping", stage: 0 } });
  ok("stage 0 clears that skill", r.j.board.stages[aoife], { sailing: 7 });
  r = await call("POST", "?a=badge-stage", { token: bCubs, body: { section: "cubs", id: aoife, skill: "sailing", stage: 0 } });
  ok("clearing the last skill drops the row", aoife in r.j.board.stages, false);
  r = await call("POST", "?a=badge-stage", { token: bCubs, body: { section: "cubs", id: brid, skill: "backwoods", stage: 2 } });
  r = await call("POST", "?a=badge-rename", { token: bCubs, body: { section: "cubs", id: aoife, name: "Aoife Ní B" } });
  ok("a rename keeps the number", r.j.board.youth.find((y) => y.id === aoife).n, 1);
  r = await call("POST", "?a=badge-remove", { token: bCubs, body: { section: "cubs", id: aoife } });
  ok("a removal takes the stages with it", [r.j.board.youth.map((y) => y.n), aoife in r.j.board.stages], [[2], false]);
  r = await call("POST", "?a=badge-add", { token: bCubs, body: { section: "cubs", name: "Cian" } });
  ok("a later addition gets a fresh number; 1 is never reused", r.j.board.youth.map((y) => [y.n, y.name]), [[2, "Bríd"], [3, "Cian"]]);
  r = await call("GET", "?a=board&section=cubs");
  ok("the public board carries numbers and stages only", r.j.rows, [{ n: 2, stages: { backwoods: 2 } }, { n: 3, stages: {} }]);
  ok("and no name or id anywhere in it", [/Br/.test(JSON.stringify(r.j)), /"id"/.test(JSON.stringify(r.j))], [false, false]);
  r = await call("GET", "?a=board&section=beavers");                ok("another section's public board is untouched", r.j.rows, []);
  r = await call("GET", "?a=badges&sections=cubs", { token: bCubs });
  ok("the lead's own view keeps the names and may edit", [r.j.boards.cubs.youth.map((y) => y.name), r.j.canEdit.cubs], [["Bríd", "Cian"], true]);

  // ---- attendance: anyone on the section fills it in, helpers included; names come from the board ----
  r = await call("GET", "?a=attendance&sections=scouts,cubs", { token: bMember });
  ok("a helper gets attendance for their own section only, with names, and may fill it in but not add", [r.status, Object.keys(r.j.sections), r.j.sections.scouts.youth.map((y) => y.name), r.j.canEdit.scouts, r.j.canAdd.scouts], [200, ["scouts"], ["Scout Kid"], true, false]);
  r = await call("POST", "?a=attend", { token: bMember, body: { section: "scouts", date: "2026-09-10", present: [scoutKid, "nope"], note: " Hike night " } });
  ok("a helper records a meeting; unknown ids dropped, note tidied, saved by name", [r.status, r.j.meetings["2026-09-10"].present, r.j.meetings["2026-09-10"].note, r.j.meetings["2026-09-10"].by], [200, [scoutKid], "Hike night", "Member One"]);
  r = await call("POST", "?a=attend", { token: bMember, body: { section: "cubs", date: "2026-09-10", present: [] } });
  ok("but not for a section that is not theirs", r.status, 403);
  r = await call("POST", "?a=attend", { token: bMember, body: { section: "scouts", date: "10/09/2026", present: [] } });   ok("a bad date is refused", r.status, 400);
  r = await call("POST", "?a=attend", { token: bMember, body: { section: "scouts", date: "2026-09-10", present: [] } });
  ok("a second save for the same date replaces the list", r.j.meetings["2026-09-10"].present, []);
  r = await call("POST", "?a=attend", { token: bCubs, body: { section: "cubs", date: "2026-09-11", present: [brid, brid] } });
  ok("the cubs lead records cubs; a repeated id counts once", r.j.meetings["2026-09-11"].present, [brid]);
  r = await call("POST", "?a=attend", { token: lead, body: { section: "cubs", date: "2026-09-18", present: [] } });
  ok("the secretary can record any section", [r.status, Object.keys(r.j.meetings).sort()], [200, ["2026-09-11", "2026-09-18"]]);
  r = await call("POST", "?a=attend-remove", { token: bCubs, body: { section: "cubs", date: "2026-09-18" } });
  ok("a meeting record can be removed", Object.keys(r.j.meetings), ["2026-09-11"]);
  r = await call("GET", "?a=attendance&sections=cubs", { token: bCubs });
  ok("the lead may add from the attendance page too", [r.j.canAdd.cubs, r.j.sections.cubs.meetings["2026-09-11"].present], [true, [brid]]);
  r = await call("GET", "?a=board&section=cubs");
  ok("attendance never reaches the public board", Object.keys(r.j).sort(), ["rows", "section", "updatedAt"]);
}
r = await call("POST", "?a=login", { body: { code: memberCode } }); const member = r.j.token; ok("member can log in", r.status, 200);

const slot = "m:2030-01-03";
r = await call("POST", "?a=slot", { token: member, body: { section: "scouts", id: slot, add: [memberId] } });
ok("member ticks self", [r.status, r.j.section.slots[slot].who], [200, [memberId]]);
r = await call("POST", "?a=slot", { token: member, body: { section: "scouts", id: slot, add: [leadId] } }); ok("member cannot tick someone else", r.status, 403);
r = await call("POST", "?a=slot", { token: member, body: { section: "scouts", id: slot, need: 3 } });      ok("member cannot change adults needed", r.status, 403);
r = await call("POST", "?a=person", { token: member, body: { name: "X", sections: [] } });                 ok("member cannot add people", r.status, 403);
r = await call("POST", "?a=login", { body: { code: cubsLeadCode } }); const cubsLead = r.j.token;
r = await call("POST", "?a=person", { token: cubsLead, body: { name: "X", sections: [] } });               ok("a section lead cannot add people either", r.status, 403);
r = await call("POST", "?a=required", { token: cubsLead, body: { section: "cubs", required: 3 } });       ok("but a section lead can set adults needed", r.status, 200);
r = await call("GET", "?sections=scouts", { token: member });
ok("member sees only people sharing a section (the secretary has none, the helper is Beavers)", r.j.people.map(p => p.name), ["Member One"]);
ok("member does not see the Beaver helper", r.j.people.some(p => p.id === beaverId), false);
r = await call("GET", "?sections=scouts", { token: cubsLead }); ok("a lead sees everyone", r.j.people.some(p => p.id === beaverId), true);
ok("but a lead is not given anyone's code", r.j.people.some(p => "code" in p) || "code" in r.j.me, false);
r = await call("GET", "?sections=scouts", { token: member }); ok("nor is a member", r.j.people.some(p => "code" in p), false);
r = await call("GET", "?sections=scouts", { token: lead });
ok("the secretary sees every code, and they are the ones issued", [r.j.people.find(p => p.id === memberId).code, r.j.people.find(p => p.id === cubsLeadId).code, r.j.me.code], [memberCode, cubsLeadCode, leadCode]);
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
r = await call("GET", "?sections=scouts", { token: lead }); ok("the roster shows the new code from then on", r.j.people.find(p => p.id === memberId).code, newCode);
r = await call("POST", "?a=person-update", { token: lead, body: { id: leadId, secretary: false } }); ok("cannot demote the only secretary", r.status, 409);
r = await call("POST", "?a=person-remove", { token: lead, body: { id: leadId, sections: [] } });     ok("cannot remove the only secretary", r.status, 409);
r = await call("POST", "?a=person-update", { token: lead, body: { id: leadId, lead: false } });      ok("the only lead can step down as lead (a secretary can re-promote)", r.status, 200);
r = await call("POST", "?a=person-update", { token: lead, body: { id: memberId, sections: ["scouts", "ventures"], lead: true, secretary: true } });
ok("member made lead and secretary with sections", [r.j.person.lead, r.j.person.secretary, r.j.person.sections], [true, true, ["scouts", "ventures"]]);
r = await call("POST", "?a=person-update", { token: lead, body: { id: leadId, secretary: false } }); ok("now the first secretary can step down", r.status, 200);
r = await call("POST", "?a=person", { token: lead, body: { name: "Y", sections: [] } });             ok("and loses roster powers at once", r.status, 403);
// Legacy roster with leads but no secretary: leads keep roster powers until one exists.
{ const raw = JSON.parse(store._map.get("roster").value); raw.people.forEach(p => { p.secretary = false; p.lead = true; }); store._map.set("roster", { value: JSON.stringify(raw), etag: "legacy" });
  r = await call("POST", "?a=person", { token: lead, body: { name: "Legacy Add", sections: [] } }); ok("with no secretary on the roster, a lead can still manage it", r.status, 200);
  const raw2 = JSON.parse(store._map.get("roster").value); raw2.people = raw2.people.filter(p => p.name !== "Legacy Add"); raw2.people.find(p => p.id === memberId).secretary = true; store._map.set("roster", { value: JSON.stringify(raw2), etag: "legacy2" }); }
r = await call("POST", "?a=login", { body: { code: newCode } }); const m2 = r.j.token;
r = await call("POST", "?a=person-remove", { token: m2, body: { id: leadId, sections: ["scouts"] } });
ok("removing a person strips them from the section's ticks", [r.status, r.j.people.length], [200, 3]);
r = await call("GET", "?sections=scouts", { token: lead }); ok("removed person's token is revoked", r.status, 401);
r = await call("GET", "?sections=scouts", { token: m2 });   ok("their ticks are gone from the slot", r.j.sections.scouts.slots[slot].who, [memberId]);
ok("no code hashes leak in GET", JSON.stringify(r.j).includes("codeHash"), false);

// ---- calendar events ----
r = await call("POST", "?a=event", { token: m2, body: { date: "2030-03-14", title: "Spring camp", section: "scouts", location: "Ruan", kitId: "sionnach", details: "Two nights." } });
ok("secretary adds a public event", [r.status, r.j.events.map(e => e.title)], [200, ["Spring camp", "Existing camp"]]);
ok("it carries only the fields given", r.j.events[0], { date: "2030-03-14", title: "Spring camp", section: "scouts", location: "Ruan", kitId: "sionnach", details: "Two nights." });
{ const doc = await contentStore.get("content", { type: "json" });
  ok("it is written into the group calendar, and the rest of the content is untouched", [doc.events.length, doc.notices[0].title, doc.updatedBy], [2, "keep me", "secretary"]); }
r = await call("POST", "?a=event", { token: m2, body: { date: "2030-03-14", title: "spring camp " } });
ok("a duplicate date and title is refused", r.status, 409);
r = await call("POST", "?a=event", { token: m2, body: { date: "not-a-date", title: "X" } });                        ok("a bad date is refused", r.status, 400);
r = await call("POST", "?a=event", { token: m2, body: { date: "2030-03-14" } });                                    ok("a missing title is refused", r.status, 400);
r = await call("POST", "?a=event", { token: m2, body: { date: "2030-03-14", title: "X", endDate: "2030-03-01" } }); ok("an end date before the start is refused", r.status, 400);
r = await call("POST", "?a=event", { token: m2, body: { date: "2030-03-14", title: "X", section: "nope" } });       ok("an unknown section is refused", r.status, 400);
r = await call("POST", "?a=event", { token: m2, body: { date: "2030-03-14", title: "X", kitId: "nope" } });         ok("an unknown kit list is refused", r.status, 400);
r = await call("POST", "?a=event", { token: m2, body: { date: "2030-03-14", title: "X".repeat(200), details: "d".repeat(3000) } });
ok("long text is capped, not rejected", [r.j.events.find(e => e.title.startsWith("XX")).title.length, r.j.events.find(e => e.title.startsWith("XX")).details.length], [120, 2000]);
r = await call("POST", "?a=event-remove", { token: m2, body: { key: "2030-03-14|" + "X".repeat(120) } });           ok("and can be removed again", r.status, 200);
r = await call("POST", "?a=event-update", { token: m2, body: { key: "2030-03-14|Spring camp", date: "2030-03-21", title: "Spring camp", location: "Tulla" } });
ok("editing moves the date and drops fields left out", [r.status, r.j.events.find(e => e.title === "Spring camp").date, "kitId" in r.j.events.find(e => e.title === "Spring camp")], [200, "2030-03-21", false]);
r = await call("POST", "?a=event-update", { token: m2, body: { key: "2030-01-01|Nothing", date: "2030-01-01", title: "Nothing" } });
ok("editing something that is not there is 404", r.status, 404);
r = await call("POST", "?a=event-update", { token: m2, body: { key: "2030-03-21|Spring camp", date: "2030-05-01", title: "Existing camp" } });
ok("editing onto another event's date and title is refused", r.status, 409);
r = await call("POST", "?a=event", { token: m2, body: { private: true, date: "2030-04-02", title: "Leaders planning night", section: "scouts" } });
ok("a leaders-only event is stored privately", [r.status, r.j.private, r.j.events.map(e => e.title)], [200, true, ["Leaders planning night"]]);
{ const doc = await contentStore.get("content", { type: "json" });
  ok("and never reaches the public calendar", doc.events.some(e => e.title === "Leaders planning night"), false); }
r = await call("GET", "?sections=scouts", { token: m2 });
ok("private events come back on GET", r.j.events.map(e => e.title), ["Leaders planning night"]);
r = await call("GET", "?sections=scouts", { token: cubsLead });
ok("a lead sees them too, so the rota can show them", r.j.events.length, 1);
r = await call("POST", "?a=event", { token: cubsLead, body: { date: "2030-06-01", title: "Not allowed" } });
ok("a section lead cannot add an event", r.status, 403);
r = await call("POST", "?a=event-remove", { token: m2, body: { private: true, key: "2030-04-02|Leaders planning night" } });
ok("a private event can be removed", r.j.events.length, 0);
{ // With no calendar configured at all, a public event fails clearly and a private one still works.
  const bare = memoryStore(); const h2 = createHandler((n) => (n === "rota" ? store : bare));
  const rr = await h2(new Request(base + "?a=event", { method: "POST", headers: { "Content-Type": "application/json", "x-rota-token": m2 }, body: JSON.stringify({ date: "2030-07-01", title: "No calendar" }) }));
  ok("no group calendar: a public event says so", [rr.status, (await rr.json()).error], [503, "The group calendar is not set up yet."]);
  const rp = await h2(new Request(base + "?a=event", { method: "POST", headers: { "Content-Type": "application/json", "x-rota-token": m2 }, body: JSON.stringify({ private: true, date: "2030-07-01", title: "Still fine" }) }));
  ok("no group calendar: a private event still works", rp.status, 200); }
{ // The GitHub path: prove it reads and writes the right requests without touching Netlify.
  const calls = []; const realFetch = globalThis.fetch;
  const doc = { settings: { sections: [{ key: "scouts", name: "Scouts" }] }, kits: [], events: [], notices: [{ title: "keep" }] };
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url).split("?")[0], method: init.method || "GET" });
    if ((init.method || "GET") === "GET") return new Response(JSON.stringify({ content: Buffer.from(JSON.stringify(doc)).toString("base64"), sha: "abc" }), { status: 200 });
    const sent = JSON.parse(init.body); Object.assign(doc, JSON.parse(Buffer.from(sent.content, "base64").toString("utf8")));
    return new Response("{}", { status: 200 });
  };
  process.env.GITHUB_REPO = "owner/repo"; process.env.GITHUB_TOKEN = "tok";
  const rr = await call("POST", "?a=event", { token: m2, body: { date: "2031-01-01", title: "Via GitHub", section: "scouts" } });
  delete process.env.GITHUB_REPO; delete process.env.GITHUB_TOKEN; globalThis.fetch = realFetch;
  ok("the GitHub path writes the event and keeps the rest", [rr.status, doc.events.map(e => e.title), doc.notices[0].title, doc.updatedBy], [200, ["Via GitHub"], "keep", "secretary"]);
  ok("it used the contents API, reading once then writing with that sha", [calls.every(c => c.url.startsWith("https://api.github.com/repos/owner/repo/contents/")), calls.map(c => c.method)], [true, ["GET", "PUT"]]); }

{ // A save by someone else between our read and our write must not be clobbered:
  // GitHub rejects the stale sha, and we redo the change on the newer document.
  const realFetch = globalThis.fetch;
  let doc = { settings: { sections: [{ key: "scouts", name: "Scouts" }] }, kits: [], events: [], notices: [] };
  let sha = "sha-1", puts = 0;
  globalThis.fetch = async (url, init = {}) => {
    if ((init.method || "GET") === "GET") return new Response(JSON.stringify({ content: Buffer.from(JSON.stringify(doc)).toString("base64"), sha }), { status: 200 });
    const sent = JSON.parse(init.body);
    if (puts++ === 0) { // someone else saved first: their event lands, our sha is now stale
      doc = { ...doc, events: [{ date: "2031-02-02", title: "Theirs" }] }; sha = "sha-2";
      return new Response("{}", { status: 409 });
    }
    if (sent.sha !== sha) return new Response("{}", { status: 409 });
    doc = JSON.parse(Buffer.from(sent.content, "base64").toString("utf8"));
    return new Response("{}", { status: 200 });
  };
  process.env.GITHUB_REPO = "owner/repo"; process.env.GITHUB_TOKEN = "tok";
  r = await call("POST", "?a=event", { token: m2, body: { date: "2031-03-03", title: "Ours" } });
  delete process.env.GITHUB_REPO; delete process.env.GITHUB_TOKEN; globalThis.fetch = realFetch;
  ok("a concurrent save is retried, and neither event is lost", [r.status, puts, doc.events.map(e => e.title)], [200, 2, ["Theirs", "Ours"]]); }

// ---- one-way sync from the county calendar ----
{
  const realFetch = globalThis.fetch;
  let feed = [
    { id: "c1", name: "Chill Camp", start: "2030-10-02", end: "2030-10-03", sections: ["scouts"], location: "Ruan", time: "18:00", description: "County camp.", host: "County Team", link: "https://example.test/book" },
    { id: "c2", name: "Cub Fun Day", start: "2030-11-05", sections: ["cubs"] },
    { id: "c3", name: "Rover Ball", start: "2030-12-01", sections: ["rovers"] },
    { id: "c4", name: "County Planning Meeting", start: "2030-09-09", sections: ["cubs", "scouts", "rovers"] },
  ];
  let feedFails = false;
  globalThis.fetch = async () => feedFails ? new Response("nope", { status: 500 }) : new Response(JSON.stringify({ events: feed }), { status: 200 });

  r = await call("POST", "?a=county-sync", { token: cubsLead });
  ok("sync pulls the county events we care about", [r.status, r.j.added], [200, 3]);
  r = await call("GET", "?sections=scouts,cubs", { token: m2 });
  ok("a Rovers-only event is ignored", r.j.county.some(x => x.id === "c3"), false);
  ok("the rest arrive pending", r.j.county.map(x => x.id).sort(), ["c1", "c2", "c4"]);
  ok("nothing is on the group calendar yet", (await contentStore.get("content", { type: "json" })).events.some(e => e.countyId), false);

  r = await call("GET", "?sections=scouts,cubs", { token: cubsLead });
  ok("a lead sees only what touches their sections", r.j.county.map(x => x.id).sort(), ["c2", "c4"]);
  r = await call("POST", "?a=county-decide", { token: cubsLead, body: { id: "c1", decision: "approve" } });
  ok("and cannot decide for a section that is not theirs", r.status, 403);

  r = await call("POST", "?a=county-decide", { token: m2, body: { id: "c1", decision: "approve" } });
  ok("the Scouts lead approves the camp", [r.status, r.j.status], [200, "approved"]);
  { const e = (await contentStore.get("content", { type: "json" })).events.find(x => x.countyId === "c1");
    ok("it lands on the group calendar in the app's own shape", e, { date: "2030-10-02", title: "Chill Camp", endDate: "2030-10-03", section: "scouts", location: "Ruan", time: "18:00", details: "County camp.\n\nHosted by County Team\n\nhttps://example.test/book", countyId: "c1" }); }

  r = await call("POST", "?a=county-decide", { token: cubsLead, body: { id: "c4", decision: "approve" } });
  { const e = (await contentStore.get("content", { type: "json" })).events.find(x => x.countyId === "c4");
    ok("a multi-section event is approved by any of its leads and goes to the whole group", [r.status, "section" in e], [200, false]); }

  r = await call("POST", "?a=county-decide", { token: cubsLead, body: { id: "c2", decision: "decline" } });
  ok("declining keeps it off the calendar", [r.j.status, (await contentStore.get("content", { type: "json" })).events.some(e => e.countyId === "c2")], ["declined", false]);
  r = await call("POST", "?a=county-sync", { token: cubsLead });
  ok("a later sync does not offer a declined event again", r.j.added, 0);
  r = await call("GET", "?sections=cubs", { token: cubsLead });
  ok("it stays visible as declined, so it can be changed later", r.j.county.find(x => x.id === "c2").status, "declined");

  feed = feed.map(e => e.id === "c1" ? { ...e, location: "Tulla", start: "2030-10-09", end: "2030-10-10" } : e);
  r = await call("POST", "?a=county-sync", { token: m2 });
  ok("the county moving an approved event is followed without asking again", [r.j.changed, r.j.followed], [1, 1]);
  { const e = (await contentStore.get("content", { type: "json" })).events.find(x => x.countyId === "c1");
    ok("and the group calendar shows the new date and place", [e.date, e.endDate, e.location], ["2030-10-09", "2030-10-10", "Tulla"]); }

  feed = feed.filter(e => e.id !== "c1");
  r = await call("POST", "?a=county-sync", { token: m2 });
  ok("an event dropped by the county is flagged, not silently deleted", r.j.gone, 1);
  r = await call("GET", "?sections=scouts", { token: m2 });
  ok("the flag is visible to the lead", r.j.county.find(x => x.id === "c1").gone, true);
  ok("and it is still on the calendar until someone decides", (await contentStore.get("content", { type: "json" })).events.some(e => e.countyId === "c1"), true);
  r = await call("POST", "?a=county-decide", { token: m2, body: { id: "c1", decision: "decline" } });
  ok("declining a dropped event takes it off", (await contentStore.get("content", { type: "json" })).events.some(e => e.countyId === "c1"), false);

  r = await call("POST", "?a=person", { token: m2, body: { name: "Plain Helper", sections: ["scouts"] } });
  const plain = (await call("POST", "?a=login", { body: { code: r.j.code } })).j.token;
  r = await call("POST", "?a=county-decide", { token: plain, body: { id: "c4", decision: "decline" } });
  ok("someone who is not a lead cannot decide at all", r.status, 403);
  r = await call("GET", "?sections=scouts", { token: plain });
  ok("and is not shown the county list", r.j.county.length, 0);
  r = await call("POST", "?a=county-decide", { token: m2, body: { id: "nope", decision: "approve" } });
  ok("an unknown county event is 404", r.status, 404);
  r = await call("POST", "?a=county-decide", { token: m2, body: { id: "c4", decision: "sideways" } });
  ok("an unknown decision is refused", r.status, 400);
  r = await call("POST", "?a=county-decide", { token: m2, body: { id: "c4", decision: "reset" } });
  ok("reset puts it back to pending and off the calendar", [r.j.status, (await contentStore.get("content", { type: "json" })).events.some(e => e.countyId === "c4")], ["pending", false]);

  feedFails = true;
  r = await call("POST", "?a=county-sync", { token: m2 });
  ok("a county feed that is down says so plainly", [r.status, /did not answer/.test(r.j.error)], [502, true]);
  globalThis.fetch = realFetch;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

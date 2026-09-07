#!/usr/bin/env node
// Drift guard for mergeContent, which lives in admin.html (the "Apply update"
// button) and in tools/apply-update.mjs (the same merge done in the repo). The
// two are formatted differently, so this compares behaviour, not text: both
// are run over the real content.json plus updates.json and over synthetic
// cases that exercise every rule, and their outputs must be identical.
import { readFileSync } from "node:fs";

const pull = (file, rx) => { const m = readFileSync(file, "utf8").match(rx); if (!m) throw new Error(`mergeContent not found in ${file}`); return m[0]; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const impls = {
  "admin.html": new Function("clone", pull("admin.html", /function mergeContent\(base, patch\)\{[\s\S]*?\n\}/) + "; return mergeContent;")(clone),
  "tools/apply-update.mjs": new Function("clone", pull("tools/apply-update.mjs", /function mergeContent\(base, patch\) \{[\s\S]*?\n\}/) + "; return mergeContent;")(clone),
};
let pass = 0, fail = 0;
const ok = (name, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); g ? pass++ : fail++; console.log(`${g ? "PASS" : "FAIL"}  ${name}${g ? "" : `\n        got  ${JSON.stringify(got).slice(0, 200)}\n        want ${JSON.stringify(want).slice(0, 200)}`}`); };

const base = {
  settings: { heroTitle: "Old", sections: [{ key: "a", name: "A" }], team: [{ name: "T" }] },
  badges: { intro: "old intro", note: "keep" },
  fundraising: { intro: "old", campaigns: [{ title: "C" }] },
  notices: [{ title: "old notice" }],
  events: [{ date: "2027-01-01", title: "  Same Event  ", section: "a", details: "old" }, { date: "2027-02-02", title: "Other" }],
  news: [{ date: "2027-01-01", title: "N1", body: "old" }],
  kits: [{ id: "k1", title: "K1 old" }, { id: "k2", title: "K2" }],
};
const patch = {
  settings: { heroTitle: "New", sections: [{ key: "b", name: "B" }] },
  badges: { intro: "new intro" },
  fundraising: { help: "new help" },
  notices: [{ title: "new notice" }],
  events: [{ date: "2027-01-01", title: "same event", location: "Ruan" }, { date: "2027-03-03", title: "Added" }],
  news: [{ date: "2027-01-01", title: "N1", body: "new" }, { date: "2027-04-04", title: "N2" }],
  kits: [{ id: "k1", title: "K1 new" }, { id: "k3", title: "K3" }],
};
const cases = [
  ["synthetic patch covering every rule", base, patch],
  ["empty patch is a no-op", base, {}],
  ["patch onto an empty base", {}, patch],
  ["real content.json plus updates.json", JSON.parse(readFileSync("content.json", "utf8")), JSON.parse(readFileSync("updates.json", "utf8"))],
];
for (const [name, b, p] of cases) {
  const snapshot = JSON.stringify(b);
  const outs = Object.fromEntries(Object.entries(impls).map(([k, fn]) => [k, fn(clone(b), clone(p))]));
  ok(`${name}: both implementations agree`, outs["admin.html"], outs["tools/apply-update.mjs"]);
  ok(`${name}: base not mutated`, JSON.stringify(b) === snapshot, true);
}
// Spot checks of the rules themselves, on the admin.html copy.
const o = impls["admin.html"](clone(base), clone(patch));
ok("kits: matched by id replaced, new appended, others kept", o.kits.map((k) => k.title), ["K1 new", "K2", "K3"]);
ok("events: matched by date and case-insensitive trimmed title, merged not replaced", [o.events[0].details, o.events[0].location, o.events.length], ["old", "Ruan", 3]);
ok("news: matched by date and exact title, replaced", [o.news[0].body, o.news.length], ["new", 2]);
ok("notices: replaced wholesale", o.notices, [{ title: "new notice" }]);
ok("badges and fundraising: shallow merged", [o.badges.note, o.badges.intro, o.fundraising.help, o.fundraising.intro], ["keep", "new intro", "new help", "old"]);
ok("settings: merged, sections replaced, team kept", [o.settings.heroTitle, o.settings.sections, o.settings.team], ["New", [{ key: "b", name: "B" }], [{ name: "T" }]]);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

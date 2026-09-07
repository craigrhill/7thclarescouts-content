#!/usr/bin/env node
// Drift guard and behaviour test for mergeBuiltInKits, which lives in both
// index.html and admin.html on purpose (each page is a single file). The two
// copies must stay identical, and both must behave as documented in CLAUDE.md:
// saved lists win, unseen built-ins are appended, and knownKitIds stops a
// deliberately deleted list from coming back.
import { readFileSync } from "node:fs";

const RX = /function mergeBuiltInKits\(saved, known\)\{[\s\S]*?\n\}/;
const pull = (file) => { const m = readFileSync(file, "utf8").match(RX); if (!m) throw new Error(`mergeBuiltInKits not found in ${file}`); return m[0]; };
const copies = { "index.html": pull("index.html"), "admin.html": pull("admin.html") };
const norm = (s) => s.replace(/\s+/g, " ").trim();
let pass = 0, fail = 0;
const ok = (name, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); g ? pass++ : fail++; console.log(`${g ? "PASS" : "FAIL"}  ${name}${g ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`); };

ok("the two copies are identical (whitespace aside)", norm(copies["index.html"]) === norm(copies["admin.html"]), true);

const DEFAULTS = [
  { id: "weekly", title: "Weekly", docs: [] },
  { id: "sionnach", title: "Sionnach", docs: [{ title: "PDF", url: "docs/x.pdf" }] },
  { id: "newlist", title: "New", docs: [] },
];
for (const [file, src] of Object.entries(copies)) {
  const merge = new Function("window", src + "; return mergeBuiltInKits;")({ DEFAULT_KITS: DEFAULTS });
  const ids = (r) => r.map((k) => k.id).join(",");
  const t = (name, got, want) => ok(`${file}: ${name}`, got, want);
  t("new built-in list is appended", ids(merge([{ id: "weekly" }, { id: "sionnach" }], undefined)), "weekly,sionnach,newlist");
  t("a list in knownKitIds is not resurrected", ids(merge([{ id: "weekly" }, { id: "sionnach" }], ["weekly", "sionnach", "newlist"])), "weekly,sionnach");
  t("only unseen lists append with a partial ledger", ids(merge([{ id: "weekly" }], ["weekly", "sionnach"])), "weekly,newlist");
  t("empty saved falls back to all defaults", ids(merge([], undefined)), "weekly,sionnach,newlist");
  t("missing saved falls back to all defaults", ids(merge(undefined, undefined)), "weekly,sionnach,newlist");
  t("leader edits are preserved", merge([{ id: "weekly", title: "Edited" }], ["weekly", "sionnach", "newlist"])[0].title, "Edited");
  t("docs re-attached when saved has none", merge([{ id: "sionnach", title: "S" }], ["weekly", "sionnach", "newlist"])[0].docs, DEFAULTS[1].docs);
  t("a leader's own docs are kept", merge([{ id: "sionnach", title: "S", docs: [{ title: "Mine" }] }], ["weekly", "sionnach", "newlist"])[0].docs[0].title, "Mine");
  t("defaults are copied, not shared", merge([], undefined)[0] !== DEFAULTS[0], true);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

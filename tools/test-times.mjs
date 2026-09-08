#!/usr/bin/env node
// Drift guard and behaviour test for eventWhen, the label for the hours an
// event runs. It lives in index.html, calendar.html and lab/rota-lib.js on
// purpose, because each of those is loaded on its own. The copies must stay
// identical, and must read the same as the group writes times elsewhere.
import { readFileSync } from "node:fs";

const RX = /function eventWhen\(e\)\{[\s\S]*?\n\}/;
const pull = (file) => { const m = readFileSync(file, "utf8").match(RX); if (!m) throw new Error(`eventWhen not found in ${file}`); return m[0]; };
const files = ["index.html", "calendar.html", "lab/rota-lib.js"];
const copies = Object.fromEntries(files.map((f) => [f, pull(f)]));
const norm = (s) => s.replace(/\s+/g, " ").trim();
let pass = 0, fail = 0;
const ok = (name, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); g ? pass++ : fail++; console.log(`${g ? "PASS" : "FAIL"}  ${name}${g ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`); };

ok("all three copies are identical (whitespace aside)", new Set(files.map((f) => norm(copies[f]))).size, 1);

const when = new Function(copies["index.html"] + "; return eventWhen;")();
ok("an evening meeting reads as one span", when({ startTime: "18:00", endTime: "19:30" }), "6:00 to 7:30 pm");
ok("minutes are always shown, as the group writes them", when({ startTime: "18:00", endTime: "20:00" }), "6:00 to 8:00 pm");
ok("morning into afternoon says both halves", when({ startTime: "11:00", endTime: "13:00" }), "11:00 am to 1:00 pm");
ok("a start on its own", when({ startTime: "19:00" }), "7:00 pm");
ok("midnight and noon", [when({ startTime: "00:30" }), when({ startTime: "12:00" })], ["12:30 am", "12:00 pm"]);
ok("a camp says both halves, because its end is another day", when({ date: "2027-05-14", endDate: "2027-05-16", startTime: "18:30", endTime: "14:00" }), "6:30 pm to 2:00 pm");
ok("no times at all is empty", when({}), "");
ok("the free text leaders used to type is the fallback", when({ time: "half six" }), "half six");
ok("and anything that is not a time falls back too", when({ startTime: "sixish", time: "sixish" }), "sixish");
ok("an end without a start is ignored", when({ endTime: "20:00", time: "" }), "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

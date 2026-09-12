#!/usr/bin/env node
// Drift guard and behaviour test for siteOrigin, the address that goes into a
// link somebody else will open: a helper's personal rota link, the chasing
// link, the subscription feed, a shared event, the print URL. It lives in
// index.html, calendar.html and lab/rota-lib.js on purpose, because each of
// those is loaded on its own, and the three copies must stay identical.
import { readFileSync } from "node:fs";

const RX = /const SITE = [\s\S]*?function siteOrigin\(\)\{[\s\S]*?\n?\}/;
const pull = (file) => { const m = readFileSync(file, "utf8").match(RX); if (!m) throw new Error(`siteOrigin not found in ${file}`); return m[0]; };
const files = ["index.html", "calendar.html", "lab/rota-lib.js"];
const copies = Object.fromEntries(files.map((f) => [f, pull(f)]));
const norm = (s) => s.replace(/\s+/g, " ").trim();
let pass = 0, fail = 0;
const ok = (name, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); g ? pass++ : fail++; console.log(`${g ? "PASS" : "FAIL"}  ${name}${g ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`); };

ok("all three copies are identical (whitespace aside)", new Set(files.map((f) => norm(copies[f]))).size, 1);

// The copies close over `location`, so hand them one.
const on = (hostname, origin) => new Function("location", copies["index.html"] + "; return siteOrigin();")({ hostname, origin });

ok("the group's own address is what a link says", on("7thclarescouts.ie", "https://7thclarescouts.ie"), "https://7thclarescouts.ie");
ok("a leader who opened the Netlify address does not pass it on", on("7thclarescouts.netlify.app", "https://7thclarescouts.netlify.app"), "https://7thclarescouts.ie");
ok("nor the www one, which Netlify only redirects", on("www.7thclarescouts.ie", "https://www.7thclarescouts.ie"), "https://7thclarescouts.ie");
ok("the local preview keeps pointing at itself, or a test would send somebody to the live site", on("127.0.0.1", "http://127.0.0.1:8899"), "http://127.0.0.1:8899");
ok("and so does localhost", on("localhost", "http://localhost:8910"), "http://localhost:8910");
ok("a deploy preview stays on the preview", on("deploy-preview-4--7thclarescouts.netlify.app", "https://deploy-preview-4--7thclarescouts.netlify.app"), "https://deploy-preview-4--7thclarescouts.netlify.app");

// The address itself is what a parent is told, so it has to be reachable and
// not a redirect to somewhere else.
ok("the address has no trailing slash, since a path is appended to it", /^https:\/\/[^/]+$/.test(copies["index.html"].match(/const SITE = "([^"]+)"/)[1]), true);

// Every URL a person is handed has to go through it. Naming them here is what
// catches a new one being written the old way.
const SHARED = [
  ["index.html", 'const url = siteOrigin() + "/.netlify/functions/content?ics=1"', "the subscription feed on the app's calendar"],
  ["index.html", 'const url = siteOrigin() + location.pathname + "#" + hash;', "a shared event"],
  ["calendar.html", "var base = siteOrigin() + '/.netlify/functions/content?ics=1';", "the subscription feed on the full calendar"],
  ["calendar.html", "return siteOrigin() + location.pathname + '?' + q.join('&');", "the print URL the home screen app offers"],
  ["lab/rota-lib.js", 'return siteOrigin() + (path === location.pathname', "a personal rota link and the chasing link"],
];
for (const [file, snippet, what] of SHARED) {
  ok(`${what} is built from the group's address`, readFileSync(file, "utf8").includes(snippet), true);
}
// location.origin is right for fetching and for the worker, wrong for a link.
// These are the files that hand out links, so nothing in them may build a URL
// from the host except siteOrigin itself.
for (const f of files) {
  const stray = readFileSync(f, "utf8").split("\n")
    .filter((l) => /location\.origin/.test(l) && !/siteOrigin|LIVE_HOSTS/.test(l));
  ok(`${f} builds no URL straight off the host`, stray, []);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

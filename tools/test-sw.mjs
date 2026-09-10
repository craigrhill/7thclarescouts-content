#!/usr/bin/env node
// The service worker's routing rules, run offline against stub caches and a
// stub network. It is the piece that decides what a phone keeps, so the rules
// that matter are pinned here: the shell is cache first, leaders' data is
// never cached, uploaded pictures are kept but only if they really are
// pictures, and a release throws away the old shell without throwing away the
// photos and fonts already downloaded.
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (name, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); g ? pass++ : fail++; console.log(`${g ? "PASS" : "FAIL"}  ${name}${g ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`); };

// A cache store and a network, small enough to see through.
function world({ net = {}, cached = {} } = {}) {
  const stores = new Map();
  for (const [name, entries] of Object.entries(cached)) stores.set(name, new Map(Object.entries(entries)));
  const asResponse = (spec) => spec && ({ ...spec, ok: spec.status === undefined || spec.status < 400, clone: () => asResponse(spec), headers: { get: (h) => (spec.headers || {})[h.toLowerCase()] || null } });
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return { match: async (req) => asResponse(m.get(req.url)), put: async (req, res) => { m.set(req.url, res); }, addAll: async () => {} };
  };
  const caches = {
    open, keys: async () => [...stores.keys()], delete: async (name) => stores.delete(name),
    match: async (req) => { for (const m of stores.values()) if (m.has(req.url)) return asResponse(m.get(req.url)); return undefined; },
  };
  const asked = [];
  const fetchStub = async (req) => { asked.push(req.url); const spec = net[req.url]; if (!spec) throw new Error("offline"); return asResponse(spec); };
  return { caches, fetchStub, asked, stores };
}

// Load sw.js with the globals a worker would have, and keep its listeners.
function boot(w) {
  const src = readFileSync("sw.js", "utf8");
  const on = {};
  const self = { addEventListener: (k, fn) => { on[k] = fn; }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  const Response = function (body, init) { return { body, ...(init || {}) }; };
  Response.error = () => ({ type: "error", ok: false, status: 0 });
  new Function("self", "caches", "fetch", "location", "URL", "Response", src)(self, w.caches, w.fetchStub, { origin: "https://7thclarescouts.ie" }, URL, Response);
  return on;
}
// Drive one fetch event and return what the worker answered, or null when it
// passed the request through to the browser untouched.
async function get(on, url, w) {
  let answered = null;
  const request = { url, method: "GET" };
  await on.fetch({ request, respondWith: (p) => { answered = p; } });
  return answered ? await answered : null;
}

const IMG = { status: 200, body: "jpegbytes", headers: { "content-type": "image/jpeg" } };
const JSONISH = { status: 200, body: '{"settings":{}}', headers: { "content-type": "application/json; charset=utf-8" } };
const PHOTO = "https://7thclarescouts.ie/photo/" + "a".repeat(32) + ".jpg";

{ // A picture is fetched once and kept.
  const w = world({ net: { [PHOTO]: IMG } });
  const on = boot(w);
  ok("a photo comes from the network the first time", (await get(on, PHOTO, w)).body, "jpegbytes");
  ok("and is kept in the photo store", [...w.stores.get("photos-2").keys()], [PHOTO]);
  ok("the second time it is served without asking the network again", [(await get(on, PHOTO, w)).body, w.asked.length], ["jpegbytes", 1]);
}
{ // The failure Craig hit: the route was broken and answered with the site's
  // JSON. A cache-first store would have served that for ever.
  const w = world({ net: { [PHOTO]: JSONISH } });
  const on = boot(w);
  ok("something that is not a picture is passed on but never kept", [(await get(on, PHOTO, w)).body, w.stores.has("photos-2") ? [...w.stores.get("photos-2").keys()] : []], ['{"settings":{}}', []]);
  const w2 = world({ net: { [PHOTO]: IMG }, cached: { "photos-2": {} } });
  const on2 = boot(w2);
  ok("so the picture is picked up as soon as the route is right", (await get(on2, PHOTO, w2)).body, "jpegbytes");
}
{ // A release keeps the photos and the fonts, and drops everything older.
  const w = world({ cached: { "shell-v0_1": {}, "data-v0_1": {}, "fonts": {}, "photos": {}, "photos-2": {} } });
  const on = boot(w);
  await on.activate({ waitUntil: async (p) => await p });
  ok("the old shell and data go, the fonts and photos stay", [...w.stores.keys()].sort(), ["fonts", "photos-2"]);
}
{ // The rules that were already there, so a rework cannot quietly drop them.
  const w = world({ net: {
    "https://7thclarescouts.ie/lab/rota.html": { status: 200, body: "lab" },
    "https://7thclarescouts.ie/.netlify/functions/rota?a=board&section=cubs": { status: 200, body: "board" },
    "https://7thclarescouts.ie/.netlify/functions/rota?sections=cubs": { status: 200, body: "private" },
  } });
  const on = boot(w);
  ok("a leaders' page is never cached", await get(on, "https://7thclarescouts.ie/lab/rota.html", w), null);
  ok("nor is a leaders' read of the rota function", await get(on, "https://7thclarescouts.ie/.netlify/functions/rota?sections=cubs", w), null);
  await get(on, "https://7thclarescouts.ie/.netlify/functions/rota?a=board&section=cubs", w);
  ok("but the public badge board is kept, so a section page works offline", [...w.stores.keys()].some(k => k.startsWith("data-")), true);
}

{ // Nothing must ever be answered with nothing. respondWith resolved to
  // undefined leaves the request pending for ever rather than failing it, and
  // a pending stylesheet blocks every script after it, so the app never boots.
  const FONT = "https://fonts.googleapis.com/css2?family=Inter";
  const w = world();
  const on = boot(w);
  ok("a font that is neither cached nor reachable is failed, not left hanging",
    (await get(on, FONT, w)).type, "error");
  ok("and the same for the badge board", (await get(on, "https://7thclarescouts.ie/.netlify/functions/rota?a=board&section=cubs", w)).type, "error");
  ok("and for anything of ours that is not in the shell cache", (await get(on, "https://7thclarescouts.ie/photos/none.png", w)).type, "error");
  const w2 = world({ cached: { "fonts": { [FONT]: { status: 200, body: "@font-face{}" } } } });
  ok("a cached font is still served without asking the network", [(await get(boot(w2), FONT, w2)).body, w2.asked.length], ["@font-face{}", 0]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
// The photo endpoints on the content function, driven offline with a store of
// its own: upload, serve, list and tidy up. Covers the password, the types and
// the size cap, that the same photo twice is stored once, that a served photo
// is cached forever because its name is its hash, and that tidying up keeps
// what the content document still points at and spares anything just uploaded.
import { createHash } from "node:crypto";
import handler, { useStore } from "../netlify/src/content.mjs";
import { memoryStore } from "../netlify/src/rota.mjs";

const PW = "pw-for-test-only";
process.env.ADMIN_PASSWORD = PW;
const base = "https://example.test/.netlify/functions/content";
let pass = 0, fail = 0;
const ok = (name, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); g ? pass++ : fail++; console.log(`${g ? "PASS" : "FAIL"}  ${name}${g ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`); };

// The same stand-in store the rota harness and the local preview use, so the
// one double is proved to hold bytes as well as text.
const store = memoryStore(), mem = store._map;
useStore(() => store);

const call = async (q, init) => { const r = await handler(new Request(base + q, init)); const t = r.headers.get("content-type") || ""; return { status: r.status, headers: r.headers, body: t.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) }; };
const put = (bytes, type, pw = PW) => call("?photo=1", { method: "POST", headers: { "x-admin-password": pw, "Content-Type": type }, body: bytes });
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(200).fill(7)]);
const other = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(200).fill(9)]);

let r = await put(jpeg, "image/jpeg", "nope");
ok("an upload without the password is refused", [r.status, mem.size], [401, 0]);
r = await put(jpeg, "application/pdf");
ok("only images are taken", [r.status, /JPEG, PNG or WebP/.test(r.body.error)], [415, true]);
r = await put(Buffer.alloc(0), "image/jpeg");
ok("an empty upload is refused", r.status, 400);
r = await put(Buffer.alloc(6 * 1024 * 1024), "image/jpeg");
ok("and one over five megabytes", [r.status, /too big/.test(r.body.error)], [413, true]);

r = await put(jpeg, "image/jpeg");
const id = r.body.id;
ok("a photo is stored under the hash of its bytes", [r.status, id, r.body.url], [200, createHash("sha256").update(jpeg).digest("hex").slice(0, 32) + ".jpg", "/photo/" + id]);
r = await put(jpeg, "image/jpeg");
ok("the same photo again is the same file, not a second copy", [r.body.id, mem.size], [id, 1]);

r = await call("?photo=" + id);
ok("anyone can fetch it, no password", [r.status, r.headers.get("content-type"), Buffer.from(r.body).equals(jpeg)], [200, "image/jpeg", true]);
ok("and it is cached forever, because the name is the hash", r.headers.get("cache-control"), "public, max-age=31536000, immutable");
r = await handler(new Request("https://example.test/photo/" + id)).then(async (x) => ({ status: x.status, headers: x.headers, body: Buffer.from(await x.arrayBuffer()) }));
ok("the pretty path works even if the rewrite drops the query", [r.status, r.headers.get("content-type"), Buffer.from(r.body).equals(jpeg)], [200, "image/jpeg", true]);
r = await call("?photo=../../etc/passwd");
ok("a name that is not a photo name is refused", r.status, 400);
r = await call("?photo=" + "0".repeat(32) + ".jpg");
ok("a photo that is not there is 404, not 500", r.status, 404);

const old = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
r = await put(other, "image/jpeg");
const id2 = r.body.id;
for (const e of mem.values()) e.metadata.at = old;
const fresh = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(200).fill(3)]);
r = await put(fresh, "image/jpeg");
const id3 = r.body.id;

r = await call("?photos=list", { method: "POST", headers: { "x-admin-password": PW } });
ok("the list has all three, with their sizes", [r.status, r.body.photos.length, r.body.photos.find((p) => p.id === id).size], [200, 3, jpeg.length]);
r = await call("?photos=list", { method: "POST", headers: { "x-admin-password": "nope" } });
ok("the list needs the password", r.status, 401);

r = await call("?photos=prune", { method: "POST", headers: { "x-admin-password": PW, "Content-Type": "application/json" }, body: JSON.stringify({ keep: ["/photo/" + id] }) });
ok("tidying up removes what nothing points at any more", [r.status, r.body.removed], [200, [id2]]);
ok("keeps what the site still uses", mem.has(id), true);
ok("and spares a photo uploaded in the last hour, which may not be saved yet", mem.has(id3), true);
r = await call("?photos=prune", { method: "POST", headers: { "x-admin-password": PW }, body: "not json" });
ok("prune without a list of what to keep is refused, not a mass delete", [r.status, mem.size], [400, 2]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

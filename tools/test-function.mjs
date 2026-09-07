#!/usr/bin/env node
// Smoke test for the content function, run offline against the built bundle.
//
//   node tools/test-function.mjs netlify/functions/content.mjs
//   node tools/test-function.mjs <new-bundle> <old-bundle>   # equivalence check
//
// Every case is driven through the exported handler with a real Request, with
// process.env set per case, so it exercises the real code paths: CORS, method
// routing, the password check (via the ADMIN_PASSWORD override, since the
// built-in hash is Craig's), source selection, and the error handling around
// both the GitHub and Netlify Blobs paths. It never has valid credentials, so
// it cannot write anywhere. With two bundles it requires identical status and
// body for every case, which is how a rebuild is proven to change nothing.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const PW = "pw-for-test-only";
const ENV_KEYS = ["ADMIN_PASSWORD", "GITHUB_REPO", "GITHUB_TOKEN", "GITHUB_BRANCH", "GITHUB_PATH"];
const base = "https://example.test/.netlify/functions/content";

const CASES = [
  { name: "OPTIONS preflight", env: {}, req: () => new Request(base, { method: "OPTIONS" }) },
  { name: "PUT is not allowed", env: {}, req: () => new Request(base, { method: "PUT" }) },
  { name: "POST wrong password (built-in hash)", env: {},
    req: () => new Request(base, { method: "POST", headers: { "x-admin-password": "nope" }, body: "{}" }) },
  { name: "POST wrong password (env override)", env: { ADMIN_PASSWORD: PW },
    req: () => new Request(base, { method: "POST", headers: { "x-admin-password": "nope" }, body: "{}" }) },
  { name: "POST ?check=1, blobs source", env: { ADMIN_PASSWORD: PW },
    req: () => new Request(base + "?check=1", { method: "POST", headers: { "x-admin-password": PW } }) },
  { name: "POST ?check=1, github source", env: { ADMIN_PASSWORD: PW, GITHUB_REPO: "x/y", GITHUB_TOKEN: "t" },
    req: () => new Request(base + "?check=1", { method: "POST", headers: { "x-admin-password": PW } }) },
  { name: "POST body is not JSON", env: { ADMIN_PASSWORD: PW },
    req: () => new Request(base, { method: "POST", headers: { "x-admin-password": PW }, body: "not json" }) },
  { name: "POST body is JSON but not an object", env: { ADMIN_PASSWORD: PW },
    req: () => new Request(base, { method: "POST", headers: { "x-admin-password": PW }, body: '"a string"' }) },
  { name: "GET, no env, falls to blobs (unconfigured here)", env: {},
    req: () => new Request(base) },
  { name: "GET, github env with bad token", env: { GITHUB_REPO: "craigrhill/7thclarescouts-content", GITHUB_TOKEN: "bogus-token" },
    req: () => new Request(base) },
  { name: "POST save, no env, blobs write (unconfigured here)", env: { ADMIN_PASSWORD: PW },
    req: () => new Request(base, { method: "POST", headers: { "x-admin-password": PW }, body: '{"settings":{}}' }) },
  { name: "GET ?ics=1, no calendar available", env: {},
    req: () => new Request(base + "?ics=1") },
  { name: "GET ?ics=1&section=..., no calendar available", env: {},
    req: () => new Request(base + "?ics=1&section=scouts") },
];

// Strip values that legitimately differ run to run before comparing.
const normalise = (s) => s.replace(/ID: [A-Za-z0-9]+/g, "ID: <id>").replace(/"updatedAt":"[^"]+"/g, '"updatedAt":"<t>"');

async function run(modPath) {
  const handler = (await import(pathToFileURL(resolve(modPath)).href)).default;
  const out = [];
  for (const c of CASES) {
    for (const k of ENV_KEYS) delete process.env[k];
    Object.assign(process.env, c.env);
    let status, body;
    try { const r = await handler(c.req()); status = r.status; body = await r.text(); }
    catch (e) { status = "THREW"; body = String(e.message || e); }
    out.push({ name: c.name, status, body: normalise(body) });
  }
  for (const k of ENV_KEYS) delete process.env[k];
  return out;
}

const [a, b] = process.argv.slice(2);
if (!a) { console.error("usage: test-function.mjs <bundle> [<other-bundle>]"); process.exit(2); }

const A = await run(a);
const B = b ? await run(b) : null;
let bad = 0;
for (let i = 0; i < A.length; i++) {
  const x = A[i], y = B && B[i];
  const same = !B || (x.status === y.status && x.body === y.body);
  if (!same) bad++;
  const mark = B ? (same ? "same " : "DIFF ") : "";
  console.log(`${mark}${String(x.status).padStart(5)}  ${x.name}`);
  console.log(`         ${x.body.slice(0, 110)}${x.body.length > 110 ? "..." : ""}`);
  if (!same) console.log(`   other ${String(y.status).padStart(5)}  ${y.body.slice(0, 110)}`);
}
if (B) console.log(`\n${A.length - bad} of ${A.length} cases identical between the two bundles`);
process.exit(bad ? 1 : 0);

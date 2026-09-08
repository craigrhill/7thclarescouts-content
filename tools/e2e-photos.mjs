#!/usr/bin/env node
// The whole picture path in a real browser: admin shrinks a photo on the
// device and uploads it, the content function stores and serves it, and the
// app shows the album as a collage that opens as a slideshow.
//
//   npm run e2e:photos       (needs Chromium; set CHROME_PATH if it is not found)
//
// The preview runs the real content function against in-memory stores, so this
// covers the code that is deployed rather than a stand-in of it. Screenshots
// land in .e2e/, which is gitignored.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { chromium } from "playwright-core";

const PORT = 8916, ROOT = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH || ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync) || (() => { try { return chromium.executablePath(); } catch { return undefined; } })();
mkdirSync(".e2e", { recursive: true });

// A photo the size a phone takes, written by hand so the suite needs no fixtures.
const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type, "ascii"), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(body)); return Buffer.concat([len, body, cr]); };
function png(path, w, h, seed) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) { raw[o++] = 0; for (let x = 0; x < w; x++) { raw[o++] = (x * seed) % 256; raw[o++] = (y * 3 + seed) % 256; raw[o++] = ((x ^ y) * seed) % 256; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
  return path;
}
const dir = mkdtempSync(join(tmpdir(), "clare-photos-"));
const files = [1, 2, 3].map((n) => png(join(dir, n + ".png"), 3000, 2250, 40 * n));

const server = spawn(process.execPath, ["tools/serve.mjs", String(PORT)], { stdio: "ignore", env: { ...process.env, ADMIN_PASSWORD: "local" } });
const stop = () => { try { server.kill(); } catch {} };
process.on("exit", stop);
for (let i = 0; i < 40; i++) { try { if ((await fetch(ROOT + "/admin.html")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }

let pass = 0, fail = 0, step = "";
const ok = (name, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); g ? pass++ : fail++; console.log(`${g ? "PASS" : "FAIL"}  ${name}${g ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
const b = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
// The app registers a service worker and pulls in web fonts; neither is the
// point here, and both make a headless run flaky, so serve the pages without.
const page = async (w, h) => {
  const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
  p.on("dialog", (d) => d.accept());
  await p.route((u) => u.origin === ROOT && (u.pathname === "/" || u.pathname.endsWith(".html")), async (route) => {
    const r = await route.fetch();
    const body = (await r.text()).replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/g, "").replace('navigator.serviceWorker.register("sw.js")', "Promise.reject()");
    await route.fulfill({ response: r, body, headers: { ...r.headers(), "content-type": "text/html; charset=utf-8" } });
  });
  await p.route("**fonts.googleapis.com/**", (r) => r.abort());
  return p;
};

try {
  step = "sign in to admin";
  const A = await page(1280, 950);
  await A.goto(ROOT + "/admin.html", { waitUntil: "load" }); await A.waitForTimeout(500);
  await A.fill("#pw", "local"); await A.locator("#login .btn").click(); await A.waitForSelector("#editor", { state: "visible" });
  await A.getByRole("button", { name: "Photos", exact: true }).first().click(); await A.waitForTimeout(300);

  step = "upload photos";
  await A.fill("#upAlbum", "Autumn camp 2026");
  await A.selectOption("#upSection", "scouts");
  await A.setInputFiles("#upFiles", files);
  await A.waitForFunction(() => /photos added/.test(document.getElementById("upMsg").textContent), null, { timeout: 60000 });
  ok("all three go up, with a reminder to save", (await A.locator("#upMsg").innerText()).includes("3 photos added"), true);
  const pics = await A.evaluate(() => C.gallery.slice(-3));
  ok("each gets a stored file, a smaller copy for tiles, the album and the section",
    pics.map((g) => [/^\/photo\/[0-9a-f]{32}\.jpg$/.test(g.url), /^\/photo\/[0-9a-f]{32}\.jpg$/.test(g.thumb), g.album, g.section, g.w, g.h]),
    [[true, true, "Autumn camp 2026", "scouts", 1600, 1200], [true, true, "Autumn camp 2026", "scouts", 1600, 1200], [true, true, "Autumn camp 2026", "scouts", 1600, 1200]]);
  ok("three photos are three files, not one", new Set(pics.map((g) => g.url)).size, 3);
  const sizes = await A.evaluate(async (g) => { const out = []; for (const x of g) { const r = await fetch(x.url); out.push([r.status, r.headers.get("content-type"), (await r.blob()).size, (await (await fetch(x.thumb)).blob()).size]); } return out; }, pics);
  ok("every one serves back as a JPEG", sizes.map((x) => [x[0], x[1]]), [[200, "image/jpeg"], [200, "image/jpeg"], [200, "image/jpeg"]]);
  ok("shrunk to something a phone can send, and the tiles smaller again", sizes.every((x) => x[2] < 500 * 1024 && x[3] < 120 * 1024), true);
  console.log("      sent " + sizes.map((x) => Math.round(x[2] / 1024) + "KB").join(", ") + "; tiles " + sizes.map((x) => Math.round(x[3] / 1024) + "KB").join(", ") + " (3000x2250 originals)");
  await A.setInputFiles("#upFiles", [files[0]]);
  await A.waitForFunction(() => /1 photo added/.test(document.getElementById("upMsg").textContent), null, { timeout: 60000 });
  ok("the same photo twice is stored once", await A.evaluate(() => C.gallery[C.gallery.length - 1].url), pics[0].url);
  await A.evaluate(() => { C.gallery.pop(); renderPhotos(); });
  await A.screenshot({ path: ".e2e/admin-photos-1280.png", fullPage: true });

  step = "a sponsor logo";
  await A.getByRole("button", { name: "Fundraising", exact: true }).first().click(); await A.waitForTimeout(300);
  await A.evaluate(() => { C.fundraising = C.fundraising || {}; C.fundraising.sponsors = [{ name: "Burren Stores", url: "", logoUrl: "" }]; renderFund(); });
  await A.locator("#sponsorList .item label.upl input").setInputFiles(files[1]);
  await A.waitForFunction(() => (C.fundraising.sponsors[0].logoUrl || "").startsWith("/photo/"), null, { timeout: 60000 });
  const logo = await A.evaluate(() => C.fundraising.sponsors[0].logoUrl);
  ok("a logo uploads the same way and stays a PNG, so it keeps its transparency", /^\/photo\/[0-9a-f]{32}\.png$/.test(logo), true);
  ok("and comes down small", await A.evaluate(async (u) => (await (await fetch(u)).blob()).size < 400 * 1024, logo), true);

  step = "save and read it back";
  await A.getByRole("button", { name: "Save & publish" }).first().click(); await A.waitForTimeout(1200);

  step = "the gallery";
  const P = await page(390, 844);
  await P.goto(ROOT + "/#more/gallery", { waitUntil: "domcontentloaded" }); await P.waitForTimeout(1500);
  ok("the album is one card, not three loose photos", await P.locator(".albums .album").count(), 1);
  ok("named and counted", (await P.locator(".album-name").innerText()).replace(/\n/g, " "), "Autumn camp 2026 3 photos");
  ok("the collage shows what is in it", await P.locator(".collage img").count(), 3);
  await P.locator(".album").click(); await P.waitForTimeout(400);
  ok("tapping opens the slideshow at the first photo", [await P.locator("#lightbox.on").count(), await P.locator("#lbCap").innerText()], [1, "1 of 3"]);
  await P.locator(".lb-next").click(); await P.waitForTimeout(200);
  ok("and it steps through", await P.locator("#lbCap").innerText(), "2 of 3");
  ok("the full size copy is the one on screen, not the tile", await P.locator("#lbImg").getAttribute("src"), pics[1].url);
  await P.keyboard.press("Escape"); await P.waitForTimeout(200);
  ok("Escape closes it", await P.locator("#lightbox.on").count(), 0);
  await P.screenshot({ path: ".e2e/gallery-390.png", fullPage: true });
  await P.goto(ROOT + "/#sections/scouts", { waitUntil: "domcontentloaded" }); await P.waitForTimeout(1200);
  ok("the section page shows the same photos, at tile size", await P.locator(".strip img").first().getAttribute("src"), pics[0].thumb);
  const W = await page(1280, 900);
  await W.goto(ROOT + "/#more/gallery", { waitUntil: "domcontentloaded" }); await W.waitForTimeout(1200);
  await W.screenshot({ path: ".e2e/gallery-1280.png" });

  step = "tidying up";
  const before = await A.evaluate(async () => (await (await fetch("/.netlify/functions/content?photos=list", { method: "POST", headers: { "x-admin-password": "local" } })).json()).photos.length);
  await A.evaluate(() => tidyPhotos());
  await A.waitForTimeout(1200);
  ok("a file uploaded minutes ago is spared, whatever the site points at", await A.evaluate(async () => (await (await fetch("/.netlify/functions/content?photos=list", { method: "POST", headers: { "x-admin-password": "local" } })).json()).photos.length), before);
  ok("and it says what it did", (await A.locator("#tidyMsg").innerText()).length > 0, true);
} catch (e) { fail++; console.log(`FAIL  suite threw${step ? " at: " + step : ""}:`, e.message.split("\n")[0]); }

await b.close(); stop();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
// End-to-end check of the leaders' area in a real browser. Starts the local
// preview (real rota function, in-memory store, admin password "local"), walks
// the flow as three people in three browser contexts, and stops the preview.
//
//   npm run e2e            (needs Chromium; set CHROME_PATH if it is not found)
//
// Screenshots at 390px and 1280px land in .e2e/, which is gitignored.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const PORT = 8910, H = `http://127.0.0.1:${PORT}/lab/`;
const CHROME = process.env.CHROME_PATH || ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync) || (() => { try { return chromium.executablePath(); } catch { return undefined; } })();
mkdirSync(".e2e", { recursive: true });

const server = spawn(process.execPath, ["tools/serve.mjs", String(PORT)], { stdio: "ignore", env: { ...process.env, ADMIN_PASSWORD: "local" } });
const stop = () => { try { server.kill(); } catch {} };
process.on("exit", stop);
for (let i = 0; i < 40; i++) { try { if ((await fetch(H + "rota.css")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }

let pass = 0, fail = 0;
const ok = (name, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); g ? pass++ : fail++; console.log(`${g ? "PASS" : "FAIL"}  ${name}${g ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
const b = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const page = async (w, h) => { const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage(); p.on("dialog", (d) => d.accept()); return p; };
const go = async (p, f) => { await p.goto(H + f, { waitUntil: "load" }); await p.waitForTimeout(600); };
const signInBtn = (p) => p.getByRole("button", { name: "Sign in", exact: true });
const status = (p, i) => p.locator(".slot").nth(i).locator(".status").innerText().then((t) => t.trim());
const pickSec = async (p, n) => { await p.getByRole("button", { name: n, exact: true }).first().click(); await p.waitForTimeout(150); };
const names = async (p) => (await p.locator("#people .person .nm").allInnerTexts()).map((t) => t.split("\n")[0].replace(/\s*\(you\)\s*$/, "").trim());
// Adds via the form and returns the new person's code, read from their row.
const addOnRoster = async (p, name, secs, lead) => {
  for (const i of await p.locator("#newSecs input").all()) await i.uncheck();
  await p.fill("#newName", name); for (const s of secs) await p.locator(`#newSecs input[data-key=${s}]`).check(); if (lead) await p.check("#newLead");
  await p.getByRole("button", { name: "Add", exact: true }).click(); await p.waitForTimeout(800);
  return (await p.locator("#people tr.person", { hasText: name.split(",")[0].trim() }).locator("td.code-cell code").innerText()).trim();
};

try {
  const S = await page(390, 844); await go(S, "roster.html");
  ok("roster gate shown", await S.locator("#gate").isVisible(), true);
  ok("stylesheet applied", await S.evaluate(() => getComputedStyle(document.body).fontFamily.includes("Inter")), true);
  await S.locator("details summary").click(); await S.fill("#bootName", "Sec Test"); await S.fill("#bootPw", "wrong");
  await S.getByRole("button", { name: "Create the secretary" }).click(); await S.waitForTimeout(500);
  ok("setup refuses a wrong admin password", (await S.locator("#bootMsg").innerText()).includes("Wrong password"), true);
  await S.fill("#bootPw", "local"); await S.getByRole("button", { name: "Create the secretary" }).click(); await S.waitForTimeout(900);
  ok("setup creates the secretary", [await S.locator("#app").isVisible(), await S.locator("#meRole").innerText()], [true, ", secretary, section lead"]);
  const secCode = (await S.locator("#people tr.person", { hasText: "Sec Test" }).locator("td.code-cell code").innerText()).trim();
  ok("the secretary's own code is in their row, with no banner", [/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(secCode), await S.locator("#codeBox").count()], [true, 0]);
  const leadCode = await addOnRoster(S, "Lead Test", ["scouts"], true);
  const memberCode = await addOnRoster(S, "Member Test", ["scouts"], false);
  await addOnRoster(S, "Beaver Helper", ["beavers"], false);
  ok("roster lists all four", await names(S), ["Sec Test", "Lead Test", "Member Test", "Beaver Helper"]);
  ok("a newly added row is highlighted", await S.locator("#people tr.fresh").count() >= 1, true);
  ok("section chips stay ticked for the next add", await S.locator("#newSecs input[data-key=beavers]").isChecked(), true);
  ok("no secretary checkbox on the add form", await S.locator("#newSecretary").count(), 0);
  await S.fill("#newName", "Bulk One, Bulk Two"); await S.getByRole("button", { name: "Add", exact: true }).click(); await S.waitForTimeout(1200);
  ok("several names at once, comma separated", (await names(S)).slice(-2), ["Bulk One", "Bulk Two"]);
  ok("both got codes", await S.locator("#people tr.person td.code-cell code").count(), 6);
  for (const n of ["Bulk One", "Bulk Two"]) { await S.locator("#people tr.person", { hasText: n }).locator("button:has-text('Edit')").click(); await S.waitForTimeout(150); await S.locator("#people tr.editor button:has-text('Remove from roster')").click(); await S.waitForTimeout(700); }
  await S.locator("#newSecs input[data-key=beavers]").uncheck();
  ok("bulk rows removed again", (await names(S)).length, 4);
  ok("secretary sees a code for everyone", await S.locator("#people tr.person td.code-cell code").count(), 4);
  ok("the lead's shown code is the one issued", (await S.locator("#people tr.person", { hasText: "Lead Test" }).locator("td.code-cell code").innerText()).trim(), leadCode);
  ok("section pills rendered, one per section held (the secretary has none)", await S.locator("#people .spill").count(), 3);
  ok("no editor open until Edit is tapped", await S.locator("#people tr.editor").count(), 0);
  await S.screenshot({ path: ".e2e/roster-390.png", fullPage: true });

  const R0 = await page(1280, 900); await go(R0, "rota.html");
  ok("rota gate has no setup form", await R0.locator("#bootName").count(), 0);
  await R0.fill("#code", "AAAA-AAAA"); await signInBtn(R0).click(); await R0.waitForTimeout(500);
  ok("bad code refused", (await R0.locator("#gateMsg").innerText()).includes("not recognised"), true);

  const L = await page(1280, 900); await go(L, "rota.html"); await L.fill("#code", leadCode); await signInBtn(L).click(); await L.waitForTimeout(900);
  ok("lead signs in", [await L.locator("#app").isVisible(), await L.locator("#meRole").innerText()], [true, ", section lead"]);
  ok("lead has no Roster link", await L.locator("#rosterLink").isVisible(), false);
  await pickSec(L, "Scouts");
  ok("lead sees the Scouts roster read-only", await names(L), ["Lead Test", "Member Test"]);
  ok("with section pills", await L.locator("#people .spill").count(), 2);
  ok("no roster controls on the rota page", await L.locator("#newName, #addForm, button:has-text('New code')").count(), 0);
  ok("first slot offers Scouts people only", (await L.locator(".slot").first().locator(".who label").allInnerTexts()).map((t) => t.trim()), ["Lead Test (you)", "Member Test"]);
  await L.locator(".slot").first().locator(".who label", { hasText: "(you)" }).locator("input").check(); await L.waitForTimeout(500);
  await L.locator(".slot").first().locator(".need input").fill("3"); await L.locator(".slot").first().locator(".need input").press("Enter"); await L.waitForTimeout(500);
  ok("lead ticks self and raises the slot to 3", await status(L, 0), "1 OF 3");
  await L.screenshot({ path: ".e2e/rota-lead-1280.png" });

  const M = await page(390, 844); await go(M, "rota.html"); await M.fill("#code", memberCode.toLowerCase()); await signInBtn(M).click(); await M.waitForTimeout(900);
  ok("member signs in (code case-insensitive)", [await M.locator("#app").isVisible(), await M.locator("#meRole").innerText()], [true, ""]);
  await pickSec(M, "Scouts");
  ok("member sees the lead's tick", await status(M, 0), "1 OF 3");
  ok("member cannot tick the lead", await M.locator(".slot").first().locator(".who label", { hasText: "Lead Test" }).locator("input").isDisabled(), true);
  ok("member sees only people sharing a section", (await M.locator(".slot").first().locator(".who label").allInnerTexts()).map((t) => t.trim()), ["Lead Test", "Member Test (you)"]);
  ok("member has no needed control and a disabled default", [await M.locator(".slot").first().locator(".need input").count(), await M.locator("#req").isDisabled()], [0, true]);
  ok("member's roster card is just their sections", (await M.locator("#peopleNote").innerText()).startsWith("Your sections: Scouts"), true);
  await M.locator(".slot").first().locator(".who label", { hasText: "(you)" }).locator("input").check(); await M.waitForTimeout(500);
  ok("member ticks self", await status(M, 0), "2 OF 3");
  await M.screenshot({ path: ".e2e/rota-member-390.png", fullPage: true });

  await L.reload({ waitUntil: "load" }); await L.waitForTimeout(700); await pickSec(L, "Scouts");
  ok("lead sees the member's tick after reload", await status(L, 0), "2 OF 3");
  await S.locator("#people tr.person", { hasText: "Member Test" }).locator("button:has-text('Edit')").click(); await S.waitForTimeout(200);
  ok("Edit opens one editor row", await S.locator("#people tr.editor").count(), 1);
  await S.locator("#people tr.editor button:has-text('New code')").click(); await S.waitForTimeout(800);
  const newCode = (await S.locator("#people tr.person", { hasText: "Member Test" }).locator("td.code-cell code").innerText()).trim();
  ok("secretary issues a new code and the row shows it", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(newCode) && newCode !== memberCode, true);
  await S.locator("#people tr.person", { hasText: "Beaver Helper" }).locator("button:has-text('Edit')").click(); await S.waitForTimeout(200);
  await S.locator("#people tr.editor button:has-text('Remove from roster')").click(); await S.waitForTimeout(800);
  ok("secretary removes the helper", (await names(S)).includes("Beaver Helper"), false);
  await S.locator("#people tr.person", { hasText: "Member Test" }).locator("button:has-text('Edit')").click(); await S.waitForTimeout(200);
  await S.locator("#people tr.editor button:has-text('Remove from roster')").click(); await S.waitForTimeout(800);
  await M.reload({ waitUntil: "load" }); await M.waitForTimeout(800);
  ok("removed member is signed out on reload", [await M.locator("#gate").isVisible(), (await M.locator("#gateMsg").innerText()).includes("removed")], [true, true]);
  await L.reload({ waitUntil: "load" }); await L.waitForTimeout(700); await pickSec(L, "Scouts");
  ok("and their tick is gone for the lead", await status(L, 0), "1 OF 3");

  const S2 = await page(1280, 900); await go(S2, "rota.html"); await S2.fill("#code", secCode); await signInBtn(S2).click(); await S2.waitForTimeout(900);
  ok("secretary on the rota page gets a Roster link", await S2.locator("#rosterLink").isVisible(), true);
  await go(S2, "roster.html"); ok("secretary is signed in on the roster page too (shared token)", await S2.locator("#app").isVisible(), true);
  await S2.locator("#people tr.person", { hasText: "Lead Test" }).locator("button:has-text('Edit')").click(); await S2.waitForTimeout(200);
  await S2.screenshot({ path: ".e2e/roster-1280.png" });
  await L.click("text=Sign out"); await L.waitForTimeout(300);
  ok("sign out returns to the gate", await L.locator("#gate").isVisible(), true);
  await S.locator("#people tr.person", { hasText: "Lead Test" }).locator("button:has-text('Edit')").click(); await S.waitForTimeout(150);
  ok("editor offers to hand the secretary role over", await S.locator("#people tr.editor button:has-text('Make secretary instead of me')").count(), 1);
  await S.locator("#people tr.editor button:has-text('Make secretary instead of me')").click(); await S.waitForTimeout(1200);
  ok("after handing over, the page is read-only for the old secretary", [await S.locator("#addCard").isVisible(), (await S.locator("#intro").innerText()).startsWith("Only the secretary")], [false, true]);
  ok("and the roster shows the new secretary", (await S.locator("#people tr.person", { hasText: "Lead Test" }).innerText()).toLowerCase().includes("secretary"), true);
} catch (e) { fail++; console.log("FAIL  suite threw:", e.message); }
await b.close(); stop();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

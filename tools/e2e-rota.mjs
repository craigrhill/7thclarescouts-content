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

// E2E_PORT moves the preview off 8910, so two suites, or a suite and anything
// else driving a browser at the preview, cannot collide on the one port.
const PORT = Number(process.env.E2E_PORT) || 8910, H = `http://127.0.0.1:${PORT}/lab/`, H_URL = H, APP_ROOT = `http://127.0.0.1:${PORT}/`;
const CHROME = process.env.CHROME_PATH || ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync) || (() => { try { return chromium.executablePath(); } catch { return undefined; } })();
mkdirSync(".e2e", { recursive: true });

const server = spawn(process.execPath, ["tools/serve.mjs", String(PORT)], { stdio: "ignore", env: { ...process.env, ADMIN_PASSWORD: "local" } });
const stop = () => { try { server.kill(); } catch {} };
process.on("exit", stop);
for (let i = 0; i < 40; i++) { try { if ((await fetch(H + "rota.css")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }

let pass = 0, fail = 0, step = "";
const ok = (name, got, want) => { const g = JSON.stringify(got) === JSON.stringify(want); g ? pass++ : fail++; console.log(`${g ? "PASS" : "FAIL"}  ${name}${g ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
const b = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const page = async (w, h) => { const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage(); p.on("dialog", (d) => d.accept()); return p; };
const go = async (p, f) => { await p.goto(H + f, { waitUntil: "load" }); await p.waitForTimeout(600); };
const signInBtn = (p) => p.getByRole("button", { name: "Sign in", exact: true });
// The roster shows each person's own link rather than a bare code, so read the
// code back out of it. That is what the secretary copies and sends.
const codeIn = async (loc) => { const t = (await loc.innerText()).trim(); return (t.match(/[?&]c=([A-Z2-9-]+)/) || [])[1] || t; };
const codeFor = (p, name) => codeIn(p.locator("#people tr.person", { hasText: name }).locator("td.code-cell .link"));
const status = (p, i) => p.locator(".slot").nth(i).locator(".status").innerText().then((t) => t.trim());
// The rota opens on the tab that suits the person: a lead on the whole list,
// a helper on what is still short. Open a named one to look at the rest.
const openTab = async (p, name) => { await p.locator("#tabs button", { hasText: name }).click(); await p.waitForTimeout(200); };
// The public app renders from defaults.js first and again when the content
// function answers, so poll for what should end up on the page rather than
// asking once and catching the wrong render.
const settled = async (p, fn, ok2, ms = 15000) => {
  const until = Date.now() + ms; let last;
  for (;;) { last = await p.evaluate(fn); if (ok2(last) || Date.now() > until) return last; await p.waitForTimeout(250); }
};
const pickSec = async (p, n) => { await p.getByRole("button", { name: n, exact: true }).first().click(); await p.waitForTimeout(150); };
const names = async (p) => (await p.locator("#people .person .nm").allInnerTexts()).map((t) => t.split("\n")[0].replace(/\s*\(you\)\s*$/, "").trim());
// Adds via the form and returns the new person's code, read from their row.
const addOnRoster = async (p, name, secs, lead) => {
  for (const i of await p.locator("#newSecs input").all()) await i.uncheck();
  await p.fill("#newName", name); for (const s of secs) await p.locator(`#newSecs input[data-key=${s}]`).check(); if (lead) await p.check("#newLead");
  await p.locator("#addCard").getByRole("button", { name: "Add", exact: true }).click(); await p.waitForTimeout(800);
  return await codeFor(p, name.split(",")[0].trim());
};

try {
  const S = await page(390, 844); await go(S, "roster.html");
  ok("roster gate shown", await S.locator("#gate").isVisible(), true);
  // The way back into the public app, before sign-in as well as after.
  ok("the header and footer both lead back to the app", [await S.locator(".appbar .back").getAttribute("href"), await S.locator("footer a").getAttribute("href")], ["/", "/"]);
  ok("stylesheet applied", await S.evaluate(() => getComputedStyle(document.body).fontFamily.includes("Inter")), true);
  await S.locator("details summary").click(); await S.fill("#bootName", "Sec Test"); await S.fill("#bootPw", "wrong");
  await S.getByRole("button", { name: "Create the secretary" }).click(); await S.waitForTimeout(500);
  ok("setup refuses a wrong admin password", (await S.locator("#bootMsg").innerText()).includes("Wrong password"), true);
  await S.fill("#bootPw", "local"); await S.getByRole("button", { name: "Create the secretary" }).click(); await S.waitForTimeout(900);
  ok("setup creates the secretary", [await S.locator("#app").isVisible(), await S.locator("#meRole").innerText()], [true, ", secretary, section lead"]);
  const secCode = await codeFor(S, "Sec Test");
  ok("the secretary's own code is in their row, with no banner", [/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(secCode), await S.locator("#codeBox").count()], [true, 0]);
  const leadCode = await addOnRoster(S, "Lead Test", ["scouts"], true);
  const memberCode = await addOnRoster(S, "Member Test", ["scouts"], false);
  await addOnRoster(S, "Beaver Helper", ["beavers"], false);
  ok("roster lists all four", await names(S), ["Sec Test", "Lead Test", "Member Test", "Beaver Helper"]);
  ok("a newly added row is highlighted", await S.locator("#people tr.fresh").count() >= 1, true);
  ok("section chips stay ticked for the next add", await S.locator("#newSecs input[data-key=beavers]").isChecked(), true);
  ok("no secretary checkbox on the add form", await S.locator("#newSecretary").count(), 0);
  await S.fill("#newName", "Bulk One, Bulk Two"); await S.locator("#addCard").getByRole("button", { name: "Add", exact: true }).click(); await S.waitForTimeout(1200);
  ok("several names at once, comma separated", (await names(S)).slice(-2), ["Bulk One", "Bulk Two"]);
  ok("both got a link of their own", await S.locator("#people tr.person td.code-cell .link").count(), 6);
  for (const n of ["Bulk One", "Bulk Two"]) { await S.locator("#people tr.person", { hasText: n }).locator("button:has-text('Edit')").click(); await S.waitForTimeout(150); await S.locator("#people tr.editor button:has-text('Remove from roster')").click(); await S.waitForTimeout(700); }
  await S.locator("#newSecs input[data-key=beavers]").uncheck();
  ok("bulk rows removed again", (await names(S)).length, 4);
  ok("secretary sees a link for everyone", await S.locator("#people tr.person td.code-cell .link").count(), 4);
  ok("the lead's shown link carries the code that was issued", await codeFor(S, "Lead Test"), leadCode);
  ok("section pills rendered, one per section held (the secretary has none)", await S.locator("#people .spill").count(), 3);
  ok("no editor open until Edit is tapped", await S.locator("#people tr.editor").count(), 0);
  await S.screenshot({ path: ".e2e/roster-390.png", fullPage: true });

  const R0 = await page(1280, 900); await go(R0, "rota.html");
  ok("rota gate has no setup form", await R0.locator("#bootName").count(), 0);
  await R0.fill("#code", "AAAA-AAAA"); await signInBtn(R0).click(); await R0.waitForTimeout(500);
  ok("bad code refused", (await R0.locator("#gateMsg").innerText()).includes("not recognised"), true);

  const L = await page(1280, 900); await go(L, "rota.html"); await L.fill("#code", leadCode); await signInBtn(L).click(); await L.waitForTimeout(900);
  ok("lead signs in", [await L.locator("#app").isVisible(), await L.locator("#meRole").innerText()], [true, ", section lead"]);
  ok("lead sees only their own section's chip", (await L.locator("#chips .chip").allInnerTexts()).map((t) => t.trim()), ["Scouts"]);
  ok("a lead is offered the Roster too, and Rota is the highlighted one", [await L.locator("#leaderNav").getByRole("link", { name: "Roster" }).isVisible(), (await L.locator("#leaderNav a.on").innerText()).trim()], [true, "Rota"]);
  await pickSec(L, "Scouts");
  ok("lead sees the Scouts roster read-only", await names(L), ["Lead Test", "Member Test"]);
  ok("with section pills", await L.locator("#people .spill").count(), 2);
  ok("no roster controls on the rota page", await L.locator("#newName, #addForm, button:has-text('New code')").count(), 0);
  ok("first slot offers Scouts people only", (await L.locator(".slot").first().locator(".who label").allInnerTexts()).map((t) => t.trim()), ["Lead Test (you)", "Member Test"]);
  await L.locator(".slot").first().locator(".who label", { hasText: "(you)" }).locator("input").check(); await L.waitForTimeout(500);
  ok("lead ticks self", await status(L, 0), "1 OF 2");
  // What a night needs is set with the night now, not here.
  ok("no numbers to set on the rota page at all", await L.locator(".slot .need input, #req").count(), 0);
  // Ticks on a phone with one bar: the count follows the tap, not the reply,
  // and a reply landing late cannot put an older picture back on screen.
  await L.route("**/functions/rota?a=slot", async (r) => { await new Promise((x) => setTimeout(x, 700)); await r.continue(); });
  await L.locator(".slot").nth(1).locator(".who label", { hasText: "(you)" }).click(); await L.waitForTimeout(120);
  await L.locator(".slot").nth(1).locator(".who label", { hasText: "Member Test" }).click(); await L.waitForTimeout(150);
  ok("two quick ticks show at once, with the count and the saving note", [await L.locator(".slot").nth(1).locator(".who input:checked").count(), (await L.locator("#gaps").innerText()).includes("saving")], [2, true]);
  await L.waitForTimeout(2400);
  ok("and neither is undone when the replies land", [await L.locator(".slot").nth(1).locator(".who input:checked").count(), await status(L, 1)], [2, "COVERED"]);
  await L.unroute("**/functions/rota?a=slot");
  await L.locator(".slot").nth(1).locator(".who label", { hasText: "Member Test" }).click(); await L.waitForTimeout(700);
  await L.locator(".slot").nth(1).locator(".who label", { hasText: "(you)" }).click(); await L.waitForTimeout(700);
  ok("and the slot goes back to empty when both are untapped", await L.locator(".slot").nth(1).locator(".who input:checked").count(), 0);
  await L.screenshot({ path: ".e2e/rota-lead-1280.png" });

  const M = await page(390, 844); await go(M, "rota.html"); await M.fill("#code", memberCode.toLowerCase()); await signInBtn(M).click(); await M.waitForTimeout(900);
  ok("member signs in (code case-insensitive)", [await M.locator("#app").isVisible(), await M.locator("#meRole").innerText()], [true, ""]);
  ok("member sees only their own section's chip", (await M.locator("#chips .chip").allInnerTexts()).map((t) => t.trim()), ["Scouts"]);
  await pickSec(M, "Scouts");
  ok("a helper lands on what is still short", (await M.locator("#tabs button.on").innerText()).split("\n")[0], "Gaps");
  await openTab(M, "Every night");
  ok("member sees the lead's tick", await status(M, 0), "1 OF 2");
  ok("member cannot tick the lead", await M.locator(".slot").first().locator(".who label", { hasText: "Lead Test" }).locator("input").isDisabled(), true);
  ok("member sees only people sharing a section", (await M.locator(".slot").first().locator(".who label").allInnerTexts()).map((t) => t.trim()), ["Lead Test", "Member Test (you)"]);
  ok("a helper gets one button rather than the whole list", [await M.locator(".slot").first().locator(".need input").count(), await M.locator(".slot").first().getByRole("button", { name: /I can do this night|Take me off/ }).count()], [0, 1]);
  ok("member's roster card is just their sections", (await M.locator("#peopleNote").innerText()).startsWith("Your sections: Scouts"), true);
  await M.locator(".slot").first().locator(".who label", { hasText: "(you)" }).locator("input").check(); await M.waitForTimeout(500);
  ok("member ticks self, and the night is covered", await status(M, 0), "COVERED");
  await M.screenshot({ path: ".e2e/rota-member-390.png", fullPage: true });

  await L.reload({ waitUntil: "load" }); await L.waitForTimeout(700); await pickSec(L, "Scouts");
  ok("lead sees the member's tick after reload", await status(L, 0), "COVERED");
  await S.locator("#people tr.person", { hasText: "Member Test" }).locator("button:has-text('Edit')").click(); await S.waitForTimeout(200);
  ok("Edit opens one editor row", await S.locator("#people tr.editor").count(), 1);
  await S.locator("#people tr.editor button:has-text('New link')").click(); await S.waitForTimeout(800);
  const newCode = await codeFor(S, "Member Test");
  ok("secretary issues a new code and the row shows it", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(newCode) && newCode !== memberCode, true);
  await S.locator("#people tr.person", { hasText: "Beaver Helper" }).locator("button:has-text('Edit')").click(); await S.waitForTimeout(200);
  await S.locator("#people tr.editor button:has-text('Remove from roster')").click(); await S.waitForTimeout(800);
  ok("secretary removes the helper", (await names(S)).includes("Beaver Helper"), false);
  await S.locator("#people tr.person", { hasText: "Member Test" }).locator("button:has-text('Edit')").click(); await S.waitForTimeout(200);
  await S.locator("#people tr.editor button:has-text('Remove from roster')").click(); await S.waitForTimeout(800);
  await M.reload({ waitUntil: "load" }); await M.waitForTimeout(800);
  ok("removed member is signed out on reload", [await M.locator("#gate").isVisible(), (await M.locator("#gateMsg").innerText()).includes("removed")], [true, true]);
  await L.reload({ waitUntil: "load" }); await L.waitForTimeout(700); await pickSec(L, "Scouts");
  ok("and their tick is gone for the lead", await status(L, 0), "1 OF 2");

  const S2 = await page(1280, 900); await go(S2, "rota.html"); await S2.fill("#code", secCode); await signInBtn(S2).click(); await S2.waitForTimeout(900);
  ok("secretary on the rota page gets a Roster pill", await S2.locator("#leaderNav").getByRole("link", { name: "Roster" }).isVisible(), true);
  ok("and every section's chip", await S2.locator("#chips .chip").count(), await S2.evaluate(async () => (await (await fetch("/.netlify/functions/content", { cache: "no-store" })).json()).settings.sections.length));
  // A lead with no section on their entry gets a plain message, not an empty rota.
  // Made through the API as the secretary: the add form is for people with sections.
  step = "blank lead";
  const blank = await S.evaluate(async () => { const h = { "Content-Type": "application/json", "x-rota-token": localStorage.getItem("rota-token") };
    const r = await (await fetch("/.netlify/functions/rota?a=person", { method: "POST", headers: h, body: JSON.stringify({ name: "Blank Lead", sections: [], lead: true }) })).json(); return { code: r.code, id: r.person.id }; });
  const Bl = await page(390, 844); await go(Bl, "rota.html"); await Bl.fill("#code", blank.code); await signInBtn(Bl).click(); await Bl.waitForTimeout(900);
  ok("a lead with no sections is told to ask the secretary, and sees no rota", [await Bl.locator("#none").isVisible(), await Bl.locator("#rotaBody").isVisible(), await Bl.locator("#chips .chip").count()], [true, false, 0]);
  await Bl.close();
  await S.evaluate(async (id) => { const h = { "Content-Type": "application/json", "x-rota-token": localStorage.getItem("rota-token") };
    await fetch("/.netlify/functions/rota?a=person-remove", { method: "POST", headers: h, body: JSON.stringify({ id, sections: [] }) }); }, blank.id);
  step = "";
  await go(S2, "roster.html"); ok("secretary is signed in on the roster page too (shared token)", await S2.locator("#app").isVisible(), true);
  await S2.locator("#people tr.person", { hasText: "Lead Test" }).locator("button:has-text('Edit')").click(); await S2.waitForTimeout(200);
  await S2.screenshot({ path: ".e2e/roster-1280.png" });
  await L.click("text=Sign out"); await L.waitForTimeout(300);
  ok("sign out returns to the gate", await L.locator("#gate").isVisible(), true);
  // ---- events: their own page now; the secretary any section, a lead their own ----
  step = "events as secretary";
  const evRows = async (p) => (await p.locator("#events tr.person td.nm").allInnerTexts()).map((t) => t.trim());
  await go(S, "events.html"); await S.waitForTimeout(700);
  ok("the secretary sees a chip per section, plus the whole group and the county inbox", (await S.locator("#chips .chip").allInnerTexts()).map((t) => t.trim()).slice(-2).map((t) => t.replace(/ \(\d+\)$/, "")), ["Whole group", "County"]);
  await pickSec(S, "Scouts");
  const before = (await evRows(S)).length;
  await S.fill("#evDate", "2030-03-14"); await S.fill("#evTitle", "Spring camp");
  await S.locator("#addCard").getByRole("button", { name: "Add", exact: true }).click(); await S.waitForTimeout(1200);
  ok("secretary adds a public Scouts event", (await evRows(S)).length, before + 1);
  ok("it reached the group content endpoint, so parents and the rota see it", await S.evaluate(async () => (await (await fetch("/.netlify/functions/content", { cache: "no-store" })).json()).events.some((e) => e.title === "Spring camp" && e.section === "scouts")), true);
  await S.fill("#evDate", "2030-04-02"); await S.fill("#evTitle", "Leaders planning night"); await S.check("#evPrivate");
  await S.locator("#addCard").getByRole("button", { name: "Add", exact: true }).click(); await S.waitForTimeout(1200);
  ok("a leaders-only event is marked as such", await S.locator("#events tr.person", { hasText: "Leaders planning night" }).locator(".rbadge").innerText(), "LEADERS ONLY");
  ok("and stays off the public calendar", await S.evaluate(async () => (await (await fetch("/.netlify/functions/content", { cache: "no-store" })).json()).events.some((e) => e.title === "Leaders planning night")), false);
  await S.uncheck("#evPrivate");
  await S.fill("#evDate", "2030-03-14"); await S.fill("#evTitle", "Spring camp");
  await S.locator("#addCard").getByRole("button", { name: "Add", exact: true }).click(); await S.waitForTimeout(1000);
  ok("a duplicate is refused with a reason", (await S.locator("#err").innerText()).includes("already an event"), true);
  await S.fill("#evTitle", "");
  await S.locator("#events tr.person", { hasText: "Spring camp" }).locator("button:has-text('Edit')").click(); await S.waitForTimeout(250);
  await S.fill("#edLocation", "Ruan"); await S.selectOption("#edKit", "sionnach");
  // Real start and end times, so a parent's calendar can put the event at the
  // right hour instead of across the whole day.
  await S.fill("#edStart", "18:30"); await S.fill("#edEnd2", "20:00");
  await S.locator("#events tr.editor button:has-text('Save')").click(); await S.waitForTimeout(1200);
  ok("editing an event saves the extra fields, times included", await S.evaluate(async () => { const e = (await (await fetch("/.netlify/functions/content", { cache: "no-store" })).json()).events.find((x) => x.title === "Spring camp"); return [e.location, e.kitId, e.startTime, e.endTime]; }), ["Ruan", "sionnach", "18:30", "20:00"]);
  ok("and the list shows the hours the way the group writes them", (await S.locator("#events tr.person", { hasText: "Spring camp" }).innerText()).includes("6:30 to 8:00 pm"), true);
  ok("the feed puts it at that hour, in Irish time", await S.evaluate(async () => (await (await fetch("/.netlify/functions/content?ics=1", { cache: "no-store" })).text()).includes("DTSTART;TZID=Europe/Dublin:20300314T183000")), true);
  await S.screenshot({ path: ".e2e/events-1280.png", fullPage: true });
  const L2 = await page(1280, 900); await go(L2, "rota.html"); await L2.fill("#code", leadCode); await signInBtn(L2).click(); await L2.waitForTimeout(900); await pickSec(L2, "Scouts");
  const slotText = (await L2.locator(".slot").allInnerTexts()).join(" | ");
  ok("the lead sees both new events on the rota", [slotText.includes("Spring camp"), slotText.includes("Leaders planning night")], [true, true]);
  await L2.screenshot({ path: ".e2e/rota-with-events-1280.png" });
  step = "events as a lead";
  await go(L2, "events.html"); await L2.waitForTimeout(700);
  ok("a lead gets their own section, the whole group and the county inbox", (await L2.locator("#chips .chip").allInnerTexts()).map((t) => t.trim().replace(/ \(\d+\)$/, "")), ["Scouts", "Whole group", "County"]);
  await pickSec(L2, "Scouts");
  await L2.fill("#evDate", "2030-05-10"); await L2.fill("#evTitle", "Scouts hike");
  await L2.locator("#addCard").getByRole("button", { name: "Add", exact: true }).click(); await L2.waitForTimeout(1200);
  ok("a lead adds an event for their section", (await evRows(L2)).length, before + 3);
  await pickSec(L2, "Whole group");
  ok("but has no add form for whole-group events", await L2.locator("#addCard").isVisible(), false);
  step = "events as a helper";
  // Member Test was removed from the roster earlier, so their code no longer
  // signs in. A fresh helper on Scouts, where the events above live, made
  // through the API because the secretary is on the events page, not the roster.
  const evHelperCode = await S.evaluate(async () => { const h = { "Content-Type": "application/json", "x-rota-token": localStorage.getItem("rota-token") };
    return (await (await fetch("/.netlify/functions/rota?a=person", { method: "POST", headers: h, body: JSON.stringify({ name: "Ev Helper", sections: ["scouts"], lead: false }) })).json()).code; });
  const Hv = await page(390, 844); await go(Hv, "events.html"); await Hv.fill("#code", evHelperCode); await signInBtn(Hv).click(); await Hv.waitForTimeout(1000);
  ok("a helper is signed in on their own section and the whole group, with no county inbox", (await Hv.locator("#chips .chip").allInnerTexts()).map((t) => t.trim()), ["Scouts", "Whole group"]);
  ok("a helper sees their section's events read-only", [await Hv.locator("#addCard").isVisible(), await Hv.locator("#events button").count(), (await evRows(Hv)).length >= 2], [false, 0, true]);
  await Hv.screenshot({ path: ".e2e/events-390.png", fullPage: true });
  await Hv.close();
  step = "";
  await go(S, "events.html"); await S.waitForTimeout(700); await pickSec(S, "Scouts");
  for (const t of ["Leaders planning night", "Scouts hike"]) { await S.locator("#events tr.person", { hasText: t }).locator("button:has-text('Edit')").click(); await S.waitForTimeout(250); await S.locator("#events tr.editor button:has-text('Remove')").click(); await S.waitForTimeout(1200); }
  ok("the secretary can remove a lead's event and a leaders-only one", (await evRows(S)).length, before + 1);
  await go(S, "roster.html"); await S.waitForTimeout(700);

  await S.locator("#people tr.person", { hasText: "Lead Test" }).locator("button:has-text('Edit')").click(); await S.waitForTimeout(150);
  ok("editor offers to hand the secretary role over", await S.locator("#people tr.editor button:has-text('Make secretary instead of me')").count(), 1);
  await S.locator("#people tr.editor button:has-text('Make secretary instead of me')").click(); await S.waitForTimeout(1200);
  // Sec Test is a lead as well, so what they keep after handing over is a
  // lead's view: the list and the links, and nothing that changes the roster.
  ok("after handing over, nothing on the page changes the roster any more", [await S.locator("#addCard").isVisible(), await S.locator("#people button:has-text('Edit')").count(), await S.locator("#msgCard").isVisible()], [false, 0, false]);
  // They are a lead with no sections now, so the list narrows to themselves:
  // the rest of the group is not a lead's to see.
  ok("and the role is gone, along with the sight of everybody else's rows", [(await S.locator("#meRole").innerText()).includes("secretary"), await names(S)], [false, ["Sec Test"]]);

  // ---- the badge board: Lead Test is now the secretary; Beaver Helper is a helper on beavers ----
  await go(L2, "badges.html"); await L2.waitForTimeout(600);
  const sectionCount = await L2.evaluate(async () => (await (await fetch("/.netlify/functions/content", { cache: "no-store" })).json()).settings.sections.length);
  ok("badge board opens signed in, with a chip per section", await L2.locator("#chips .chip").count(), sectionCount);
  await pickSec(L2, "Scouts");
  ok("an empty board says so and offers the add form", [await L2.locator("#board .empty").count(), await L2.locator("#newName").count()], [1, 1]);
  await L2.fill("#newName", "Aoife Test, Cian Test"); await L2.locator("#tools").getByRole("button", { name: "Add", exact: true }).click(); await L2.waitForTimeout(900);
  ok("two Scouts added, numbered 1 and 2", await L2.locator("table.board tr.youth td.nm small").allInnerTexts(), ["Scout 1 on the public board", "Scout 2 on the public board"]);
  await L2.locator("table.board tr.youth").first().locator("td.st button").nth(0).click(); await L2.waitForTimeout(200);
  ok("tapping a cell opens the stage picker for that Scout and skill", (await L2.locator(".picker").innerText()).includes("Camping") && (await L2.locator(".picker").innerText()).includes("Aoife Test"), true);
  await L2.locator(".picker").getByRole("button", { name: "4", exact: true }).click(); await L2.waitForTimeout(900);
  ok("the stage shows in the cell and the picker closes", [await L2.locator("table.board tr.youth").first().locator("td.st button").nth(0).innerText(), await L2.locator(".picker").count()], ["4", 0]);
  ok("print and CSV are offered", [await L2.getByRole("button", { name: "Print" }).count(), await L2.getByRole("button", { name: "Download CSV" }).count()], [1, 1]);
  await L2.screenshot({ path: ".e2e/badges-1280.png", fullPage: true });
  const pub = await L2.evaluate(async () => (await (await fetch("/.netlify/functions/rota?a=board&section=scouts")).json()));
  ok("the public board has numbers and stages but no names", [pub.rows, JSON.stringify(pub).includes("Aoife")], [[{ n: 1, stages: { camping: 4 } }, { n: 2, stages: {} }], false]);
  // A helper to look through: the earlier checks removed Beaver Helper, so the secretary adds one now, and puts a Beaver on that board to see.
  step = "add a Beaver to the board";
  await pickSec(L2, "Beavers"); await L2.fill("#newName", "Bea Test"); await L2.locator("#tools").getByRole("button", { name: "Add", exact: true }).click(); await L2.waitForTimeout(900);
  step = "secretary adds Board Helper on the roster";
  await go(L2, "roster.html"); await L2.waitForTimeout(600);
  const helperCode = await addOnRoster(L2, "Board Helper", ["beavers"], false);
  step = "helper signs in to the badge board";
  const Hh = await page(390, 844); await go(Hh, "badges.html"); await Hh.fill("#code", helperCode); await signInBtn(Hh).click(); await Hh.waitForTimeout(900);
  step = "helper reads the Beavers board";
  ok("a helper sees their own section's board with names", [await Hh.locator("#chips .chip").count(), (await Hh.locator("table.board").innerText()).includes("Bea Test")], [1, true]);
  ok("but read-only: no add form, no editable cells", [await Hh.locator("#newName").count(), await Hh.locator("table.board td.st button").count(), await Hh.locator("table.board td.st .ro").count() > 0], [0, 0, true]);
  ok("and nothing of another section's board", (await Hh.locator("body").innerText()).includes("Aoife Test"), false);
  await Hh.screenshot({ path: ".e2e/badges-390.png", fullPage: true });
  step = "secretary removes a Scout from the board";
  await go(L2, "badges.html"); await L2.waitForTimeout(600); await pickSec(L2, "Scouts");
  await L2.locator("table.board tr.youth").first().locator("td.nm button:has-text('Edit')").click(); await L2.waitForTimeout(200);
  await L2.locator("tr.editor button:has-text('Remove from board')").click(); await L2.waitForTimeout(900);
  ok("removing keeps the other Scout's number", await L2.locator("table.board tr.youth td.nm small").allInnerTexts(), ["Scout 2 on the public board"]);

  // ---- the term's nights, and a night that fills up ----
  step = "the term's nights";
  await go(L2, "events.html"); await L2.waitForTimeout(800); await pickSec(L2, "Scouts");
  ok("the meetings card offers the term, worked out from the section's night", await L2.locator("#meetList .entry").count(), 12);
  // The school breaks are kept once in the site's settings, so a night inside
  // one arrives marked off rather than anyone having to remember.
  const inBreaks = await L2.evaluate(() => MEET.filter(e => e.off && e.title).map(e => e.date + " " + e.title));
  ok("a night in a school break comes ready marked, named after the break", inBreaks.some(x => /midterm|Christmas|Easter/i.test(x)), true);
  ok("and nothing is left for the lead to notice", await L2.locator("#breakNote").isHidden(), true);
  ok("and says it is not saved yet", (await L2.locator("#meetNote").innerText()).includes("Save them to take the list over"), true);
  await L2.locator("#meetList .entry").nth(1).getByRole("button", { name: "Edit" }).click(); await L2.waitForTimeout(200);
  await L2.locator("#meetList .entry.open input[type=checkbox]").check();
  await L2.locator("#meetList .entry.open input[type=number]").fill("1");
  await L2.locator("#meetList .entry").first().getByRole("button", { name: "Edit" }).click(); await L2.waitForTimeout(200);
  await L2.locator("#meetList .entry.open input[type=text]").first().fill("Night hike");
  await L2.getByRole("button", { name: "Save the nights" }).click(); await L2.waitForTimeout(1200);
  ok("saving takes the list over", (await L2.locator("#meetMsg").innerText()).includes("12 nights saved"), true);
  await go(L2, "rota.html"); await L2.waitForTimeout(800); await pickSec(L2, "Scouts");
  const slotFor = (p, text) => p.locator(".slot", { hasText: text }).first();
  ok("the rota shows the renamed night", await slotFor(L2, "Night hike").count(), 1);
  // Two of them: the one called off by hand, and the one the October midterm
  // took, which the editor marked before it was ever saved.
  ok("nights that are off are greyed out rather than gone", await L2.locator(".slot", { hasText: "No meeting" }).count(), 2);
  ok("and the school break says which one it is", await L2.locator(".slot", { hasText: "October midterm" }).count(), 1);

  // ---- and out to the parents, because some weeks are off ----
  step = "the nights reach parents";
  const nights = await L2.evaluate(async () => (await (await fetch("/.netlify/functions/content", { cache: "no-store" })).json()).meetings || []);
  ok("saving the nights publishes them to the group calendar", [nights.length, nights.every(m => m.section === "scouts")], [12, true]);
  ok("with the date, the name and the hours, and nothing about adults or the lead's own notes",
    [nights.some(m => m.title === "Night hike"), nights.some(m => m.off), nights.some(m => "need" in m || "details" in m)], [true, true, false]);
  ok("and the subscription feed carries them, so a phone that subscribed sees which Tuesdays are on",
    await L2.evaluate(async () => ((await (await fetch("/.netlify/functions/content?ics=1&section=scouts")).text()).match(/SUMMARY:/g) || []).length >= 12), true);
  // The app itself: the section page and the calendar tab.
  const APP = await page(390, 844);
  await APP.goto(APP_ROOT + "#sections/scouts", { waitUntil: "load" });
  const secPage = await settled(APP, () => ({
    nights: document.querySelectorAll("#secDetail .event.night").length,
    off: document.querySelectorAll("#secDetail .event.night.off").length,
    offText: (document.querySelector("#secDetail .event.night.off") || {}).innerText || "",
    chevs: document.querySelectorAll("#secDetail .event.night .chev").length,
  }), (x) => x.nights >= 8 && x.off >= 1);
  ok("the section page lists the nights under its calendar", secPage.nights >= 8, true);
  ok("a week that is off is struck through and says so", [secPage.off >= 1, secPage.offText.includes("No meeting")], [true, true]);
  ok("and a night is not something to open, so it offers no chevron", secPage.chevs, 0);
  await APP.screenshot({ path: ".e2e/app-section-nights-390.png", fullPage: true });
  await APP.goto(APP_ROOT + "#calendar", { waitUntil: "load" });
  ok("the calendar tab has them too, beside the events",
    await settled(APP, () => document.querySelectorAll("#calBody .event.night").length, (n) => n >= 8) >= 8, true);
  await APP.screenshot({ path: ".e2e/app-calendar-nights-390.png", fullPage: true });
  // Events read as events: green, where a night is plain white.
  const tints = await APP.evaluate(() => {
    const bg = (el) => el && getComputedStyle(el).backgroundColor;
    return { event: bg(document.querySelector("#calBody .event:not(.night)")), night: bg(document.querySelector("#calBody .event.night")) };
  });
  ok("an event card is green and a night's is white", [tints.event, tints.night], ["rgb(233, 244, 228)", "rgb(255, 255, 255)"]);
  // And the nights can be turned off, for whoever is scrolling for the camp.
  ok("the switch fits the tools row on a phone rather than pushing it to a third line",
    await APP.evaluate(() => document.querySelector("#calBody .cal-tools").getBoundingClientRect().height < 100), true);
  await APP.locator("#meetToggle").click(); await APP.waitForTimeout(400);
  ok("turning the weekly meetings off takes every night off the list, cancelled ones included", [await APP.locator("#calBody .event.night").count(), await APP.locator("#calBody .event").count() > 0, await APP.getAttribute("#meetToggle", "aria-pressed")], [0, true, "false"]);
  // After a reload the app draws from defaults.js first, which has no nights,
  // so wait for the real content before counting: only then does zero prove
  // anything.
  await APP.reload({ waitUntil: "load" });
  const afterReload = await settled(APP, () => (typeof C !== "undefined" && Array.isArray(C.meetings) && C.meetings.length) ? document.querySelectorAll("#calBody .event.night").length : -1, (n) => n >= 0);
  ok("and the phone remembers", [afterReload, await APP.getAttribute("#meetToggle", "aria-pressed")], [0, "false"]);
  await APP.screenshot({ path: ".e2e/app-calendar-events-only-390.png", fullPage: true });
  await APP.setViewportSize({ width: 1280, height: 900 }); await APP.waitForTimeout(300);
  await APP.screenshot({ path: ".e2e/app-calendar-events-only-1280.png" });
  await APP.setViewportSize({ width: 390, height: 844 }); await APP.waitForTimeout(300);
  // With the calendar tab set to events only, the section page still shows
  // its term: that page is the term for that section.
  await APP.goto(APP_ROOT + "#sections/scouts", { waitUntil: "load" });
  ok("the section page keeps its own nights while the calendar tab is set to events only",
    await settled(APP, () => document.querySelectorAll("#secDetail .event.night").length, (n) => n >= 8) >= 8, true);
  await APP.goto(APP_ROOT + "#calendar", { waitUntil: "load" });
  await settled(APP, () => (typeof C !== "undefined" && Array.isArray(C.meetings) && C.meetings.length) ? 1 : 0, (n) => n === 1);
  await APP.locator("#meetToggle").click(); await APP.waitForTimeout(400);
  ok("pressing it again brings them back", [await APP.locator("#calBody .event.night").count() >= 8, await APP.getAttribute("#meetToggle", "aria-pressed")], [true, "true"]);
  // The full calendar page has the same switch.
  await APP.goto(APP_ROOT + "calendar.html", { waitUntil: "load" });
  await APP.locator("#viewTbl").click();
  ok("the full calendar lists the nights too", await settled(APP, () => { const t = document.querySelector("#tblView").innerText; return t.includes("Scouts meeting") && t.includes("No meeting"); }, (x) => x === true), true);
  await APP.screenshot({ path: ".e2e/fullcal-390.png", fullPage: true });
  await APP.locator("#meetOff").click(); await APP.waitForTimeout(400);
  ok("and Events only takes them off there as well, leaving the events", await APP.evaluate(() => { const t = document.querySelector("#tblView").innerText; return [t.includes("Scouts meeting"), t.includes("First Meeting")]; }), [false, true]);
  // Back on the table after the reload, and wait for an event that only the
  // content function has, or the check would pass on an empty table.
  await APP.reload({ waitUntil: "load" }); await APP.locator("#viewTbl").click();
  ok("which that page remembers on its own", [await APP.getAttribute("#meetOff", "aria-pressed"),
    await settled(APP, () => { const t = document.querySelector("#tblView").innerText; return t.includes("First Meeting") ? t.includes("Scouts meeting") : null; }, (x) => x !== null)], ["true", false]);
  // Our own events used to be typed "County" on this page, because its
  // normaliser only knew the county's categories. Open one and read the type.
  await APP.locator("#tblWrap button.mev", { hasText: "First Meeting" }).first().click(); await APP.waitForTimeout(400);
  ok("and our own events are typed as ours there, not the county's", (await APP.locator("#evBody .tag").first().innerText()).trim().toUpperCase(), "OURS");
  await APP.keyboard.press("Escape"); await APP.waitForTimeout(200);
  await APP.setViewportSize({ width: 1280, height: 900 }); await APP.waitForTimeout(400);
  await APP.screenshot({ path: ".e2e/fullcal-1280.png" });
  await APP.close();

  // The month the full calendar opens on has to be a month with something on
  // it, as this device is set to see it. Given nights in November and events
  // only from January, with the nights turned off it must open on January:
  // reading the unfiltered list would open on an empty November.
  step = "the month it opens on";
  const JC = await page(1280, 900);
  await JC.route((u) => /fonts\.g/.test(u.hostname), (r) => r.abort());
  await JC.route("**/.netlify/functions/content**", async (r) => {
    const d = await (await r.fetch()).json();
    d.events = [{ date: "2027-01-20", title: "Winter walk", section: "scouts" }];
    d.meetings = [0, 1, 2].map((i) => ({ id: "j" + i, section: "scouts", date: "2026-11-0" + (5 + i) }));
    await r.fulfill({ json: d });
  });
  await JC.addInitScript(() => { try { localStorage.setItem("ccs_meetings", "off"); } catch {} });
  await JC.goto(APP_ROOT + "calendar.html", { waitUntil: "load" });
  const opened = await settled(JC, () => (document.querySelector("#monthLabel") || document.querySelector(".month-nav h2, .month-nav h3, #navRow h2, #navRow h3") || {}).textContent || "", (t) => /\w/.test(t));
  ok("with the nights off it opens on the month that has an event, not the empty one", [/January\s*2027/.test(opened), /November\s*2026/.test(opened)], [true, false]);
  await JC.close();

  step = "first come, first served";
  // Lead Test is the secretary by now, and L2 is the context signed in as them.
  await go(L2, "roster.html"); await L2.waitForTimeout(700);
  const spare = await addOnRoster(L2, "Spare Helper", ["scouts"], false);
  const HP = await page(390, 844); await go(HP, "rota.html"); await HP.fill("#code", spare); await signInBtn(HP).click(); await HP.waitForTimeout(900);
  await pickSec(HP, "Scouts");
  ok("a helper is told what they can take", (await HP.locator("#callout").innerText()).includes("You can take"), true);
  await HP.locator("#gaps .gap.open").first().getByRole("button", { name: "I can do it" }).click(); await HP.waitForTimeout(900);
  ok("and takes it from the gaps list", (await HP.locator("#tallyMine").innerText()), "1");
  await openTab(HP, "My nights");
  ok("which is then on their own list", await HP.locator("#mines .slot").count(), 1);
  await HP.screenshot({ path: ".e2e/rota-helper-390.png", fullPage: true });

  step = "a personal link";
  const P = await page(390, 844);
  await P.goto(H_URL + "rota.html?c=" + encodeURIComponent(spare), { waitUntil: "load" }); await P.waitForTimeout(1200);
  ok("a link signs the phone in with nothing typed", [await P.locator("#app").isVisible(), await P.locator("#meName").innerText()], [true, "Spare Helper"]);
  ok("and the code is taken back out of the address bar", P.url().includes("c="), false);

  step = "the link for chasing";
  const N = await page(390, 844);
  await N.goto(H_URL + "needed.html?section=scouts", { waitUntil: "load" }); await N.waitForTimeout(1200);
  ok("the chasing link needs no sign-in and shows what is short", [await N.locator("#gate").count(), await N.locator("#list .gap").count() > 0], [0, true]);
  ok("and carries no names at all", (await N.locator("body").innerText()).includes("Spare Helper"), false);
  await N.screenshot({ path: ".e2e/needed-390.png", fullPage: true });

  step = "who is down for what";
  await go(L2, "roster.html"); await L2.waitForTimeout(900);
  ok("the secretary sees how much each person has taken on", await L2.locator("#loadTable tr.person").count() >= 4, true);
  ok("and who is down for nothing is marked", await L2.locator("#loadTable tr.person.zero").count() > 0, true);
  ok("the message that goes with a link is theirs to word", (await L2.locator("#msgPreview").innerText()).includes("Hi Mary"), true);
  // The nights it counts are the ones the rota draws, weekday ones included,
  // so it never reports no meetings on a section that plainly has some.
  ok("and it counts the nights the rota shows, not only saved lists", /^[1-9]\d* meetings/.test(await L2.locator("#loadNote").innerText()), true);
  await L2.screenshot({ path: ".e2e/roster-1280.png", fullPage: true });
  const LP = await page(390, 844); await go(LP, "roster.html"); await LP.fill("#code", leadCode); await signInBtn(LP).click(); await LP.waitForTimeout(1100);
  ok("a table of numbers keeps its headings on a phone", [await LP.locator("#loadTable thead").isVisible(), await LP.locator("#loadTable thead th").allInnerTexts()], [true, ["SCOUTER", "MEETINGS", "EVENTS", "TOTAL"]]);
  ok("and the people down for nothing are at the top, said in words as well as colour", (await LP.locator("#loadTable tr.person").first().innerText()).includes("none yet"), true);
  await LP.screenshot({ path: ".e2e/roster-load-390.png", fullPage: true });

  step = "a rule nobody has named";
  // settings.rota carries no qualifiedLabel, so the whole idea is off: no tick
  // box on the roster, no tag beside a name, no numbers on the meetings card.
  ok("nothing on the roster asks about a rule the group has not named", [await L2.locator("#newQualifiedWrap").isVisible(), await L2.locator("#people label", { hasText: "qualified" }).count()], [false, 0]);
  await go(L2, "events.html"); await L2.waitForTimeout(800); await pickSec(L2, "Scouts");
  ok("nor does the meetings card, though it still asks how many adults", [await L2.locator("#meetReq").isVisible(), await L2.locator("#meetQualWrap").isVisible(), await L2.locator("#meetQualEvWrap").isVisible()], [true, false, false]);

  // ---- attendance: the helper takes it at the door, the secretary sees it ----
  await go(Hh, "attendance.html"); await Hh.waitForTimeout(700);
  ok("attendance opens signed in, on the helper's one section, dated today", [await Hh.locator("#chips .chip").count(), await Hh.locator("#date").inputValue() !== "", await Hh.locator("#names label").allInnerTexts()], [1, true, ["Bea Test"]]);
  ok("a helper cannot add Scouts here", await Hh.locator("#newName").count(), 0);
  await Hh.locator("#names label", { hasText: "Bea Test" }).locator("input").check(); await Hh.waitForTimeout(900);
  ok("one tap marks them here and it saves", [(await Hh.locator("#count").innerText()).startsWith("1 of 1 here"), await Hh.locator("#meetings details").count()], [true, 1]);
  ok("the tally shows one of one", (await Hh.locator("#totals").innerText()).replace(/\s+/g, " ").includes("Bea Test 1 1 100%"), true);
  await Hh.screenshot({ path: ".e2e/attendance-390.png", fullPage: true });
  await go(L2, "attendance.html"); await L2.waitForTimeout(700); await pickSec(L2, "Beavers");
  ok("the secretary sees the helper's record, saved under their name", [await L2.locator("#meetings details").count(), (await L2.locator("#count").innerText()).includes("saved by Board Helper")], [1, true]);
  ok("and may add Scouts from here", await L2.locator("#newName").count(), 1);
  // Quick taps at the door, on a phone with one bar: the ticks and the count
  // follow the taps, and a reply that lands late never puts one back.
  await L2.fill("#newName", "Bea Two, Bea Three");
  await L2.locator("#addRow").getByRole("button", { name: "Add", exact: true }).click(); await L2.waitForTimeout(1200);
  await L2.route("**/functions/rota?a=attend", async (r) => { await new Promise((x) => setTimeout(x, 700)); await r.continue(); });
  for (const n of ["Bea Two", "Bea Three"]) { await L2.locator("#names label", { hasText: n }).click(); await L2.waitForTimeout(120); }
  ok("both taps show at once, without waiting for the save", [await L2.locator("#names label.on").count(), (await L2.locator("#count").innerText()).includes("saving")], [3, true]);
  await L2.waitForTimeout(2400);
  ok("and neither reverts when the replies land", (await L2.locator("#names label.on").allInnerTexts()).map((t) => t.trim()).sort(), ["Bea Test", "Bea Three", "Bea Two"]);
  ok("the line says it saved, with no error", [(await L2.locator("#count").innerText()).includes("saved by"), await L2.locator("#err").isVisible()], [true, false]);
  // The same again from "Everyone here", which is how a full house is taken.
  await L2.getByRole("button", { name: "Everyone here" }).click(); await L2.waitForTimeout(120);
  await L2.locator("#names label", { hasText: "Bea Two" }).click();
  await L2.waitForTimeout(2400);
  ok("Everyone here, then one tapped off, leaves the rest on", (await L2.locator("#names label.on").allInnerTexts()).map((t) => t.trim()).sort(), ["Bea Test", "Bea Three"]);
  await L2.unroute("**/functions/rota?a=attend");

  // ---- the Scouters who were there, and the one answerable for the night ----
  step = "Scouters at the door";
  ok("the Scouters covering the section are listed under their own heading", (await L2.locator("#adults label").allInnerTexts()).map((t) => t.trim()).sort(), ["Board Helper", "Lead Test"]);
  ok("and nobody is answerable until somebody says so", [await L2.locator("#lead").inputValue(), (await L2.locator("#leadNote").innerText()).includes("in charge of the programme")], ["", true]);
  await L2.locator("#adults label", { hasText: "Board Helper" }).click(); await L2.waitForTimeout(900);
  ok("a Scouter is ticked in like anyone else", [(await L2.locator("#acount").innerText()).startsWith("1 of 2"), await L2.locator("#adults label.on").count()], [true, 1]);
  await L2.selectOption("#lead", { label: "Lead Test" }); await L2.waitForTimeout(900);
  ok("naming who was in charge marks them there too, so the two agree", [await L2.locator("#adults label.on").count(), (await L2.locator("#adults label", { hasText: "Lead Test" }).innerText()).toUpperCase().includes("IN CHARGE")], [2, true]);
  await L2.locator("#adults label", { hasText: "Lead Test" }).click(); await L2.waitForTimeout(900);
  ok("taking them off again takes the title with them", [await L2.locator("#lead").inputValue(), (await L2.locator("#leadNote").innerText()).includes("in charge")], ["", true]);
  await L2.selectOption("#lead", { label: "Board Helper" }); await L2.waitForTimeout(900);
  const tally = (await L2.locator("#totals").innerText()).replace(/\s+/g, " ");
  ok("the tally puts the young people and the Scouters under headings of their own", [/YOUNG PEOPLE/i.test(tally), /SCOUTERS/i.test(tally), tally.includes("Board Helper 1 1 100%")], [true, true, true]);
  await L2.locator("#meetings summary").first().click(); await L2.waitForTimeout(150);
  ok("and the night's record says who was on and who ran it", (await L2.locator("#meetings details").first().innerText()).replace(/\s+/g, " ").includes("Scouters: Board Helper. In charge: Board Helper."), true);
  await L2.screenshot({ path: ".e2e/attendance-scouters-1280.png", fullPage: true });
  // A night away asks for a camp lead by name, every day of it, and an
  // ordinary night for whoever is in charge of the programme.
  ok("a camp asks for a camp lead, on each of its days, and nothing else does", await L2.evaluate(() => {
    const was = C.events;
    C.events = [{ date: "2030-01-05", endDate: "2030-01-07", section: "beavers", title: "Camp" }];
    const out = ["2030-01-05", "2030-01-06", "2030-01-07", "2030-01-08"].map((d) => leadWord("beavers", d).label);
    C.events = was; return out;
  }), ["Camp lead", "Camp lead", "Camp lead", "In charge of the programme"]);
  await L2.setViewportSize({ width: 390, height: 844 }); await L2.waitForTimeout(300);
  ok("it reads the same on a phone", [await L2.locator("#adults label").count(), await L2.locator("#lead").isVisible()], [2, true]);
  await L2.screenshot({ path: ".e2e/attendance-scouters-390.png", fullPage: true });
  await L2.setViewportSize({ width: 1280, height: 900 }); await L2.waitForTimeout(200);

  // ---- the load table, section by section ----
  // Board Helper takes on Scouts as well as Beavers, so there is somebody the
  // split is actually about: how much of them goes to each.
  step = "who is down for what, per section";
  await go(L2, "roster.html"); await L2.waitForTimeout(900);
  await L2.locator("#people tr.person", { hasText: "Board Helper" }).locator("button:has-text('Edit')").click(); await L2.waitForTimeout(200);
  await L2.locator("#people tr.editor .secs label", { hasText: "Scouts" }).locator("input").check(); await L2.waitForTimeout(1200);
  // A night out that belongs to the whole group, to prove it is not counted
  // twice for somebody who covers two of the sections it is offered to.
  await L2.evaluate(async () => { const h = { "Content-Type": "application/json", "x-rota-token": localStorage.getItem("rota-token") };
    await fetch("/.netlify/functions/rota?a=event", { method: "POST", headers: h, body: JSON.stringify({ date: "2030-06-08", title: "Group day out", section: "" }) }); });
  await go(L2, "rota.html"); await L2.waitForTimeout(800); await pickSec(L2, "Beavers"); await openTab(L2, "Every night");
  // #slots is the Every night pane. The Gaps pane holds .slot cards too, and
  // a hidden one is not clickable, so scope to the list being ticked.
  // A night called off has no list of names on it at all, so reach for the
  // first tickable one across the matching nights rather than the first night.
  const tickOn = async (what) => { await L2.locator("#slots .slot", { hasText: what })
    .locator(".who label", { hasText: "Board Helper" }).first().click(); await L2.waitForTimeout(800); };
  await tickOn("Beavers meeting"); await tickOn("Group day out");
  await pickSec(L2, "Scouts"); await L2.waitForTimeout(500);
  await tickOn("Scouts meeting"); await tickOn("Group day out");
  await go(L2, "roster.html"); await L2.waitForTimeout(1100);
  const loadRow = async (name) => (await L2.locator("#loadTable tr.person", { hasText: name }).innerText()).replace(/\s+/g, " ").trim();
  ok("the card offers All and a pill per section", (await L2.locator("#loadChips .chip").allInnerTexts()).map((t) => t.trim()), ["All", "Beavers", "Cubs", "Scouts", "Ventures"]);
  ok("All says where the nights went, and counts one night out once however many sections were offered it",
    await loadRow("Board Helper"), "Board Helper Beavers 2, Scouts 2 2 1 3");
  await L2.locator("#loadChips .chip", { hasText: "Beavers" }).click(); await L2.waitForTimeout(400);
  ok("one section counts only its own nights", await loadRow("Board Helper"), "Board Helper 1 1 2");
  ok("and only the people who cover it", (await L2.locator("#loadTable tr.person").allInnerTexts()).some((t) => t.includes("Spare Helper")), false);
  ok("the line above counts that section's nights", (await L2.locator("#loadNote").innerText()).includes("Beavers meeting"), true);
  await L2.reload({ waitUntil: "load" }); await L2.waitForTimeout(1200);
  ok("and the section stays picked when the page is opened again", (await L2.locator("#loadChips .chip.on").innerText()).trim(), "Beavers");
  await L2.screenshot({ path: ".e2e/roster-load-section-1280.png", fullPage: true });
  await L2.locator("#loadChips .chip", { hasText: "All" }).click(); await L2.waitForTimeout(400);
  ok("All is the way back", [(await L2.locator("#loadChips .chip.on").innerText()).trim(), (await loadRow("Board Helper")).endsWith("2 1 3")], ["All", true]);

  // ---- a lead on the roster: their own section, its links, no changing it ----
  // Ev Helper is on Scouts and nothing else. Make them its lead, then look at
  // the roster through their eyes.
  step = "a lead reads the roster";
  await go(L2, "roster.html"); await L2.waitForTimeout(900);
  ok("the role landed on Lead Test, who now sees the whole roster and may change it", [(await L2.locator("#meRole").innerText()).includes("secretary"), await L2.locator("#addCard").isVisible(), (await names(L2)).length >= 5], [true, true, true]);
  await L2.locator("#people tr.person", { hasText: "Ev Helper" }).locator("button:has-text('Edit')").click(); await L2.waitForTimeout(200);
  await L2.locator("#people tr.editor label", { hasText: "Section lead" }).locator("input").check(); await L2.waitForTimeout(1100);
  const evLeadCode = await codeFor(L2, "Ev Helper");
  const LD = await page(1280, 900); await go(LD, "roster.html"); await LD.fill("#code", evLeadCode); await signInBtn(LD).click(); await LD.waitForTimeout(1200);
  ok("a lead can open the roster at all, and the leaders' nav offers it", [await LD.locator("#app").isVisible(), (await LD.locator(".lnav").innerText()).includes("Roster")], [true, true]);
  const seen = (await LD.locator("#people tr.person td.nm").allInnerTexts()).map((t) => t.trim().replace(/ \(you\)$/, "")).sort();
  // Everyone carrying Scouts, and nobody else. Board Helper is on it because
  // they took Scouts on earlier; Sec Test carries no section at all and so is
  // not a Scouts lead's to see.
  ok("and sees the people on their own section, nobody else's", seen, ["Board Helper", "Ev Helper", "Lead Test", "Spare Helper"]);
  ok("with a link to hand out and the message that goes with it", [await LD.locator("#people tr.person", { hasText: "Ev Helper" }).locator("button:has-text('Copy link')").count(), await LD.locator("#people tr.person", { hasText: "Ev Helper" }).locator("button:has-text('Copy message')").count()], [1, 1]);
  ok("but nothing to change it with: no add form, no editing, no wording", [await LD.locator("#addCard").isVisible(), await LD.locator("#people button:has-text('Edit')").count(), await LD.locator("#msgCard").isVisible()], [false, 0, false]);
  ok("the secretary's own link is not theirs to have, and the row says so", [await LD.locator("#people tr.person", { hasText: "Lead Test" }).locator("button:has-text('Copy link')").count(), (await LD.locator("#people tr.person", { hasText: "Lead Test" }).innerText()).includes("the secretary's own link")], [0, true]);
  ok("and the header does not call a lead the secretary", (await LD.locator(".appbar .pill").innerText()).trim(), "LEADERS ONLY");
  ok("and the tally is there, for their section, with no pills to choose between", [await LD.locator("#loadCard").isVisible(), await LD.locator("#loadChips").isVisible()], [true, false]);
  ok("counting that section's nights", /^\d+ meetings? and \d+ events? still to come/.test(await LD.locator("#loadNote").innerText()), true);
  await LD.screenshot({ path: ".e2e/roster-lead-1280.png", fullPage: true });
  await LD.setViewportSize({ width: 390, height: 844 }); await LD.waitForTimeout(300);
  await LD.screenshot({ path: ".e2e/roster-lead-390.png", fullPage: true });
  // A helper is where they were: the list, read only, and no links but their own.
  const HR = await page(390, 844); await go(HR, "roster.html"); await HR.fill("#code", helperCode); await signInBtn(HR).click(); await HR.waitForTimeout(1200);
  ok("a helper still gets the list read-only, with no tally and no links to hand out", [await HR.locator("#loadCard").isVisible(), await HR.locator("#addCard").isVisible(), await HR.locator("#people button:has-text('Copy link')").count()], [false, false, 0]);
  ok("and the leaders' nav does not offer them the roster", (await HR.locator(".lnav").innerText()).includes("Roster"), false);
  await HR.close();

  // ---- a section with nights saved but no events ----
  // Saving the term's nights and then reading "nothing coming up" underneath
  // looks like the save failed. The nights are not events; the line says so.
  step = "nights are not events";
  await go(L2, "events.html"); await L2.waitForTimeout(900); await pickSec(L2, "Ventures"); await L2.waitForTimeout(400);
  const empty = async () => (await L2.locator("#events .empty").innerText()).replace(/\s+/g, " ");
  await L2.setViewportSize({ width: 390, height: 844 }); await L2.waitForTimeout(300);
  await L2.locator("#events").scrollIntoViewIfNeeded();
  await L2.screenshot({ path: ".e2e/events-empty-390.png" });
  await L2.setViewportSize({ width: 1280, height: 900 }); await L2.waitForTimeout(300);
  await L2.locator("#events").scrollIntoViewIfNeeded();
  await L2.screenshot({ path: ".e2e/events-empty-1280.png" });
  ok("a section with no events says which list is empty and what belongs on it", [(await empty()).startsWith("No Ventures events coming up."), (await empty()).includes("meeting nights above")], [true, true]);
  // The whole group has an event on it by now, so ask the wording itself: it
  // has no meeting nights of its own, so it points at the section chips.
  ok("the whole group has no nights of its own, so it points at the section chips instead", await L2.evaluate(() => emptyLine("all", false)), "No whole-group events coming up. A section's own events are on its chip.");

  // ---- the installed app: the iOS status bar sits over the page ----
  // viewport-fit is cover on every leaders' page, so in a standalone app the
  // status bar overlays the top of it. The header has to start below the bar,
  // and its own colour has to fill the bar, or the App button and the title
  // end up under the clock, blurred and untappable.
  step = "under the status bar";
  await L2.setViewportSize({ width: 390, height: 844 });
  await go(L2, "roster.html"); await L2.waitForTimeout(900);
  const barTop = async () => (await L2.locator(".appbar").boundingBox()).y;
  const appBtn = async () => (await L2.locator(".appbar .back").boundingBox()).y;
  ok("in a browser, with no bar to dodge, the header starts at the very top", [await barTop(), (await appBtn()) < 20], [0, true]);
  await L2.addStyleTag({ content: ":root{--safe-top:47px;--safe-bottom:34px}" }); await L2.waitForTimeout(200);
  ok("on a phone the bar's colour still reaches the top, and the App button clears the clock", [await barTop(), (await appBtn()) >= 47], [0, true]);
  ok("and the footer clears the home indicator", await L2.evaluate(() => parseFloat(getComputedStyle(document.querySelector("footer")).paddingBottom) >= 34 + 48), true);
  await L2.screenshot({ path: ".e2e/roster-safe-area-390.png" });
  await L2.setViewportSize({ width: 1280, height: 900 });

  // ---- the admin password signs the leaders' pages in as the secretary ----
  step = "sign into admin.html";
  const A = await page(1280, 900); await A.goto(H.replace(/lab\/$/, "admin.html"), { waitUntil: "load" }); await A.waitForTimeout(600);
  await A.fill("#pw", "local"); await A.locator("#login .btn").click(); await A.waitForSelector("#editor", { state: "visible" });
  ok("the admin editor links to the leaders' area once signed in", await A.locator("#leadersLink").isVisible(), true);
  step = "rota via the admin password";
  await go(A, "rota.html");
  ok("with the admin password on the device, the rota opens as the secretary with no code typed", [await A.locator("#app").isVisible(), await A.locator("#meName").innerText()], [true, "Lead Test"]);
  await A.screenshot({ path: ".e2e/rota-via-admin-1280.png" });
  await go(A, "badges.html");
  ok("and so does the badge board", await A.locator("#app").isVisible(), true);
  await A.locator("#app").getByRole("button", { name: "Sign out" }).click(); await A.waitForTimeout(300);
  await go(A, "attendance.html");
  ok("signing out there sticks, and the gate offers the admin route back", [await A.locator("#gate").isVisible(), await A.locator("#adminHint").isVisible()], [true, true]);
  await A.locator("#adminHint button").click(); await A.waitForTimeout(900);
  ok("one tap brings it back", await A.locator("#app").isVisible(), true);

  // ---- the owner: named in the app, so the roster cannot move the role ----
  // Last, because adding them makes them the secretary from that moment.
  step = "the owner";
  await go(L2, "roster.html"); await L2.waitForTimeout(900);
  // Added by the form rather than addOnRoster, which reads the new code back
  // out of the row: this one's code is the secretary's and is not handed to a
  // lead, which the secretary is about to become.
  for (const i of await L2.locator("#newSecs input").all()) await i.uncheck();
  await L2.fill("#newName", "Craig Hill"); await L2.locator("#newSecs input[data-key=scouts]").check();
  await L2.locator("#addCard").getByRole("button", { name: "Add", exact: true }).click(); await L2.waitForTimeout(1400);
  ok("added as a plain helper, the owner is the secretary from that moment",
    (await L2.locator("#people tr.person", { hasText: "Craig Hill" }).innerText()).toLowerCase().includes("secretary"), true);
  ok("and the secretary who added them is a lead now, with no add form left",
    [await L2.locator("#addCard").isVisible(), await L2.locator("#people button:has-text('Edit')").count()], [false, 0]);
  // The owner's own view, reached the way Craig will reach it: the admin
  // password on the device signs the leaders' pages in as the secretary.
  const OW = await page(1280, 900);
  await OW.goto(H.replace(/lab\/$/, "admin.html"), { waitUntil: "load" }); await OW.waitForTimeout(600);
  await OW.fill("#pw", "local"); await OW.locator("#login .btn").click(); await OW.waitForSelector("#editor", { state: "visible" });
  await go(OW, "roster.html"); await OW.waitForTimeout(1400);
  ok("the admin password signs in as the owner, whoever the roster last flagged", [await OW.locator("#meName").innerText(), (await OW.locator("#meRole").innerText()).includes("secretary")], ["Craig Hill", true]);
  await OW.locator("#people tr.person", { hasText: "Craig Hill" }).locator("button:has-text('Edit')").click(); await OW.waitForTimeout(300);
  const ed = OW.locator("#people tr.editor");
  ok("their own row cannot be removed, and says why", [await ed.locator("button:has-text('Remove from roster')").count(), (await ed.innerText()).includes("The app names Craig Hill as the group's secretary")], [0, true]);
  ok("but a new link can still be sent to themselves", await ed.locator("button:has-text('New link')").count(), 1);
  await OW.locator("#people tr.person", { hasText: "Spare Helper" }).locator("button:has-text('Edit')").click(); await OW.waitForTimeout(300);
  ok("and nobody else is offered the role any more", [await OW.locator("#people tr.editor button:has-text('Make secretary instead of me')").count(), await OW.locator("#people tr.editor button:has-text('Remove from roster')").count()], [0, 1]);
  await OW.screenshot({ path: ".e2e/roster-owner-1280.png", fullPage: true });
} catch (e) { fail++; console.log(`FAIL  suite threw${step ? " at: " + step : ""}:`, e.message.split("\n")[0]);
  for (const p of b.contexts().flatMap((c) => c.pages())) { try { await p.screenshot({ path: `.e2e/threw-${b.contexts().flatMap((c) => c.pages()).indexOf(p)}.png` }); } catch {} } }
await b.close(); stop();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

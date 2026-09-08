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

let pass = 0, fail = 0, step = "";
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
  await p.locator("#addCard").getByRole("button", { name: "Add", exact: true }).click(); await p.waitForTimeout(800);
  return (await p.locator("#people tr.person", { hasText: name.split(",")[0].trim() }).locator("td.code-cell code").innerText()).trim();
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
  const secCode = (await S.locator("#people tr.person", { hasText: "Sec Test" }).locator("td.code-cell code").innerText()).trim();
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
  ok("lead sees only their own section's chip", (await L.locator("#chips .chip").allInnerTexts()).map((t) => t.trim()), ["Scouts"]);
  ok("lead has no Roster pill, and Rota is the highlighted one", [await L.locator("#leaderNav").getByRole("link", { name: "Roster" }).isVisible(), (await L.locator("#leaderNav a.on").innerText()).trim()], [false, "Rota"]);
  await pickSec(L, "Scouts");
  ok("lead sees the Scouts roster read-only", await names(L), ["Lead Test", "Member Test"]);
  ok("with section pills", await L.locator("#people .spill").count(), 2);
  ok("no roster controls on the rota page", await L.locator("#newName, #addForm, button:has-text('New code')").count(), 0);
  ok("first slot offers Scouts people only", (await L.locator(".slot").first().locator(".who label").allInnerTexts()).map((t) => t.trim()), ["Lead Test (you)", "Member Test"]);
  await L.locator(".slot").first().locator(".who label", { hasText: "(you)" }).locator("input").check(); await L.waitForTimeout(500);
  await L.locator(".slot").first().locator(".need input").fill("3"); await L.locator(".slot").first().locator(".need input").press("Enter"); await L.waitForTimeout(500);
  ok("lead ticks self and raises the slot to 3", await status(L, 0), "1 OF 3");
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
  ok("after handing over, the page is read-only for the old secretary", [await S.locator("#addCard").isVisible(), (await S.locator("#intro").innerText()).startsWith("Only the secretary")], [false, true]);
  ok("and the roster shows the new secretary", (await S.locator("#people tr.person", { hasText: "Lead Test" }).innerText()).toLowerCase().includes("secretary"), true);

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
} catch (e) { fail++; console.log(`FAIL  suite threw${step ? " at: " + step : ""}:`, e.message.split("\n")[0]);
  for (const p of b.contexts().flatMap((c) => c.pages())) { try { await p.screenshot({ path: `.e2e/threw-${b.contexts().flatMap((c) => c.pages()).indexOf(p)}.png` }); } catch {} } }
await b.close(); stop();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

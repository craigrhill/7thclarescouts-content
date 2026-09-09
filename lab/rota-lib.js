// Shared by lab/rota.html and lab/roster.html: sign-in token, API calls, and
// a few helpers. Plain globals on purpose; both pages are single files.
const API = "/.netlify/functions/rota", TK = "rota-token";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
// The year is shown only when it is not the current one, so a list spanning
// years does not read as jumbled while this year's dates stay short.
const fmt = s => { const d = new Date(s + "T12:00:00"); return d.toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) }); };
let token = null; try { token = localStorage.getItem(TK); } catch {}
// Nobody types a code. It is handed out as a link, ?c=XXXX-XXXX on the rota
// page, spent on the first load and taken straight back out of the address bar
// so it is not left sitting in the tab for the next person to read.
const linkCode = new URLSearchParams(location.search).get("c");
function dropCodeFromUrl(){
  try { const u = new URL(location.href); if (u.searchParams.has("c")) { u.searchParams.delete("c"); history.replaceState(null, "", u.pathname + u.search + u.hash); } } catch {}
}
// A link to a page beside this one, whether Netlify is serving these pretty
// (/lab/rota) or as files (/lab/rota.html).
function pageLink(page, query){
  const path = location.pathname.replace(/(rota|roster|events|badges|attendance|needed)(\.html)?$/, (m, name, ext) => page + (ext || ""));
  return location.origin + (path === location.pathname ? "/lab/" + page + ".html" : path) + (query || "");
}
// The link to send someone. The same code, nothing for them to remember.
const codeLink = code => pageLink("rota") + "?c=" + encodeURIComponent(code);
// The standard wording that goes with it. The secretary can word it herself on
// the roster page; {name}, {link}, {from} and {section} are filled in.
const STANDARD_MESSAGE = "Hi {name}, here is your own link to the 7th Clare rota:\n\n{link}\n\nIt is yours alone, so please keep it to yourself. Open it and you can put yourself down for the meetings and events you can help at. Your phone stays signed in, so keep this message in case you need the link again.\n\nThanks, {from}";
function messageFor(person, code, from, wording){
  const fill = { name: person.name, link: codeLink(code), from: from || "", section: (person.sections || []).join(", ") || "the group" };
  return String(wording || STANDARD_MESSAGE).replace(/\{(name|link|from|section)\}/g, (m, k) => fill[k]);
}
// Sign in from the link, if there is one, before anything else: a personal
// link beats whoever this phone was signed in as before, so handing a phone
// round does the obvious thing.
async function signInFromLink(after){
  if (!linkCode) return false;
  try { const r = await api("POST", "?a=login", { code: linkCode }); setToken(r.token); dropCodeFromUrl(); await after(); return true; }
  catch { dropCodeFromUrl(); return false; }
}
function setToken(t){ token = t; try { if (t) localStorage.setItem(TK, t); else localStorage.removeItem(TK); } catch {} }
let onUnauthorized = () => {};

async function api(method, q, body, extra = {}) {
  const h = { "Content-Type": "application/json", ...extra }; if (token) h["x-rota-token"] = token;
  const r = await fetch(API + q, { method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const j = await r.json().catch(() => ({ error: "The server gave an unexpected reply." }));
  if (r.status === 401 && token && q !== "?a=login" && q !== "?a=admin-login") { setToken(null); onUnauthorized("Your sign-in has expired or been removed. Sign in again."); throw new Error(j.error || "Please sign in."); }
  if (!r.ok) throw new Error(j.error || ("Error " + r.status));
  return j;
}
// What the group asks of at least one adult on a night, where it asks
// anything: Garda vetting, a first aider, whatever the rule is. Until the
// group names it in admin there is no rule at all: no checkbox on the roster,
// no tag beside a name, no numbers for a lead to set. Naming it turns all of
// that on, worded the way the group words it, and the numbers are then per
// section and still start at nought.
let QUAL = { on: false, label: "", short: "" };
const qualOn = () => QUAL.on;
async function loadContent(){
  let c;
  try { const r = await fetch("/.netlify/functions/content", { cache: "no-store" }); c = await r.json(); if (!c || !c.settings) throw 0; }
  catch { c = { settings: { sections: [{ key: "scouts", name: "Scouts", day: "Thursday", time: "6:00 to 7:30 pm" }] }, events: [] }; }
  const r0 = (c.settings && c.settings.rota) || {};
  const label = String(r0.qualifiedLabel || "").trim();
  QUAL = { on: !!label, label, short: String(r0.qualifiedShort || "").trim() || label };
  document.querySelectorAll("[data-qual-label]").forEach(el => { el.textContent = QUAL.label; });
  document.querySelectorAll("[data-qual-only]").forEach(el => { el.hidden = !QUAL.on; });
  return c;
}
// The nights a section has: the list its lead has saved on the Events page,
// or, until there is one, the ones worked out from the section's own meeting
// night. The rota draws these and the roster counts them, so the two cannot
// disagree about how many nights there are to fill.
const DAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const isoOf = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
function meetingNights(C, D, k){
  const section = ((C.settings || {}).sections || []).find(x => x.key === k) || {};
  const saved = (((D || {}).calendar || {}).entries || []).filter(e => e.section === k);
  const t = isoOf(new Date());
  if (saved.length) return saved.filter(e => e.date >= t).sort((a, b) => a.date.localeCompare(b.date));
  const wd = DAYS[String(section.day || "").toLowerCase()];
  if (wd === undefined) return [];
  const out = [], d = new Date(); d.setHours(12, 0, 0, 0);
  while (d.getDay() !== wd) d.setDate(d.getDate() + 1);
  for (let i = 0; i < 8; i++) { out.push({ id: isoOf(d), section: k, date: isoOf(d) }); d.setDate(d.getDate() + 7); }
  return out;
}
// School breaks, kept once in the site's settings: midterms, Christmas,
// Easter. A night inside one is not a night: the tool marks it off with the
// break's name rather than anyone remembering to. A break with no sections
// named is every section's.
const BREAKS = c => (((c || {}).settings || {}).breaks || []).filter(b => b && b.start && b.end);
const breakOn = (c, date, section) => BREAKS(c).find(b => date >= b.start && date <= (b.end || b.start)
  && (!Array.isArray(b.sections) || !b.sections.length || b.sections.includes(section)));
const qualTag = p => (QUAL.on && p.qualified) ? `<span class="tag" title="${esc(QUAL.label)}">${esc(QUAL.short)}</span>` : "";
// On a rota the people who answer the rule come first: a night is not covered
// without one of them, so they are the ones being looked for.
const byName2 = (a, b) => String(a.name).localeCompare(String(b.name), "en-IE");
const byQualifiedThenName = (a, b) => (!!b.qualified - !!a.qualified) || byName2(a, b);
// The admin password, which admin.html keeps on the device, signs these
// pages in as the current secretary without a code. It is tried on every
// load, so a handover is picked up at once. Signing out here switches it
// off until admin.html is signed into again, or the gate's button is tapped.
const PW_KEY = "admin-pw", BRIDGE_OFF = "rota-bridge-off";
function adminPw(){ try { return localStorage.getItem(PW_KEY) || ""; } catch { return ""; } }
function bridgeOff(){ try { return !!localStorage.getItem(BRIDGE_OFF); } catch { return false; } }
async function adminSignIn(){
  const pw = adminPw(); if (!pw) return false;
  const r = await api("POST", "?a=admin-login", null, { "x-admin-password": pw });
  setToken(r.token); try { localStorage.removeItem(BRIDGE_OFF); } catch {} return true;
}
async function bridgeIfAdmin(){ if (adminPw() && !bridgeOff()) { try { await adminSignIn(); } catch {} } }
function leaveBridge(){ try { if (adminPw()) localStorage.setItem(BRIDGE_OFF, "1"); } catch {} }
async function useAdmin(after, msgId){
  $(msgId).textContent = ""; $(msgId).className = "msg";
  try { await adminSignIn(); await after(); } catch (e) { $(msgId).textContent = e.message; $(msgId).className = "msg err"; }
}
// The pill nav across the leaders' pages, built once here so all four agree.
// Roster is the secretary's and shows for them only. The current page is
// worked out from the path, which Netlify serves without the .html.
const LEADER_PAGES = [
  ["rota.html", "Rota", '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>'],
  ["events.html", "Events", '<svg viewBox="0 0 24 24"><path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/></svg>'],
  ["attendance.html", "Attendance", '<svg viewBox="0 0 24 24"><path d="M9 12l2 2 4-4"/><rect x="4" y="4" width="16" height="16" rx="3"/></svg>'],
  ["badges.html", "Badge board", '<svg viewBox="0 0 24 24"><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/></svg>'],
  ["roster.html", "Roster", '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 19a6 6 0 0 1 12 0M14 18a4 4 0 0 1 7 0"/></svg>', "secretary"],
];
function leaderNav(me){
  const here = (location.pathname.split("/").pop() || "rota").replace(/\.html$/, "");
  return `<nav class="lnav" aria-label="Leaders' pages">${LEADER_PAGES.filter(([,,, role]) => !role || me[role]).map(([href, label, icon]) => {
    const on = href.replace(/\.html$/, "") === here;
    return `<a href="${href}" class="${on ? "on" : ""}"${on ? ' aria-current="page"' : ""}>${icon}<span>${label}</span></a>`; }).join("")}</nav>`;
}
const roleText = me => [me.secretary && "secretary", me.lead && "section lead"].filter(Boolean).join(", ");
// One colour per section, from the site's own accent palette. Unknown keys
// cycle through a neutral set so a new section never renders unstyled.
const SECTION_COLOURS = { beavers: ["#DEE5F7", "#22407F"], cubs: ["#E3ECDC", "#3B5230"], scouts: ["#FDE8D3", "#9A4B00"], ventures: ["#F6DCE8", "#7E2049"] };
const FALLBACK_COLOURS = [["#E8E4DA", "#2F3134"], ["#DCEAF0", "#1B4A63"], ["#FBE9EC", "#7A1F2E"], ["#FFF4D6", "#7A5A00"]];
function pill(C, key){ const i = C.settings.sections.findIndex(x => x.key === key); const c = SECTION_COLOURS[key] || FALLBACK_COLOURS[(i < 0 ? 0 : i) % FALLBACK_COLOURS.length]; const name = (C.settings.sections[i] || {}).name || key; return `<span class="spill" style="background:${c[0]};color:${c[1]}">${esc(name)}</span>`; }
// The nine Adventure Skills in the order the public page lists them, with a
// short form for column headings. Keys match the rota function's SKILLS.
const SKILLS = [["camping","Camping","Camp"],["backwoods","Backwoods","Back"],["pioneering","Pioneering","Pion"],["hillwalking","Hillwalking","Hill"],["emergencies","Emergencies","Emer"],["air","Air Activities","Air"],["paddling","Paddling","Padd"],["rowing","Rowing","Row"],["sailing","Sailing","Sail"]];
// How a row is labelled on the public board, where no name is shown.
// The hours an event runs, as people write them here: "6:00 to 7:30 pm",
// "11:00 am to 1:00 pm", "7:00 pm". Events made before there were real times
// carry only the free text a leader typed, so that is the fallback. Kept
// identical in index.html, calendar.html and lab/rota-lib.js;
// tools/test-times.mjs holds the three copies together.
function eventWhen(e){
  var ok = function(x){ return /^([01]\d|2[0-3]):[0-5]\d$/.test(x || "") ? x : ""; };
  var s = ok(e.startTime), f = ok(e.endTime);
  if (!s) return e.time || "";
  var say = function(x, ampm){ var h = +x.slice(0, 2), g = ((h + 11) % 12) + 1; return g + ":" + x.slice(3) + (ampm ? (h < 12 ? " am" : " pm") : ""); };
  if (!f) return say(s, true);
  // The start says am or pm of its own only when the end's would not do for
  // both: across noon, or across midnight onto a later day.
  var half = function(x){ return +x.slice(0, 2) < 12; };
  var days = !!e.endDate && e.endDate !== e.date;
  return say(s, days || half(s) !== half(f)) + " to " + say(f, true);
}
const SECTION_NOUN = { beavers: "Beaver", cubs: "Cub", scouts: "Scout", ventures: "Venture" };
const rowLabel = (k, n) => (SECTION_NOUN[k] || "Member") + " " + n;
const pills = (C, keys) => C.settings.sections.filter(x => (keys || []).includes(x.key)).map(x => pill(C, x.key)).join("") || `<span class="small muted">none</span>`;
async function copyText(t, btn){ try { await navigator.clipboard.writeText(t); if (btn) { const o = btn.textContent; btn.textContent = "Copied"; setTimeout(() => btn.textContent = o, 1200); } } catch {} }
function showCode(name, code){
  $("codeBox").innerHTML = `<b>Code for ${esc(name)}</b><br><span class="code" id="codeText">${esc(code)}</span><br><span class="small">Send it to them now. It stays visible on the roster.</span> <button class="btn" onclick="copyCode()">Copy</button> <button class="btn quiet" onclick="$('codeBox').hidden=true">Close</button>`;
  $("codeBox").hidden = false; $("codeBox").scrollIntoView({ block: "center" });
}
async function copyCode(){ try { await navigator.clipboard.writeText($("codeText").textContent); } catch {} }
async function signIn(code, msgId, after){
  $(msgId).textContent = ""; $(msgId).className = "msg";
  try { const r = await api("POST", "?a=login", { code }); setToken(r.token); await after(); }
  catch (e) { $(msgId).textContent = e.message; $(msgId).className = "msg err"; }
}

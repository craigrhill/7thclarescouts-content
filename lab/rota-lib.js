// Shared by lab/rota.html and lab/roster.html: sign-in token, API calls, and
// a few helpers. Plain globals on purpose; both pages are single files.
const API = "/.netlify/functions/rota", TK = "rota-token";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
// The year is shown only when it is not the current one, so a list spanning
// years does not read as jumbled while this year's dates stay short.
const fmt = s => { const d = new Date(s + "T12:00:00"); return d.toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) }); };
let token = null; try { token = localStorage.getItem(TK); } catch {}
function setToken(t){ token = t; try { if (t) localStorage.setItem(TK, t); else localStorage.removeItem(TK); } catch {} }
let onUnauthorized = () => {};

async function api(method, q, body, extra = {}) {
  const h = { "Content-Type": "application/json", ...extra }; if (token) h["x-rota-token"] = token;
  const r = await fetch(API + q, { method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const j = await r.json().catch(() => ({ error: "The server gave an unexpected reply." }));
  if (r.status === 401 && token && q !== "?a=login") { setToken(null); onUnauthorized("Your sign-in has expired or been removed. Sign in again."); throw new Error(j.error || "Please sign in."); }
  if (!r.ok) throw new Error(j.error || ("Error " + r.status));
  return j;
}
async function loadContent(){
  try { const r = await fetch("/.netlify/functions/content", { cache: "no-store" }); const c = await r.json(); if (!c || !c.settings) throw 0; return c; }
  catch { return { settings: { sections: [{ key: "scouts", name: "Scouts", day: "Thursday", time: "6:00 to 7:30 pm" }] }, events: [] }; }
}
const roleText = me => [me.secretary && "secretary", me.lead && "section lead"].filter(Boolean).join(", ");
// One colour per section, from the site's own accent palette. Unknown keys
// cycle through a neutral set so a new section never renders unstyled.
const SECTION_COLOURS = { beavers: ["#DEE5F7", "#22407F"], cubs: ["#E3ECDC", "#3B5230"], scouts: ["#FDE8D3", "#9A4B00"], ventures: ["#F6DCE8", "#7E2049"] };
const FALLBACK_COLOURS = [["#E8E4DA", "#2F3134"], ["#DCEAF0", "#1B4A63"], ["#FBE9EC", "#7A1F2E"], ["#FFF4D6", "#7A5A00"]];
function pill(C, key){ const i = C.settings.sections.findIndex(x => x.key === key); const c = SECTION_COLOURS[key] || FALLBACK_COLOURS[(i < 0 ? 0 : i) % FALLBACK_COLOURS.length]; const name = (C.settings.sections[i] || {}).name || key; return `<span class="spill" style="background:${c[0]};color:${c[1]}">${esc(name)}</span>`; }
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

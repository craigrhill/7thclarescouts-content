#!/usr/bin/env node
// Apply updates.json to content.json exactly as admin.html's "Apply update"
// button does, for when it is easier to do it in the repo than in the browser.
//
//   node tools/apply-update.mjs [--dry-run]
//
// mergeContent below is a straight port of the function in admin.html. Keep the
// two in step: if one changes, change the other, or the repo and the editor will
// disagree about what an update does.
import { readFileSync, writeFileSync } from "node:fs";

const clone = (x) => JSON.parse(JSON.stringify(x));

function mergeContent(base, patch) {
  const out = clone(base);
  const byId = (arr, key) => Object.fromEntries((arr || []).map((x, i) => [x[key], i]));
  if (Array.isArray(patch.kits)) {
    out.kits = out.kits || [];
    const idx = byId(out.kits, "id");
    patch.kits.forEach((k) => { if (k.id in idx) out.kits[idx[k.id]] = k; else out.kits.push(k); });
  }
  if (Array.isArray(patch.events)) {
    out.events = out.events || [];
    patch.events.forEach((e) => {
      const i = out.events.findIndex((x) => x.date === e.date && x.title.trim().toLowerCase() === e.title.trim().toLowerCase());
      if (i >= 0) out.events[i] = { ...out.events[i], ...e }; else out.events.push(e);
    });
  }
  if (Array.isArray(patch.news)) {
    out.news = out.news || [];
    patch.news.forEach((n) => {
      const i = out.news.findIndex((x) => x.date === n.date && x.title === n.title);
      if (i >= 0) out.news[i] = n; else out.news.push(n);
    });
  }
  if (Array.isArray(patch.notices)) out.notices = patch.notices;
  if (patch.badges) out.badges = { ...(out.badges || {}), ...patch.badges };
  if (patch.fundraising) out.fundraising = { ...(out.fundraising || {}), ...patch.fundraising };
  if (patch.settings) {
    out.settings = { ...out.settings, ...patch.settings };
    if (patch.settings.sections) out.settings.sections = patch.settings.sections;
  }
  return out;
}

const dryRun = process.argv.includes("--dry-run");
const content = JSON.parse(readFileSync("content.json", "utf8"));
const update = JSON.parse(readFileSync("updates.json", "utf8"));

if (!update.version) {
  console.error("updates.json has no version field; nothing to apply.");
  process.exit(1);
}
if ((content.appliedUpdates || []).includes(update.version)) {
  console.log(`Update ${update.version} is already applied. Nothing to do.`);
  process.exit(0);
}

const merged = mergeContent(content, update);
merged.appliedUpdates = [...(content.appliedUpdates || []), update.version];

const before = { kits: content.kits?.length ?? 0, events: content.events?.length ?? 0, badges: "badges" in content };
const after = { kits: merged.kits?.length ?? 0, events: merged.events?.length ?? 0, badges: "badges" in merged };
console.log(`Applying ${update.version}`);
console.log(`  kits   ${before.kits} -> ${after.kits}`);
console.log(`  events ${before.events} -> ${after.events}`);
console.log(`  badges ${before.badges} -> ${after.badges}`);

if (dryRun) { console.log("Dry run; content.json not written."); process.exit(0); }

// Match the formatting the content function writes with, so admin saves produce
// a clean diff against this file rather than reformatting the whole thing.
writeFileSync("content.json", JSON.stringify(merged, null, 2) + "\n");
console.log("content.json updated. Review the diff before pushing.");

# 7th Clare Scouts app

A single-file PWA for parents and Scouts of 7th Clare Scout Group, Ballyvaughan,
Co. Clare (Scouting Ireland). Live at https://7thclarescouts.netlify.app.

Owner: Craig Hill (craigrhill). Group email: 7thclarescouts@gmail.com.

## Conventions (follow these)

* **No em dashes** in any prose or UI text. Use commas, colons or brackets.
* Deliverable zips are named `7th Clare App v0_x.zip`, incrementing every
  iteration. Bump `VERSION` in `sw.js` in the same change, or installed phones
  keep serving the cached old shell.
* Verify UI changes with headless Chromium screenshots at 390px and 1280px
  before reporting them done. Chromium is preinstalled; do not run
  `playwright install`.
* `main` is production and auto-deploys. Anything committed there is public
  within about a minute.

## How it is deployed (changed 2026-09-07)

Netlify auto-publishes from this repo. The older convention of zip drag-and-drop
only, with no Git-based deploys, has been superseded by Craig wiring up Git
auto-publish. Zip drops still work as a fallback but are no longer the path.

Netlify applies Pretty URLs, so `href="admin.html"` is served as `href='/admin'`.
A small diff between the repo and the live HTML is expected and is not a stale
deploy.

## Where content lives

`content.json` on `main` in this repo is the source of truth. The flow is:

    content.json (main)  ->  netlify/functions/content  ->  app

`netlify/functions/content.mjs` picks its source implicitly, with no toggle:

    const repo = process.env.GITHUB_REPO, token = process.env.GITHUB_TOKEN;
    if (!repo || !token) return null;   // null falls back to Netlify Blobs

Both variables must be set, **scoped to Functions**, and the site redeployed.
A Builds-only scope leaves the function blind to them and looks identical to
not setting them at all. `GITHUB_BRANCH` defaults to `main` and `GITHUB_PATH`
to `content.json`, so neither needs setting.

The `source` field on the GET response reports which path was taken
(`"github"` or `"blobs"`). It is the only reliable confirmation the wiring is
right, because the fallback is silent: a missing file or missing env var both
return 200 with `source: "blobs"`. A bad token is different and returns 500.

The pre-migration Netlify Blobs copy (store `site-content`, key `content`) is
still intact but no longer read. It is a usable second snapshot.

`admin.html` writes to the same `content.json` via the GitHub contents API, and
warns if `updatedAt` moved since the editor was opened. When committing content
from a Claude session, set `updatedBy: "claude"` and refresh `updatedAt` so that
warning fires correctly for leaders.

## Layout

    index.html          app shell, hash routing (#home #calendar #kit/<id>
                        #sections/<key> #more/<sub> #events/<i>)
    admin.html          leader editor, noindexed via netlify.toml
    defaults.js         window.DEFAULT_CONTENT, used until leaders save
    kit-defaults.js     window.DEFAULT_KITS
    updates.json        patch shipped with a release, applied from admin
    content.json        live content, source of truth
    sw.js               service worker, VERSION gates the caches
    netlify/functions/content.mjs   prebundled from content.src.js (not in repo)
    tools/apply-update.mjs          ports admin's mergeContent, --dry-run
    tools/serve.mjs                 local preview, stands in for the
                                    content function so the app loads
                                    content.json instead of defaults.js
    docs/Sionnach_Tips.pdf

Tabs: Home, Calendar, Kit, Sections, More. Home is personalised per phone via
localStorage `my-sections`.

Style: Burren palette, limestone greys and sea blue `#1B4A63`, with the logo
orange `#F07800` as accent. Fraunces headings, Inter body. Logo is a
Poulnabrone dolmen silhouette.

## Gotchas

* **The shell cache is cache-first.** `sw.js` does `return cached || net`, so a
  broken `index.html` that gets cached is served once more before a fix lands.
  Bumping `VERSION` purges old caches on activate.
* **`content.mjs` is a build artifact.** Roughly 810 of its 894 lines are
  bundled `@netlify/blobs` vendor code; the real handler is at the bottom under
  the `content.src.js` banner. The source is not in the repo, so changing the
  API means editing bundled output. Extracting it is worth doing.
* **Two functions are duplicated across files.** `mergeContent` lives in both
  `admin.html` and `tools/apply-update.mjs`. `mergeBuiltInKits` lives in both
  `index.html` and `admin.html`. Change one copy and change the other.
* **`knownKitIds` is a ledger, not a setting.** It records every built-in kit
  list admin has already offered, so a list a leader deleted on purpose is not
  auto-added back on the next load. Admin writes it on every save. Do not hand
  edit it to force a list back; delete the id instead.
* **This repo is public and so is the site.** Reverting a commit does not
  unpublish anything already fetched, cached or indexed. Treat names, contact
  details and photos of young people as one-way, and confirm with Craig before
  committing them. Never commit the `GITHUB_TOKEN`; it lives only in Netlify
  env vars, and a leak means rotating it, not reverting.

## Content shape

    { settings: { heroTitle, heroLede, about, venue, email, phone, facebook,
                  instagram, logoUrl?, aboutPhotoUrl?, joinPhotoUrl?,
                  venues: [{name, query, link}],
                  team: [{name, role, section}],
                  sections: [{key, name, ages, day, time, venue, blurb}] },
      badges: { intro, stages, placement: [{area, items[]}], note },
      fundraising: { intro, donateTitle, donateText, donateUrl, donateLabel,
                     campaigns: [{title, blurb, goal, raised, link, linkLabel}],
                     help, sponsors: [{name, url, logoUrl}] },
      notices: [{title, body}],
      events: [{date, endDate?, title, section, location?, time?, kitId?, details}],
      news: [{date, title, body}],
      kits: [{id, title, event, summary, docs: [{title, url, note}], tips[],
              groups: [{name, items: [{n, note?, must?}]}], dontBring[]}],
      appliedUpdates: [], updatedAt, updatedBy }

## Group facts

Beavers, Tue 6:00 to 7:00 pm, The Hall, Ballyvaughan.
Cubs, Thu 6:00 to 7:30 pm, The Hall.
Scouts and Ventures, Thu 6:00 to 7:30 pm, Newquay National School.

Weekly dress: Beavers and Cubs jumper plus necker; Scouts fleece, full uniform
once a term; Ventures necker. Full uniform starts at Scouts. Necker is orange
with a black border.

Kit list ids: weekly, uniform, overnight-out, overnight-in, standing-camp,
sionnach, mpc.

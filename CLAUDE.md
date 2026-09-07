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
    netlify/src/content.mjs         the content function, edit this one
    netlify/src/rota.mjs            the leaders' rota function, edit this one
    netlify/src/foroige.mjs         the Foroige club rota function (see below)
    netlify/functions/*.mjs         built from netlify/src by `npm run build:function`;
                                    self-contained so zip drops still work
    tools/test-function.mjs         offline smoke test of the built content
                                    function; pass two bundles to prove equivalence
    tools/test-rota.mjs             offline harness for the rota function
    tools/test-foroige.mjs          offline harness for the Foroige function
    tools/apply-update.mjs          ports admin's mergeContent, --dry-run
    tools/serve.mjs                 local preview, stands in for the
                                    content function so the app loads
                                    content.json instead of defaults.js
    lab/                experiments. Public on the site but not linked from
                        the app, not cached by sw.js, noindexed, and never
                        read by content.json. Delete a file to remove it.
    lab/rota.html       the rota: coverage per section (see below)
    lab/roster.html     the secretary's roster: people, sections, codes
    lab/rota-lib.js     sign-in, API calls and helpers shared by both
    lab/rota.css        styles shared by both
    foroige/            the Foroige club rota, a separate tool (see below)
    docs/Sionnach_Tips.pdf

Tabs: Home, Calendar, Kit, Sections, More. Home is personalised per phone via
localStorage `my-sections`.

Style: Burren palette, limestone greys and sea blue `#1B4A63`, with the logo
orange `#F07800` as accent. Fraunces headings, Inter body. Logo is a
Poulnabrone dolmen silhouette.

## Leaders' area: the volunteer rota

Shared, private data behind a personal code. Nothing in it is published.

    lab/roster.html (secretary)  \
                                  ->  netlify/functions/rota  ->  Blobs store "rota"
    lab/rota.html (leads, all)   /

Store keys: `secret` (HMAC key, generated on first use, never leaves the
server), `roster` (people with `id`, `name`, `sections`, `lead`, `secretary`,
`codeHash`), `section/<key>` (`required` and `slots`, each slot `who` as
person ids, `off`, optional `need`). Every write is guarded by the document's
etag and retried on conflict, so concurrent edits do not overwrite each other.

Roles are flags on a person, and the function enforces them, not the pages:

* **secretary** keeps the roster on `roster.html`: who is on it, which
  sections each can cover, codes. Done once, by the group secretary. The
  roster always keeps at least one secretary.
* **lead** runs coverage on `rota.html`: adults needed per section and per
  meeting, anyone's ticks, weeks off. Leads see the roster there read-only.
* neither: sees the rota, ticks only themselves, and sees only people who
  share a section with them.

While no secretary exists (a roster from before the role did), leads hold the
secretary's powers so nobody is locked out. The first secretary is created
with the admin password on `roster.html` (`?a=bootstrap`); running it again
with an existing name makes that person secretary and issues a new code.
A code (`XXXX-XXXX`) signs a phone in for 365 days; removing a person revokes
their token at once. The API is documented at the top of
`netlify/src/rota.mjs`.

Local preview: `npm run serve` runs the real rota handler against an
in-memory store, with admin password `local` unless `ADMIN_PASSWORD` is set.

## The Foroige club rota

Not part of the Scouts app. It lives here so it could be built and tested
against the existing rota, and it is meant to move to its own repo and its
own Netlify site. `foroige/README.md` says how to lift it out.

It is the leaders' rota above, copied and then changed for one rule: every
club night and event needs three leaders and one of them must hold the
building specific training from the ETB. So a person carries a `trained`
flag, a club carries `required` and `requiredTrained`, and a single night can
override either. A night with the numbers but nobody trained reads as a
warning, not as covered.

    foroige/rota.html        coverage, everyone
    foroige/roster.html      the coordinator's page, including bulk add
    foroige/rota-lib.js      shared sign-in, API calls, config
    foroige/rota.css         shared styles, a green palette of its own
    foroige/rota-config.json the club, its night, its events, the training

Differences from `lab/` worth knowing:

* Store `foroige`, function `/.netlify/functions/foroige`, token key
  `foroige-token`. Nothing is shared with the Scouts rota.
* **No password hash is committed.** `ADMIN_PASSWORD` must be set in Netlify,
  scoped to Functions. Unset means first-time setup returns 503 saying so.
* The pages read `rota-config.json` beside them, not the content function.
* Roles are the same flags in the store (`secretary`, `lead`) so the two
  functions stay diffable. The words shown are coordinator and club leader.
* Names never go in the repo. The coordinator pastes the list into the
  roster page and it goes straight to the store.

## Gotchas

* **The shell cache is cache-first.** `sw.js` does `return cached || net`, so a
  broken `index.html` that gets cached is served once more before a fix lands.
  Bumping `VERSION` purges old caches on activate.
* **`netlify/functions/content.mjs` is a build artifact. Never edit it.** Edit
  `netlify/src/content.mjs`, run `npm run build:function`, then
  `npm run test:function`, and commit both files together. Roughly 805 of
  its lines are bundled `@netlify/blobs` vendor code, which is deliberate: it
  keeps the deployed function self-contained so the zip-drop fallback works.
  `@netlify/blobs` is pinned exactly in package.json; bumping it changes the
  vendor code, so re-run the equivalence check before committing.
* **Two rota functions, one shape.** `netlify/src/rota.mjs` and
  `netlify/src/foroige.mjs` are the same design and diff cleanly against each
  other. A fix to the store access, the token logic or the conditional-write
  retry in one almost certainly belongs in the other. They are separate files
  on purpose: the Foroige one is leaving.
* **Duplicated on purpose, change together.** `mergeContent` lives in both
  `admin.html` and `tools/apply-update.mjs`. `mergeBuiltInKits` lives in both
  `index.html` and `admin.html`. The admin password check (`BUILT_IN_HASH`
  and `safeEqual`) lives in both `netlify/src/content.mjs` and
  `netlify/src/rota.mjs`, so each built function stays self-contained.
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

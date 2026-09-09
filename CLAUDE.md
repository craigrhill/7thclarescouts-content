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
* `npm test` runs every offline check: the function harnesses and the drift
  guards for the duplicated functions. `npm run e2e` runs two browser suites
  against the local preview, the leaders' area and the picture path, and
  writes screenshots to `.e2e/`. Run both before pushing anything they cover.
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

    calendar.html       /calendar: the full calendar, ported from the county
                        app. Public. Month grid, agenda, table, A3 poster,
                        .ics download and subscribe. Reads the group calendar
                        from the content function and adapts it to the shape
                        that code was written for, so the renderers are
                        untouched.
    index.html          app shell, hash routing (#home #calendar #kit/<id>
                        #sections/<key> #more/<sub> #events/<i>)
    admin.html          the admin editor, noindexed via netlify.toml. Signing in is
                        remembered on the device (see the gotcha below)
    defaults.js         window.DEFAULT_CONTENT, used until leaders save
    kit-defaults.js     window.DEFAULT_KITS
    updates.json        patch shipped with a release, applied from admin
    content.json        live content, source of truth
    sw.js               service worker, VERSION gates the caches
    netlify/src/content.mjs         the content function, edit this one
    netlify/src/rota.mjs            the leaders' rota function, edit this one
    netlify/functions/*.mjs         built from netlify/src by `npm run build:function`;
                                    self-contained so zip drops still work
    tools/test-function.mjs         offline smoke test of the built content
                                    function; pass two bundles to prove equivalence
    tools/test-rota.mjs             offline harness for the rota function
    tools/test-photos.mjs           offline harness for the photo endpoints
    tools/test-ics.mjs              the subscription feed's iCalendar output
    tools/test-kits.mjs             drift guard: mergeBuiltInKits in both files
    tools/test-times.mjs            drift guard: eventWhen in the three pages
    tools/test-sw.mjs               the service worker's caching rules
    tools/test-merge.mjs            drift guard: mergeContent in both files
    tools/e2e-rota.mjs              browser suite for the leaders' area
    tools/e2e-photos.mjs            browser suite for uploading pictures,
                                    from the admin file picker to the gallery
    tools/apply-update.mjs          ports admin's mergeContent, --dry-run
    tools/serve.mjs                 local preview, stands in for the
                                    content function so the app loads
                                    content.json instead of defaults.js,
                                    and answers ?ics=1 as the real one does
    lab/                experiments. Public on the site but not linked from
                        the app, not cached by sw.js, noindexed, and never
                        read by content.json. Delete a file to remove it.
    photo/<id>          uploaded pictures, served from the Blobs store by the
                        content function (see the gotcha below)
    lab/rota.html       the rota: coverage per section, in three tabs (see below)
    lab/needed.html     the link a lead sends when chasing: dates and how many
                        are still needed, no sign-in and no names
    lab/events.html     calendar events: a lead for their sections, the secretary for all
    lab/roster.html     the secretary's roster: people, sections, codes
    lab/badges.html     the Adventure Skills badge board, names and all (see below)
    lab/attendance.html attendance per meeting, taken at the door (see below)
    lab/rota-lib.js     sign-in (code or link), API calls and helpers shared
                        by all of them
    lab/rota.css        styles shared by both
    photos/            images referenced from content, such as the badge
                       placement chart on the Full uniform kit list
    docs/Sionnach_Tips.pdf

Tabs: Home, Calendar, Kit, Sections, More. Home is personalised per phone via
localStorage `my-sections`. The More menu's last row links out to the
leaders' area; an entry there may carry a fifth item, an href, for anything
that is not a `#more` route.

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
`qualified`, `code`, `codeHash`), `section/<key>` (`required`,
`requiredQualified`, `requiredQualifiedEvents`, and `slots`, each slot holding
only `who` as person ids), `calendar` (the term's meetings, per section, see
below), `message` (the wording that goes out with a link), `admin-tries` (the
guard in front of the password), `events` (leaders-only calendar events),
`badges/<key>` (the section's badge board: `next`, `youth` with `id`, `n`,
`name`, and `stages` keyed by youth id then skill), `attendance/<key>`
(`meetings` keyed by ISO date: `present` youth ids, `note`, `by`, `at`).
Every write is guarded by
the document's etag and retried on conflict, so concurrent edits do not
overwrite each other.

Roles are flags on a person, and the function enforces them, not the pages:

* **secretary** keeps the roster on `roster.html`: who is on it, which
  sections each can cover, codes. Done once, by the group secretary. The
  roster always keeps at least one secretary, and the pages assume exactly
  one: the add form has no secretary option, and the role is passed on
  with "Make secretary instead of me" in a person's row. Codes are kept in
  the store so the secretary can see them again; GET returns them to
  secretaries only, never to leads or helpers. Adding is a name (or
  several, comma separated), section chips and Add; the code shows in the
  row.
* **county events** are a chip of their own on `events.html`: "Check the
  county" pulls the feed, and the decision is **per section**. The county
  naming several sections is an offer to each of them, not one group event
  for us: Craig's rule is that a county-wide event is not automatically a
  7th Clare group event, so each of our sections decides for itself. A lead
  is asked only about their own sections, the secretary about every section
  the event was offered to, and a helper is not asked at all. Each section
  that says yes gets its own event on the group calendar, tagged with that
  section, so it lands on that section's chip and on the parents' calendar;
  undoing one leaves the others alone. `countyTargets` works out who is
  asked: the event's sections that are ours, or every section of ours when
  it names none. Items written before this carried one status for the whole
  event; `countyDecisions` reads that as applying to every section it was
  offered to, so nothing already approved drops off the calendar. Reading it
  that way is not enough on its own, because the calendar still holds the old
  whole-group entry, so every sync reconciles: for each item it compares the
  calendar's entries against what the decisions ask for and rewrites only the
  ones that differ, leaving entries for county events it has never seen alone.
  "Check the county" is therefore the repair as well as the fetch, and a sync
  with nothing to put right does not write `content.json` at all. A county
  event is rebuilt on every sync, so it cannot be hand
  edited from a section list; it is marked "county" there and run from the
  County chip. This was on the public `/calendar` page behind a County
  button until it moved here, so the whole event workflow sits in one place.
* **events** live on `events.html`: a lead adds and changes events for the
  sections on their own roster entry, the secretary for any section and for
  the whole group; helpers see their sections' events read-only. The
  function decides, not the page. A public event is written into
  `content.json`, the same file `admin.html` edits, so it reaches parents
  and the rota alike; a "leaders only" one is kept in the rota store and
  shows on the rota only.
* **lead** runs coverage on `rota.html` for the sections on their own
  roster entry: anyone's ticks, and the section's own numbers. Leads see the
  roster there read-only. **The rota page has no settings on it**: what a
  night needs, and whether it is on at all, are set with the night itself,
  under Meeting nights on `events.html`, and `?a=slot` refuses `need` and
  `off` from anyone at all. A tick changes the page
  first and the save follows: requests go one at a time in the order they
  were made, and the section the function sends back is taken only when
  nothing else is waiting, so a reply that lands late cannot put an older
  picture on screen. The local change mirrors what the function does with
  the same request, down to a needed number equal to the section default
  counting as no change at all. One that fails reads the section back from
  the server rather than leaving the page ahead of it.
* neither: sees the rota for their own sections, ticks only themselves, and
  sees only people who share a section with them.

The function returns and accepts only the sections on the caller's roster
entry (all of them for the secretary), so a lead or helper with no section
set sees a message asking the secretary to add one rather than an empty
rota. The county filter still uses the group's whole section list to decide
which of a county event's sections are ours at all.

While no secretary exists (a roster from before the role did), leads hold the
secretary's powers so nobody is locked out. The first secretary is created
with the admin password on `roster.html` (`?a=bootstrap`); running it again
with an existing name makes that person secretary and issues a new code.
A code (`XXXX-XXXX`) signs a phone in for 365 days; removing a person revokes
their token at once. The API is documented at the top of
`netlify/src/rota.mjs`.

### The badge board

`lab/badges.html` is the Adventure Skills badge board: each section's young
people down the side, the nine skills across, the stage held in each cell.
Names live only in the private `rota` store. A lead edits the boards of the
sections on their own roster entry (tighter than the rota, where any lead can
run any section's coverage, because this holds children's names); the
secretary edits all; anyone signed in can look at their own sections' boards.
Leads can print it (A4 landscape, names included, marked "for leaders") and
download a CSV.

The public app shows the same board on each section page, read from the
rota function's one unauthenticated endpoint, `?a=board&section=<key>`,
which strips names and ids and returns `rows: [{n, stages}]`. Each row is
labelled by the section's noun and a number, "Cub 7", so a Scout can be told
their number and find their row without being named. Craig chose this over
first names on purpose: in a village this size a first name beside the
section's age band, venue and meeting time identifies a child. Numbers are
assigned at creation and never changed or reused, so a removal retires a
number rather than shifting everyone else's. Skills are the fixed nine, in
the order the public Adventure Skills page lists them; keys match between
`rota.mjs`, `rota-lib.js` and `index.html`.

### The term's nights, and the places on them

A meeting used to be worked out from the section's weekday: the next eight,
for ever. There was no way to say a night was off for half term, that one of
them was somewhere else, or that this one wanted three adults. The nights are
a list now, in the store under `calendar`, kept per section by its lead on
`events.html` under **Meeting nights**, and written whole by `?a=calendar`
(one section at a time, so a lead can only touch their own).

    entries: [{ id, section, date, title, location, details,
                need, needQualified, off, startTime, endTime }]

**The ticks hang off the entry's id, not its date and name.** `m:<entryId>`,
so moving or renaming a night keeps everyone already down for it. Events got
the same treatment: `cleanEvent` gives one an id and the slot is `e:<id>`,
with `?a=event-update` carrying the ticks across from the old
`e:<date>:<title>` shape the first time an older event is edited, and
`?a=event-remove` taking them away with it. County events take an id made from
the county's own, so a sync never shuffles anyone off; the first sync after
this carries the old ticks across once and records `movedSlots`. `isSlotId`
still accepts both shapes. Until a section has saved a list, both the rota and
the editor fall back to the weeks worked out from its weekday, and the editor
seeds from those, **using each date as the entry id**, so the first save keeps
every tick that is already there.

**School breaks are kept once, not remembered twelve times.** `settings.breaks`
in `content.json` is `[{name, start, end, sections?}]`: the midterms, Christmas
and Easter, off the school calendar, edited in admin under Sections. A break
with no sections named is the whole group's, and the ones in there now name
Scouts and Ventures: those two are at Seamount College, and Beavers and Cubs
are at the primary school, whose calendar is its own and is not in yet. The meetings editor seeds a night
inside one already marked off, titled "No meeting, October midterm", and for a
list that was saved before a break was added it offers one button to mark them
all. The admin editor spells out which nights each break swallows as it is
typed, so a wrong date shows up before it is saved, and the section pages tell
parents which weeks have no meeting, off the same list, so the two can never
disagree. Events are deliberately left alone: a camp in the midterm is the
point of the midterm.

**A night fills up and then closes.** A helper puts themselves on while there
is a place; once there is not, `?a=slot` answers 409 and the button is gone.
Two things stop that deadlocking, and both matter: while a night still wants
somebody who answers the group's rule, that many places are **held**, so the
last one cannot go to somebody who does not; and somebody who does can get on
a night that is already full but has nobody. A lead and the secretary are held
to none of it, which is what makes the rota the place to put right what self
service has left. The rule is enforced inside the read-modify-write, so two
people racing for the last place cannot both win, and mirrored in
`placeForMe()` on the page purely so the button knows what to say.

**The rule itself is Craig's to name, and is off until he does.** A person
carries a `qualified` flag, a section carries `requiredQualified` (meetings)
and `requiredQualifiedEvents`, and both default to 0, so nothing about this
shows anywhere until a number is set. The wording comes from
`settings.rota.qualifiedLabel` and `qualifiedShort` in `content.json`, so it
can be Garda vetting, a first aider, or anything else without the store
moving.

**The rota is three tabs**, remembered in `localStorage` under `rota-tab`:
Gaps (what is still short, each row offering itself to anyone who can take
it), Every night (the whole list with the ticks), and My nights. A lead lands
on Every night, because theirs is the ticking; anyone else on Gaps, because
theirs is the taking. One `slotCard()` draws a night for both of the last two,
so they cannot drift apart.

**Nobody has to type a code.** A person's link is `lab/rota.html?c=XXXX-XXXX`,
built by `codeLink()`; `signInFromLink()` spends it on the first load and
`dropCodeFromUrl()` takes it out of the address bar with `history.replaceState`.
A link beats the token already on the phone, so handing a phone round does the
obvious thing. The roster shows each person's link with **Copy link** and
**Copy message** beside it; the message is a template the secretary words
herself with a live preview, kept under `message` and filled with `{name}`,
`{link}`, `{from}` and `{section}`. Every `lab/` page carries
`<meta name="referrer" content="no-referrer">`, or the Google Fonts request
would carry the whole URL, code and all, in the Referer header.

**Who is down for what** on the roster counts each person over the nights
still to come that are going ahead, meetings and events apart, and marks
anyone at nothing. **The link for chasing** is `lab/needed.html?section=<key>`,
reading `?a=cover&section=<key>`, which takes no token and returns dates and
counts: no names, no ids, and no leaders-only events. It is on the rota page
for leads under "A link for chasing".

### Attendance

`lab/attendance.html` is taken at the door on a phone: pick the section,
the date defaults to today, tap each name as they arrive. Every tap saves
the whole list for that date, so two phones at the door converge on
whatever was tapped last instead of fighting over a diff. On one phone the
tap changes the list locally first and the save goes out behind it: saves
are single file, one request at a time, carrying whatever the list holds
when it goes, and a reply is taken back only when nothing newer is waiting.
Before that the page rebuilt itself from each reply, so four quick taps on
a slow connection left one Scout ticked and the other three marked absent. Names come from
the badge board, which is the one list of young people; a lead can add a
Scout from either page and both see it. Anyone signed in with the section
on their roster entry can fill it in, helpers included, because whoever is
at the door does it; only a lead can add Scouts. "Term so far" lists the
meetings newest first with who was missing, a tally per Scout, print and
CSV. Nothing in it is public, and the public board endpoint never includes
it.

The service worker never caches the rota function except that public board
read, which is network first with the last copy as fallback. Before this the
same-origin catch-all would have cached leaders' GETs cache-first, so keep
that exclusion if the worker is reworked.

Local preview: `npm run serve` runs the real rota handler against an
in-memory store, with admin password `local` unless `ADMIN_PASSWORD` is set.

Every leaders' page carries a way back into the public app: an "App" button
in the header, which is there before sign-in as well as after, and a plain
link in the footer.

## Gotchas

* **Two print stylesheets share one page.** `index.html` prints kit lists and
  the calendar, and each block hides every view but its own. `route()` sets
  `body[data-print]` to the showing tab and each block is scoped to it;
  without that, both blocks apply and printing gives a blank page.
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
* **An event's hours are fields, not prose.** `startTime` and `endTime` are 24
  hour `HH:MM`; an event with no `startTime` is an all-day one, which is what
  every event was before. Both editors offer them as `<input type="time">`,
  `netlify/src/rota.mjs` refuses anything that is not a time and an end that is
  not after the start on a single day, and a start with no end runs an hour.
  `time` is the free text leaders used to type: still read and shown when there
  is nothing better, dropped the moment a real start time is set. The county's
  feed gives free text too, so `readTimes` in `rota.mjs` reads it when it is not
  a guess ("7pm", "18:30", "6:00pm - 7:30pm"); a bare "10:00" could be either
  end of the day and is left as text. A timed event is written into every
  iCalendar output against a VTIMEZONE for Europe/Dublin, in the subscription
  feed, the calendar page's download and the app's single-event download alike,
  because a floating time drifts for anyone whose phone is set elsewhere.
  `eventWhen` turns the pair into the way the group writes times ("6:00 to 7:30
  pm", "11:00 am to 1:00 pm") and lives in `index.html`, `calendar.html` and
  `lab/rota-lib.js`, held together by `tools/test-times.mjs`.
* **The content function serves an iCalendar feed.** `?ics=1`, optionally
  `&section=<key>`, public and read only, so a parent's calendar subscribes
  once and stays current. A section feed carries that section's events plus
  anything group-wide. `tools/test-ics.mjs` pins the awkward parts: the
  exclusive DTEND, escaping, stable UIDs and the 75 octet fold.
* **The rota function writes `content.json` too.** Calendar events from the
  secretary go through the same GitHub-or-Blobs path `content.mjs` uses, so
  those helpers are duplicated in `netlify/src/rota.mjs`. One difference is
  deliberate: `rota.mjs` writes with the sha from the read it based the
  change on, so a concurrent save conflicts and is retried rather than
  overwritten. `content.mjs` re-reads the sha immediately before writing,
  which cannot conflict; it is safe there only because admin replaces the
  whole document and warns on `updatedAt` drift first.
* **Duplicated on purpose, change together.** `mergeContent` lives in both
  `admin.html` and `tools/apply-update.mjs`. `mergeBuiltInKits` lives in both
  `index.html` and `admin.html`. The admin password check (`BUILT_IN_HASH`
  and `safeEqual`) lives in both `netlify/src/content.mjs` and
  `netlify/src/rota.mjs`, so each built function stays self-contained.
* **Admin stays signed in, by storing the password.** `admin.html` keeps the
  admin password in `localStorage` under `admin-pw` and replays it on the next
  visit, so a leader types it once. It is the password rather than a token
  because the content function authenticates every write with the
  `x-admin-password` header; there is no token endpoint on that function, only
  on the rota one. The consequence is that anyone holding an unlocked phone that
  has signed in can read the shared password, so "Sign out" in the header is the
  way to hand a device on. Only a 401 clears the stored copy: being offline
  leaves it alone and says so, or a leader with no signal would be logged out.
  A save that hits 401 asks for the password inline rather than signing out,
  which would throw away unsaved edits. The same stored password also signs
  the leaders' pages in: each `lab/` page's boot tries `?a=admin-login` with
  it, which the rota function answers with a token for the current secretary
  (a device holding the admin password can already create or replace the
  secretary via bootstrap, so this adds no power). "Sign out" on a leaders'
  page sets `rota-bridge-off` so it stays out; the gate then offers a button
  to use the admin sign-in again, and signing into admin re-arms it. Admin's
  own "Sign out" drops the leaders' token too.
* **Two pages can carry one picture, through the same card.** `imageUrl` with
  an optional `imageCaption` on a kit list, or on `badges`, renders a
  `.card.figure`: tappable into the same lightbox the gallery uses, with a
  plain link beside it to the file itself so a phone can pinch-zoom detail the
  lightbox cannot. `figureCard(kind)` builds it and `openFigure(kind)` opens
  it, both reading through `figureSource(kind)`, so the onclick carries the
  literal token `"kit"` or `"badges"` and never a url or caption; an
  apostrophe a leader types cannot break the handler. It is left out of the A4
  kit print, as tips and downloads already are, so that sheet stays a tight
  packing checklist. Scouting Ireland's badge placement chart is the same file
  on both: the Full uniform kit list and the Adventure Skills page, where it
  sits under "Where badges go" beside the built-in jumper diagram.
* **Pictures are uploaded, shrunk on the device first.** Admin has an Upload
  button wherever a picture can go: the gallery (several at once), a sponsor's
  logo, a kit list, the badge chart, the site logo and the about and join
  photos. The browser does the resizing before anything is sent, because a
  picture off a phone is four or five megabytes and the site never shows one
  wider than about 1600: `shrink` in `admin.html` draws it onto a canvas at
  1600 (600 for a logo), encodes JPEG at 0.82 and steps the quality down until
  it is under 400KB, and makes a second 480px copy, under 90KB, for tiles and
  collages. A logo that arrives as a PNG stays a PNG so it keeps its
  transparency; everything else becomes a JPEG. `imageOrientation:
  "from-image"` turns a phone photo the right way up.
  The bytes go to a Blobs store, not the repo:
  `POST /.netlify/functions/content?photo=1` with the admin password and the
  image as the body, answered with `{ id, url }`. The name is the SHA-256 of
  the bytes, so the same photo twice is stored once and `/photo/<id>` is served
  `immutable` for a year. `netlify.toml` rewrites `/photo/*` onto the function.
  `?photos=list` and `?photos=prune` (both admin) back the "Tidy up unused
  files" button, which sends every `/photo/<id>` it can find in the content
  document as the keep list; anything uploaded in the last hour is spared, so a
  save that is still being typed cannot delete someone else's upload.
  **A photo is public the moment it is uploaded, before it is saved, and
  removing it from the gallery does not delete the file.** Only tidying up
  does, and even that cannot un-share a copy someone already has.
  `sw.js` keeps `/photo/*` in a cache of its own, like the fonts, rather than
  the shell's: the name is the hash, so a copy is good for ever, and a VERSION
  bump should not throw away every photo the phone has already fetched. It
  stores a response only when it really is an image. While the pretty path was
  misrouted those URLs answered 200 with the site's JSON, and a cache-first
  store went on serving that after the route was fixed, so every photo stayed
  blank on any device that had looked once. Renaming the store (`photos-2`)
  threw the poisoned copies away, since a store not in the keep list is deleted
  on activate. `tools/test-sw.mjs` pins that and the other caching rules.
* **The stand-in store holds bytes.** `memoryStore` in `netlify/src/rota.mjs`
  is the double behind both offline harnesses and `npm run serve`, and the
  content function keeps photos in a store of that shape, so it holds Buffers
  and answers `type: "arrayBuffer"`. It used to `String(value)` everything,
  which turned a JPEG into a mangled UTF-8 string three times the size. The
  preview also runs the real content function for photo requests, and emulates
  the admin save into the same in-memory store, so an upload and a save can be
  walked through locally end to end.
* **One photo list, two surfaces.** `gallery` is the only place photos live.
  The gallery page under More shows all of them with a chip per section; a
  section page shows the ones whose `section` matches its key, capped at eight,
  linking on to `#more/gallery/<key>`. Photos sharing an `album` show as one
  collage card there, captioned with the album name and the count, which opens
  the slideshow at the first of them; the rest show as loose tiles underneath.
  The slideshow steps with the arrows, the keyboard or a swipe, and says where
  in the album you are. A photo with no `section` is group-wide
  and shows in the gallery only. So leaders add a photo once, in the Photos tab
  in admin, and tag it rather than filing it twice.
* **Social links are a list, not fields.** `settings.social` is
  `[{name, url}]`, so a new account is a row in admin rather than a code
  change. `name` picks the icon (facebook, instagram, tiktok, youtube,
  whatsapp, x, website); anything else still renders with a generic link icon.
  Content saved before the list existed had `settings.facebook` and
  `settings.instagram`: `index.html` falls back to reading those, and admin
  folds them into the list and deletes them on the next save.
* **`knownKitIds` is a ledger, not a setting.** It records every built-in kit
  list admin has already offered, so a list a leader deleted on purpose is not
  auto-added back on the next load. Admin writes it on every save. Do not hand
  edit it to force a list back; delete the id instead.
* **The admin password is throttled.** Both functions count wrong tries in
  their own store under `admin-tries`: fifteen goes, then it shuts for five
  minutes, then fifteen, then an hour. A correct password wipes the count. On
  the rota function the gate covers `?a=admin-login` and `?a=bootstrap` alike.
  **A deploy clears it**, which is the way back in if Craig ever locks himself
  out: the guard records the deploy that was live when it was last written
  (`DEPLOY_ID`, falling back to `COMMIT_REF`) and a newer one starts again.
  With neither set, under the preview and the harnesses, the count persists.
  The password is trimmed at both ends before it is compared.
* **This repo is public and so is the site.** Reverting a commit does not
  unpublish anything already fetched, cached or indexed. Treat names, contact
  details and photos of young people as one-way, and confirm with Craig before
  committing them. Never commit the `GITHUB_TOKEN`; it lives only in Netlify
  env vars, and a leak means rotating it, not reverting.

## Content shape

    { settings: { heroTitle, heroLede, about, venue, email, phone,
                  rota: { qualifiedLabel?, qualifiedShort? },
                  breaks: [{name, start, end, sections?}],
                  social: [{name, url}],
                  logoUrl?, aboutPhotoUrl?, joinPhotoUrl?,
                  venues: [{name, query, link}],
                  team: [{name, role, section}],
                  sections: [{key, name, ages, day, time, venue, blurb}] },
      badges: { intro, stages, placement: [{area, items[]}], note,
                imageUrl?, imageCaption? },
      fundraising: { intro, donateTitle, donateText, donateUrl, donateLabel,
                     campaigns: [{title, blurb, goal, raised, link, linkLabel}],
                     help, sponsors: [{name, url, logoUrl}] },
      notices: [{title, body}],
      events: [{id?, date, endDate?, title, section, location?,
                startTime?, endTime?, time?, need?, needQualified?,
                kitId?, details}],
      news: [{date, title, body}],
      gallery: [{url, thumb?, caption?, section?, album?, w?, h?}],
      kits: [{id, title, event, summary, imageUrl?, imageCaption?,
              docs: [{title, url, note}], tips[],
              groups: [{name, items: [{n, note?, must?}]}], dontBring[]}],
      appliedUpdates: [], updatedAt, updatedBy }

## Group facts

Beavers, Tue 6:00 to 7:00 pm, The Hall, Ballyvaughan.
Cubs, Thu 6:30 to 8:00 pm, The Hall.
Scouts and Ventures, Thu 6:00 to 7:30 pm, Newquay National School.

Weekly dress: Beavers and Cubs jumper plus necker; Scouts fleece, full uniform
once a term; Ventures necker. Full uniform starts at Scouts. Necker is orange
with a black border.

Kit list ids: weekly, uniform, overnight-out, overnight-in, standing-camp,
sionnach, mpc.

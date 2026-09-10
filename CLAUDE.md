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
    tools/county-fixture.json       the county's feed, stood in for through
                                    COUNTY_FEED so the county inbox reads the
                                    same every run
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
(`meetings` keyed by ISO date: `present` youth ids, `adults` Scouter ids,
`lead` the one Scouter answerable for that night, `note`, `by`, `at`).
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
  Two things about a row: a button says what pressing it does, **"Add to our
  calendar"**, because "We are going" was both the button and the pill it
  turns into and a row still waiting on a decision read as one already made;
  and while the decision is in flight the row's buttons say "Saving…" and go
  dead, because writing to `content.json` is a commit and takes a second or
  two. That wait is one read and one commit now, not two reads: the handler
  passes the document it already read to `withContent()` as its `seed`, and
  only a retry reads again, since reading fresh is the point of retrying.
  **Duplicates on the calendar are not the county machinery's doing.** It
  matches on `countyId`, so an event without one is invisible to it: it can
  neither recognise it as the same night nor tidy it away. `defaults.js`
  used to carry seven sample events, six of them county ones, which a first
  save copied into `content.json` and which then sat there for months beside
  the same events arriving properly from the county. The sample events are
  gone, and nothing seeds `events` any more.
* **events** live on `events.html`: a lead adds and changes events for the
  sections on their own roster entry, the secretary for any section and for
  the whole group; helpers see their sections' events read-only. The
  function decides, not the page. A public event is written into
  `content.json`, the same file `admin.html` edits, so it reaches parents
  and the rota alike; a "leaders only" one is kept in the rota store and
  shows on the rota only.
* **lead** runs coverage on `rota.html` for the sections on their own
  roster entry: anyone's ticks, and the section's own numbers. They also get
  `roster.html`, cut to their own sections: the people on them, each with
  their personal link and **Copy link** and **Copy message**, so a lead can
  send a helper their link without going through the secretary, and "Who is
  down for what" for those sections. Nothing on it changes anything: no add
  form, no Edit, no wording to change, and the function refuses every roster
  write from anyone but the secretary anyway. Two things are held back from a
  lead: anybody outside their sections, and **the secretary's own code**,
  which would pass on her powers rather than just a place on a rota
  (`codeFor()` in the GET). Their own code always comes back, to anyone. **The rota page has no settings on it**: what a
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
  sees only people who share a section with them. On `roster.html` they get
  the list read-only, their own link and no tally, and the leaders' nav does
  not offer them the page at all.

The function returns and accepts only the sections on the caller's roster
entry (all of them for the secretary), so a lead or helper with no section
set sees a message asking the secretary to add one rather than an empty
rota. That now covers the people list and the leaders-only events as well:
a lead used to be sent the whole roster and every private event, and is sent
their own sections' share of each. The county filter still uses the group's whole section list to decide
which of a county event's sections are ours at all.

**The owner is the secretary, and that is set in the app.** `isOwner()` in
`netlify/src/rota.mjs` matches a roster entry by name, case-insensitively and
trimmed, against `OWNER_NAME` (default `"Craig, Craig Hill"`, a comma
separated list because a roster entry may be either); `OWNER_ID` pins it to
one roster entry instead and ignores the name. Both are read per request, so
either can change in Netlify without a deploy. While that person is on the
roster, `withOwner()` makes them the secretary and nobody else, whatever the
stored flags say. It is a read-side rule: the stored document is untouched,
so pointing `OWNER_NAME` at nobody gives back exactly the flags that were
always there.

The consequences, all enforced by the function and mirrored on the page: the
owner cannot be demoted, removed from the roster, or renamed out of the
matching list; nobody else can be given the role, so "Make secretary instead
of me" is gone from every row; and `?a=bootstrap` will only reissue the
owner's own code, since a group with an owner cannot lose its secretary.
Everything else about their entry still edits, and "New link" still works, so
a lost phone is a tap. `owner` on a person in the GET says which one they are.

While no secretary exists (a roster from before the role did), leads hold the
secretary's powers so nobody is locked out. **`hasSecretary` on the GET is
what says so.** The pages used to work it out from the people list, which a
lead now only sees a section of: a secretary with no sections of her own
would have vanished from a lead's list and handed every lead her powers. The first secretary is created
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

**Saving a section's nights publishes them.** Parents need to know which
Tuesday, because some weeks are off, so `?a=calendar` mirrors the list into
`content.json` under `meetings`, replacing that section's entries only:

    meetings: [{ id, section, date, title?, location?,
                 startTime?, endTime?, off? }]

`publicNight()` in `rota.mjs` decides what goes: the date, the name, the place
and the hours. Not `need` or `needQualified`, which are the rota's business,
and **not `details`**, which leads typed while the list was private and which
is labelled "for leaders only" in the editor. A save that changes nothing a
parent would see does not rewrite `content.json` at all, so a leaders-only
tweak to a night leaves it alone; the write goes through `withContent()`,
which took only `events` before and now takes either. If the public copy
cannot be written the nights are still saved and `published` comes back with
the reason.

Everything downstream reads `meetings` from the one document: `index.html`
(`nightsSorted`, `calendarItems`, `sectionCalendar`), `calendar.html`
(`fromMeeting`, alongside the county-shape adapter) and the subscription feed
(`nightsAsEvents` in `content.mjs`, whose UID is the night's own id so moving
one does not leave a second entry behind). A night that is **off** is
published too, named "No meeting" plus whatever reason was typed, because a
Tuesday that is not happening is the one worth showing: it is struck through
in the app and on the feed like any other entry. `nightTitle` decides that
wording and lives in `index.html`, `calendar.html` and `content.mjs`.

A night is not an event: nothing to open, no kit list, no details, so
`eventCard` draws it flatter and without a chevron, plain white where an
event is green (`--leaf-50` and `--leaf-200` on `:root`, the one place the
green lives), and in the month grid a night's chip is hollow (`.dchip.night`)
so the filled chips are the events. Home is the exception in the other
direction: it shows only the nights that are **off**, since four slots have
no room for an ordinary Tuesday but a cancelled one is exactly what a parent
needs to catch. A section that has never saved a list publishes nothing, and
its page reads as it always did.

**"Beavers meets Tuesday" is the standing pattern, not an answer.** It comes
off `settings.sections` and reads the same whether or not there is a meeting
this week, and the week somebody turns up to a locked hall is the one that
matters. So the meets card on Home and the section page's own card both carry
a line under them, `meetNextLine()` in `index.html`, read off the published
nights: "Next meeting this Tuesday, 15 Sep" when the next one is on, and "No
meeting this Tuesday, 15 Sep, hall booked. Next is Tuesday, 22 Sep" when it is
off, the reason being whatever the lead typed with "No meeting" stripped off
the front of it. `nightWhen()` says "today", "tomorrow" or "this Tuesday" while
the day name is the useful part and falls back to the date after a week. A
section with no published list says nothing at all and its card reads as it
always did, so this turns itself on section by section as each lead saves their
nights. The line sits below the whole meets row rather than beside the
Directions button, which squeezed it to four lines at 390px.

**The nights can be turned off on the Calendar tab**, and only there: a term
of Tuesdays makes a long list, and somebody scrolling for the camp does not
want every one of them in the way. The "Weekly meetings" toggle sits beside
Calendar|Table (one pressed button rather than a two-button segment, which
pushed the tools onto a third row at 390px), `showMeetings` drives it, and
the choice is kept in `localStorage` under `cal-meetings` (default on). Off
hides every night, cancelled ones included, from the list and the month
grid, and the print head says "events only" so a printed sheet does not pass
for complete; the section page keeps its own nights regardless, because that
page is the term for that section, and Home is unaffected. `calendar.html`
has the same control as an "Events only | With meetings" segment
(`state.meetings`, `ccs_meetings`): `visible()` gates the grid, the table,
the day list and the download, `buildPrintout()` reads `state.events` itself
so it carries the same test, and `jumpToFirstUpcoming()` reads `visible()`
rather than `state.events`, or the page would open on the month of the next
thing hidden from it and render empty. There a night carries `category:
"meeting"`, which is in `CATEGORIES` so `catName` and the detail sheet's
Type tag read "Meeting". **`normalise()` on that page whitelists categories**
and used to coerce anything else to `county`, which is why our own events
were typed "County" there for as long as the page existed; `group` and
`meeting` are on the list now, with a `.tag.group` style to match.

The green must survive the print reset: `.event:not(.night)` is specificity
(0,2,0), so the `@media print` rule that puts the paper back to white names
the same selector, or it loses. A past event goes back to white too: green
says the thing is still to come, and `.event.past{opacity:.6}` over the
green cost the title the contrast it had on white.

Both browser suites take `E2E_PORT`, so two of them, or one of them and
anything else driving a browser at the preview, cannot collide on 8910.

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

**The rule itself is Craig's to name, and naming it is what turns it on.**
The wording is `settings.rota.qualifiedLabel` and `qualifiedShort` in
`content.json`, set in admin under Sections in "Adults on a night", so it can
be Garda vetting, a first aider, or anything else without the store moving.
While the label is empty there is no rule: `lab/rota-lib.js` holds `QUAL` and
`qualOn()`, and every page reads them, so the roster's tick box, the tag
beside a name and the two number boxes on the meetings card are all hidden.
Naming it shows them. The data underneath is there either way: a person
carries a `qualified` flag, a section carries `requiredQualified` (meetings)
and `requiredQualifiedEvents`, and both numbers default to 0, so a rule that
is named but has no number set still holds nobody back. Setting those numbers
is a lead's job, on `events.html` beside "Adults needed".

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
still to come that are going ahead, meetings and events apart, with the two
added up, and puts anyone at nothing at the top: they are who the secretary
rings next. A pill row picks the section: **All**, then one per section, kept
in `localStorage` under `roster-load-section`. On a section it counts only
that section's nights and lists only the people who cover it (and anyone
still carrying one of its nights after being moved off, who would otherwise
vanish with their ticks). On All, a Scouter covering more than one section
gets a line under their name saying where the nights went, "Beavers 2,
Scouts 2", which is the question the card is usually asked. One night out
counts once in the All total however many sections were offered it: a
group event's slot id turns up under each section, so `bump()` counts a
slot id it has already seen for that person in the section tallies but not
in the overall one. It is a table of numbers, so it is the one table on these pages
that keeps its headings on a phone rather than folding into cards
(`table.roster.load`), because three bare figures under a name say nothing.
The nights it counts come from `meetingNights()` in `lab/rota-lib.js`, the
same helper `upcoming()` on the rota draws: the list a lead has saved, or the
section's own weekday until there is one. Counting only saved lists had it
reporting no meetings at all on a section whose lead had not been near the
editor. **The link for chasing** is `lab/needed.html?section=<key>`,
reading `?a=cover&section=<key>`, which takes no token and returns dates and
counts: no names, no ids, and no leaders-only events. It is on the rota page
for leads under "A link for chasing".

### Attendance

`lab/attendance.html` is taken at the door on a phone: pick the section,
the date defaults to today, tap each name as they arrive, the young people
and the Scouters both. Every tap saves
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
at the door does it; only a lead can add Scouts.

**The Scouters are the second list, and one of them is answerable.** They
come from the roster, not the board, through `coverOf()` in `rota.mjs`:
whoever carries the section on their roster entry, plus the secretary, who
covers the group. That is deliberately the same set as may take the
section's attendance at all, so whoever can be at the door can be recorded
at it, and deliberately wider than the rota's own list, which is about
being put down for a night in advance. A Scouter helping another section is
added to it on the roster, as the rota already asks.

One of them is named as answerable for the night, kept as `lead`. Naming
somebody also ticks them present, in the function and mirrored on the page,
because they were there to be answerable for it; taking them off the list
takes the title with them. The field is called **Camp lead** on any day of
a multi-day event on the public calendar and **In charge of the programme**
otherwise, worked out by `overnight()` on the page. A camp kept leaders-only
asks for the programme wording, since that page reads the public calendar.
Until somebody is named, the page and the night's record both say so.

"Term so far" lists the meetings newest first with who was missing, who was
on and who ran it, then one tally with the young people and the Scouters
under headings of their own, print and CSV (which carries a Who column and
an In charge row). Nothing in it is public, and the public board endpoint
never includes it.

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

* **The installed app has no browser chrome, so the phone's own bars sit on
  the page.** Every page carries `viewport-fit=cover`, which is what lets the
  header's colour run to the top edge, and the price is that iOS puts the
  status bar over the page rather than above it. Anything at the top or bottom
  has to dodge it: `index.html` and `calendar.html` pad with
  `env(safe-area-inset-top)` inline, and `lab/rota.css` does it through
  `--safe-top`, `--safe-bottom`, `--safe-left` and `--safe-right` on `:root`,
  so a test can set a phone's insets and check the header moved. It did not,
  for a while, and in the installed app the leaders' header sat under the
  clock, blurred by the bar and untappable. The bar's own background must
  still reach the top edge: pad the header, never move it down.
* **Two print stylesheets share one page.** `index.html` prints kit lists and
  the calendar, and each block hides every view but its own. `route()` sets
  `body[data-print]` to the showing tab and each block is scoped to it;
  without that, both blocks apply and printing gives a blank page.
* **Nothing the worker answers may be nothing.** `respondWith` resolved to
  `undefined` does not fail a request, it leaves it pending for ever, and a
  pending stylesheet blocks every script after it, so the app never boots.
  Two of the fallbacks in `sw.js` could do that: a font and the public badge
  board both fell back to a cached copy that might not exist. They answer
  `Response.error()` instead, which fails the request properly and lets the
  page carry on in its fallback fonts. `tools/test-sw.mjs` pins it. The same
  trap catches the browser suites, where Google Fonts is unreachable: their
  font route goes on the **context**, not the page, because once the worker
  takes control it fetches the stylesheet itself and a page route does not
  reach a worker's own requests.
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
  anything group-wide, and the weekly meeting nights, cancelled ones included.
  `tools/serve.mjs` answers `?ics=1` through the same `nightsAsEvents`, so the
  preview cannot drift from the deployed one. `tools/test-ics.mjs` pins the awkward parts: the
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
* **The owner's name is in the source, and this repo is public.** It is
  already on the site in the team list, so nothing new is published by it, but
  it does mean the person named in `OWNER_NAME` is the one the app trusts.
  Change the name on the roster and the rule stops matching, which is why
  renaming that entry is refused rather than silently dropping the role.
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
      meetings: [{id, section, date, title?, location?,
                  startTime?, endTime?, off?}],
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

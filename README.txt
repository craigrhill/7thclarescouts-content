7th Clare Scouts app v0_22
==========================

Deploy
1. Netlify auto-publishes from the main branch of
   github.com/craigrhill/7thclarescouts-content. Push to main and the site
   updates in about a minute.
2. Zip drag-and-drop still works as a fallback: Netlify > Add new site >
   Deploy manually, or drop onto the existing site's Deploys page.
3. When you drop a new zip or push a shell change, bump VERSION in sw.js so
   installed phones pick up the new shell instead of the cached old one.

What's inside
- index.html            the app: Home (personalised to the sections chosen on this phone), Calendar, Kit, Sections, More (fundraising, team, contact, join, about)
- admin.html            leader editor (notices, events, news, kit lists, sections, contact, venue maps)
- defaults.js           default content (shown until leaders save)
- kit-defaults.js       default kit lists (Sionnach, MPC)
- content.json          the live content, source of truth
- manifest.webmanifest, icon-192.png, icon-512.png, sw.js   PWA: installable, works offline with last-saved content
- logo.png              group logo
- netlify/src/content.mjs         the content function source (edit this)
- netlify/src/rota.mjs            the leaders' rota function source (edit this)
- netlify/functions/*.mjs         built from those: npm run build:function
- tools/test-function.mjs, tools/test-rota.mjs   offline tests: npm run test:function
- lab/rota.html                   the leaders' volunteer rota; needs a personal code
- tools/apply-update.mjs          applies updates.json to content.json the same way admin does
- netlify.toml

Content storage
- content.json in this repo, on the main branch, is the source of truth.
- The function picks its source from two Netlify environment variables:
  GITHUB_REPO (craigrhill/7thclarescouts-content) and GITHUB_TOKEN. Both must
  be set and scoped to Functions, then the site redeployed. A Builds-only
  scope leaves the function unable to see them.
- GITHUB_BRANCH defaults to main and GITHUB_PATH to content.json, so neither
  needs setting.
- To confirm the wiring, open /admin.html and read the line under the header,
  or fetch /.netlify/functions/content and check the "source" field. It reads
  "github" when wired and "blobs" when not. The fallback is silent, so that
  field is the only reliable signal.
- The older Netlify Blobs copy (store "site-content", key "content") is still
  there but no longer read. It is a usable second snapshot.
- Password: built into the function as a hash. Setting ADMIN_PASSWORD in
  Netlify env vars overrides it.
- Photos: add a photos/ folder and reference e.g. photos/camp.jpg in admin
  (used by the About card when set).

Getting new lists/content from Claude without retyping
- Each release can carry an updates.json. Open /admin.html: a yellow
  "Update vX is in this deploy" card appears; press Apply, then Save & publish.
  Or run tools/apply-update.mjs in the repo to do the same merge in a commit.
- Admin > Import / export: "Download content.json" to send Claude the live
  content for reading or editing; paste Claude's JSON back and press Merge.
- Claude can also read and commit content.json directly. The admin warns
  before overwriting a change Claude made.

Leaders' area (volunteer rota)
- /lab/rota.html. Not linked from the app. Shared data, private, in Netlify
  Blobs; nothing in it is published.
- First time: open the page, expand "First time setting this up?", enter your
  name and the admin password. That creates the first lead and shows a code.
- Leads add Scouters, tick which sections each can cover, and hand out codes.
  A code signs a phone in for three months. "New code" cancels the old one;
  removing a person signs them out at once.
- Everyone can see the rota and tick themselves in. Only leads can tick
  others, change the adults needed, or mark a week as no meeting.

Note on the repo
- It is public, and so is the site. Reverting a commit does not unpublish
  anything already fetched or indexed. Never commit the GITHUB_TOKEN; if it
  leaks, rotate it rather than reverting.

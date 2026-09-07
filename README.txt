7th Clare Scouts app v0_20
==========================

Deploy (Netlify zip drop)
1. Netlify > Add new site > Deploy manually > drop this zip (or drop onto the existing site's Deploys page to update).
2. Open /admin.html, sign in with the leader password, press "Save & publish" once to seed the content store.

What's inside
- index.html            the app: Home (personalised to the sections chosen on this phone), Calendar, Kit, Sections, More (fundraising, team, contact, join, about)
- admin.html            leader editor (notices, events, news, kit lists, sections, contact, venue maps)
- defaults.js           default content (shown until leaders save)
- kit-defaults.js       default kit lists (Sionnach, MPC)
- manifest.webmanifest, icon-192.png, icon-512.png, sw.js   PWA: installable, works offline with last-saved content
- logo.png              group logo
- netlify/functions/content.mjs   pre-bundled Netlify Function (Netlify Blobs store "site-content")
- netlify.toml

Notes
- Password: built into the function as a hash. Setting ADMIN_PASSWORD in Netlify env vars overrides it.
- When you drop a new zip, bump VERSION in sw.js so installed phones pick up the new shell.
- Photos: add a photos/ folder to the zip and reference e.g. photos/camp.jpg in admin (used by the About card when set).

Getting new lists/content from Claude without retyping
- Each zip can carry an updates.json. Open /admin.html: a yellow "Update vX is in this deploy" card appears; press Apply, then Save & publish.
- Admin > Import / export: "Download content.json" to send Claude the live content for reading or editing; paste Claude's JSON back and press Merge.

Live editing by Claude (GitHub-backed content)
1. Create a GitHub repo (public is fine; the content is public on the site anyway), e.g. 7thclare-content.
2. Create a fine-grained personal access token: Settings > Developer settings > Fine-grained tokens, repository access = that repo only, permission Contents: Read and write.
3. Netlify > Site configuration > Environment variables: GITHUB_REPO = yourname/7thclare-content, GITHUB_TOKEN = the token. (Optional: GITHUB_BRANCH, GITHUB_PATH.) Then drop the zip again.
4. Open /admin.html and press Save & publish once: this copies the current content from Netlify Blobs into content.json in the repo. From then on the repo is the source of truth and the app reads it live.
Give Claude a token for the same repo and it can read and edit content.json directly; the admin warns before overwriting a change Claude made.

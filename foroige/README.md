# Foroige club rota

Who is covering each club night and each event, behind a personal code.
Nothing on these pages is public and nothing is stored in this repo: the
roster, the ticks and the codes all live in a private Netlify Blobs store.

The rule it exists to enforce: **every club night and event needs three
leaders, and on a club night one of them must hold the building specific
training from the ETB.** A club night with three untrained leaders on it is
not counted as covered. Events are away from the building, so they need the
three leaders and nobody in particular.

All three numbers are settings, and any of them can be changed on a single
club night or event: a night that needs four, or an event that does need
somebody approved after all.

## The two pages

    roster.html   the coordinator's page: who is on the roster, who is
                  trained, who runs the club, codes
    rota.html     everyone's page: the next eight club nights and the
                  events, ticks, and the gaps

    roster.html  \
                  ->  /.netlify/functions/foroige  ->  Blobs store "foroige"
    rota.html    /

Three roles. They are flags on a person and the function enforces them, not
the pages:

* **coordinator** keeps the roster. Adds people, marks who is trained,
  issues codes. There is always at least one.
* **club leader** sets how many leaders a night needs and how many of them
  must be trained, ticks anyone in, marks a week as no club.
* **anyone else** sees the rota and ticks only themselves.

A code (`XXXX-XXXX`) signs a phone in for 365 days. It is shown once. Taking
someone off the roster revokes their sign-in at once, and takes their ticks
off every night with it. "New code" cancels the old one.

## Setting it up for a club

1. **`rota-config.json`**, beside the pages. Set the club's name, the night
   it meets, the time and the venue, and the wording of the training:

       { "club": { "name": "Ballyvaughan Foroige Club" },
         "training": { "label": "Building training", "short": "Building" },
         "settings": { "sections": [
           { "key": "club", "name": "Club night",
             "time": "7:30 to 9:00 pm", "venue": "The Hall",
             "dates": ["2026-10-07", "2026-10-14"] } ] },
         "events": [
           { "date": "2026-10-30", "title": "Halloween disco",
             "location": "The Hall" } ] }

   `label` is the full name of the training and `short` is what fits on a
   badge. `key` must match `^[a-z0-9-]{1,32}$`. Add an `endDate` to anything
   running more than a day.

   **Club nights come from `dates`, or from `day`, or from both.** `dates` is
   a list of confirmed dates, which is what to use while BOETC is still
   setting them: paste them in as they are confirmed and they appear on the
   rota. `day` is a weekday name instead, and fills the next eight weeks by
   itself. Past dates drop off on their own.

   **Club nights and events are not the same thing here.** Anything in
   `dates` is a club night, in the building, and carries the training
   requirement. Anything in `events` is an event and does not. That is the
   only difference between them, so put a night in the building in `dates`
   even if it is a one-off. Events with no `section` show for every club,
   which is what a single club wants.

   More than one club or age group: add more entries to `sections`, each with
   its own `key`. The rota grows a row of chips to switch between them and
   the coordinator gets a tick box per club against each person. With one
   club none of that appears and everyone on the roster covers it.

2. **The admin password.** No password is baked into the code. Set
   `ADMIN_PASSWORD` in Netlify's environment variables, **scoped to
   Functions**, and redeploy. A variable scoped to Builds only is invisible
   to the function and looks exactly like not setting it, which is the
   commonest way to lose an afternoon here. Without it, first-time setup
   answers 503 and says so.

3. **First run.** Open `roster.html`, expand "First time setting this up?",
   enter a name and that password. That creates the coordinator and shows
   their code. Everything after that happens on the roster page and the
   password is not needed again.

4. **The two lists.** On the roster page, "Add a list of names at once"
   takes the whole list pasted in, one name per line, with a `*` on the end
   of the line for anyone who holds the training. Numbering and bullets are
   stripped, so a list copied out of a document works as it stands. Everyone
   gets a code, all shown together, once. Do not put either list in the
   repo: names belong in the store, not in Git.

## Deploying

* `netlify.toml` needs `functions = "netlify/functions"` and an
  `X-Robots-Tag: noindex` header for this folder.
* Netlify Blobs needs no setup. It is on for every site.
* If the site has a service worker, make it skip these pages, or a cached
  copy will show one deploy behind.
* Confirm the function is up before handing it over: `OPTIONS` returns 204,
  and a `GET` with no token returns 401 with `{"error":"Please sign in."}`.
  A 401 rather than a 500 proves the store is reachable, because the
  function reads or creates its secret before it checks anything.

## Working on it

    npm install
    npm run build:function    # netlify/src/*.mjs -> netlify/functions/*.mjs
    npm run test:function     # the offline harnesses
    npm run serve             # http://127.0.0.1:8899/foroige/rota.html

The preview runs the real function against an in-memory store that lasts
only as long as the process, with `local` as the admin password. The built
file under `netlify/functions/` is generated: never edit it, edit
`netlify/src/foroige.mjs`, rebuild, and commit the two together.

`tools/test-foroige.mjs` is the fast check on the function, 74 cases
covering the codes, the roles, the training rule for both kinds of night,
and the conditional writes. Run it after any change to the function.

## Moving it to its own repo

Take `foroige/` (these four files plus the config), `netlify/src/foroige.mjs`,
`netlify/functions/foroige.mjs`, `tools/test-foroige.mjs`, and the
`build:function` and `test:function` scripts with their two devDependencies.
The pages can sit at the root of the new site; they reference `rota.css`,
`rota-lib.js` and `rota-config.json` by relative path, so the folder can be
renamed or flattened. Nothing else in this repo is involved.

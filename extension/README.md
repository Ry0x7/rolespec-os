# RoleSpec Job Clipper (Chrome MV3)

A standalone Chrome extension that reads the job posting in the current tab, lets you
review and edit it, and posts it to your RoleSpec job tracker. The UI is a **side panel**
that stays open beside the page, so clicking back into the page never closes or resets it.

Requires **Chrome 114+** (`chrome.sidePanel`).

It is **not** part of the Next.js app build: it has its own `package.json`, its own
`tsconfig.json`, and its own dependency tree (the repo does not use npm workspaces).

## Build

```bash
cd extension
npm install
npm run build      # type-checks, then emits dist/
```

Other scripts: `npm run dev` (Vite watch rebuild), `npm test` (extractor, LinkedIn extractor, connect, site-access and resume-picker unit tests),
`npm run test:watch` (Vitest in watch mode), `npm run typecheck`.

## Load unpacked

1. Run the build above so `extension/dist/` exists.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension/dist` folder (not `extension/`).
4. Pin "RoleSpec Job Clipper" to the toolbar.
5. Re-run `npm run build` after code changes, **then hit Reload on the card**. Chrome
   keeps serving the bundle it loaded, so without that Reload your build is not the one
   running — including manifest/permission changes.

## Configure

### Sign in (recommended)

Press **Sign in to RoleSpec** — either in the side panel's setup banner, or on the
Options page (right-click the extension icon → **Options**, or the *Options* link in the
side panel).

Chrome opens RoleSpec in an auth window; sign in there if you are not already, then press
**Connect**. RoleSpec hands the extension a fresh `rspec_…` token and it is saved for you.
The side panel picks the token up immediately — no reload.

Set **App URL** first if RoleSpec is not on `http://localhost:3100` (the default).
Trailing slashes are stripped on save.

### Manual token (fallback)

Under **Advanced — manual token** on the Options page you can still paste a token
generated in RoleSpec under **Settings → API access**, then press **Save settings**. The
field is masked with a Show/Hide toggle.

App URL and token are stored in `chrome.storage.local` on this browser profile only.

## Use

1. Open a job posting, then click the extension icon. The side panel opens alongside the
   page and stays open while you scroll, click and select text on that page.
2. The panel extracts the posting and pre-fills the form (if the first read lands before
   Chrome hands over page access, it retries once). Company and job title are
   required; everything else is optional. Edit anything before saving.
3. Salary has a **Currency** (USD or PHP, USD by default) and a **Pay period** (Hourly /
   Monthly / Yearly, blank by default) next to it. Both are read from the posting's
   JSON-LD `baseSalary` when it states them — a `unitText` of `HOUR`/`MONTH`/`YEAR` and a
   currency of `USD`/`PHP`; anything else is left for you to pick.
4. **Job type** (Full-time / Part-time / …) and **Work type** (Remote (WFH) / Hybrid /
   On-site) sit side by side, both blank by default. Job type comes from JSON-LD
   `employmentType`; work type comes from `jobLocationType: "TELECOMMUTE"` or a
   `VirtualLocation` (both → Remote), else from a keyword scan of the location and title,
   where a "hybrid" mention beats a "remote" one and an on-site mention comes last. The
   description is only consulted for unambiguous phrases ("work from home", "hybrid
   schedule", "on-site only"), so a "hybrid cloud" or "remote teams" aside cannot set the
   field. No signal means it is left blank for you to pick.
5. Press **Save to RoleSpec**. Nothing is sent until you press Save. After a save the
   form stays editable and a **Clip another job** button resets it and re-reads the
   current tab. If RoleSpec flags the posting as a possible ghost job or scam, a warning
   banner appears under the **Saved.** confirmation with the reasons — the clip is still
   saved either way, and nothing shows when the server sends no flag.

If a page has no structured data, the fields may come out partially filled — the panel
says so. Selecting the job description text on the page before opening the panel makes
that text the description.

### "RoleSpec can't read this page yet"

The Job link is still filled (that only needs `tabs`), but the posting's text needs page
access. The panel shows **Allow RoleSpec to read <host>** — press it and accept Chrome's
prompt, and the panel re-reads the page immediately. That grant is per site (scheme, host
and port), persists across browser sessions, and is revocable at `chrome://extensions` →
RoleSpec Job Clipper → **Details** → **Site access**. You can also just fill the form in
by hand. If you changed the manifest, make sure you hit **Reload** on the extension card
first — an old bundle has no way to ask for the grant.

`chrome://`, `chrome-extension://`, `file://` and `about:` pages can never be read by any
extension; there the panel says so and offers no button.

### Cold email a person (LinkedIn)

The panel has three modes, switched with the **Clip job** / **Cold email** / **Reply**
tabs at the top.

1. Open someone's LinkedIn profile (`linkedin.com/in/…`), then open the panel and switch
   to **Cold email** — or right-click the page and pick **Cold email this person with
   RoleSpec**, which opens the panel on that tab and reads the profile for you.
2. **Read profile from page** fills in name, headline, company, About and the profile
   URL. LinkedIn's markup changes constantly, so treat this as a first draft and correct
   anything that came out wrong. Selecting 200+ characters on the page before reading
   makes that selection the About text.
3. Add optional **Instructions** ("mention we both worked in fintech"), pick a **Message
   type** and a **Tone** (Professional, the default / Warm / Direct), pick a **Resume**
   if you do not want the latest one, then press the generate button (its label follows
   the type).

**Message type** picks what gets written:

| Type | What comes back |
| ---- | --------------- |
| **Cold email** (default) | Subject + body, with a greeting and sign-off |
| **Connection note (≤200 chars)** | Body only, capped at 200 characters — the panel shows a `183/200` count |
| **LinkedIn DM** | Body only, no greeting or sign-off |

For the two LinkedIn types the server returns an empty subject, so the panel hides the
subject row and its Copy button and shows only the message.

Requires sign-in (same token as clipping). The draft is written from your RoleSpec
resume — with no resume in RoleSpec the request is rejected. Nothing is saved: the
subject and body appear in the panel with a **Copy** button each, and are gone when you
generate the next one.

A 401 points you back at **Sign in to RoleSpec**, and a 429 asks you to wait.

### Picking a resume

Both generate tabs have a **Resume** picker, filled once the panel is connected with your
non-archived resumes (newest first, with their ATS score where they have one). It starts
on **Latest resume**, which sends no resume id at all and lets RoleSpec use your newest.

The list is a convenience only: if it cannot be fetched the picker keeps just the
**Latest resume** option and drafting works exactly as before. Replacing your token or
App URL refetches it.

### Reply to an email you received

The **Reply** tab drafts an answer to a message you were sent — a recruiter screen, an
interview invite, a rejection you want to follow up on.

1. Paste the email into **Paste the email you received** (required, 8000 characters max
   with a counter) — or select it in your webmail and right-click → **Draft a reply with
   RoleSpec**, which opens the panel on the Reply tab with the selection already in the
   box. Nothing is generated until you press the button.
2. **Company**, **Job title** and **Job description** (5000 characters max) are optional
   and give the model the job context.
3. Pick a **Tone** (Professional, the default / Warm / Direct) and a **Length** (Brief /
   Standard, the default / Detailed), and a **Resume** if the latest one is not the right
   one.
4. Paste **Earlier messages in this thread** (optional, 6000 characters max with a
   counter) when the reply has to follow a back-and-forth rather than a single email.
5. Add optional **Instructions** ("accept the interview, ask for a Friday slot"), then
   press **Generate reply**.

After a draft comes back the button reads **Regenerate reply**: pressing it again sends
the previous draft along so the model rewrites it instead of starting over. Editing the
received email drops that memory and the button goes back to **Generate reply**.

Same rules as cold email: sign-in required, written from your RoleSpec resume (no
resume → rejected), nothing persisted, subject and body each with a **Copy** button, and
the same 401 / 429 handling.

### Context menus

Right-clicking gives four commands (all of them open the side panel and, like the
toolbar icon, grant page access for that click):

| Command | Where it shows | What it does |
| ------- | -------------- | ------------ |
| **Clip this job to RoleSpec** | any page | Same as clicking the toolbar icon: re-reads the page into the clip form, offering **Replace with this page** instead of overwriting unsaved edits |
| **Use selection as job description** | when text is selected | Re-reads the page and forces the selected text into the description, however short it is |
| **Cold email this person with RoleSpec** | `linkedin.com/in/*` only | Switches to the Cold email tab and reads the profile |
| **Draft a reply with RoleSpec** | any page, when text is selected | Switches to the Reply tab and drops the selection into the received-email box (truncated at 8000 characters). Nothing is generated automatically |

### Switching tabs

The panel outlives the tab it was opened on:

- If you have not edited the form, switching tabs (or finishing a navigation in the
  active tab) re-reads the new page automatically.
- If you have edited the form, your edits are kept and the panel just notes that the
  page changed.
- The Job link field is filled from the tab's URL either way — that needs no page
  access, only the `tabs` permission.
- Reading the posting's text needs page access. A toolbar-icon click grants it for that
  click only, and that grant does not follow you to another tab. When the panel cannot
  read the page it says so and offers **Allow RoleSpec to read <host>**, which asks
  Chrome for a persistent grant on that one site. Whatever is in the form is left
  untouched.
- Clicking the toolbar icon always re-reads the current page, whether the panel was open
  or not: the click re-grants access and the service worker tells the panel about it. If
  the form has unsaved edits the panel does not overwrite them — it offers a **Replace
  with this page** button and leaves the choice to you.
- The panel picks up App URL / API token changes from Options immediately, without a
  reopen.

### Fit badges on job boards

On JobStreet / SEEK, Indeed and LinkedIn job pages, RoleSpec can put a small label next
to each job title — **✓ Strong fit**, **Worth a look**, **⚠ Weak fit** or **⛔ Blocked**
(the same wording as the panel), plus **⚑ risk** when the posting looks like a ghost or scam job. Hover it to
see which of your capabilities matched. The verdict is the same heuristic check the panel
shows after a save; no AI model is called.

- **Off until you grant the site.** Badges are enabled per site. On a supported job
  board the panel shows a **Show fit badges on <host>** button while that site has no
  grant; click it and accept Chrome's prompt, and badges appear on the open tab without
  a reload. Clipping with the toolbar icon does not enable them (that is a one-off
  activeTab read). The **Allow RoleSpec to read <host>** button grants the same thing, and
  so does `brave://extensions` / `chrome://extensions` → RoleSpec Job Clipper →
  **Details** → **Site access** (add the site there). Supported hosts: `*.jobstreet.com`, `*.jobstreet.com.<cc>`,
  `*.seek.com.<cc>`, `*.seek.co.nz`, Indeed (`indeed.com`, `<cc>.indeed.com`,
  `indeed.com.<cc>`, `indeed.co.<cc>`, `indeed.<cc>`) and LinkedIn (`www.linkedin.com`
  and country hosts such as `ph.linkedin.com`). A grant on
  any other site never runs the badge script.
- **What is sent, and where.** For the postings on screen: title, company, location, the
  job's link, and on a single-job page also the work type and description (up to 20,000
  characters). It goes only to your own RoleSpec server (the App URL in options) with
  your API token, and only while you are signed in: signed out, nothing leaves the
  browser. With no career profile yet the server answers that once, no badge is drawn,
  and the page sends nothing more.
- **Nothing is stored on the page.** The badge is a self-contained element added next to
  the title; the page gets no stylesheet, no cookies and no storage. The script adds no
  keyboard, focus, input, click or form listeners and never touches form fields, so it
  stays out of the way of password managers. Verdicts are cached in the extension's
  in-memory session storage for 6 hours (cleared when the browser closes or you change
  the App URL / token).
- **Turning it off.** Revoke the site's access at `chrome://extensions` → RoleSpec Job
  Clipper → **Details** → **Site access**; the badge script is unregistered for that site
  straight away.

## How it works

- Permissions are `activeTab`, `contextMenus`, `identity`, `scripting`, `storage`,
  `sidePanel` and `tabs`: no `host_permissions` and no `content_scripts` in the
  manifest. The only content script, the fit badge, is registered at runtime with
  `chrome.scripting.registerContentScripts` (id `rolespec-badge`, top frame only) for
  exactly the supported job boards you have granted; see below.
  `identity` is only used for the sign-in flow below, and `contextMenus` only adds the
  four right-click commands. `tabs` is what lets the panel read the active tab's URL and
  title without any page grant — that is how the Job link is filled, and how the panel
  knows which origin to ask about.
- Page access to a posting's text comes from one of two places: the `activeTab` grant
  from your toolbar-icon or context-menu click (one click, one tab, gone on navigation),
  or a per-site grant from `optional_host_permissions` (`https://*/*`, `http://*/*`).
  Nothing is granted at install. The **Allow RoleSpec to read <host>** button in the
  panel calls `chrome.permissions.request` for that single origin (scheme + host + port),
  and the grant persists across sessions until you revoke it at `chrome://extensions` →
  RoleSpec Job Clipper → **Details** → **Site access**. `<all_urls>` is never requested.
- Sign-in (`src/connect.ts`) generates a base64url `state`, opens
  `{appUrl}/extension/connect?state=…&redirect_uri=…` through
  `chrome.identity.launchWebAuthFlow`, and reads the token back out of the
  `#token=…&state=…` fragment on the `https://<extension-id>.chromiumapp.org/` redirect.
  A mismatched state, a missing token, or a token without the `rspec_` prefix is rejected.
- The only background code is `src/background.ts`, a service worker that owns the
  toolbar-icon click (there is no `action.default_popup`). It sets
  `setPanelBehavior({ openPanelOnActionClick: false })` — with `true`, Chrome toggles the
  panel itself and `action.onClicked` never fires — then in `onClicked` calls
  `chrome.sidePanel.open()` first (synchronously, so the user gesture survives; it is a
  no-op if the panel is already open) and posts
  `{ type: "rolespec:action-clicked", tabId, windowId }`. A cold open has no listener yet,
  so the send failing is expected and swallowed; the panel extracts on load anyway.
- The same worker owns the context menus: it recreates them from scratch on
  `onInstalled` (`removeAll` first, so a re-install cannot trip over a duplicate id) and
  on a click calls `chrome.sidePanel.open()` synchronously before posting
  `{ type: "rolespec:context-menu", clickId, menuId, tabId, windowId, selectionText }`.
  A panel that was still booting misses the first send, so it is retried once after
  400ms; the `clickId` lets the panel drop a duplicate.
- Fit badges: `syncBadgeScripts()` (`src/badge-registration.ts`, wired to `chrome` by
  the worker) reads `chrome.permissions.getAll()`,
  keeps the origins `isSupportedOriginPattern` accepts (`src/badge-sites.ts`; wildcard
  grants are refused) and registers, updates or unregisters `assets/badge.js` to match.
  It runs on `onInstalled`, `onStartup`, `permissions.onAdded` and
  `permissions.onRemoved`; a new grant on a supported board also injects the script once
  into tabs already open on it, so no reload is needed. `assets/badge.js` is a classic
  IIFE (content scripts cannot be modules), built by a second single-entry Vite build in
  `vite.config.ts`. It watches `document.body` with one debounced MutationObserver,
  reads list cards and the detail title with the per-site adapters in
  `src/badge-sites.ts` (detail postings through `extractJobPosting`), and asks the worker
  with `{ type: "rolespec:qualify", postings }` — it never fetches. The worker serves
  cached keys from `chrome.storage.session` (`rolespec.badge-cache`, 6 h TTL, ~2000
  entries) and sends the rest, at most 40 per request, to
  `POST {appUrl}/api/extension/qualify`. Each badge is a `<span>` with a closed shadow
  root inserted right after the title; the title element only gets
  `data-rolespec-badged="1"`.
- `src/extractor.ts` exports a pure `extractJobPosting(doc)` that is injected via
  `chrome.scripting.executeScript({ func })`. Because Chrome stringifies that function,
  it must stay self-contained (all helpers inside the body, no module-scope references).
- Extraction order: schema.org `JobPosting` JSON-LD (including `@graph` and array
  wrappers) first, then `og:*` meta and `document.title` heuristics, then the current
  text selection for the description. The tab URL is added as `jobLink` by the panel.
- `src/linkedin-extractor.ts` exports `extractLinkedInProfile(doc)` under the same
  self-contained rules. LinkedIn ships no profile JSON-LD to a logged-in page, so the
  first strategy is the embedded Voyager payloads: every `<code>` element is `JSON.parse`d
  (bad blobs are skipped), the flattened entities are searched for the profile whose
  `publicIdentifier` matches the `/in/<slug>` of the page, and name / headline / summary /
  current-position company are read from it. The older selector strategies (top-card h1,
  `.text-body-medium` headline, the "Current company:" `aria-label`, the `#about` section)
  and the `og:title` / `og:description` fallbacks then fill in, **per field**, whatever the
  JSON pass left empty; a 200+ character selection still wins for About.
- Observed on two real logged-in profiles (2026): the server-driven-UI rewrite ships none
  of the above — no `<code>` payload, no `<h1>`, no `og:*` meta, no `link[rel=canonical]`,
  and every class name is a content hash. So there is a fourth strategy, keyed on the
  markup's only semantic hooks: `[data-sdui-screen]` marks the profile root, the name is
  its first `<h2>`, the top card is the largest ancestor of that heading holding no second
  heading, the headline is the card's first paragraph that is not a pronoun / degree badge
  / entity chip (the scan stops at the location row, found via the contact-info link), the
  company is the `[role=button]` chip whose ghost glyph id starts with `company` (a
  `school` chip is never read as a company), and About is the
  `[data-testid="expandable-text-box"]` under the "About" heading, falling back to the
  first one inside `[data-sdui-component*="AboveActivity"]` so the activity feed's boxes
  cannot win. It reports as source `dom`.
- The return value carries a `sources` record (`name` / `headline` / `company` / `about` →
  `"json" | "dom" | "og" | "selection" | null`, omitted when nothing at all was read). It is
  logged once as `console.debug("[rolespec] linkedin profile extraction", …)` in the page's
  console, and the panel turns the empty fields into a note naming exactly what it could not
  read instead of failing silently.
- The resume pickers are filled by one `GET {appUrl}/api/extension/resumes` (same bearer
  token, a short 10s timeout because no model call sits behind it). Every failure is
  swallowed — the picker just keeps its **Latest resume** option. A picked resume rides
  along as `resumeId` on both draft requests; the default sends no `resumeId` at all.
- Cold email issues one request: `POST {appUrl}/api/extension/cold-email` (with the
  selected `messageType`, and `tone` only when it is not the server default) and Reply
  issues one to `POST {appUrl}/api/extension/email-reply`
  (with `tone` / `length` only when they differ from the server defaults, and
  `priorThread` / `previousDraft` only when they have content, so the panel still works
  against a server that predates those fields).
  Both go through the same helper in `src/api.ts`: same bearer token, a 70s client timeout
  (the server's model call is capped at 60s) and the same `{subject, body}` envelope.
  That envelope may also carry an optional `grounding` object: RoleSpec checks every draft
  against the user's own resume, and when the draft mentions a skill or technology the
  resume does not back it names them here. The panel then shows the draft with a warning
  status instead of the plain "Draft ready" line. `parseGrounding()` in `src/api.ts` reads
  it defensively, so a clean draft and an older RoleSpec both mean "nothing to warn about".
- Save issues one request: `POST {appUrl}/api/extension/jobs` with
  `Authorization: Bearer <token>`. 401 points you back to options, 429 asks you to wait,
  400 shows the server's validation message, and connection failures name the App URL.
  A 201 may carry an optional `risk: { level, reasons }`; `parseJobRisk` in
  `src/job-risk.ts` accepts it only when the level is `LOW` / `MEDIUM` / `HIGH` and
  `reasons` is an array, so a missing or malformed one never turns a save into an error.
  A 201 may also carry `requirements` (the posting's eligibility flags, e.g. `NO_SPONSORSHIP`),
  present only when something fired; the side panel does not read it yet.

## Layout

```
extension/
  sidepanel.html, options.html   Vite HTML entries
  public/manifest.json       copied verbatim into dist/
  src/
    extractor.ts             pure, self-contained job extractor
    extractor.test.ts        vitest + jsdom tests
    linkedin-extractor.ts    pure, self-contained LinkedIn profile extractor
    linkedin-extractor.test.ts
    connect.ts               sign-in flow (pure helpers + chrome.identity wrapper)
    connect.test.ts          vitest tests for the pure connect helpers
    resume-select.ts         pure helpers for the two resume pickers
    resume-select.test.ts    vitest tests for those helpers
    job-risk.ts              pure parser for the optional `risk` on a saved job
    job-risk.test.ts         vitest tests for that parser
    __fixtures__/            JSON-LD / @graph / no-data / malformed / LinkedIn fixtures,
                             plus trimmed real job-board markup (badge-*.html)
    sidepanel.ts, options.ts entry scripts
    background.ts            service worker entry → dist/assets/background.js
    badge.ts                 fit-badge content script entry → dist/assets/badge.js (IIFE)
    badge-core.ts            badge scan loop + closed-shadow rendering
    badge-sites.ts           pure per-board adapters (hosts, cards, detail title)
    badge-cache.ts           pure TTL / size-cap helpers for the worker's verdict cache
    badge-registration.ts    grant/revoke → register/update/unregister + inject (chrome injected)
    verdict-badges.ts        verdict wording shared by the panel and the badge
    api.ts, settings.ts, types.ts
    styles.css
  dist/                      build output (gitignored) — load this folder
```

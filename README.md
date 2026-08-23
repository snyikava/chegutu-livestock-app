# Chegutu Livestock Census — offline-first prototype

A working prototype of the system described in the concept note: the same 12-class
livestock checklist as `Chegutu_Livestock_Checklist_XLSForm.xlsx`, running as an
installable offline-first web app, plus a small sync server and a live dashboard.

## What's here

- `public/` — the field app (PWA). Works fully offline once opened once: form fields
  render from `schema.js` (same field list as the XLSForm), submissions are saved to
  the device's IndexedDB immediately, and a service worker caches the app shell so it
  loads with zero signal.
- `server/` — a small Express server. Receives synced submissions at
  `POST /api/submissions`, stores them in `server/data/submissions.json`, and serves
  a live dashboard at `/dashboard.html` that shows each household as it lands,
  including how long it sat queued on the device before syncing. The dashboard has a
  second tab, **Ward Report**, that rolls the same live data up per ward — households
  reached, head counts and breed/type mix per species — computed straight from
  `schema.js`, no separate reporting step required. The dashboard and the submissions
  API are protected — see **Access control** below.
- `server/smsFlow.js` — the farmer self-report conversation (rabbits, poultry, goats
  only — see `self_report_strategy.pdf` for why those three) as a small state machine,
  driven by real inbound SMS via the webhook below. Conversation state per phone number
  persists to `server/data/sms_sessions.json`, so a server restart mid-conversation no
  longer silently drops a farmer back to square one. Every column on the dashboard now
  distinguishes **Source** (field visit vs SMS self-report) and **Verified** (a
  self-report lands as unverified until a councillor confirms it — see **Verifying a
  self-report** below), and the Ward Report cards show the field-visit/self-report
  split and how many are still pending review.

## The SMS self-report channel

`POST /webhook/telerivet-sms` runs the same conversation as the demo's Self-Report
tab, but for real, against real replies — see `sms_pilot_checklist.pdf` for the setup
sequence (SIM, Android phone, Telerivet account) and what it costs. Once that's set up:

1. In the Telerivet dashboard, add a **Webhook API** service under your project.
2. Set the webhook URL to `https://<your-public-host>/webhook/telerivet-sms`.
3. Set a shared secret in Telerivet's webhook config, and set the same value as the
   `TELERIVET_WEBHOOK_SECRET` environment variable wherever `server.js` runs — without
   this set, the server falls back to a placeholder value and refuses real traffic with
   a mismatched-secret error, which is deliberate (it stops anyone else's webhook from
   writing into your data). For example:
   ```
   TELERIVET_WEBHOOK_SECRET=<your-long-random-string> npm start
   ```
4. Text the gateway number from a personal phone to try the full flow — the reply
   after confirming lands on the dashboard immediately, tagged as an SMS self-report
   and unverified, and a councillor can cross-check it against the household on a
   later visit rather than needing to go there first.

This channel needs the same public URL as the field dashboard (see below) — Telerivet
has to be able to reach the webhook over the internet, not just your local network.

Reply **2** ("Check my last report") looks up the most recent SMS self-report actually
on file for that phone number and reports its species, date, and review status — it
used to always claim none existed, regardless of history; that's now fixed.

## Access control

Two things are gated by a shared secret, each read from an environment variable. Both
default to the placeholder `change-me-before-going-live` — the server logs a warning
on startup if either is still on that default, the same way the SMS webhook already
warns about `TELERIVET_WEBHOOK_SECRET`:

- **`DASHBOARD_PASSWORD`** — gates `/dashboard.html` and `GET /api/submissions` with
  standard HTTP Basic Auth (any username, this as the password). Browsers prompt for
  it natively the first time and remember it for the browsing session, so nothing in
  `dashboard.html` needed to change.
- **`FIELD_ACCESS_TOKEN`** — gates `POST /api/submissions`, the endpoint the field app
  syncs to. The PWA asks the enumerator for this once (a plain prompt), remembers it
  on that device via `localStorage`, and sends it as an `X-Field-Token` header on every
  sync. If the server rejects it (wrong code, or a new code was issued), the app clears
  the stored value and prompts again on the next sync attempt. An enumerator can also
  view or reset it any time via the **Code** button in the status bar.

Without both of these set to real values, the dashboard and the submissions API are
reachable — and the data behind them readable/writable — by anyone with the URL. Set
them wherever `server.js` runs, the same way as the Telerivet secret:

```
DASHBOARD_PASSWORD=<a-real-password> FIELD_ACCESS_TOKEN=<a-real-shared-code> TELERIVET_WEBHOOK_SECRET=<your-long-random-string> npm start
```

On Render (or Railway/etc.), set these as environment variables on the service rather
than in a committed file, so they're not sitting in source control.

## Verifying a self-report

A self-report lands "Pending review" until a councillor cross-checks it against the
household. The Live Feed tab on the dashboard now has a **Mark verified** button on
every pending row — previously there was no way to move a record out of that state at
all, so a self-report stayed marked "pending" forever even after it had actually been
confirmed in person.

## Run it

```
cd server
npm install
npm start
```

Then open `http://localhost:3000/` for the field form and
`http://localhost:3000/dashboard.html` for the live dashboard, in a second window —
it will prompt for the dashboard password the first time.

## Test the offline behaviour for real

**On a laptop (fastest):** open the form once with Wi-Fi on, then in Chrome DevTools
→ Network tab, switch to "Offline" (or just turn off Wi-Fi) and reload — the form
still loads and still lets you submit a household. Reconnect and watch the "queued"
badge drop to zero and the record appear on the dashboard.

**On the councillor's iPad (realistic test):** with the server running on a laptop,
find the laptop's local network IP (`ipconfig getifaddr en0` on a Mac, `ipconfig` on
Windows) and open `http://<that-ip>:3000/` in Safari on the iPad, while both devices
are on the same Wi-Fi. Tap Share → **Add to Home Screen**. Open the app from the home
screen icon once so it caches, then switch the iPad to **Airplane Mode** and fill in
a household — it saves locally with no network at all. Turn Wi-Fi back on and it
syncs itself; check the dashboard on the laptop to see it land, along with the
field-to-server lag.

## Getting a real public URL

This was built and tested in a sandboxed session whose outbound network is limited to
package registries, so I couldn't stand up a public tunnel from here — the test above
is the closest equivalent available in this session, and it exercises the exact same
offline/IndexedDB/service-worker/sync code path a public deployment would.

For a URL the councillor can reach from anywhere (not just your Wi-Fi), the
quickest options once you're ready:

- **Render, Railway, Vercel, or Netlify** — connect one of these as a tool in Claude
  (claude.ai → Settings → Connectors) and a future Cowork session can deploy this
  folder directly and hand you a live link.
- **Do it yourself** — push this folder to a GitHub repo and connect it to Render or
  Railway as a Node web service (build command `npm install`, start command
  `npm start`, root directory `server`). Free tier is enough for a single-ward pilot.

## Swapping in the real national system

Right now submissions land in `server/data/submissions.json` — enough to prove the
offline-capture-and-sync loop. The only place that needs to change for a production
pilot is the `POST /api/submissions` handler in `server/server.js`: instead of (or in
addition to) writing to the JSON file, it would call the national system's actual
intake API. Nothing in the field app (`public/`) needs to change for that.

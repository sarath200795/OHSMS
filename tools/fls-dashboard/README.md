# The standalone FLS dashboard

A single self-contained HTML file: FLS audit scores against the 90% pass mark,
and the remediation tickets they raised. It opens in any browser, needs no
server, no login and no API key, and can be mailed to someone who has neither.

**This is the secondary artefact.** The live version is in the app, at
Analytics → ODIN, and it queries Metabase through a Cloud Function every time
someone opens it. Use this one when the audience has no login.

## Refresh it

```bash
node tools/fls-dashboard/refresh.mjs --key mb_xxxxx
```

The key is checked before anything else runs, then cached in `.mbkey`
(git-ignored) so later runs need no `--key`:

```bash
node tools/fls-dashboard/refresh.mjs
```

**Keys on this Metabase expire every three days.** When one does, the script
says so in a sentence rather than failing twenty minutes into a fetch — mint a
new one under Settings → Admin → Authentication → API keys and pass it with
`--key`. (The app's own copy of the key is rotated separately, in Analytics →
ODIN → Connection.)

## What runs

| Step | File | What it does |
|---|---|---|
| 1 | `refresh.mjs` | Checks the key, decides the window, calls the other three |
| 2 | `fetch.mjs` | Pulls both questions in monthly chunks, resumable |
| 3 | `build.mjs` | Columnar, dictionary-encoded dataset — 30 MB of dumps to ~1.5 MB |
| 4 | `inject.mjs` | Splices that into `template.html` → `fls-dashboard.html` |

Chunked because the ticket dump crashes a Trino worker on a 90-day request and
returns a 500. A chunk that fails is retried on its own instead of discarding
twenty minutes of successful work, and chunks already on disk are reused — a
refresh costs only the months that moved.

Edit `template.html`, never `fls-dashboard.html`; the latter is generated and
overwritten on every refresh.

## The two questions

| Card | Name | Gives |
|---|---|---|
| 68611 | Dynamic FLS Audit Score-V3 | One row per completed audit, with all three CAS scores |
| 80321 | QFLS Audit Tickets Dump | One row per remediation ticket, with SLA, priority and checkpoint |

Both declare **required** date variables, so neither can be run without a range.
`fetch.mjs` binds them by name (`Start`/`End`, `sd`/`ed`); the app's callable
infers them from the question's own parameter list — see `buildDateParams` in
`functions/lib/metabase.js`.

## What "N+7" means

Every audit carries three readings of the same answers:

- **On the day** — credits no remediation.
- **After 7 days** — re-scores a failed critical checkpoint as a pass if its
  ticket closed within seven days of being raised.
- **To date** — credits every closure up to the snapshot. The only one of the
  three that moves without the estate changing, which is why the other two are
  the ones to trend.

An audit passes at **90%** or better. That threshold is the question's own, not
one applied here — `build.mjs` asserts that `score >= 90` reproduces the
PASS/FAIL verdict Metabase returned, on every row, and fails the build if it
ever stops matching.

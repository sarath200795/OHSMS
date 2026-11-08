# Self-hosting WEEHS on your own server

This runs WEEHS for one organization on any Linux server with Docker: a
virtual machine on any cloud, or a server in your own building. Your
records stay in a Postgres database on that server, your people sign in with
your own identity provider, and nothing is stored on the shared WEEHS
service.

Everything is in [`selfhost/`](../selfhost): `compose.yaml` (the app,
Postgres, and an HTTPS front door), `.env.example` (every setting), and
`init-db.sh` (the one-time database setup). Prefer Google Cloud Run with a
managed database instead? Follow [`CONTROL-PLANE.md`](CONTROL-PLANE.md).

## What you need

- A Linux server with **Docker** and the **Docker Compose plugin**. 2 vCPU,
  4 GB RAM and 40 GB disk are comfortable for a few hundred users.
- A **domain name** for it, for example `ehs.example.com`, with a DNS `A`
  record pointing at the server's public IP address.
- **Ports 80 and 443** open to the internet. Port 80 is needed for the free
  certificate; everything is served over 443.
- Your organization's **identity provider** details: SAML, or OIDC (Okta,
  Microsoft Entra, Google, Keycloak, …). See "Known limits" in
  `CONTROL-PLANE.md`.
- The **image** for the release you are installing, from the release page
  ([`RELEASES.md`](RELEASES.md)).
- Optional: SMTP details for outgoing mail.

## 1. Get the files

Copy the `selfhost/` folder from the release's source archive onto the
server, for example into `/opt/weehs`.

```bash
cd /opt/weehs
```

```bash
cp .env.example .env
```

## 2. Fill in `.env`

Open `.env` and fill in every value. The comments say what each is and the
command that generates the random ones:

- `WEEHS_IMAGE`: the image from the release page, preferably the
  `@sha256:` digest form.
- `DOMAIN`: your domain, without `https://`.
- `DB_ADMIN_PASSWORD`, `APP_DB_PASSWORD`: `openssl rand -hex 24` each.
- `STATE_KEY`, `DATA_KEY_MASTER`: `openssl rand -base64 32` each.
- `CONTROL_TOKEN`, `SESSION_SECRET`: `openssl rand -hex 32` each.
- The `SMTP_` settings and `MAIL_FROM`, if you want mail.

Then make it readable only by the administrator:

```bash
chmod 600 .env
```

**Back up `.env` somewhere safe and separate from the server.** Without
`STATE_KEY` the stored secrets cannot be read and the app will not start;
without the database passwords the data cannot be reached.

## 3. Start it

If the image is private (see "Who can download the image" in
`RELEASES.md`), sign in to the registry first with the token you were given:

```bash
docker login ghcr.io
```

Then:

```bash
docker compose up -d
```

The first start creates the database, the two roles its security rules use,
and an ordinary account for the app (`init-db.sh`). Caddy obtains the HTTPS
certificate, which can take a minute. Check:

```bash
docker compose ps
```

```bash
curl -s https://ehs.example.com/health
```

`/health` answers `{"ok":true}`. Opening `https://ehs.example.com` shows
**Not set up yet** until the next step is done.

## 4. Connect your sign-in

This is the same as on any dedicated environment. Follow
[`CONTROL-PLANE.md`](CONTROL-PLANE.md) from **step 7, "File the request"**,
using `https://ehs.example.com` as the address and `CONTROL_TOKEN` from
`.env`:

- file your organization's request (step 7);
- your handoff contact opens the one-time link and submits the IdP
  certificate and entry point (step 8), and registers
  `https://ehs.example.com/auth/saml` as the application in your IdP;
- the founder signs in (step 9) and invites everyone else from
  **Employees** (step 10).

## Upgrading

When a new release is announced:

1. Read its release page for any action needed.
2. Back up the database (below).
3. Put the new image in `.env` (`WEEHS_IMAGE=…`).
4. Pull and restart:

```bash
docker compose pull
```

```bash
docker compose up -d
```

The database schema is updated automatically when the new version starts.
Never change `STATE_KEY` or `SESSION_SECRET` as part of an upgrade.

## Backups

Back up the database daily, and keep copies off the server:

```bash
docker compose exec -T db pg_dump -U postgres -Fc ehs > weehs-$(date +%F).dump
```

Restore into a fresh install (same `.env`, empty database volume):

```bash
docker compose up -d db
```

```bash
docker compose exec -T db pg_restore -U postgres -d ehs --clean --if-exists < weehs-2026-01-01.dump
```

```bash
docker compose up -d
```

Test a restore before you need one. A backup that has never been restored is
a hope, not a backup.

## Everyday operation

- **Logs:** `docker compose logs -f app`
- **Stop:** `docker compose down` (data is kept). Never add `-v` unless you
  mean to delete the database.
- **Server updates:** keep the operating system and Docker patched; the
  database and app are not exposed to the internet, only Caddy is.
- **Disk:** watch free space; the database and its backups grow with use.

## Known limits

The limits in [`CONTROL-PLANE.md`](CONTROL-PLANE.md#known-limits--read-before-promising-a-company-a-date)
apply here too: in particular, a "WEEHS provisions a bucket" file store is
not served, so arrange your own bucket and presign endpoint for uploads.

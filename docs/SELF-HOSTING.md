# Self-hosting WEEHS on your own server

This runs WEEHS for one organization on a computer or server with Docker: a
virtual machine on any cloud, or a server in your own building. Your
records stay in a Postgres database on that server, your people sign in with
your own identity provider, and nothing is stored on the shared WEEHS
service.

Everything is in [`selfhost/`](../selfhost): `install.sh` (sets it all up in
one command), `compose.yaml` (the app, Postgres, and an HTTPS front door),
`.env.example` (every setting), and `init-db.sh` (the one-time database
setup). Prefer Google Cloud Run with a
managed database instead? Follow [`CONTROL-PLANE.md`](CONTROL-PLANE.md).

## Install without a terminal (recommended)

Before you start: point your address (for example `ehs.example.com`) at the
server with a DNS record, and let web traffic (ports 80 and 443) reach it.

1. On the server, install **Docker**: Docker Desktop on Windows or macOS (an
   ordinary installer), Docker Engine on Linux.
2. From the release page, download the **WEEHS Installer** for the server
   (`weehs-installer-windows-x64.exe`, `weehs-installer-macos-arm64` or
   `weehs-installer-linux-x64`) and open it. The server's screen shows a
   one-time **installer code**.
3. On any computer, open `http://ehs.example.com`. The installer answers at
   your address:
   - **Installer code:** the one on the server's screen. Ten wrong codes lock
     it for fifteen minutes.
   - **Check the server:** Docker is running and the HTTPS port is free.
   - **Your address:** filled in from the one you opened; email optional.
   - **Install:** writes the settings with new secrets on the server and
     prepares WEEHS. Then **Download settings backup** (keep it somewhere
     safe, away from the server) and **Switch to HTTPS and finish**.
4. The installer hands the address to WEEHS, which takes it with HTTPS, and
   your browser lands on `https://ehs.example.com/setup` with the setup code
   already filled in: step 4 below.

Opening the installer again later starts WEEHS again with the same settings;
it never replaces the secrets of an existing install.

The installer is not code-signed yet, so Windows SmartScreen and macOS
Gatekeeper ask for confirmation the first time.

The rest of this page is the same install by command line, for servers
without a desktop.

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

Download `weehs-VERSION-selfhost.tar.gz` from the release page onto the
server, for example into `/opt/weehs`, and unpack it:

```bash
cd /opt/weehs
```

```bash
tar xzf weehs-2.2.0-selfhost.tar.gz && cd weehs-selfhost-2.2.0/selfhost
```

## 2. Install

If the image is private (see "Who can download the image" in
`RELEASES.md`), sign in to the registry first with the token you were given:

```bash
docker login ghcr.io
```

Then one command, with your domain and the image from the release page:

```bash
./install.sh --domain ehs.example.com --image ghcr.io/OWNER/weehs-dedicated@sha256:DIGEST
```

It checks that Docker, Compose, `openssl` and `curl` are there, writes `.env`
with every secret freshly generated (readable by you only), starts the
database, the app and Caddy, waits until `https://ehs.example.com/health`
answers, and prints the status. The first start creates the database, the
two roles its security rules use, and an ordinary account for the app
(`init-db.sh`). Caddy obtains the HTTPS certificate, which can take a minute.

**Back up `.env` somewhere safe and separate from the server.** Without
`STATE_KEY` the stored secrets cannot be read and the app will not start;
without the database passwords the data cannot be reached.

Running `./install.sh` again, with or without options, never touches an
existing `.env`: it only starts what is there. So it is also how you start
again after a reboot or an upgrade. To add mail, fill in the `SMTP_`
settings and `MAIL_FROM` in `.env` and run it again.

Opening `https://ehs.example.com` shows **Not set up yet** until step 4.

## 3. Or by hand

What `install.sh` does, if you prefer to do it yourself. Copy the example:

```bash
cp .env.example .env
```

Fill in every value. The comments say what each is:

- `WEEHS_IMAGE`: the image from the release page, preferably the
  `@sha256:` digest form.
- `DOMAIN`: your domain, without `https://`.
- `DB_ADMIN_PASSWORD`, `APP_DB_PASSWORD`: `openssl rand -hex 24` each.
- `STATE_KEY`, `DATA_KEY_MASTER`: `openssl rand -base64 32` each.
- `CONTROL_TOKEN`, `SESSION_SECRET`: `openssl rand -hex 32` each.
- The `SMTP_` settings and `MAIL_FROM`, if you want mail.

Then make it readable only by the administrator, and start:

```bash
chmod 600 .env
```

```bash
docker compose up -d
```

Check:

```bash
docker compose ps
```

```bash
curl -s https://ehs.example.com/health
```

`/health` answers `{"ok":true}`.

## 4. Connect your organization, in the browser

Open `https://ehs.example.com/setup` (the sign-in page links to it while the
environment is not set up) and fill in:

- **Setup code:** `CONTROL_TOKEN` from `.env`.
- **Your organization:** its name and address, and your name and work email.
  You become the administrator.
- **How people sign in:** SAML or OpenID Connect. The page shows the values
  to register this application with in your identity provider (the SAML
  reply URL and entity ID, or the OIDC redirect URI), and asks for what the
  identity provider gives back: for SAML its sign-in URL and certificate, for
  OIDC the issuer URL, client ID and client secret.

**Set up and go live** creates the organization in this server's database
and connects the sign-in. Then sign in with your company account and, from
**Employees**, invite everyone else; from **Sites**, add your locations.

For a company whose identity provider already serves many apps, read
"Known limits" in [`CONTROL-PLANE.md`](CONTROL-PLANE.md#known-limits--read-before-promising-a-company-a-date):
where the app's tile in their portal should point, Microsoft Entra, and
**Join automatically**, which lets everyone at the company's email domain in
without an invite each.

`/setup` closes for good once the organization is live. Ten wrong setup codes
in fifteen minutes lock it for the rest of that window.

The operator route from [`CONTROL-PLANE.md`](CONTROL-PLANE.md) (file a
request with `curl`, a one-time handoff link) still works, for an operator
setting up an environment on someone else's behalf.

## Upgrading

When a new release is announced:

1. Read its release page for any action needed.
2. Back up the database (below).
3. Put the new image in `.env` (`WEEHS_IMAGE=…`).
4. Pull and restart (or run `./install.sh`, which keeps `.env` and starts):

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

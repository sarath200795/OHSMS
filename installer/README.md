# WEEHS Installer

One program an organization double-clicks on its server to install a
self-hosted WEEHS, with no terminal. Using it is in [`docs/SELF-HOSTING.md`](../docs/SELF-HOSTING.md).

## How it is shaped

- **At the company's own address.** Opened on the server, it answers on port
  80, which is the company's address once its DNS points there, and shows a
  one-time installer code on the server's own screen (`code.html`, only to a
  browser on the server itself). The IT admin opens `http://their-address`
  from any computer, enters the code, and goes through the steps (`ui.html`).
- **Who may drive it.** Until WEEHS is installed, anyone who can reach the
  address can reach the installer. The code (about 39 bits, ten wrong tries
  lock it for fifteen minutes) sets an HttpOnly, SameSite=Strict session
  cookie, and every action needs that cookie plus an `X-Installer` header a
  cross-site form cannot send (`core.cjs`).
- **It drives Docker.** It writes the [`selfhost/`](../selfhost) kit (built
  into the program), pulls and creates the containers, and on **Switch to
  HTTPS and finish** leaves port 80 and runs `docker compose up -d`: Caddy
  takes the address with HTTPS. If the start fails, the installer comes back
  on port 80, and the waiting page shows why.
- **Secrets.** Generated on the server (`core.cjs`, `buildEnv`), written to
  `.env` readable by the account only, offered as a backup download before
  the hand-over, and never regenerated over an existing install.
- **Hand-over.** The page waits for `https://their-address` and opens
  `/setup#code=…`: the setup code travels in the fragment, which browsers do
  not send to servers, and `/setup` fills it in and removes it from the
  address bar.

## Building

```bash
node installer/build.mjs --version 2.3.0 --image ghcr.io/OWNER/weehs-dedicated@sha256:DIGEST
```

Writes `dist-installer/weehs-installer-<os>-<arch>[.exe]`: this platform's
Node with the installer injected (Node single executable applications,
`postject`). The release workflow runs it on Linux, Windows and macOS and
attaches the three to the release. On Windows the program is marked a GUI
program, so no console window opens.

`--script-only` writes just the joined script, `dist-installer/weehs-installer.cjs`,
which `node` can run directly. For development, `node installer/installer.cjs`
runs from the repository with the kit read from `selfhost/` (set
`WEEHS_IMAGE` to the image to install).

Not yet: code signing. Until then Windows SmartScreen and macOS Gatekeeper
ask for confirmation on first open.

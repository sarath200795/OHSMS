# WEEHS Installer

One program an organization double-clicks to install a self-hosted WEEHS,
with no terminal. Using it is in [`docs/SELF-HOSTING.md`](../docs/SELF-HOSTING.md).

## How it is shaped

- **A page in the browser, not a desktop window.** The program starts a web
  server on `127.0.0.1` and opens the installer page in the default browser.
  No GUI toolkit is shipped, and the page looks the same on every system.
- **It drives Docker.** It writes the [`selfhost/`](../selfhost) kit (built
  into the program) and runs `docker compose up -d`, exactly as
  `selfhost/install.sh` does, then waits for `/health`. Docker is the one
  prerequisite, and Docker Desktop is itself an ordinary installer.
- **Who may drive it.** Loopback only; every request must carry the
  one-time token in the URL it opened, and name `127.0.0.1:<port>` as its
  Host, so neither another web page nor a rebound DNS name can use it
  (`core.cjs`, `allowedRequest`).
- **Secrets.** Generated on the machine (`core.cjs`, `buildEnv`), written to
  `.env` readable by the account only, never sent anywhere. An existing
  `.env` is never regenerated: a new `STATE_KEY` cannot read what the old one
  sealed.
- **Hand-over.** It ends by showing the setup code and opening the app's own
  `/setup` (`stack/setupPage.mjs`), where the organization and its sign-in
  are connected.

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

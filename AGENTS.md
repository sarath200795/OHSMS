# Working in this repository

Conventions that are load-bearing and not obvious from the file you happen to
open. Most of them exist because breaking them once caused a real defect; where
that is the case, the defect is named so the rule is arguable rather than
arbitrary.

## Where the truth lives

- **`firestore.rules` is the only enforcement that cannot be bypassed.** The
  browser talks to Firestore directly. Anything enforced in React — `can()`, a
  hidden button, a disabled field — is a usability feature. The same action
  succeeds from the browser console. If a change makes a permission decision,
  it belongs in the rules and needs a test in `tests/`.
- **`src/shared/modules/registry.js` is the module list.** It drives the
  sidebar, the dashboard grid and route mounting. Do not write the module count
  into a comment; it was wrong for a long time.
- **`docs/SECURITY.md` is the authority on open findings**, and
  `docs/PRODUCTION.md` on operating the deployed system. When another document
  restates either, it drifts. Link instead of copying.

## Four deployable units, three of them separate npm packages

`src/` (the SPA), `functions/`, and `server/` each have their own
`package.json`, lockfile and test config. The root `npm test` only reaches
`src/**`. CI runs all of them; a local check that only runs the root script has
tested a third of the repository.

`server/` is **not deployed**. Its `src/authz/policy.js` is a second copy of
eight `firestore.rules` role helpers, each annotated with the rules line range
it mirrors, and nothing ties them together mechanically. If you change one of
those predicates in the rules, change it there too.

## The audit trail

One implementation: `logAudit` in `src/shared/org/orgData.js`. Modules wrap it to
supply their `module` key and a default `target`, and nothing else writes to
`auditLogs`.

This was five copy-pasted copies, and four of them omitted `module`. Admin →
Audit Log renders `MODULE_BY_KEY[l.module]`, so every entry those four wrote
displayed as "Core" and the log could not be filtered back to the module that
produced it. A trail that cannot attribute an action is not a trail.

## Personal data

Two files describe the same personal data for different purposes and live in
different npm packages, so no import can tie them together:

- `src/shared/crypto/policy.js` — which fields get sealed
- `functions/lib/subjectData.js` — where a person's records are, for subject access

A collection added to one and not the other is a silent gap: unsealed personal
data in the first case, a person's records missing from their own legal export in
the second. `EXPECTED_SEALED` in `subjectData.js` is checked by the test suite
for exactly this. Update both.

Before touching subject access, read `docs/DATA-RIGHTS.md` §2 — with encryption
on, a server-side scan for a name reads ciphertext, and **zero matches is
indistinguishable from a person who is genuinely not mentioned**.

## Seams

`src/shared/data/` and `src/shared/storage/` are adapter contracts. The header
comment in `src/shared/data/index.js` declares itself to be the specification —
it is, and an adapter that deviates is a bug in the adapter. Note that only two
files consume `dataProvider` while 39 import `firebase/firestore` directly; the
seam is real but not yet universal, so do not assume it.

`src/shared/module-kit/service.js` (`createModuleService`) is the org-scoped CRUD
factory. Prefer it over hand-rolling `collection(db, 'organizations', orgId, …)`.

## Testing

- Run unit tests with `--no-file-parallelism`. The parallel run reports one to
  four phantom failures; treating those as a regression wastes an afternoon.
- `npm run test:rules`, the Playwright suite, and `server`'s attack tests all
  need a **JDK** — the emulators are JVM processes. CI uses Java 17.
- Rules tests send hostile payloads, not well-behaved ones. A new rule needs a
  test that tries to defeat it, not one that confirms it works when used
  correctly.
- After changing `firestore.rules`, the result count must be **unchanged** unless
  you intended a semantic change. A refactor that moves the number changed
  meaning.

## Two failure patterns worth recognising on sight

Both are documented in `docs/SECURITY.md` and both have bitten this codebase
three times each:

1. **The permissive union.** Firestore rules OR together. A narrow rule that
   refuses something is worthless while a broader `match` grants it. Adding a
   restrictive match block restricts nothing on its own.
2. **The post-state branch.** `request.resource.data` on an update is the state
   *after* the write. A rule that authorises against it lets the writer supply
   the value that authorises them.

## Style

- JavaScript, not TypeScript. No `tsconfig.json` anywhere, and that is
  deliberate — do not introduce one incidentally.
- Prettier: no semicolons, single quotes, width 100. `npm run format`.
- Comments explain *why*, and name the failure that motivated the code. The
  codebase carries no `TODO`, `FIXME`, or `console.log`; keep it that way.
- Line endings are mixed across the repo and `core.autocrlf` is on. Preserve
  whatever a file already uses rather than normalising it in an unrelated diff.

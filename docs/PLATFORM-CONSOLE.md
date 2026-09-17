# Platform console — module access

Which modules each organization can see and use, controlled from one screen at
`/platform` by whoever operates the platform. Nobody else can reach it, and no
tenant can grant itself a module.

## How the control works

Three layers, and only the last one is a real control:

| Layer           | What it does                                                                      | Where                                                                            |
| --------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| The tile grids  | A disabled module is not offered                                                  | `pages/portal/Home.jsx`, `pages/Dashboard.jsx`                                   |
| The route       | A bookmark to a disabled module gets a "not enabled" screen instead of the module | `shared/modules/ModuleGate.jsx`, mounted by `Protected moduleKey=…` in `App.jsx` |
| Firestore rules | Only a platform operator may write an entitlement                                 | `firestore.rules` → `match /moduleEntitlements/{orgId}`                          |

The first two are presentation and can be defeated in a browser. The third
cannot, which is why the entitlement lives in a top-level collection rather than
as a field on `organizations/{orgId}` — that document is writable by the org's
own admin (`allow update: if isAdminOf(orgId)`), so an entitlement stored there
would be one the tenant could switch back on.

## A separate application

The console is not a screen inside the customer app. It has its own sign-in at
`/platform/login`, its own dark shell, and its own guard — and the customer app
contains no link to it.

That separation is not decoration. Deciding what _other_ organizations may use
while signed in as an admin of one of them, under a header carrying that
customer's name, is how the wrong organization gets edited. So:

- The operator account **belongs to no organization**. It has no `/users`
  profile, no role and no `orgId`, and the console's guard never asks for one —
  it goes nowhere near `ProtectedRoute`, which exists to check tenant membership.
- `/platform/login` is not a general entrance. Signing in there with an ordinary
  customer account does **not** drop that person into the tenant app: the
  session is ended immediately and the screen says only "That account cannot
  sign in here." Wrong password, unknown address and "not an operator" all
  produce that same sentence, so the page will not confirm whether an email is
  one of the few that can reconfigure every customer.
- There is no SSO, no password reset and no sign-up on that page. Each would be
  another way in to the highest-privilege screen in the system.

**One browser, one identity.** Firebase Auth keeps a single session per browser
profile, so signing in as the operator signs you out of the tenant app in that
browser, and vice versa. You cannot be a customer and the operator at the same
time — which is the point. To have both open, use a second browser profile or a
private window.

## Who counts as the operator

The existence of `platformAdmins/{uid}`. Nothing else — not a role, not a custom
claim, not an email allowlist.

**No client operation can write that collection.** That is the design, not a gap:
an org admin edits `/users` for their own tenant every day, so any grant derived
from a document they control would be a grant they control. The only ways in are
the Firebase console and the Admin SDK, both of which already require
project-level access — the same authority the collection stands in for.

The rules also refuse `list`, so "am I an operator?" cannot be turned into a
roster of the platform's operators by anyone with an account.

## Granting it

**Production** — Firebase console:

1. Authentication → Users → **Add user**. Create a dedicated operator account
   (e.g. `operator@yourcompany.com`). Do **not** reuse an account that belongs to
   a customer organization, and do not give this one an organization.
2. Copy its UID.
3. Firestore → Start collection `platformAdmins` → Document ID = that UID.
4. Add one field, `note` (string), e.g. `platform owner`. The field is only there so the next person to read the console knows whose UID it is; existence is the grant.

Then go to `/platform/login` and sign in with that account.

**Local development** — the emulator write is scripted:

```bash
npm run platform:grant -- <uid>
```

Run the same command with `--prod` and it prints the console steps above rather
than writing anything.

## Revoking

Delete the document. Open tabs lose the console within seconds — the client
watches the document rather than reading it once — and every write from that
account is refused from the same moment.

## The default: absent means enabled (legacy); new orgs start as placeholders

An organization with **no** record in `moduleEntitlements` gets the full product.
That is deliberate for tenants that existed before this collection, in two places:

- **No document** → every org was in exactly this state before entitlements
  existed, so shipping this took nothing away from anyone.
- **Document present, key missing** → a module added to the registry later is
  **on**. Otherwise every new module would be invisible to every existing tenant
  until someone re-saved each one, and a shipped feature nobody can see is the
  worse failure.

Only an explicit `false` disables a module. `normalizeEntitlement` in
`shared/modules/entitlements.js` is what makes that true at every call site.

**New organizations are not in that state.** `createOrganization` writes the
document in the same batch as the org, with every known key `false` — a
placeholder per registry module. They become usable when an operator activates
them on this screen (the subscription grant), either one module at a time or by
assigning a **suite**. Suites live in `src/shared/modules/suites.js` (Core,
Operations, Fire & Emergency, Compliance, Full) and partition the registry.
Assigning a suite turns those placeholders on; it does not turn others off, so
an org can hold Core plus à-la-carte extras. The founder cannot flip those
flags themselves; rules allow that first write only while every module is off.

The document shape is `{ modules, suite?, updatedAt, updatedBy, updatedByEmail }`.
`modules` is the grant. `suite` is which bundle the operator last assigned
(`core` / `operations` / `fire` / `compliance` / `full` / `custom` / `''`) so
the console can name it. A founder seed does not include `suite`.

"Restore default" on the console **deletes** the record rather than writing every
module `true`, so a legacy org keeps getting new modules automatically. On a
new org that is the opposite of a placeholder seed — use "All placeholders"
when you mean the seeded state.

## What this is not

Entitlements are a **packaging** control, not a confidentiality boundary. A
tenant whose Permit-to-Work is switched off still has Firestore read access to
its own `organizations/{orgId}/permits` collection — the generic org rules are
unchanged — so its own data has not been sealed away from it, only removed from
its product. If a module ever needs to be genuinely unreachable rather than
merely un-offered, the per-collection rules are where that goes, and it needs
its own design: the mapping from module to collection is not one-to-one
(`equipment` covers extinguishers, AEDs, fire alarms and signage; `actions` and
`weather` have no collection of their own).

## Adding a module to the system

Add it to `shared/modules/registry.js` as usual, mount its route with
`moduleKey="<its key>"`, add it to `shared/modules/apps.js` and
`scripts/generate-apps.mjs`, and put it in exactly one packaging suite in
`shared/modules/suites.js`. The partition test fails if a registry key is
missing from the suites or listed twice. It appears on the console for every
organization; a new org still gets it as a placeholder until a suite or
à-la-carte switch turns it on.

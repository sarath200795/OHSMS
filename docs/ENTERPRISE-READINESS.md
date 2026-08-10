# Enterprise readiness

An honest assessment of what this app would meet, and what it would fail, in a
mid-to-large enterprise procurement or security review. Written against what is
in the repository today, not what is planned.

**Short answer: not yet — but the gap is a list, not a rewrite.**

The engineering foundation is genuinely good. Tenancy is enforced at the only
layer that counts, the audit trail is append-only and now attributable, the
security rules carry 149 tests, and the whole app builds and tests clean on every
push. What is missing is almost entirely *operational* — the things a buyer's
security questionnaire asks about and a developer never has to think about until
someone does.

Four things below would stop a deal on their own: no SSO, no MFA, no backups, and
file storage that is not tenant-isolated.

---

## Scorecard

| Area | State | Verdict |
|---|---|---|
| Tenant isolation (database) | Org-scoped paths, enforced in rules, 149 tests | **Ready** |
| Tenant isolation (files) | `storage.rules` does not bind a caller to an org | **Blocker** |
| Authentication | Email + password only | **Blocker** |
| MFA | None | **Blocker** |
| Authorization | 4 roles + site scoping; manager gate only in React | **Gap** |
| Audit trail | Append-only, immutable, actor pinned to caller | **Ready** |
| Backups / disaster recovery | Not configured. No RPO or RTO defined | **Blocker** |
| Observability | Sentry wired, DSN unset. No metrics, no alerting, no uptime check | **Gap** |
| Data lifecycle (export, deletion, retention) | None | **Gap** |
| Testing | 1075 unit, 149 rules, 1 e2e smoke | **Mostly ready** |
| CI/CD | Lint + test + build on push; ordered deploy | **Mostly ready** |
| Environments | Production only — no staging | **Gap** |
| Secrets handling | Nothing committed; client keys are appropriately public | **Ready** |
| Scalability | Uncapped collection listeners | **Gap** |
| Compliance artifacts | None | **Gap** |

---

## The four blockers

### 1. No SSO

Authentication is `signInWithEmailAndPassword` and nothing else. Enterprises
expect SAML or OIDC against their own identity provider, because it is how they
switch someone off everywhere at once when that person leaves. An app with its
own password list is a second offboarding step nobody remembers to perform.

Firebase Auth supports SAML and OIDC on the Identity Platform tier, so this is
configuration and a login-screen change rather than an architectural one. It also
brings enforced session length and device policy along with it.

### 2. No MFA

Admin accounts protect every safety record in the tenant and are protected by a
password. Most security reviews treat unconditional MFA on privileged accounts as
non-negotiable. Comes largely for free with SSO; available standalone through
Identity Platform otherwise.

### 3. No backups, no disaster recovery

Firestore has no automatic backups on the free tier and none are configured. If a
tenant's data is deleted — a bad script, a compromised admin, a bug — it is
gone. There is no point-in-time recovery, no tested restore, and no stated RPO or
RTO.

This is the cheapest blocker to fix and the most expensive to leave. `PRODUCTION.md`
§3 has the steps; what is missing beyond enabling it is a *restore that has
actually been performed once*, because a backup nobody has restored is a belief,
not a control.

### 4. File storage is not tenant-isolated

Any signed-in user of any tenant can read and delete any other tenant's uploaded
files if they know the path — incident photos, permit documents, LOTO procedure
photos. See `SECURITY.md` S-01. Needs an `orgId` custom claim, which needs the
Admin SDK, which means deploying the `functions/` tier. The stronger ruleset is
already written and waiting at the bottom of `storage.rules`.

---

## The gaps

**Authorization has a hole in it.** Approving permits, deciding defect reports and
managing sites are gated in React only, so an ordinary member can do them from
the SDK (`SECURITY.md` S-02). For a safety system this is more serious than it
sounds: the value of an approval is that only the approver could have made it.

**Nothing is watching.** Sentry is integrated but has no DSN, so no error reaches
anyone. There are no metrics, no alerts, no uptime monitoring and no on-call
path. Today, the way you find out production is broken is that a user tells you.

**No data lifecycle.** This app stores occupational health records — injuries,
illnesses, medical restrictions. Under GDPR and India's DPDP Act that is
sensitive personal data, and there is currently no way to export a person's
records, delete them on request, or expire them on a retention schedule. A buyer's
privacy review will ask for all three, and "we would do it by hand in the console"
is not an answer that survives.

**Production is the only environment.** There is no staging, so the first time a
change meets real data is when a customer does. The deploy workflow is sound —
rules and indexes ship ahead of the client — but it deploys straight to
production on merge.

**Scalability has a known ceiling.** Whole collections are read with no limit
(`SECURITY.md` S-04) and aggregation happens in the browser. Fine now; a tenant
with tens of thousands of records will find the edge.

**One e2e test.** `e2e/smoke.spec.js` covers the critical path. Unit and rules
coverage are strong, but there is little proof that the assembled app works
end-to-end across the twelve modules.

**No compliance artifacts.** No DPA template, no data-flow or subprocessor list,
no security whitepaper, no penetration test, no SOC 2 or ISO 27001. Not code, but
these are what actually gets asked for, and assembling them takes months of
calendar time — worth starting before the first enterprise deal, not during it.

---

## What is genuinely strong

Worth saying, because the list above is long and the foundation is not the
problem:

- **Tenancy is enforced where it cannot be bypassed.** Not in a middleware
  someone can forget to call — in rules, with tests that send hostile payloads
  rather than well-behaved ones.
- **The audit trail is real.** Append-only, no updates, no deletes, and entries
  are now pinned to the caller so the name on one means something.
- **The public QR surfaces are tightly bound.** Anonymous writes must present a
  token that resolves to the org and asset being written to, which ties a write
  to physical access to the equipment. That is a sharper control than most
  products manage on an unauthenticated endpoint.
- **The seams are real.** Storage, data and email are behind adapters with a
  documented contract, so swapping infrastructure is a file, not a project.
- **The deploy order is understood and written down**, including the failure
  modes that motivated it.

---

## Suggested order

1. Turn on backups and **perform one restore** (hours; removes a blocker)
2. Set the Sentry DSN and add an uptime check (hours; you stop finding out from users)
3. Enforce App Check on the public write surfaces (a console toggle, already documented)
4. Identity Platform: SSO + enforced MFA for admins (days; removes two blockers)
5. Deploy `functions/`, then the `orgId` claim and the stronger `storage.rules` (removes a blocker, and unblocks notifications)
6. Move manager-only transitions into the rules (`SECURITY.md` S-02)
7. A staging project and a staging deploy on merge
8. Data export / deletion / retention
9. Cap the unbounded listeners
10. Compliance artifacts, and a penetration test once 1–8 are done

Items 1–3 are hours of work and clear two blockers between them. That is the
cheapest security the project will ever buy.

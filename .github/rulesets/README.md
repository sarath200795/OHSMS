# Rulesets, in version control

The two JSON files here are the repository rulesets this project intends to
have. GitHub stores the live copy in the console, where nothing in this
repository can see it, diff it, or fail when it changes — a limitation an
ISO 27001 audit recorded as its standing caveat: *console state is invisible to
version control*. These files are the answer to that for the one piece of
console state that governs how code reaches production.

They are not applied automatically. Import one from the repository's
**Settings → Rules → Rulesets → New ruleset → Import a ruleset**, or with:

```bash
gh api -X POST repos/sarath200795/OHSMS/rulesets --input .github/rulesets/main-require-ci.json
gh api -X POST repos/sarath200795/OHSMS/rulesets --input .github/rulesets/release-tags-immutable.json
```

## What each one is for

**`main-require-ci.json`** — the five CI checks must pass, and a change must
arrive through a pull request. The approval count is deliberately **0**: with a
single collaborator, GitHub will not let you approve your own pull request, so
requiring one would block every merge rather than review it. The rule still
earns its place — it forces every change onto a branch and through the checks,
and it gives a reviewer somewhere to stand the day there is one. Raise the count
to 1 and set `require_code_owner_review: true` when a second person has write
access; `.github/CODEOWNERS` is already written for that day.

**`release-tags-immutable.json`** — `v*` tags cannot be deleted, force-updated
or moved. `deploy.yml` ships production on such a tag, so the tag is the
release's identity: one that can be repointed at a different commit afterwards
means the record of what shipped is not evidence of anything.

## ⚠️ These do nothing while the repository is private on GitHub Free

Repository rulesets are enforced on public repositories on every plan, and on
private repositories only with GitHub Pro, Team or Enterprise. This repository
was made private on 2026-09-09, and the API confirms the consequence:

```
$ gh api repos/sarath200795/OHSMS/rules/branches/main
403 Upgrade to GitHub Pro or make this repository public to enable this feature.
```

So as things stand, **`main` has no required checks, no pull-request
requirement, and no protection against force-push or deletion**, and `v*` tags
are mutable. The rulesets themselves were not deleted — GitHub refuses access to
them rather than reporting them absent — and they should resume on a plan
upgrade or a return to public. The `production` environment's **required
reviewer was actively dropped**, though, and has to be re-added:

```bash
gh api -X PUT repos/sarath200795/OHSMS/environments/production \
  -F wait_timer=0 -F prevent_self_review=false \
  -f 'reviewers[][type]=User' -F 'reviewers[][id]=224282467' \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/sarath200795/OHSMS/environments/production/deployment-branch-policies \
  -f name='v*' -f type='tag'
```

Verify enforcement — not configuration — with the endpoint that reports what
actually applies to a ref, which is the one that told the truth above:

```bash
gh api repos/sarath200795/OHSMS/rules/branches/main --jq '[.[].type]'
# expected: ["required_status_checks","pull_request","deletion","non_fast_forward"]
```

Reading the ruleset list back is not the same check: it shows what is
configured, and configuration that is not enforced is what this file exists to
stop anyone believing in.

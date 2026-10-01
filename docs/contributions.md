# Community contributions: setup and review

The static site can't accept posts. Every club page ends with **Help improve this page**: one link per kind of update (deadline, how to join, hours, members, dues, who can join, website, Instagram, application link, something wrong, and more). Each link opens an external Google Form with the club, the kind of update and a short answer template already filled in. `/contribute` does the same for clubs known only by name. Nothing a student sends changes the site until an editor accepts it, field by field (ADRs 0027 and 0035).

## 1. The form

The live form has four questions; `scripts/google-form.gs` creates the same form in a new Google account:

1. **Club** (short answer). Prefilled as `Club Name [slug]`.
2. **What kind of update?** (multiple choice). Prefilled with the option the link's type maps to (`formOption` in `packages/core/src/contribute.ts`). The prefill only works when the value is exactly one of the form's options.
3. **Details** (paragraph). Prefilled with the type's template, e.g. `Dues (amount and how often, or none): `. The importer turns each answered `Label: value` line into a proposed field value.
4. **Source link (optional)**.

Settings: don't collect email addresses, and don't require sign-in.

In `.env`, use a prefill link with your question ids (⋮ → _Get pre-filled link_, then replace the answers with the placeholders):

```
NEXT_PUBLIC_CONTRIBUTE_FORM_URL=https://docs.google.com/forms/d/e/<id>/viewform?usp=pp_url&entry.<club>={clubref}&entry.<kind>={type}&entry.<details>={details}
```

Rebuild and publish after changing it.

## 2. Review responses

```bash
pnpm hci submissions import ~/Downloads/responses.csv   # Responses → ⋮ → Download CSV; re-importing skips rows already queued
pnpm hci submissions list                                # pending, with proposed-field counts
pnpm hci submissions show <id>                           # answers, parsed values, what the profile shows now
pnpm hci submissions accept <id>                         # accept every proposed field that has a value
pnpm hci submissions accept-field <id> <field|#> [--value=<json|text>] [--term=2026-fall] [--override]
pnpm hci submissions reject-field <id> <field|#> --reason="…"
pnpm hci submissions reject <id> --reason="…" [--spam]
pnpm hci submissions match <id> <club-slug>              # for a response whose club didn't match
pnpm hci submissions stats
```

- **On import:** form columns that identify the submitter are dropped, and email addresses and phone numbers in answers are removed. "Feedback about the site" responses are skipped.
- **Accepting:** creates a `user_reported` claim evidenced by the submission. It shows on the profile labelled _student-reported_.
- **Source links:** if the response has a link, accepting a field fetches it (never social sites). A page that states the value adds a second, sourced claim.
- **Conflicts:** a student value never silently replaces one from a club's or Harvard's page. The command refuses, and `--override` records that you decided otherwise.
- **Free text:** use `accept-field <id> <field> --value=…` for what a response says outside the template. Field keys and value shapes are in `packages/core/src/fields/registry.ts`.
- **Websites:** a submitted website is best read with `pnpm hci enrich --club=<slug>` after accepting it.

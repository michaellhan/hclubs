# Community contributions: setup and review

The static site can't accept posts. Its "Share what you know" and "Run this club?" buttons open an external form, or an email to `CONTACT_EMAIL` when no form is configured. Responses reach the index only through an editor (ADR 0027).

## 1. Create the form (Google Forms)

Settings: **don't collect email addresses**, and don't require sign-in. The importer ignores email, name, phone, NetID and HUID columns anyway.

Questions (the importer matches these by keywords, so keep the words in bold):

1. **Club** (short answer). This question is prefilled with the club's slug.
2. **What kind of update?** (multiple choice): Recruiting deadline / How to join / Comp stages / Time commitment / Size / Dues / Website or link / Club seems inactive / Other.
3. **Details** (paragraph): "What do you know, and when did it apply?"
4. **Source link** (short answer, optional): "A page, post or form that shows it".

Get a prefilled link: ⋮ → *Get pre-filled link*. Type `{slug}` as the Club answer, then copy the link. Use it as:

```
NEXT_PUBLIC_CONTRIBUTE_FORM_URL=https://docs.google.com/forms/d/e/<id>/viewform?usp=pp_url&entry.<n>={slug}
```

A second form (or the same one) can serve club officers via `NEXT_PUBLIC_CLUB_MANAGER_FORM_URL`. Ask for the club's official email address or website so the claim can be verified. Rebuild and publish the site after setting either variable.

## 2. Review responses

```
pnpm hci submissions import ~/Downloads/responses.csv   # Responses → ⋮ → Download CSV; re-importing skips rows already queued
pnpm hci submissions list
pnpm hci submissions accept <id> --field=club.hours_per_week --value='{"min":5,"max":8,"qualifier":"comp_period"}'
pnpm hci submissions accept <id> --field=club.link --value='{"kind":"instagram","url":"https://www.instagram.com/<handle>"}'
pnpm hci submissions accept <id> --field=club.short_description --value='"One sentence on what the club does."'
pnpm hci submissions reject <id> [--spam] --reason="…"
```

Clubs known only by name (mostly from the SOCO import, ADR 0030) are listed on `/contribute` with a prefilled "Add info" link each, and their profiles show an "Add what you know" callout. A submitted website is best added as a link and then read with `pnpm hci enrich --club=<slug> --llm`.

- **Accepting:** creates a `user_reported` claim, shown with the **Community** badge.
- **One field per claim:** accept a response once per field it supports.
- **Official sources:** when a response links an official page, prefer adding that page as a club link and letting `enrich` read it. The fact is then backed by a snapshot, not just the submission.
- **Field keys and value shapes:** see `packages/core/src/fields/registry.ts`.

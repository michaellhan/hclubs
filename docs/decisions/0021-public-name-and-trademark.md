# 0021: Public name and Harvard trademark

**Status:** amended twice on 2026-09-30. **Second amendment:** the owner renamed the site **hclubs** (hclubs.app). The site name, header, page titles, browser icon, feedback form and crawler (`hclubsBot`) no longer say "Harvard Club Index". "Harvard" is used only descriptively ("every Harvard student club"), and the not-affiliated notice stays. This resolves the trademark concern below. **First amendment:** The owner chose **Harvard Club Index** as the public name and knowingly accepts the trademark risk described below. The rest of this record is the original decision, kept for context.

## Amendment (2026-09-30)

- **Public name:** the site is called **Harvard Club Index**. The owner prefers the name and accepts the risk.
- **Address:** `https://<owner>.github.io/hci/`. "Harvard" is still not in the domain, which Harvard monitors most actively.
- **No endorsement:** no Harvard shields, the VERITAS mark or other insignia; the not-affiliated notice stays on every page.
- **Trademark email:** ask the Trademark Program (trademark_useofname@harvard.edu) whether the name is acceptable; a draft is in `data/outreach/drafts.md`. If they object, rename. The name is `SITE_NAME` in `apps/web/src/lib/site.ts` plus the layout metadata.
- **Crawler:** the user agent stays `ClubIndexBot`.

## Original decision

## Context

The working name "Harvard Club Index" uses a Harvard trademark. Harvard's Trademark Program says:

- use of Harvard names by non-Harvard entities on third-party websites needs case-by-case approval (trademark.harvard.edu, "Use of Harvard names and insignias in electronic contexts");
- Harvard monitors "Harvard" domain registrations;
- the name may never be used to imply affiliation or endorsement ("Endorsement guidelines").

Use of the Harvard College name is a benefit of official recognition, which this project does not have. Some of these pages returned 403 to our fetcher, so parts of this summary come from search excerpts. It is a product decision, not legal advice.

## Decision

- **Brand:** the public brand is **Club Index**. The site name, domain and crawler (`ClubIndexBot`) do not contain "Harvard".
- **Descriptive use:** "Harvard" appears only factually, as in "an independent index of Harvard student organizations".
- **Disclaimer:** a clear not-affiliated notice appears in the footer and on `/about`.
- **No Harvard marks:** no shields, the VERITAS mark or other Harvard insignia. We don't call the accent color "crimson" or present the site as official.
- **Internal name:** the source repo is `michaellhan/hclubs` (private; renamed from `harvardclubindex` on 2026-09-30) and packages are `@hci/*`. The site is served at hclubs.app, which has no "Harvard" in the domain.
- **Before launch:** email the Trademark Program (trademark_useofname@harvard.edu) describing the site and its descriptive use, and follow their guidance. If "Harvard" is ever wanted in the name, it needs written permission first.

## Consequences

- Fixture READMEs keep the old user-agent string, because they record what was used when each fixture was fetched.
- Renaming again later touches only `apps/web/src/lib/site.ts`, the layout metadata and the crawler default.

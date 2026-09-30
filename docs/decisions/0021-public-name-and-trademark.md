# 0021: Public name is "Club Index"; no "Harvard" in the brand, domain, or crawler name

**Status:** accepted (launch prep)

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
- **Internal name:** the repo and package names (`harvardclubindex`, `@hci/*`) are internal and unchanged.
- **Before launch:** email the Trademark Program (trademark_useofname@harvard.edu) describing the site and its descriptive use, and follow their guidance. If "Harvard" is ever wanted in the name, it needs written permission first.

## Consequences

- Fixture READMEs keep the old user-agent string, because they record what was used when each fixture was fetched.
- Renaming again later touches only `apps/web/src/lib/site.ts`, the layout metadata and the crawler default.

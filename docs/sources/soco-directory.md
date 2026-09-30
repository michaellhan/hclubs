# Source: soco-directory

|                    |                                                                                   |
| ------------------ | --------------------------------------------------------------------------------- |
| Adapter            | `soco-directory` (`packages/pipeline/src/adapters/soco-directory.ts`)             |
| URL (cited only)   | https://soco.college.harvard.edu/club_signup                                      |
| Publisher          | Harvard College Student Organization Center (SOCO)                                |
| Source type / tier | harvard_official / tier 1, `fetch_method = manual_upload`                         |
| Reviewed           | 2026-09-30 (synthetic fixture in `packages/pipeline/test/soco-directory.test.ts`) |
| Cadence            | Each semester, when the owner saves a new copy                                    |

**Access:** Requires HarvardKey. Never fetched by the crawler. The owner copies the group list by hand and saves it as plain text in `data/imports/` (gitignored); `pnpm hci import-soco data/imports/soco.txt` imports it (ADR 0030).

**Structure (copied text):** each group starts with a line "Select <name>'s group. Select the group and click on the Join button …", then the name, then "<category>[ - <flag>, <flag>]", then optional "Website", "Contact: …", "Group Not Registered Yet", and a membership-duration line. There are no URLs or descriptions in the copied text.

**What we extract:** name/acronym, category and flags as tags, "No Dues Required" → dues none, registration → recognized, affiliation harvard_college; category → our taxonomy/org type (inferred). **Dropped:** contact/officer names; "Office" entries.

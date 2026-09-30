# Sources

One note per discovery adapter: URL, access/robots review, structure, what is extracted, cadence. See `packages/pipeline/src/adapters/index.ts` for the run order (official Harvard sources first, lower-trust breadth sources last).

## Surveyed but not used (2026-09-30)

| Source                                                                                                                                                                 | Why not                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SOCO / CampusGroups org directory (`soco.college.harvard.edu/club_signup`, 554 groups)                                                                                 | Requires HarvardKey; never crawled. Imported from the owner's hand-saved copy instead (`soco-directory.md`, ADR 0030).                                                |
| Dean of Students Office (`dso.college.harvard.edu`), Office for the Arts (`ofa.fas.harvard.edu`), `arts.harvard.edu`, `tdm.fas.harvard.edu`, most FAS department sites | Akamai "Access Denied" (403) to our identified crawler. Not bypassed.                                                                                                 |
| `www.math.harvard.edu`                                                                                                                                                 | Cloudflare challenge. Not bypassed.                                                                                                                                   |
| `thehub.college.harvard.edu`                                                                                                                                           | Host does not resolve; its org slugs are kept only as external ids.                                                                                                   |
| Harvard Undergraduate Association (`thehua.org`)                                                                                                                       | No club directory.                                                                                                                                                    |
| The Harvard Crimson                                                                                                                                                    | Allowed by robots, but articles name clubs only in prose. Fixtures are saved in `crimson-guides/` for a future name-matching extractor (tier 6, historical evidence). |
| Instagram / LinkedIn / Facebook / TikTok                                                                                                                               | Platform terms forbid scraping; we only store links found on official pages (CLAUDE.md §21).                                                                          |

## Survey of other Harvard offices (2026-09-30)

- **Blocked** (Akamai 403 or Cloudflare challenge; not bypassed):
  - `publicservice.fas` (lists 70+ affiliated orgs: the best remaining target), `chaplains.harvard.edu`, `uraf.harvard.edu`, `diversity.harvard.edu`, `scienceeducation.fas`, `ghhp.fas`, `physics.harvard.edu`;
  - `mittalsouthasiainstitute.harvard.edu` (including its robots.txt) and the `worldwide.harvard.edu` listings.
- **Host no longer resolves:** `harvardfoundation.fas`, `bgltq.fas`, `hcwc.college`.
- **No organization list:** `thehua.org`, `huafinance.org`, `college.harvard.edu` student activities, Harvard Recreation (links to SOCO), `harvardcatholic.org`.
- **Usable:** Harvard Hillel (adapter `hillel-student-groups`). Individual SOCO club home pages (`soco.college.harvard.edu/<id>/home/`) are public and allowed by robots, but can only be reached from links elsewhere. The listing itself requires HarvardKey.

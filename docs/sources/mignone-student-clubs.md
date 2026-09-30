# Source: mignone-student-clubs

|                    |                                                                            |
| ------------------ | -------------------------------------------------------------------------- |
| Adapter            | `mignone-student-clubs` (`packages/pipeline/src/adapters/`)                |
| URL                | https://careerservices.fas.harvard.edu/organizations/?ctag[]=student-clubs |
| Publisher          | Mignone Center for Career Success                                          |
| Source type / tier | harvard_official / tier 1                                                  |
| Reviewed           | 2026-09-30 (fixture: `packages/pipeline/test/fixtures/`)                   |
| Cadence            | Monthly                                                                    |

**Access and robots:** Public WordPress; robots allows. About 8 pages.

**Structure:** `.post-wrapper > div.entry.type-organization`: `h2.entry-title > a` for name and detail page (the slug is the id), `.categories-list > span` for tags, `.entry-summary p` for the description. Pagination follows only the next page number. The umbrella "HES Student Organizations" entry is skipped. Includes GSAS/HES clubs, which are flagged graduate by name.

**What we extract:** name, description, directory page, tags, category pre-professional (inferred).

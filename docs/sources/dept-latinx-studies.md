# Source: dept-latinx-studies

|                    |                                                           |
| ------------------ | --------------------------------------------------------- |
| Adapter            | `dept-latinx-studies` (`packages/pipeline/src/adapters/`) |
| URL                | https://sites.harvard.edu/latinx/latinx-organizations/    |
| Publisher          | Harvard Latinx Studies                                    |
| Source type / tier | harvard_official / tier 1                                 |
| Reviewed           | 2026-09-30 (fixture: `packages/pipeline/test/fixtures/`)  |
| Cadence            | Each semester                                             |

**Access and robots:** Public WordPress; robots Crawl-delay 30 (honored by the fetcher).

**Structure:** `.entry-content p.wp-block-paragraph` containing `a > strong`; the description is the next non-empty paragraph. Research centers and faculty/staff associations are excluded. Links point to org pages on thehub.college.harvard.edu or SOCO; those slugs become external ids (thehub host did not resolve on 2026-09-30).

**What we extract:** name, description, directory page, category cultural-identity (inferred).

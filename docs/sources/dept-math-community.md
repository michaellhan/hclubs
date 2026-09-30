# Source: dept-math-community

|                    |                                                            |
| ------------------ | ---------------------------------------------------------- |
| Adapter            | `dept-math-community` (`packages/pipeline/src/adapters/`)  |
| URL                | https://sites.harvard.edu/math-community/community-groups/ |
| Publisher          | Harvard Mathematics                                        |
| Source type / tier | harvard_official / tier 1                                  |
| Reviewed           | 2026-09-30 (fixture: `packages/pipeline/test/fixtures/`)   |
| Cadence            | Each semester                                              |

**Access and robots:** Public WordPress; Crawl-delay 30.

**Structure:** `.entry-content h3:first-of-type + ul.wp-block-list > li` with the name in `strong`, the text after the colon as description, and a contact `mailto`. Only entries mentioning undergraduates are kept.

**What we extract:** name, description, club email.

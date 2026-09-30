# Source: dept-mcb-neuroscience

|                    |                                                                                  |
| ------------------ | -------------------------------------------------------------------------------- |
| Adapter            | `dept-mcb-neuroscience` (`packages/pipeline/src/adapters/`)                      |
| URL                | https://www.mcb.harvard.edu/undergraduate/neuroscience/student-groups-resources/ |
| Publisher          | Harvard MCB                                                                      |
| Source type / tier | harvard_official / tier 1                                                        |
| Reviewed           | 2026-09-30 (fixture: `packages/pipeline/test/fixtures/`)                         |
| Cadence            | Each semester                                                                    |

**Access and robots:** Public WordPress; robots allows.

**Structure:** `ul.accordion[data-category="groupsandevents"] .accordion__content-wrapper h3:first-of-type + p`, with entries separated by `<br>`: `<strong><a>NAME</a></strong> description`.

**What we extract:** name, link, short description.

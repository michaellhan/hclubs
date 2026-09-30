# Source: innovation-labs-student-groups

|                    |                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------- |
| Adapter            | `innovation-labs-student-groups` (`packages/pipeline/src/adapters/`)                |
| URL                | https://innovationlabs.harvard.edu/resources/hub?externalResourceType=student-group |
| Publisher          | Harvard Innovation Labs                                                             |
| Source type / tier | harvard_official / tier 1                                                           |
| Reviewed           | 2026-09-30 (fixture: `packages/pipeline/test/fixtures/`)                            |
| Cadence            | Monthly                                                                             |

**Access and robots:** Public; robots allows.

**Structure:** `ul.ventures-landing__grid > li.resource-cards__card-wrapper`: `h3.resource-cards__title` name, `p.resource-cards__desc` description, `a.resource-cards__card[href]` link, `p.resource-cards__category` tag. Covers all Harvard schools.

**What we extract:** name, description, website, category entrepreneurship (inferred).

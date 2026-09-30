# Source: seas-orgs-by-concentration

|                    |                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| Adapter            | `seas-orgs-by-concentration` (`packages/pipeline/src/adapters/`)                                |
| URL                | https://seas.harvard.edu/office-student-organizations/find-seas-affiliated-student-organization |
| Publisher          | Harvard SEAS                                                                                    |
| Source type / tier | harvard_official / tier 1                                                                       |
| Reviewed           | 2026-09-30 (fixture: `packages/pipeline/test/fixtures/`)                                        |
| Cadence            | Monthly                                                                                         |

**Access and robots:** Public; robots allows.

**Structure:** Accordion: `.accordion-content .field-item h2` (APPLIED MATHEMATICS / COMPUTER SCIENCE / ENGINEERING) followed by `ul > li` (`a > span` name, trailing `span` = "(ACR) - description"); community/project sections are `p a` links. Some links are wrapped in urldefense/proofpoint and are unwrapped.

**What we extract:** name, acronym, description, website, concentration tag; graduate-school groups ("GSAS …") get an inferred graduate_school affiliation and are hidden from the default directory.

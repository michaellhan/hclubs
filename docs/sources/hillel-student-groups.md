# hillel-student-groups

|                    |                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| Publisher          | Harvard Hillel, an independent nonprofit serving Harvard's Jewish community. It is not a Harvard office. |
| URL                | https://hillel.harvard.edu/jewish-life/student-groups-initiatives/                                       |
| Source type / tier | `harvard_related_other` (tier 7)                                                                         |
| Auth               | None (public)                                                                                            |
| robots.txt         | Reviewed 2026-09-30: allows everything, with `Crawl-delay: 10`, which is honored                         |
| Cadence            | Each semester                                                                                            |
| Adapter            | `packages/pipeline/src/adapters/hillel.ts` (key namespace `hillel-groups`, keyed by name)                |

**What we take:** each group's name, its description (first paragraph), and its own links (website, Instagram, LinkedIn, YouTube). The category is inferred as Religious & Spiritual, and the tag "jewish life" is stated.

**What we never take:** the per-group "Contact: <student>" line and any `mailto:` addresses. These are individual students (CLAUDE.md §21).

**Quirks:**

- The page is a tile grid with modals. All modal content is present in the static HTML.
- Some entries are initiatives, such as trips, rather than standing clubs. They are kept, because the page lists them as student groups.
- There is some overlap with other sources: Tamid also appears on the Mignone list, and entity resolution merges them.

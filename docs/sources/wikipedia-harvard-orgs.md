# Source: wikipedia-harvard-orgs

|                    |                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Adapter            | `wikipedia-harvard-orgs` (`packages/pipeline/src/adapters/`)                                                             |
| URL                | https://en.wikipedia.org/wiki/List_of_Harvard_College_undergraduate_organizations (+ /wiki/Harvard_College_social_clubs) |
| Publisher          | Wikipedia (CC BY-SA 4.0)                                                                                                 |
| Source type / tier | public_web / tier 8                                                                                                      |
| Reviewed           | 2026-09-30 (fixture: `packages/pipeline/test/fixtures/`)                                                                 |
| Cadence            | Each semester                                                                                                            |

**Access and robots:** robots.txt disallows /w/ (which includes api.php), so the adapter fetches the ordinary /wiki/ article pages, which are allowed. Content is CC BY-SA 4.0: we store names and short excerpts with the source URL on every claim.

**Structure:** Parsoid article HTML: `<section>`-wrapped sections with `h2[id]` section ids and `dl > dt` subsections, `ul > li` entries. The name is the leading link text, or the leading Capitalized run of words split out of prose (these get confidence ×0.8). Gallery captions are skipped. Social clubs are parsed from the multi-column `table.col-begin td` with `p` group headings.

**What we extract:** name, description (confidence ×0.8, often historical), "(formerly X)" as former-name aliases, categories by section (inferred), recognition only for the explicit "(Un)recognized student groups" sections. The Wikipedia article link is stored as kind `other`, never as the org's own channel. All of it displays as "Reported"; it is never authoritative.

**Descriptions (1.2.0, 2026-10-13):** an entry is "Name, a …", "Name performs …" or "Name, which …". The text after the name starts mid-sentence, so it is never stored on its own (1.1.0 stored "which performs in the Memorial Church", "founded in the 1960s."). The description is the whole entry, verbatim, when it reads as one: the name followed by a verb, by an appositive ("a/an/the/one …", or a capitalized one such as "Harvard's oldest …"), or by a participle clause the next clause completes with a verb ("…, founded in 1919, plays …"). Entries whose tail is only a relative, prepositional or participle clause give no description; nothing is joined or reworded. Maintenance and footnote tags (`sup.noprint`, `sup.reference`, and text such as "[citation needed]", "[clarification needed]", "[when?]", "[1]", "[a]") are removed first. Name keys and the `wikipedia-article` ids are unchanged.

# 0049 — Logos chosen from the root page, with the images measured

Date: 2026-10-05 · Status: accepted (owner: "logos are mostly not being extracted properly … CBE is missing, HDAG is wrong")

Amends the logo part of ADR 0029.

## Context

`club.logo` came from the deterministic extractor on any crawled page labelled `home`, judged
by URL alone (file names, hosts, declared widths). A survey of the 245 clubs with a website
(2026-10-05) found:

- **Missed header logos.** Only images whose own src/alt/class/id said "logo" counted, so
  Squarespace's header logo (`elementtiming="nbf-header-logo-desktop"`, alt = the club's name),
  `navbar-brand`/`site-logo` wrappers and home-link images were invisible: 64 sites with no logo.
- **Wrong picks.** A template's stock `logo-test.png` share image (HDAG), white logos for dark
  headers, screenshots, 32–72 px favicons, a widget vendor's mark, WordPress.com's own "W", a
  collage of sponsor logos, and pages that weren't the root (`/apply-1` labelled `home`).
- **Wix placeholders.** Wix puts a ~50 px blurred lazy-load rendition in the HTML; the audit then
  rejected it (CBE's logo, which was found, never showed).
- **The UI hid wordmarks.** `ClubLogo` fell back to initials for anything wider than 2:1.

URL rules can't see that an image is white on transparency, pale, 72 px, or 6:1.

## Decision

- **A `logos` stage** (`pnpm hci logos`, `stages/logos.ts`) owns `club.logo`. It reads the newest
  successful snapshot of each club's verified (else probable) website link, the root page
  itself, and records one claim (`logo-picker` 1.1.0, evidence = that snapshot, locator = kind
  and measured size). The deterministic extractor no longer claims logos (1.16.16).
- **Candidates** (`parse/logo-candidates.ts`): an image in the header counts when it sits in a
  logo/brand slot (class, id or `elementtiming`, up to four levels up), says "logo", is inside a
  link to the home page, or its alt is the site's name (og:site_name / title). `<body>` and
  `<html>` classes are ignored (site builders put theme switches there). Wix renditions are
  replaced by the original upload; the page's file name and alt are kept as `hint`.
- **Measured once** (`logo-measure.ts`, sharp, already a Next dependency): size, format and
  pixel statistics, including `ink`, the share of pixels that stand out once the image is laid
  on our stone-100 tile. Stored in the new `image_probe` table (URL key, `measure_version`);
  re-measured after 60 days or when the version changes. `--offline` replays from it. Images
  are fetched with the polite fetcher (robots, per-host interval) restricted to image types.
- **Rules** (`extract/logo.ts`, shared with the audit): URL rules (other organizations' marks,
  template and collage files, Harvard-wide images, third-party hosts outside known site-builder
  CDNs; screenshot/photo names only outside the site's declared slot) and image rules (blank,
  white on transparency, `ink` < 3 %, raster under 96 px, wider than 3.2:1, taller than 2:1).
  White-by-file-name is only a guess when no measurement exists. Among usable images the
  declared kinds rank first, but a square mark beats a wordmark wider than 2.2:1.
- Earlier site-extracted logo claims the rules no longer pick are rejected with a reason
  (reversible); editorial and other claims, and logos someone restored by hand, are left
  alone. A rejection by a reviewer keeps that image (and, for a favicon, its other sizes) out;
  an automatic rejection (this stage, a re-extraction, an audit file-name heuristic) is undone
  when the measured image passes. A club whose deciding images aren't all measured (offline,
  a new measure version, a fetch that failed with a network error, 429 or 5xx) is left
  unchanged; transient failures are retried after a day.
- **UI:** `ClubLogo` accepts up to 3.3:1 and asks Wix for a 300 px rendition.
- `refresh.sh` runs `hci logos` after `enrich`; a failure doesn't stop the refresh.

## Consequences

Displayed logos went from 146 to 168 of the 233 clubs whose site page is stored (109 logos
added, replaced or removed), after a visual check of every pick on a contact sheet. Remaining gaps are sources, not rules:
logos drawn by JavaScript or inline SVG (the Crimson, the Lampoon, IOP), `.ico`-only
favicons, and clubs with only an Instagram account (profile pictures are outside the §21
owner exception, which covers follower counts only). A plain Harvard shield used as a club's
icon (Debate Council) can't be told from a club crest by these rules.

# 0050 — Instagram profile pictures as club logos

Date: 2026-10-05 · Status: accepted (owner: "yes use insta pfps that's very good", also for clubs
whose site draws its logo in code)

Extends the owner's §21 exception (ADR 0046 amendment), which covered follower counts only.

## Context

After ADR 0049, 168 of 692 clubs show a logo; 163 clubs without one have an Instagram account
on file, including clubs whose website draws its logo with code or inline SVG (the Crimson).
An Instagram profile picture is the club's own mark in most cases. Its address is signed and
expires within days, so it can't be hotlinked like a website logo.

## Decision

- **Read with the follower count.** `pnpm hci instagram-followers` (installed Chrome, one public
  profile page every 10–15 s, never logged in, stops at the first block) also takes the image
  the page labels `<handle>'s profile picture`, from the same page load, and downloads it once
  (≤ 2 MB, image types only). Instagram's grey stand-in picture is skipped. `--missing-logo`
  reads only clubs the site shows no logo for.
- **Same account check as counts.** The importer writes a picture only for an entry that passes
  `accountProblem` (a verified link, or an account named like the club, not shared with another
  club). An account that fails also loses the pictures it gave.
- **A claim like any logo.** `club.logo` = the picture's address without its signed query (stable
  per picture), extractor `instagram-picture` v1, evidence = an image snapshot of the profile
  source; measured with the site-logo rules (`logoImageProblem`, recorded in `image_probe` with
  the kept copy's `storage_key`). The club's earlier pictures are retired when it changes it.
  A site logo still wins (tier 2 over 3, or over 8 for an unconfirmed account); an editor who
  prefers the picture rejects the site logo (`reject-value`, binding for the logos stage).
- **Served from our copy.** `pnpm hci logo-files` writes each displayed picture, resized to
  160 px WebP, to `apps/web/public/logos/ig/` (not in git; rebuilt from the snapshot store), run
  by the import and by `publish-pages.sh` before every build. `logoSrc` maps Instagram addresses
  to `/logos/ig/<name>.webp`; a missing file falls back to initials.

## Consequences

Clubs with only an Instagram, or with a site that offers no usable image, get their own mark.
Pictures refresh with the monthly follower run (`HCI_INSTAGRAM=on`). The exception still covers
nothing else on Instagram: no posts, bios, or other accounts' images.

## Amendment (2026-10-05): signed-in reads

Instagram rate-limited the anonymous reader (`is_from_rle`) after 6 profiles, and again an hour
later on the first page. The owner chose to sign in: `pnpm hci instagram-login` opens installed
Chrome with a persistent profile (`data/chrome-instagram/`, local only) on the login page, the
owner signs in by hand and closes it, and `instagram-followers --signed-in` reuses that profile
in a visible window. Everything else is unchanged: one profile page per club, 10–15 s apart,
the same account check on import, and the run stops at the first login redirect, challenge or
rate-limit sign. The owner accepted the risk to the signed-in account (Instagram may challenge
or restrict it). This overrides §21's "never logs in or uses a session" for this reader only.

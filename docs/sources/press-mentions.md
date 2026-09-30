# Press mentions (press stage)

- **Command:** `pnpm hci press [--publisher=crimson,independent,hpr] [--club=…] [--limit=N]`. `pnpm hci crimson` runs the Crimson only.
- **The Harvard Crimson** (`thecrimson.com`, tier 6):
  - **robots.txt:** allows everything (checked 2026-09-30).
  - **Candidates:** Brave `site:thecrimson.com "<name>"`, replayed for 90 days. The site's own search is JavaScript-only.
  - **Dates:** from the article URL (`/article/YYYY/M/D/`).
- **The Harvard Independent** (`harvardindependent.com`, tier 7): robots allows everything except wp-admin and uploads. Candidates come from `/wp-json/wp/v2/search`, and dates from JSON-LD.
- **Harvard Political Review** (`harvardpolitics.com`, now served from `theharvardpoliticalreview.com`, tier 7): robots allows everything. Candidates come from WordPress search, and dates from JSON-LD.
- **Acceptance:** the fetched article text must contain the club's full name. Names must have 2+ words with something distinctive, and names containing "Crimson" are skipped.
- **Stored:** headline, date, publisher and link. Evidence quotes redact students named with class years.
- **Reviewed:** 2026-09-30.

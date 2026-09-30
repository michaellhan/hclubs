# Fixture: Harvard Hillel — Student Groups and Initiatives

- URL: https://hillel.harvard.edu/jewish-life/student-groups-initiatives/ (HTTP 200, public WordPress page). The old `/jewish-life/student-groups/` returns a 301 to this URL.
- Fetch date: 2026-09-30
- User-Agent: `ClubIndexBot/0.1`. A generic browser user agent got a Cloudflare 403; the honest crawler user agent is served normally.
- Post-processing: `<script>`, `<style>` and inline `<svg>` blocks were stripped, and runs of 3 or more spaces/tabs were collapsed to one space.
- robots.txt: `User-agent: *` with an empty `Disallow:`, and **Crawl-delay: 10** (honored by the fetcher).

## Selectors

- One modal per group: `h2.mb-1` gives the name (14 groups). The container is the closest `.container`.
- `h4` "Contact: <student name>" is an individual student. **It is never stored**, and neither are the `mailto:` links.
- Description: the first `p` in the modal that is not `.group-social`.
- Links: `p.group-social a[href]`, which holds the group's website, Instagram, LinkedIn and YouTube.

# Fixture: Harvard Innovation Labs — Innovation Resource Hub filtered to Student Club/Group

- URL: https://innovationlabs.harvard.edu/resources/hub?externalResourceType=student-group (HTTP 200, public, server-rendered Craft CMS)
- Fetch date: 2026-09-30
- User-Agent: `HarvardClubIndexBot/0.2 (+https://github.com/michaellhan/harvardclubindex; michael.l.han@gmail.com)`
- Post-processing: `<script>`, `<style>` and inline `<svg>` blocks were stripped, and runs of 3 or more spaces/tabs were collapsed to one space. Nothing else was changed.
- robots.txt (saved): `User-agent: *` disallows /cpresources/, /vendor/, /.env, /cache/ only.

## Selectors
- Entry: `ul.ventures-landing__grid > li.resource-cards__card-wrapper` (19 entries; no pagination)
- Name: `h3.resource-cards__title`
- Link: `a.resource-cards__card[href]` (external; href is unquoted in the source)
- Description: `p.resource-cards__desc`
- Category: `p.resource-cards__category` (all "Student Club/Group")
- Covers all Harvard schools (HBS, HKS, HLS, GSAS clubs + ~7 College clubs). School filter exists as `?school=harvard-college` (not fetched).

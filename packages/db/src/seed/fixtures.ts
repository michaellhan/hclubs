import { newYorkDateParts, termForDate, termKey, type AssertionKind, type FieldKey, type SourceType } from "@hci/core";
import type { Db } from "../client";
import { resolveClubs } from "../resolve/project";
import { finishRun, startRun } from "../write/runs";
import { upsertClaim } from "../write/claims";
import { createClub, ensureRecruitingCycle } from "../write/clubs";
import { upsertSource } from "../write/sources";
import { eq } from "drizzle-orm";
import { club } from "../schema";

/**
 * DEVELOPMENT FIXTURES — FICTIONAL ORGANIZATIONS.
 *
 * Every club below is invented. Names are deliberately fictional; slugs are prefixed
 * `fixture-`; rows carry data_origin = 'fixture'; sources live on the reserved `.invalid`
 * TLD and are flagged is_fixture. The UI labels all of it "Demo data". Numbers here
 * (member counts, applicant counts) are fictional and exist only to exercise the UI.
 *
 * Fixtures are loaded through the real claims → resolver path so they exercise
 * provenance, badges, conflicts, staleness and cycle status exactly like ingested data.
 * Dates are relative to the seed time so "recruiting now" stays populated.
 */

type SourceKey = "website" | "harvard" | "social" | "recruiting" | "crimson" | "student";

const SOURCE_TYPES: Record<SourceKey, { type: SourceType; title: string; url: (slug: string) => string }> = {
  website: { type: "club_website", title: "Club website (demo)", url: (s) => `https://${s}.fixture.invalid/` },
  harvard: {
    type: "harvard_official",
    title: "Harvard directory listing (demo)",
    url: (s) => `https://directory.fixture.invalid/orgs/${s}`,
  },
  social: { type: "club_social", title: "Club Instagram (demo)", url: (s) => `https://social.fixture.invalid/${s}` },
  recruiting: {
    type: "club_recruiting_material",
    title: "Recruiting page (demo)",
    url: (s) => `https://${s}.fixture.invalid/apply`,
  },
  crimson: { type: "harvard_crimson", title: "News article (demo)", url: (s) => `https://news.fixture.invalid/${s}` },
  student: {
    type: "student_submission",
    title: "Student submission (demo)",
    url: (s) => `https://submissions.fixture.invalid/${s}`,
  },
};

interface Fact {
  field: FieldKey;
  value: unknown;
  from?: SourceKey;
  kind?: AssertionKind;
  /** Observation age in days (default 3). */
  age?: number;
  /** Days ago the source says the value applied. */
  asOfAge?: number;
}

interface CycleFixture {
  /** Offset in terms from the current term (0 = current, -1 = previous). */
  termOffset: number;
  facts: Fact[];
}

interface FixtureClub {
  slug: string; // without the fixture- prefix
  name: string;
  facts: Fact[];
  cycles?: CycleFixture[];
}

const DAY = 86_400_000;

/** Date-only value `offset` days from now, in campus time. */
function day(now: Date, offset: number, label?: string) {
  const p = newYorkDateParts(new Date(now.getTime() + offset * DAY));
  const at = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return label ? { at, precision: "date" as const, label } : { at, precision: "date" as const };
}

/** Academic term `offset` spring/fall terms away from the current one (summer is skipped). */
function shiftTerm(now: Date, offset: number): string {
  const t = termForDate(now);
  const index = t.year * 2 + (t.season === "fall" ? 1 : 0) + offset;
  return termKey({ year: Math.floor(index / 2), season: index % 2 === 1 ? "fall" : "spring" });
}

const link = (kind: string, url: string, from: SourceKey = "website"): Fact => ({
  field: "club.link",
  value: { kind, url },
  from,
});

export function buildFixtures(now: Date): FixtureClub[] {
  const d = (offset: number, label?: string) => day(now, offset, label);
  return [
    {
      slug: "northyard-consulting-group",
      name: "Northyard Consulting Group",
      facts: [
        { field: "club.acronym", value: "NCG" },
        {
          field: "club.short_description",
          value: "Student-run pro bono consulting for Boston-area nonprofits and startups.",
        },
        {
          field: "club.long_description",
          value:
            "Members work in small teams on semester-long engagements with nonprofit and early-stage clients. New members complete a training program covering problem structuring, market sizing, and client communication before staffing on a project.",
        },
        { field: "club.category", value: "consulting" },
        { field: "club.org_type", value: "student_organization", kind: "inferred" },
        { field: "club.recognition_status", value: "recognized", from: "harvard" },
        { field: "club.activity_status", value: "active", from: "social" },
        { field: "club.affiliation_scope", value: "harvard_college", from: "harvard" },
        { field: "club.join_mode", value: "application" },
        { field: "club.freshmen_eligible", value: true, from: "recruiting" },
        { field: "club.hours_per_week", value: { min: 5, max: 8, qualifier: "member" } },
        { field: "club.member_count", value: { kind: "range", min: 40, max: 60 }, from: "harvard", asOfAge: 400 },
        { field: "club.member_count", value: { kind: "exact", count: 55 }, from: "website", asOfAge: 20 },
        { field: "club.tag", value: "pro bono" },
        link("website", "https://northyard-consulting-group.fixture.invalid/"),
        link("instagram", "https://instagram.fixture.invalid/fixture-northyardconsulting"),
        link("linkedin", "https://linkedin.fixture.invalid/fixture-northyard-consulting"),
      ],
      cycles: [
        {
          termOffset: 0,
          facts: [
            { field: "cycle.opens_at", value: d(-7), from: "recruiting" },
            { field: "cycle.deadline", value: d(6, "Written application due"), from: "recruiting" },
            { field: "cycle.process_type", value: "application", from: "recruiting" },
            {
              field: "cycle.stages",
              value: [
                { order: 1, kind: "info_session", startsAt: d(-5) },
                { order: 2, kind: "written_application", endsAt: d(6) },
                { order: 3, kind: "coffee_chat" },
                { order: 4, kind: "case_interview" },
                { order: 5, kind: "final_round" },
              ],
              from: "recruiting",
            },
            {
              field: "cycle.application_url",
              value: "https://northyard-consulting-group.fixture.invalid/apply",
              from: "recruiting",
            },
          ],
        },
        {
          termOffset: -2,
          facts: [
            { field: "cycle.applicants", value: 120, from: "crimson", age: 330 },
            { field: "cycle.admits", value: 18, from: "crimson", age: 330 },
          ],
        },
      ],
    },
    {
      slug: "quincy-street-investment-fund",
      name: "Quincy Street Investment Fund",
      facts: [
        { field: "club.acronym", value: "QSIF" },
        {
          field: "club.short_description",
          value: "Undergraduate-managed paper portfolio with sector teams and weekly stock pitches.",
        },
        { field: "club.category", value: "finance" },
        { field: "club.org_type", value: "student_organization" },
        { field: "club.recognition_status", value: "recognized", from: "harvard" },
        { field: "club.activity_status", value: "active" },
        { field: "club.join_mode", value: "comp" },
        { field: "club.freshmen_eligible", value: true },
        { field: "club.hours_per_week", value: { min: 6, max: 10, qualifier: "comp_period" }, from: "recruiting" },
        { field: "club.meeting_frequency", value: "Weekly general meeting plus sector team meetings" },
        link("website", "https://quincy-street-investment-fund.fixture.invalid/"),
        link("instagram", "https://instagram.fixture.invalid/fixture-qsif"),
      ],
      cycles: [
        {
          termOffset: 0,
          facts: [
            { field: "cycle.opens_at", value: d(-3), from: "recruiting" },
            { field: "cycle.deadline", value: d(14, "Comp sign-up closes"), from: "recruiting" },
            { field: "cycle.process_type", value: "comp", from: "recruiting" },
            {
              field: "cycle.stages",
              value: [
                { order: 1, kind: "info_session" },
                { order: 2, kind: "comp_period", label: "Six-week stock-pitch comp" },
                { order: 3, kind: "interview" },
              ],
              from: "recruiting",
            },
          ],
        },
      ],
    },
    {
      slug: "oxbow-software-collective",
      name: "Oxbow Software Collective",
      facts: [
        { field: "club.acronym", value: "OSC" },
        {
          field: "club.short_description",
          value: "Builds software for campus organizations and local nonprofits in product teams.",
        },
        { field: "club.category", value: "technology" },
        { field: "club.category", value: "entrepreneurship", kind: "inferred" },
        { field: "club.org_type", value: "student_organization" },
        { field: "club.recognition_status", value: "recognized", from: "harvard" },
        { field: "club.activity_status", value: "active" },
        { field: "club.join_mode", value: "application" },
        {
          field: "club.experience_required",
          value: "Some programming experience expected; no specific languages required.",
        },
        link("website", "https://oxbow-software-collective.fixture.invalid/"),
        link("github", "https://github.fixture.invalid/fixture-oxbow-software"),
      ],
      cycles: [
        {
          termOffset: 0,
          facts: [
            { field: "cycle.opens_at", value: d(12), from: "social" },
            { field: "cycle.deadline", value: d(26), from: "social" },
            { field: "cycle.process_type", value: "application", from: "social" },
            {
              field: "cycle.stages",
              value: [
                { order: 1, kind: "written_application" },
                { order: 2, kind: "technical_interview" },
              ],
              from: "social",
            },
          ],
        },
      ],
    },
    {
      slug: "undergraduate-fintech-circle",
      name: "Undergraduate Fintech Circle",
      facts: [
        {
          field: "club.short_description",
          value: "Speaker events and reading groups on payments, crypto, and financial infrastructure.",
        },
        { field: "club.category", value: "finance" },
        { field: "club.category", value: "technology" },
        { field: "club.org_type", value: "student_organization" },
        { field: "club.recognition_status", value: "not_recognized", from: "harvard" },
        { field: "club.activity_status", value: "likely_active", from: "social", age: 60 },
        { field: "club.join_mode", value: "open" },
        { field: "club.freshmen_eligible", value: true },
        { field: "club.dues", value: { hasDues: false } },
        link("mailing_list", "https://lists.fixture.invalid/fintech-circle"),
        link("instagram", "https://instagram.fixture.invalid/fixture-fintechcircle", "social"),
      ],
    },
    {
      slug: "riverbend-pre-law-society",
      name: "Riverbend Pre-Law Society",
      facts: [
        {
          field: "club.short_description",
          value: "LSAT study groups, law school admissions panels, and courtroom visits.",
        },
        { field: "club.category", value: "law" },
        { field: "club.org_type", value: "student_organization" },
        { field: "club.recognition_status", value: "recognized", from: "harvard" },
        { field: "club.activity_status", value: "active" },
        { field: "club.join_mode", value: "open" },
        { field: "club.freshmen_eligible", value: true },
        { field: "club.hours_per_week", value: { min: 1, max: 2 } },
        link("website", "https://riverbend-pre-law-society.fixture.invalid/"),
        link("mailing_list", "https://lists.fixture.invalid/prelaw"),
      ],
    },
    {
      slug: "andean-heritage-society",
      name: "Andean Heritage Society",
      facts: [
        {
          field: "club.short_description",
          value: "Community, food, music, and language exchange celebrating Andean cultures.",
        },
        {
          field: "club.long_description",
          value:
            "Open to everyone interested in the cultures of the Andes. Hosts a fall festival, weekly language tables, and a spring showcase with folk dance and music.",
        },
        { field: "club.category", value: "cultural-identity" },
        { field: "club.org_type", value: "student_organization" },
        { field: "club.recognition_status", value: "recognized", from: "harvard" },
        { field: "club.activity_status", value: "active", from: "social" },
        { field: "club.join_mode", value: "open" },
        { field: "club.freshmen_eligible", value: true },
        { field: "club.meeting_frequency", value: "Biweekly" },
        { field: "club.alias", value: { name: "AHS", kind: "abbreviation" } },
        link("instagram", "https://instagram.fixture.invalid/fixture-andeanheritage"),
        link("link_in_bio", "https://link-in-bio.fixture.invalid/fixture-andean"),
      ],
    },
    {
      slug: "the-mossy-notes",
      name: "The Mossy Notes",
      facts: [
        { field: "club.short_description", value: "Co-ed a cappella group performing pop and folk arrangements." },
        { field: "club.category", value: "a-cappella" },
        { field: "club.org_type", value: "performing_arts_group" },
        { field: "club.recognition_status", value: "recognized", from: "harvard" },
        { field: "club.activity_status", value: "active" },
        { field: "club.join_mode", value: "audition" },
        { field: "club.freshmen_eligible", value: true },
        { field: "club.hours_per_week", value: { min: 4, max: 6 } },
        {
          field: "club.member_count",
          value: { kind: "range", min: 12, max: 18 },
          from: "student",
          kind: "user_reported",
        },
        link("youtube", "https://youtube.fixture.invalid/fixture-mossynotes"),
        link("instagram", "https://instagram.fixture.invalid/fixture-mossynotes"),
      ],
      cycles: [
        {
          termOffset: 0,
          facts: [
            { field: "cycle.opens_at", value: d(-21), from: "social" },
            { field: "cycle.deadline", value: d(-9, "Auditions ended"), from: "social" },
            { field: "cycle.process_type", value: "audition", from: "social" },
            {
              field: "cycle.stages",
              value: [
                { order: 1, kind: "audition" },
                { order: 2, kind: "final_round", label: "Callbacks" },
              ],
              from: "social",
            },
          ],
        },
      ],
    },
    {
      slug: "stepline-dance-company",
      name: "Stepline Dance Company",
      facts: [
        {
          field: "club.short_description",
          value: "Contemporary and hip-hop dance company with two main-stage shows a year.",
        },
        { field: "club.category", value: "dance" },
        { field: "club.org_type", value: "performing_arts_group" },
        { field: "club.recognition_status", value: "recognized", from: "harvard" },
        { field: "club.activity_status", value: "active" },
        { field: "club.join_mode", value: "audition" },
        { field: "club.hours_per_week", value: { min: 6, max: 9 } },
        link("instagram", "https://instagram.fixture.invalid/fixture-stepline"),
      ],
      cycles: [
        {
          termOffset: 0,
          facts: [
            { field: "cycle.stated_status", value: "open", from: "social" },
            { field: "cycle.process_type", value: "audition", from: "social" },
          ],
        },
      ],
    },
    {
      slug: "blackbox-players",
      name: "Blackbox Players",
      facts: [
        {
          field: "club.short_description",
          value: "Student theater troupe producing experimental plays in a black-box space.",
        },
        { field: "club.category", value: "theater" },
        { field: "club.org_type", value: "performing_arts_group" },
        { field: "club.recognition_status", value: "recognized", from: "harvard" },
        { field: "club.activity_status", value: "active" },
        { field: "club.join_mode", value: "open" },
        { field: "club.join_mode", value: "audition" },
        {
          field: "club.eligibility_note",
          value: "Crew positions are open to all; acting roles are cast by audition per show.",
        },
        { field: "club.freshmen_eligible", value: true },
        link("website", "https://blackbox-players.fixture.invalid/"),
      ],
    },
    {
      slug: "the-quad-review",
      name: "The Quad Review",
      facts: [
        {
          field: "club.short_description",
          value: "Literary magazine publishing student fiction, poetry, and criticism each semester.",
        },
        { field: "club.category", value: "publications-media" },
        { field: "club.org_type", value: "publication" },
        { field: "club.recognition_status", value: "recognized", from: "harvard" },
        { field: "club.activity_status", value: "active" },
        { field: "club.join_mode", value: "comp" },
        { field: "club.freshmen_eligible", value: true },
        { field: "club.hours_per_week", value: { min: 3, max: 5, qualifier: "comp_period" } },
        { field: "club.alias", value: { name: "Quad Review", kind: "alternate" } },
        link("website", "https://the-quad-review.fixture.invalid/"),
        link("newsletter", "https://newsletter.fixture.invalid/quadreview-substack-com"),
      ],
      cycles: [
        {
          termOffset: 0,
          facts: [
            { field: "cycle.opens_at", value: d(-10), from: "website" },
            { field: "cycle.deadline", value: d(3, "Comp sign-up"), from: "website" },
            { field: "cycle.process_type", value: "comp", from: "website" },
            {
              field: "cycle.stages",
              value: [
                { order: 1, kind: "info_session" },
                { order: 2, kind: "comp_period", label: "Four-week editing comp" },
              ],
              from: "website",
            },
          ],
        },
      ],
    },
    {
      slug: "beacon-street-tutors",
      name: "Beacon Street Tutors",
      facts: [
        {
          field: "club.short_description",
          value: "Weekly after-school tutoring for middle-school students in partner schools.",
        },
        { field: "club.category", value: "mentoring-education" },
        { field: "club.org_type", value: "public_service_program" },
        { field: "club.recognition_status", value: "recognized", from: "harvard" },
        { field: "club.activity_status", value: "active" },
        { field: "club.join_mode", value: "application" },
        { field: "club.freshmen_eligible", value: true },
        { field: "club.hours_per_week", value: { min: 3, max: 4 } },
        { field: "club.eligibility_note", value: "Background check required before placement." },
        link("website", "https://beacon-street-tutors.fixture.invalid/"),
        link("application_form", "https://application-form.fixture.invalid/fixturebeacontutors"),
      ],
      cycles: [
        {
          termOffset: 0,
          facts: [
            { field: "cycle.stated_status", value: "open", from: "recruiting" },
            { field: "cycle.deadline", value: d(20, "Rolling; final deadline"), from: "recruiting" },
            { field: "cycle.process_type", value: "application", from: "recruiting" },
          ],
        },
      ],
    },
    {
      slug: "fieldhouse-ultimate",
      name: "Fieldhouse Ultimate",
      facts: [
        {
          field: "club.short_description",
          value: "Club ultimate frisbee team competing in the regional college series.",
        },
        { field: "club.category", value: "athletics-recreation" },
        { field: "club.org_type", value: "club_sport" },
        { field: "club.recognition_status", value: "recognized", from: "harvard" },
        { field: "club.activity_status", value: "active" },
        { field: "club.join_mode", value: "tryout" },
        { field: "club.freshmen_eligible", value: true },
        { field: "club.hours_per_week", value: { min: 8, max: 12 } },
        {
          field: "club.dues",
          value: { hasDues: true, amountUsd: 150, note: "Covers tournament travel; financial aid available." },
        },
        link("instagram", "https://instagram.fixture.invalid/fixture-fieldhouseultimate"),
      ],
      cycles: [
        {
          termOffset: 0,
          facts: [
            { field: "cycle.opens_at", value: d(-2), from: "social" },
            { field: "cycle.deadline", value: d(4, "Final tryout"), from: "social" },
            { field: "cycle.process_type", value: "tryout", from: "social" },
          ],
        },
      ],
    },
    {
      slug: "parliamentary-debate-union",
      name: "Parliamentary Debate Union",
      facts: [
        { field: "club.acronym", value: "PDU" },
        {
          field: "club.short_description",
          value: "Competitive parliamentary debate with weekly practice rounds and national tournaments.",
        },
        { field: "club.category", value: "competition-teams" },
        { field: "club.org_type", value: "competition_team" },
        { field: "club.recognition_status", value: "recognized", from: "harvard" },
        { field: "club.activity_status", value: "active" },
        { field: "club.join_mode", value: "attendance_based" },
        {
          field: "club.eligibility_note",
          value: "Anyone may practice; tournament travel slots depend on practice attendance.",
        },
        { field: "club.freshmen_eligible", value: true },
        { field: "club.hours_per_week", value: { min: 4, max: 15 } },
        link("website", "https://parliamentary-debate-union.fixture.invalid/"),
      ],
    },
    {
      slug: "ironbark-robotics",
      name: "Ironbark Robotics",
      facts: [
        {
          field: "club.short_description",
          value: "Designs and builds autonomous robots for intercollegiate competitions.",
        },
        { field: "club.category", value: "competition-teams" },
        { field: "club.category", value: "academic-stem" },
        { field: "club.org_type", value: "competition_team" },
        { field: "club.recognition_status", value: "recognized", from: "harvard" },
        { field: "club.activity_status", value: "active" },
        { field: "club.join_mode", value: "application" },
        { field: "club.hours_per_week", value: { min: 10, max: 15 }, from: "student", kind: "user_reported" },
        { field: "club.hours_per_week", value: { min: 6, max: 8 }, from: "website", age: 500 },
        link("website", "https://ironbark-robotics.fixture.invalid/"),
        link("github", "https://github.fixture.invalid/fixture-ironbark"),
      ],
      cycles: [
        {
          termOffset: 0,
          facts: [
            { field: "cycle.deadline", value: d(9), from: "website" },
            { field: "cycle.process_type", value: "application", from: "website" },
          ],
        },
      ],
    },
    {
      slug: "midnight-chess-circle",
      name: "Midnight Chess Circle",
      facts: [
        { field: "club.short_description", value: "Casual late-night chess, blitz tournaments, and puzzle nights." },
        { field: "club.category", value: "hobbies-games" },
        { field: "club.join_mode", value: "open" },
      ],
    },
    {
      slug: "civic-futures-forum",
      name: "Civic Futures Forum",
      facts: [
        {
          field: "club.short_description",
          value: "Nonpartisan discussion series on local government, housing, and transit policy.",
        },
        { field: "club.category", value: "political-advocacy" },
        { field: "club.org_type", value: "student_organization" },
        { field: "club.recognition_status", value: "recognized", from: "harvard" },
        { field: "club.activity_status", value: "active" },
        { field: "club.join_mode", value: "open" },
        { field: "club.freshmen_eligible", value: true },
        link("website", "https://civic-futures-forum.fixture.invalid/"),
      ],
    },
    {
      slug: "interfaith-dialogue-circle",
      name: "Interfaith Dialogue Circle",
      facts: [
        {
          field: "club.short_description",
          value: "Monthly dinners and conversations among students of many faiths and none.",
        },
        { field: "club.category", value: "religious-spiritual" },
        { field: "club.org_type", value: "student_organization" },
        { field: "club.recognition_status", value: "recognized", from: "harvard" },
        { field: "club.activity_status", value: "active" },
        { field: "club.join_mode", value: "open" },
        { field: "club.freshmen_eligible", value: true },
        { field: "club.meeting_frequency", value: "Monthly" },
      ],
    },
    {
      slug: "premed-mentorship-network",
      name: "Pre-Med Mentorship Network",
      facts: [
        { field: "club.short_description", value: "Pairs first- and second-years with upperclass pre-med mentors." },
        { field: "club.category", value: "medicine-health" },
        { field: "club.org_type", value: "student_organization" },
        { field: "club.recognition_status", value: "recognized", from: "harvard" },
        { field: "club.join_mode", value: "application" },
        { field: "club.eligibility_note", value: "Mentee applications are open to first- and second-years only." },
        { field: "club.freshmen_eligible", value: true },
      ],
    },
    {
      slug: "startup-studio",
      name: "Startup Studio",
      facts: [
        {
          field: "club.short_description",
          value: "Founder community with demo days, office hours, and a spring accelerator.",
        },
        { field: "club.category", value: "entrepreneurship" },
        { field: "club.org_type", value: "student_organization" },
        { field: "club.recognition_status", value: "recognized", from: "harvard" },
        { field: "club.activity_status", value: "active" },
        { field: "club.join_mode", value: "open" },
        { field: "club.join_mode", value: "application", from: "social" },
        { field: "club.member_count", value: { kind: "exact", count: 80 }, from: "website", asOfAge: 30 },
        { field: "club.member_count", value: { kind: "exact", count: 140 }, from: "social", asOfAge: 25 },
        link("website", "https://startup-studio.fixture.invalid/"),
      ],
    },
    {
      slug: "vintage-radio-society",
      name: "Vintage Radio Society",
      facts: [
        { field: "club.short_description", value: "Restores antique radios and hosts listening sessions." },
        { field: "club.category", value: "hobbies-games" },
        { field: "club.org_type", value: "student_organization", age: 900 },
        { field: "club.recognition_status", value: "formerly_recognized", from: "harvard", age: 400 },
        { field: "club.activity_status", value: "possibly_dormant", from: "harvard", age: 400 },
        { field: "club.join_mode", value: "open", age: 900 },
      ],
    },
    {
      slug: "evening-supper-society",
      name: "Evening Supper Society",
      facts: [
        { field: "club.short_description", value: "Invitation-based social dining society." },
        { field: "club.category", value: "social" },
        { field: "club.org_type", value: "social_organization" },
        { field: "club.recognition_status", value: "not_recognized", from: "crimson" },
        { field: "club.activity_status", value: "likely_active", from: "crimson", age: 120 },
        { field: "club.join_mode", value: "invite_only", from: "crimson" },
      ],
    },
  ];
}

export const FIXTURE_EXTRACTOR = { name: "fixture-seed", version: "1" } as const;

/**
 * Seed fixtures idempotently: clubs are matched by slug; claims/evidence are upserted.
 * Returns the number of clubs.
 */
export async function seedFixtures(db: Db, now: Date = new Date()): Promise<{ clubs: number; claims: number }> {
  const runId = await startRun(db, { job: "seed", adapter: "fixtures", adapterVersion: FIXTURE_EXTRACTOR.version });
  let claims = 0;
  const clubIds: string[] = [];
  try {
    for (const f of buildFixtures(now)) {
      const slug = `fixture-${f.slug}`;
      const [existing] = await db.select({ id: club.id }).from(club).where(eq(club.slug, slug));
      const clubId = existing?.id ?? (await createClub(db, { name: f.name, slug, dataOrigin: "fixture" })).id;
      clubIds.push(clubId);

      const sourceIds = new Map<SourceKey, string>();
      const sourceFor = async (key: SourceKey) => {
        const cached = sourceIds.get(key);
        if (cached) return cached;
        const spec = SOURCE_TYPES[key];
        const id = await upsertSource(db, {
          url: spec.url(f.slug),
          sourceType: spec.type,
          title: spec.title,
          adapter: "fixtures",
          isFixture: true,
          ownerClubId: ["website", "social", "recruiting"].includes(key) ? clubId : null,
        });
        sourceIds.set(key, id);
        return id;
      };

      const write = async (fact: Fact, cycleId: string | null, term: string | null) => {
        const key = fact.from ?? "website";
        const kind = fact.kind ?? (key === "student" ? "user_reported" : "stated");
        await upsertClaim(
          db,
          {
            clubId,
            recruitingCycleId: cycleId,
            fieldKey: fact.field,
            value: fact.value,
            assertionKind: kind,
            termKey: term,
            asOfDate: fact.asOfAge !== undefined ? new Date(now.getTime() - fact.asOfAge * DAY) : null,
          },
          {
            sourceId: await sourceFor(key),
            sourceType: SOURCE_TYPES[key].type,
            snapshotId: null,
            ingestionRunId: runId,
            observedAt: new Date(now.getTime() - (fact.age ?? 3) * DAY),
            extractionMethod: "fixture",
            extractorName: FIXTURE_EXTRACTOR.name,
            extractorVersion: FIXTURE_EXTRACTOR.version,
            isDirect: kind !== "inferred",
          },
        );
        claims++;
      };

      await write({ field: "club.name", value: f.name }, null, null);
      for (const fact of f.facts) await write(fact, null, null);
      for (const c of f.cycles ?? []) {
        const term = shiftTerm(now, c.termOffset);
        const cycleId = await ensureRecruitingCycle(db, { clubId, termKey: term });
        for (const fact of c.facts) await write(fact, cycleId, term);
      }
    }
    const stats = await resolveClubs(db, { clubIds, now });
    await finishRun(db, runId, {
      status: stats.failed > 0 ? "partial" : "succeeded",
      counters: { clubs: clubIds.length, claims, resolved: stats.clubs, resolveFailed: stats.failed },
      errorSummary: stats.errors.map((e) => `${e.clubId}: ${e.error}`).join("\n") || null,
    });
  } catch (error) {
    await finishRun(db, runId, { status: "failed", counters: { claims }, errorSummary: String(error) });
    throw error;
  }
  return { clubs: clubIds.length, claims };
}

/**
 * Enumerations as plain constants, labels and union types: no Zod, so the browser bundle
 * can import them (launch audit). The Zod schemas of the same names live in enums.ts.
 */

/**
 * Vocabularies shared by the database, pipeline, and UI.
 *
 * Taxonomy-like vocabularies (source types, link kinds, org types, …) are stored as
 * `text` in Postgres and validated here, so extending them is a code change rather
 * than an enum migration. Closed lifecycle states live as Postgres enums in @hci/db.
 */

export const SOURCE_TYPES = [
  "harvard_official",
  "club_website",
  "club_social",
  "club_recruiting_material",
  "club_publication",
  "harvard_crimson",
  "harvard_related_other",
  "public_web",
  "student_submission",
  "editorial",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Default trust tier per source type (1 = most trusted). See CLAUDE.md §7.1. */
export const SOURCE_TYPE_TIER: Record<SourceType, number> = {
  harvard_official: 1,
  club_website: 2,
  club_social: 3,
  club_recruiting_material: 4,
  club_publication: 5,
  harvard_crimson: 6,
  harvard_related_other: 7,
  public_web: 8,
  student_submission: 9,
  // Editorial decisions bypass tiering in the resolver; the tier is only used for sorting.
  editorial: 0,
};

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  harvard_official: "Official Harvard source",
  club_website: "Club website",
  club_social: "Club social account",
  club_recruiting_material: "Club recruiting material",
  club_publication: "Club publication",
  harvard_crimson: "The Harvard Crimson",
  harvard_related_other: "Harvard-related source",
  public_web: "Public web",
  student_submission: "Student submission",
  editorial: "Editorial",
};

export const LINK_KINDS = [
  "website",
  "instagram",
  "linkedin",
  "facebook",
  "x",
  "youtube",
  "tiktok",
  "github",
  "discord",
  "link_in_bio",
  "mailing_list",
  "newsletter",
  "application_page",
  "application_form",
  "harvard_directory",
  "email",
  "other",
] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const LINK_KIND_LABEL: Record<LinkKind, string> = {
  website: "Website",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  x: "X / Twitter",
  youtube: "YouTube",
  tiktok: "TikTok",
  github: "GitHub",
  discord: "Discord",
  link_in_bio: "Link in bio",
  mailing_list: "Mailing list",
  newsletter: "Newsletter",
  application_page: "Application page",
  application_form: "Application form",
  harvard_directory: "Harvard directory",
  email: "Email",
  other: "Link",
};

/** Whether a link is established as the club's own, or merely a candidate. CLAUDE.md §7.1. */
/** Mirrors the club_link_status check constraint (ADR 0017). */
export const LINK_STATUSES = ["verified", "probable", "unverified", "rejected"] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

export const ORG_TYPES = [
  "student_organization",
  "club_sport",
  "publication",
  "performing_arts_group",
  "competition_team",
  "social_organization",
  "public_service_program",
  "governance_body",
  "academic_society",
  "other",
] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export const ORG_TYPE_LABEL: Record<OrgType, string> = {
  student_organization: "Student organization",
  club_sport: "Club sport",
  publication: "Publication",
  performing_arts_group: "Performing arts group",
  competition_team: "Competition team",
  social_organization: "Social organization",
  public_service_program: "Public service program",
  governance_body: "Governance body",
  academic_society: "Academic society",
  other: "Other",
};

export const RECOGNITION_STATUSES = ["recognized", "not_recognized", "formerly_recognized", "unknown"] as const;
export type RecognitionStatus = (typeof RECOGNITION_STATUSES)[number];

export const RECOGNITION_STATUS_LABEL: Record<RecognitionStatus, string> = {
  recognized: "Recognized",
  not_recognized: "Not recognized",
  formerly_recognized: "Formerly recognized",
  unknown: "Recognition unknown",
};

export const ACTIVITY_STATUSES = [
  "active",
  "likely_active",
  "possibly_dormant",
  "inactive",
  "defunct",
  "unknown",
] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const ACTIVITY_STATUS_LABEL: Record<ActivityStatus, string> = {
  active: "Active",
  likely_active: "Likely active",
  possibly_dormant: "Possibly dormant",
  inactive: "Inactive",
  defunct: "Defunct",
  unknown: "Activity unknown",
};

export const AFFILIATION_SCOPES = [
  "harvard_college",
  "graduate_school",
  "university_wide",
  "cross_school",
  "harvard_chapter_of_external_org",
  "independent",
  "unknown",
] as const;
export type AffiliationScope = (typeof AFFILIATION_SCOPES)[number];

export const AFFILIATION_SCOPE_LABEL: Record<AffiliationScope, string> = {
  harvard_college: "Harvard College",
  graduate_school: "Graduate school",
  university_wide: "University-wide",
  cross_school: "Cross-school",
  harvard_chapter_of_external_org: "Harvard chapter of an external organization",
  independent: "Independent",
  unknown: "Unknown",
};

/**
 * Harvard schools an organization can belong to (ADR 0038). Only from a source that says
 * so, or from a site the school itself hosts for the group (shown as an estimate).
 */
export const HARVARD_SCHOOLS = [
  "college",
  "gsas",
  "hbs",
  "hls",
  "hms",
  "hsdm",
  "hks",
  "hsph",
  "gsd",
  "hgse",
  "hds",
  "extension",
] as const;
export type HarvardSchool = (typeof HARVARD_SCHOOLS)[number];

export const HARVARD_SCHOOL_LABEL: Record<HarvardSchool, string> = {
  college: "Harvard College",
  gsas: "Graduate School of Arts and Sciences",
  hbs: "Harvard Business School",
  hls: "Harvard Law School",
  hms: "Harvard Medical School",
  hsdm: "Harvard School of Dental Medicine",
  hks: "Harvard Kennedy School",
  hsph: "Harvard Chan School of Public Health",
  gsd: "Graduate School of Design",
  hgse: "Graduate School of Education",
  hds: "Harvard Divinity School",
  extension: "Harvard Extension School",
};

/** How an organization ended (ADR 0038). A rename keeps the same club; this is for endings. */
export const LIFECYCLE_EVENTS = ["dissolved", "replaced"] as const;
export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

export const JOIN_MODES = [
  "open",
  "application",
  "comp",
  "audition",
  "tryout",
  "invite_only",
  "attendance_based",
] as const;
export type JoinMode = (typeof JOIN_MODES)[number];

export const JOIN_MODE_LABEL: Record<JoinMode, string> = {
  open: "Open membership",
  application: "Application",
  comp: "Comp",
  audition: "Audition",
  tryout: "Tryout",
  invite_only: "Invite only",
  attendance_based: "Attendance-based",
};

/**
 * What each way of joining means, for students new to campus vocabulary ("comp"). Shown
 * as help text next to filters and on profiles; says nothing about how selective a club is.
 */
export const JOIN_MODE_HELP: Record<JoinMode, string> = {
  open: "Anyone can join: sign up or come to a meeting.",
  application: "A written application, often followed by interviews.",
  comp: "Doing the club's work for a while to show you can, then you join.",
  audition: "You perform for the group, often with a callback round.",
  tryout: "You try out in practice or a skills session.",
  invite_only: "Members are invited; there's no public application.",
  attendance_based: "You become a member by showing up regularly.",
};

/** Join modes that imply a selection step (does NOT imply any acceptance rate). */
export const SELECTIVE_JOIN_MODES: readonly JoinMode[] = ["application", "comp", "audition", "tryout", "invite_only"];

export const STAGE_KINDS = [
  "info_session",
  "written_application",
  "coffee_chat",
  "interview",
  "case_interview",
  "technical_interview",
  "audition",
  "tryout",
  "comp_period",
  "final_round",
  "other",
] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const STAGE_KIND_LABEL: Record<StageKind, string> = {
  info_session: "Info session",
  written_application: "Written application",
  coffee_chat: "Coffee chat",
  interview: "Interview",
  case_interview: "Case interview",
  technical_interview: "Technical interview",
  audition: "Audition",
  tryout: "Tryout",
  comp_period: "Comp period",
  final_round: "Final round",
  other: "Other",
};

export const ASSERTION_KINDS = ["stated", "inferred", "computed", "user_reported", "editorial"] as const;
export type AssertionKind = (typeof ASSERTION_KINDS)[number];

export const EXTRACTION_METHODS = [
  "structured_data",
  "html_parse",
  "llm",
  "manual",
  "user_submission",
  "fixture",
] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];

/** Single display vocabulary for field provenance. CLAUDE.md §7.4. */
export const BADGES = ["verified", "reported", "community", "computed", "estimate", "unknown"] as const;
export type Badge = (typeof BADGES)[number];

import type {
  ActivityStatus,
  AffiliationScope,
  CycleStatus,
  DateValue,
  JoinMode,
  LinkKind,
  OrgType,
  RecognitionStatus,
  ResolvedValue,
  SelectivityLabel,
  SourceType,
  StageKind,
} from "@hci/core";
import type { StoredField } from "../resolve/project";

/**
 * Display model consumed by the web app. The UI never reads claims directly; everything
 * here comes from resolver projections plus read-time computations (cycle status).
 */

export interface CategoryRef {
  slug: string;
  name: string;
}

export interface CycleSummary {
  id: string;
  termKey: string;
  track: string;
  status: CycleStatus;
  /** Explicitly stated by a source ("applications are closed"); input to the computed status. */
  statedStatus: "open" | "closed" | null;
  opens: DateValue | null;
  deadline: DateValue | null;
  processTypes: JoinMode[];
  applicationUrl: string | null;
  eligibleClasses: string[] | null;
  /** Latest observation of this cycle's facts by a club/official source. */
  lastVerifiedAt: string | null;
}

export interface ClubSummary {
  id: string;
  slug: string;
  name: string;
  acronym: string | null;
  shortDescription: string | null;
  orgType: OrgType | null;
  recognitionStatus: RecognitionStatus;
  activityStatus: ActivityStatus;
  joinModes: JoinMode[];
  freshmenEligible: boolean | null;
  categories: CategoryRef[];
  memberCount: { min: number | null; max: number | null } | null;
  hoursPerWeek: { min: number | null; max: number | null } | null;
  currentCycle: CycleSummary | null;
  isFixture: boolean;
  completeness: number;
  sourceCount: number;
  lastObservedAt: string | null;
  lastVerifiedAt: string | null;
  eligibleClasses: string[] | null;
  affiliationScope: AffiliationScope;
  /** Derived activity assessment confidence (0–1) and its reasons. */
  activityConfidence: number | null;
  activityReasons: string[];
  /** Best website and Instagram URLs (any non-rejected status), for directory rows. */
  quickLinks: { website: string | null; instagram: string | null };
  /** The club's logo image (from its own site), if found. */
  logo: string | null;
  /** News articles that name the club. */
  pressCount: number;
}

export interface LinkDisplay {
  kind: LinkKind;
  url: string;
  handle: string | null;
  label: string | null;
  status: "verified" | "probable" | "unverified";
  confidence: number;
  signals: string[];
  discoveredVia: string[];
  lastObservedAt: string | null;
}

export interface StageDisplay {
  ordinal: number;
  kind: StageKind;
  label: string | null;
  startsAt: DateValue | null;
  endsAt: DateValue | null;
}

export interface CycleDetail extends CycleSummary {
  stages: StageDisplay[];
  applicants: number | null;
  admits: number | null;
  fields: Record<string, StoredField>;
}

export interface SelectivityDisplay {
  termKey: string;
  applicants: ResolvedValue<number>;
  admits: ResolvedValue<number>;
  /** COMPUTED from stated counts. */
  acceptanceRate: number;
  /** DERIVED classification (versioned rule set); null when evidence is insufficient. */
  label: SelectivityLabel | null;
  rulesetVersion: string;
}

export interface MembershipDisplay {
  kind: "exact" | "range";
  count: number | null;
  min: number | null;
  max: number | null;
  asOf: string | null;
  termKey: string | null;
  badge: string;
  isCurrent: boolean;
}

export interface SourceDisplay {
  id: string;
  url: string;
  title: string | null;
  sourceType: SourceType;
  trustTier: number;
  publisher: string | null;
  isFixture: boolean;
  claimCount: number;
  lastObservedAt: string;
}

export interface ClubProfile extends ClubSummary {
  longDescription: string | null;
  aliases: { alias: string; kind: string }[];
  links: LinkDisplay[];
  cycles: CycleDetail[];
  membership: MembershipDisplay[];
  selectivity: SelectivityDisplay | null;
  sources: SourceDisplay[];
  fields: Record<string, StoredField>;
  conflictFields: string[];
  resolvedAt: string | null;
}

export type ProfileLookup =
  { kind: "found"; profile: ClubProfile } | { kind: "redirect"; slug: string } | { kind: "not_found" };

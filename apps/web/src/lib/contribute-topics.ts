import type { ContributionType } from "@hci/core";

/** Facts a student can add when the page lacks them, most useful first. */
export const ADDABLE: ContributionType[] = [
  "joining_process",
  "deadline",
  "website",
  "time_commitment",
  "member_count",
  "dues",
  "eligibility",
  "application_link",
  "instagram",
];

/** Corrections and changes, offered on every profile. */
export const FIXES: ContributionType[] = [
  "incorrect_info",
  "website",
  "instagram",
  "inactive",
  "renamed",
  "duplicate",
  "club_manager",
  "other",
];

/**
 * What "Help improve this page" offers: the `max` most valuable missing topics up front,
 * everything else (more topics, corrections) behind "More options". A link the page lacks
 * is offered once, as an addition. PURE.
 */
export function planContributions(
  missing: readonly ContributionType[],
  max = 3,
): { primary: ContributionType[]; moreAdds: ContributionType[]; fixes: ContributionType[] } {
  const gaps = new Set(missing);
  const adds = ADDABLE.filter((t) => gaps.has(t));
  return {
    primary: adds.slice(0, max),
    moreAdds: adds.slice(max),
    fixes: FIXES.filter((t) => !gaps.has(t)),
  };
}

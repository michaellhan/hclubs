import type { ContributionType } from "@hci/core";

/** Facts a student can add or update, most useful first. */
export const ADDABLE: ContributionType[] = [
  "joining_process",
  "deadline",
  "application_link",
  "time_commitment",
  "eligibility",
  "dues",
  "member_count",
  "website",
  "instagram",
  "missing_info",
];

/** Corrections and changes, offered on every profile. */
export const FIXES: ContributionType[] = ["incorrect_info", "inactive", "renamed", "duplicate", "other"];

/** Short chip names; every type the profile offers has one. */
export const TOPIC_LABEL: Partial<Record<ContributionType, string>> = {
  joining_process: "How to join",
  deadline: "Recruiting deadline",
  application_link: "Application link",
  time_commitment: "Time commitment",
  eligibility: "Who can join",
  dues: "Dues",
  member_count: "Member count",
  website: "Website",
  instagram: "Instagram",
  missing_info: "What the club does",
  incorrect_info: "Something is wrong",
  inactive: "Club seems inactive",
  renamed: "Club was renamed",
  duplicate: "Listed twice",
  other: "Something else",
};

/**
 * What "Help improve this page" offers: every topic of the form. Additions the page lacks
 * come first and are marked missing; the rest follow in priority order. PURE.
 */
export function planContributions(missing: readonly ContributionType[]): {
  add: { type: ContributionType; missing: boolean }[];
  fixes: ContributionType[];
} {
  const gaps = new Set(missing);
  return {
    add: [
      ...ADDABLE.filter((t) => gaps.has(t)).map((type) => ({ type, missing: true })),
      ...ADDABLE.filter((t) => !gaps.has(t)).map((type) => ({ type, missing: false })),
    ],
    fixes: FIXES,
  };
}

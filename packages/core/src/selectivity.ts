/**
 * Competitiveness. CLAUDE.md §9. Highest-risk logic in the product.
 *
 *  - acceptance rate is COMPUTED only from stated applicant + admit counts
 *  - the qualitative label is a DERIVED classification from a versioned rule set
 *  - with insufficient evidence both are null -> UI shows "Unknown"
 */
export const SELECTIVITY_RULESET_VERSION = "selectivity-v1";

export type SelectivityLabel = "highly_selective" | "selective" | "moderately_selective" | "broadly_open";

export const SELECTIVITY_LABEL: Record<SelectivityLabel, string> = {
  highly_selective: "Highly selective",
  selective: "Selective",
  moderately_selective: "Moderately selective",
  broadly_open: "Admits most applicants",
};

export function computeAcceptanceRate(applicants: number | null, admits: number | null): number | null {
  if (applicants === null || admits === null) return null;
  if (!Number.isInteger(applicants) || !Number.isInteger(admits)) return null;
  if (applicants <= 0 || admits < 0 || admits > applicants) return null;
  return admits / applicants;
}

/** Minimum applicant count before a label is derived — tiny cycles are too noisy. */
const MIN_APPLICANTS_FOR_LABEL = 10;

export function deriveSelectivityLabel(applicants: number | null, admits: number | null): SelectivityLabel | null {
  const rate = computeAcceptanceRate(applicants, admits);
  if (rate === null || applicants === null || applicants < MIN_APPLICANTS_FOR_LABEL) return null;
  if (rate <= 0.15) return "highly_selective";
  if (rate <= 0.35) return "selective";
  if (rate <= 0.7) return "moderately_selective";
  return "broadly_open";
}

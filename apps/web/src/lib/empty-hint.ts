export type TriKey = "openJoin" | "noComp" | "noDues" | "noExperience";
const KEYS: TriKey[] = ["noComp", "openJoin", "noDues", "noExperience"];

export interface UnconfirmedHint {
  /** The yes/no/unknown filter that left nothing. */
  key: TriKey;
  /** Clubs in the view without that filter. */
  total: number;
  no: number;
  unknown: number;
}

/**
 * For an empty result: a joining filter (No comp, Open membership, ...) that no club in the
 * rest of the view is confirmed for, with how many clubs the view has without it and how
 * many of those say no or don't say ("27 finance clubs, 20 don't say"). Null when no such
 * filter is on or it isn't what emptied the list. PURE.
 */
export function unconfirmedHint(
  known: Record<TriKey, { yes: number; no: number; unknown: number }>,
  filters: Partial<Record<TriKey, boolean>>,
): UnconfirmedHint | null {
  for (const key of KEYS) {
    const k = known[key];
    if (filters[key] && k.yes === 0 && k.no + k.unknown > 0)
      return { key, total: k.yes + k.no + k.unknown, no: k.no, unknown: k.unknown };
  }
  return null;
}

import { compareTermKeys } from "@hci/core/browser";
import { isPastTerm } from "@hci/db/local";

/** The fields `splitCycles` needs: a cycle's id and term. */
interface TermCycle {
  id: string;
  termKey: string;
}

/**
 * How a profile's "How to join" lays out a club's rounds: the featured round (never one from
 * an earlier term, even if the build picked it), other rounds this term or later, and past
 * rounds newest first. A past round is history ("Last round: Spring 2026"), never current
 * recruiting (CLAUDE.md §8). `shown` drops rounds with nothing to show. PURE.
 */
export function splitCycles<T extends TermCycle>(
  cycles: readonly T[],
  featured: T | null,
  now: Date,
  shown: (c: T) => boolean = () => true,
): { current: T | null; others: T[]; past: T[] } {
  const isPast = (c: T) => isPastTerm(c.termKey, now);
  const current = featured && shown(featured) && !isPast(featured) ? featured : null;
  const byTermDesc = (a: T, b: T) => compareTermKeys(b.termKey, a.termKey);
  const rest = cycles.filter((c) => c.id !== current?.id && shown(c));
  return {
    current,
    others: rest.filter((c) => !isPast(c)).sort(byTermDesc),
    past: rest.filter(isPast).sort(byTermDesc),
  };
}

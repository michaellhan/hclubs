import type { LinkKind } from "./enums";

/**
 * Link verification. CLAUDE.md §7.1: a link is the club's own only when evidenced.
 *
 *   verified   — listed by an official Harvard source (tier 1) for this org, or found on
 *                the club's verified official website, or editorially confirmed
 *   probable   — listed by another official-ish source (tier ≤ 5), or reciprocal link,
 *                or site whose title/heading matches the club name exactly
 *   unverified — everything else (e.g. listed only on Wikipedia / public web)
 */
export type LinkVerification = "verified" | "probable" | "unverified";

export interface LinkEvidenceSignal {
  sourceTier: number;
  /** Source is a page of the club's verified official website. */
  fromVerifiedOfficialSite: boolean;
  assertion: "stated" | "inferred" | "computed" | "user_reported" | "editorial";
}

export interface LinkVerificationInput {
  kind: LinkKind;
  evidence: readonly LinkEvidenceSignal[];
  /** The linked site links back to a verified channel of the club. */
  reciprocal?: boolean;
  /** The linked page's title/h1 matches the club name (normalized, exact). */
  nameMatchOnPage?: boolean;
}

export interface LinkVerificationResult {
  status: LinkVerification;
  confidence: number;
  signals: string[];
}

export function verifyLink(input: LinkVerificationInput): LinkVerificationResult {
  const signals: string[] = [];
  const e = input.evidence;
  if (e.some((x) => x.assertion === "editorial")) {
    return { status: "verified", confidence: 0.99, signals: ["editorially confirmed"] };
  }
  if (e.some((x) => x.sourceTier <= 1 && x.assertion === "stated"))
    signals.push("listed by an official Harvard source");
  if (e.some((x) => x.fromVerifiedOfficialSite && x.assertion === "stated"))
    signals.push("linked from the club's official website");
  if (signals.length > 0) return { status: "verified", confidence: 0.95, signals };

  if (e.some((x) => x.sourceTier <= 5 && x.assertion === "stated"))
    signals.push("listed by a club or official channel");
  if (input.reciprocal) signals.push("reciprocal link to a verified channel");
  if (input.nameMatchOnPage) signals.push("page title matches the club name");
  if (signals.length > 0) return { status: "probable", confidence: 0.7, signals };

  if (e.length > 0)
    signals.push(`only seen on lower-trust sources (best tier ${Math.min(...e.map((x) => x.sourceTier))})`);
  return { status: "unverified", confidence: 0.35, signals };
}

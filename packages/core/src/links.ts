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
  /** The site is on a host Harvard runs for student groups (`harvardGroupHost`). */
  harvardHostedGroupSite?: boolean;
  /**
   * ownership-v2 (ADR 0039): someone independent of the club links this site under the
   * club's name — a Harvard-related page (tier ≤ 7) whose link text is the club's name,
   * Wikipedia's article about the club ("Website:" / "Official website"), or two other
   * sites that both link it by the club's name. Describes the reference, or null.
   */
  independentReference?: string | null;
}

/**
 * Hosts Harvard runs for student-group sites (HCS, school group pages). A site there whose
 * title names the club is Harvard-hosted for it, not an outside look-alike. PURE.
 */
export function harvardGroupHost(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "hcs.harvard.edu") return /^\/~[\w-]+/.test(u.pathname);
    return /(^|\.)hcs\.harvard\.edu$/.test(host) || /^orgs\.law\.harvard\.edu$/.test(host);
  } catch {
    return false;
  }
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
  // ownership-v1 (ADR 0038): a site whose own title names the club becomes the club's when
  // a second, independent signal agrees: it links to an account Harvard or an editor
  // already confirmed as the club's, or Harvard hosts it as a student-group site.
  if (input.nameMatchOnPage && input.reciprocal) signals.push("names the club and links to its confirmed account");
  if (input.nameMatchOnPage && input.harvardHostedGroupSite)
    signals.push("names the club on a Harvard-hosted group site");
  if (input.nameMatchOnPage && input.independentReference)
    signals.push(`names the club, and ${input.independentReference}`);
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

// --- Link labels --------------------------------------------------------------------------

/** Selector blocks, declarations or builder component ids: never a link's visible words. */
export const CSS_LIKE_TEXT =
  /[{}]|#comp-[\w-]+|\[data-[\w-]+=|\b(?:fill|stroke|font-family|background(?:-color)?|margin|padding|display)\s*:\s*[^\s;]+\s*;/i;

/**
 * A link's visible words: without icon-font class names ("icon-comp Comp") or a site
 * builder's "Folder:" prefix; "" when what is left is CSS. Used when extracting links and
 * again when projecting them, because a label stays on the first claim seen for a URL. PURE.
 */
export function cleanLinkLabel(raw: string): string {
  let t = raw.trim();
  for (let i = 0; i < 3; i++) t = t.replace(/^(?:icon|fa|fas|far|fab|glyphicon|ico|material-icons?)[-_][\w-]+\s+/i, "");
  t = t.replace(/^Folder:\s*/i, "").trim();
  // A bare YouTube channel id ("@UCZ4uBfFpiZ7kXZujAX_EOVw") names nothing a student can read.
  if (/^@?UC[\w-]{22}$/.test(t)) return "";
  return CSS_LIKE_TEXT.test(t) ? "" : t;
}

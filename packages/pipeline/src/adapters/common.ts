import {
  classifyLink,
  normalizeName,
  normalizeUrl,
  slugify,
  splitParentheticalAcronym,
  type ActivityStatus,
  type OrgType,
  type RecognitionStatus,
} from "@hci/core";
import type { DiscoveredOrganization, ExtractedClaim, PageContent, ParsedPage } from "../types";
import { cleanText } from "../parse/html";

/**
 * Shared builder for directory-style adapters: one listed organization → a candidate
 * (entity mention) plus the claims the listing directly makes about it.
 *
 * Stated: name, acronym (from "Name (ACR)"), description, links listed for the org,
 * the org's page on the directory, the directory's own tags, explicit status.
 * Inferred (labeled as such): our category/org-type interpretation of the listing.
 */
const GRADUATE_NAME =
  /\b(GSAS|HKS|HBS|HLS|HMS|HSPH|GSD|HGSE|HDS|Extension School|Kennedy School|Business School|Law School|Medical School|Divinity School|Graduate School|Graduate Students?|School of Public Health|Chan School)\b/;

const GENERIC_NAMES = new Set(
  [
    "harvard",
    "harvard college",
    "harvard university",
    "social",
    "female",
    "male",
    "co ed",
    "coed",
    "final clubs",
    "fraternities",
    "sororities",
    "radio",
    "other",
    "others",
    "clubs",
    "student groups",
    "publications",
    "service",
    "political",
    "academic",
  ].map((n) => n),
);

export interface ListedOrgInput {
  system: string; // external-id namespace, e.g. "seas-orgs"
  /** Stable id within the directory (defaults to slug of the name). Never change a source's key scheme. */
  key?: string;
  /** Additional identifiers in other namespaces (e.g. a Wikipedia article title). */
  extraIds?: { system: string; id: string }[];
  name: string;
  description?: string | null;
  /** The organization's own URL as listed (website/social/mailto). */
  url?: string | null;
  /** The organization's page on the directory itself. */
  directoryUrl?: string | null;
  directoryLabel?: string;
  categories?: string[]; // our taxonomy slugs (inferred)
  orgType?: OrgType; // inferred from the listing's context
  tags?: string[]; // the directory's own labels (stated)
  recognition?: RecognitionStatus; // only when the source explicitly says so
  activity?: ActivityStatus; // only when the source explicitly says so
  locator: Record<string, unknown>;
  /** Lower for heuristic name parsing (e.g. names split out of prose). */
  nameConfidence?: number;
}

export function listedOrg(input: ListedOrgInput): DiscoveredOrganization | null {
  const rawName = cleanText(input.name)
    .replace(/\s*\(\s*$/, "")
    .replace(/\(([^)]*)$/, "($1)");
  if (rawName.length < 2 || rawName.length > 160) return null;
  // Section labels and bare institution names parsed out of lists are not organizations.
  if (GENERIC_NAMES.has(normalizeName(rawName))) return null;
  const { base, acronym } = splitParentheticalAcronym(rawName);
  // Only strip the parenthetical when it is the org's short form; "(Club Sport)" etc. stay.
  const name = acronym && base ? base : rawName;
  const claims: ExtractedClaim[] = [];
  const stated = (fieldKey: ExtractedClaim["fieldKey"], value: unknown, quote?: string, factor?: number): void => {
    claims.push({
      fieldKey,
      value,
      assertionKind: "stated",
      isDirect: true,
      extractionMethod: "html_parse",
      ...(quote ? { quote } : {}),
      locator: input.locator,
      ...(factor !== undefined ? { confidenceFactor: factor } : {}),
    });
  };
  const inferred = (fieldKey: ExtractedClaim["fieldKey"], value: unknown): void => {
    claims.push({
      fieldKey,
      value,
      assertionKind: "inferred",
      isDirect: false,
      extractionMethod: "html_parse",
      locator: input.locator,
    });
  };

  stated("club.name", name, rawName, input.nameConfidence);
  if (acronym) stated("club.acronym", acronym, rawName);
  if (rawName !== name) stated("club.alias", { name: rawName, kind: "alternate" }, rawName);

  const desc = input.description ? cleanText(input.description).replace(/^[-–—:\s]+/, "") : "";
  if (desc.length >= 12) {
    if (desc.length <= 400) stated("club.short_description", desc, desc);
    else stated("club.long_description", desc, desc);
  }

  const urls: string[] = [];
  if (input.url) {
    const c = classifyLink(input.url);
    if (c && !c.isPersonal && !c.isContentItem) {
      stated("club.link", { kind: c.kind, url: c.url, ...(c.handle ? { handle: c.handle } : {}) }, input.url);
      if (c.kind !== "email") urls.push(c.url);
    }
  }
  if (input.directoryUrl) {
    const d = normalizeUrl(input.directoryUrl);
    if (d) {
      // A directory's page ABOUT the org is a listing, not the org's own site: it is an
      // identity signal only via the directory id (externalIds), never a "site".
      stated(
        "club.link",
        { kind: "harvard_directory", url: d, label: input.directoryLabel ?? "Directory page" },
        input.directoryUrl,
      );
    }
  }
  for (const t of input.tags ?? []) {
    const tag = cleanText(t).toLowerCase();
    if (tag.length >= 2 && tag.length <= 60) stated("club.tag", tag, t);
  }
  for (const c of input.categories ?? []) inferred("club.category", c);
  if (input.orgType) inferred("club.org_type", input.orgType);
  // Graduate/professional-school groups named as such (e.g. "Harvard GSAS Consulting Club").
  if (GRADUATE_NAME.test(rawName)) inferred("club.affiliation_scope", "graduate_school");
  if (input.recognition) stated("club.recognition_status", input.recognition);
  if (input.activity) stated("club.activity_status", input.activity);

  // A real directory identifier (URL slug, post id) is an identity signal: two different
  // ids in one directory mean two organizations. A key derived from the listed NAME is not —
  // the same directory may list one org as "X (ACR)" and "X" — so it only pins the mention
  // across runs (from the base name, so both spellings share it) and never rules out a match.
  const key = (input.key ?? slugify(name)).toLowerCase();
  const externalIds = [...(input.key ? [{ system: input.system, id: key }] : []), ...(input.extraIds ?? [])];
  return {
    externalKey: key,
    name,
    ...(acronym ? { acronym } : {}),
    identity: { urls, externalIds },
    claims,
  };
}

export function collect(
  orgs: (DiscoveredOrganization | null)[],
  page: PageContent,
  extra: Partial<ParsedPage> = {},
): ParsedPage {
  // The same org listed twice on one page ("X (ACR)" and "X") is one candidate: merge claims.
  const byKey = new Map<string, DiscoveredOrganization>();
  for (const o of orgs) {
    if (!o) continue;
    const prev = byKey.get(o.externalKey);
    if (!prev) {
      byKey.set(o.externalKey, o);
      continue;
    }
    prev.claims.push(...o.claims);
    prev.identity.urls = [...new Set([...prev.identity.urls, ...o.identity.urls])];
    if (!prev.acronym && o.acronym) prev.acronym = o.acronym;
  }
  const organizations = [...byKey.values()];
  return {
    organizations,
    nextUrls: extra.nextUrls ?? [],
    title: extra.title ?? null,
    warnings: [
      ...(extra.warnings ?? []),
      ...(organizations.length === 0 ? [`no organizations parsed from ${page.url} — structure may have changed`] : []),
    ],
  };
}

/** Last path segment of a URL as a stable key. */
export function lastSegment(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean).pop();
    return seg ? decodeURIComponent(seg).toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/** Unwrap proofpoint/safelinks redirect wrappers found in some Harvard pages. */
export function unwrapRedirect(href: string): string {
  try {
    const u = new URL(href);
    if (/urldefense\.(proofpoint\.)?com$/.test(u.hostname)) {
      const m = /__(https?:\/\/.+?)__;/.exec(href);
      if (m?.[1]) return m[1];
      const q = u.searchParams.get("u");
      if (q) return decodeURIComponent(q.replace(/-/g, "%").replace(/_/g, "/"));
    }
    if (/safelinks\.protection\.outlook\.com$/.test(u.hostname)) return u.searchParams.get("url") ?? href;
  } catch {
    /* keep as is */
  }
  return href;
}

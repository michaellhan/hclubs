import type { OrgType } from "@hci/core";
import type { DiscoveredOrganization, DiscoveryAdapter, ExtractedClaim, PageContent, ParsedPage } from "../types";
import { collect, listedOrg } from "./common";

/**
 * The College's student organization directory (SOCO / CampusGroups), from a copy the
 * owner made by hand while signed in (docs/sources/soco-directory.md, ADR 0030). We never
 * fetch it: the directory needs HarvardKey. `pnpm hci import-soco <file>` feeds the saved
 * plain text through this parser.
 *
 * Each group in the copied list looks like:
 *
 *   Select <name>'s group. Select the group and click on the Join button …
 *   (blank)
 *   <name>
 *   <category>[ - <flag>, <flag>]
 *   Website
 *   Contact: <officer names>, Email group officers     ← individual students: never stored
 *   Group Not Registered Yet                            ← optional
 *   Lifetime membership
 *
 * Stated: the name, the directory's category and flags (as tags), "No Dues Required",
 * College registration. Inferred: our category and org type for the directory's category.
 */

export const SOCO_DIRECTORY_URL = "https://soco.college.harvard.edu/club_signup";

const SELECT_LINE = /^Select (.+)'s group\. Select the group and click on the Join button/;

/** Directory categories that aren't student organizations (College offices). */
const NOT_ORGS = new Set(["Office"]);

const CATEGORY_MAP: Record<string, { categories?: string[]; orgType?: OrgType }> = {
  "Cultural and Racial Initiatives": { categories: ["cultural-identity"] },
  "Women's Initiatives": { categories: ["cultural-identity"] },
  "Gender and Sexuality": { categories: ["cultural-identity"] },
  PBHA: { categories: ["public-service"], orgType: "public_service_program" },
  "Public Service": { categories: ["public-service"] },
  "Creative and Performing Arts": { categories: ["performing-arts"] },
  "Club Sports": { categories: ["athletics-recreation"], orgType: "club_sport" },
  "Government and Politics": { categories: ["political-advocacy"] },
  "Hobbies and Special Interests": { categories: ["hobbies-games"] },
  "Religious and Spiritual Life": { categories: ["religious-spiritual"] },
  "House Committee": { categories: ["social"], orgType: "governance_body" },
  "Media and Publications": { categories: ["publications-media"], orgType: "publication" },
  SEAS: { categories: ["academic-stem"] },
};

export interface SocoEntry {
  name: string;
  category: string;
  flags: string[];
  registered: boolean;
  line: number;
}

/** Pure: the copied page text → one entry per group. Contact lines are dropped. */
export function parseSocoEntries(text: string): SocoEntry[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim());
  const entries: SocoEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = SELECT_LINE.exec(lines[i] ?? "");
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j]) j++;
    const name = lines[j] ?? m[1] ?? "";
    let k = j + 1;
    while (k < lines.length && !lines[k]) k++;
    const categoryLine = lines[k] ?? "";
    // "Academic and Pre-Professional - No Dues Required, SEAS": the category ends at " - ".
    const cut = categoryLine.indexOf(" - ");
    const category = (cut >= 0 ? categoryLine.slice(0, cut) : categoryLine).trim();
    const flags =
      cut >= 0
        ? categoryLine
            .slice(cut + 3)
            .split(",")
            .map((f) => f.trim())
            .filter(Boolean)
        : [];
    let registered = true;
    for (let n = k + 1; n < lines.length && !SELECT_LINE.test(lines[n] ?? ""); n++) {
      if (lines[n] === "Group Not Registered Yet") registered = false;
    }
    if (name && category) entries.push({ name, category, flags, registered, line: j + 1 });
  }
  return entries;
}

export function parseSocoDirectory(page: PageContent): ParsedPage {
  const orgs: (DiscoveredOrganization | null)[] = [];
  for (const e of parseSocoEntries(page.body)) {
    if (NOT_ORGS.has(e.category)) continue;
    const mapped = CATEGORY_MAP[e.category] ?? {};
    const org = listedOrg({
      system: "soco-directory",
      name: e.name,
      tags: [e.category, ...e.flags.filter((f) => f !== "No Dues Required")],
      ...(mapped.categories ? { categories: mapped.categories } : {}),
      ...(mapped.orgType ? { orgType: mapped.orgType } : {}),
      ...(e.registered ? { recognition: "recognized" as const } : {}),
      locator: { line: e.line, category: e.category },
    });
    if (!org) continue;
    const stated = (fieldKey: ExtractedClaim["fieldKey"], value: unknown, quote: string): void => {
      org.claims.push({
        fieldKey,
        value,
        assertionKind: "stated",
        isDirect: true,
        extractionMethod: "manual",
        quote,
        locator: { line: e.line },
      });
    };
    // Listed in the College's own directory: an undergraduate organization.
    stated("club.affiliation_scope", "harvard_college", e.name);
    if (e.flags.includes("No Dues Required")) stated("club.dues", { hasDues: false }, "No Dues Required");
    // Typed by hand from a signed-in page, not parsed from HTML.
    for (const c of org.claims) if (c.extractionMethod === "html_parse") c.extractionMethod = "manual";
    orgs.push(org);
  }
  return collect(orgs, page, { title: "Groups" });
}

export const socoDirectoryAdapter: DiscoveryAdapter = {
  name: "soco-directory",
  version: "1.0.0",
  description: "Harvard College student organization directory (SOCO), from the owner's saved copy",
  sourceType: "harvard_official",
  publisher: "Harvard College Student Organization Center (SOCO)",
  maxPages: 1,
  seeds: () => [
    {
      url: SOCO_DIRECTORY_URL,
      sourceType: "harvard_official",
      title: "Student organization directory",
      publisher: "Harvard College Student Organization Center (SOCO)",
    },
  ],
  parse: parseSocoDirectory,
};

import { distinctiveTokens, initialisms } from "../name-only/identity";
import type { AuditClub } from "./types";

/** Lowercase ASCII words joined by single spaces; "&" → "and"; possessive "'s" dropped. PURE. */
export function plain(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’']s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const LEADING =
  /^(?:(?:the|harvard|radcliffe|harvard radcliffe|undergraduate|college|pbha|university|hbs|hls|hks|gsas|hes)\s+)+/;
const TRAILING =
  /(?:\s+(?:club|society|association|organization|program|group|inc|student|students|at harvard(?: college)?))+$/;

/**
 * The ways an article or page might name a club: its full name, without the "Harvard
 * Undergraduate" / "PBHA's" prefix or a trailing "Club", without parentheticals, the
 * parenthetical itself ("Citizenship Tutoring (Cit Tut)" → "cit tut"), aliases and an
 * acronym of 3+ letters. Each is `plain`. PURE.
 */
export function nameForms(club: Pick<AuditClub, "name" | "acronym" | "aliases">): string[] {
  const out = new Set<string>();
  const add = (raw: string) => {
    const p = plain(raw);
    if (!p) return;
    out.add(p);
    const lead = p.replace(LEADING, "");
    const both = lead.replace(TRAILING, "");
    for (const v of [lead, both, p.replace(TRAILING, "")]) if (v.split(" ").join("").length >= 4) out.add(v);
    // "Harvard Men's Rugby Club" is "the Harvard Rugby Club" in most stories.
    const ungendered = p
      .replace(/\b(men|women|mens|womens)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (ungendered !== p && ungendered.split(" ").length >= 2) out.add(ungendered);
  };
  for (const n of [club.name, ...club.aliases]) {
    add(n);
    add(n.replace(/\([^)]*\)/g, " "));
    // "The John Adams Society: A Harvard Undergraduate Debating Society" → "The John Adams Society".
    const head = n.split(/\s*[:–—]\s+|\s+-\s+/)[0];
    if (head && head !== n) add(head);
    for (const m of n.matchAll(/\(([^)]+)\)/g)) if (m[1] && !/club sport/i.test(m[1])) add(m[1]);
  }
  if (club.acronym && plain(club.acronym).replace(/ /g, "").length >= 3) out.add(plain(club.acronym));
  return [...out].filter((f) => f.length >= 3);
}

/** True when `text` names the club in one of its `nameForms` (whole-word match). PURE. */
export function namesClub(text: string, club: Pick<AuditClub, "name" | "acronym" | "aliases">): boolean {
  const t = ` ${plain(text)} `;
  return nameForms(club).some((f) => t.includes(` ${f} `));
}

/**
 * Tokens a club's own handle or domain would plausibly contain: distinctive name words (and
 * their 5-letter prefix, so @harvardfinance matches "Financial Analysts"), initialisms
 * (@harvardtghi), acronym and alias words. PURE.
 */
export function identityTokens(club: Pick<AuditClub, "name" | "acronym" | "aliases"> & { slug?: string }): string[] {
  const out = new Set<string>();
  // The slug often carries the acronym the name lacks ("harvard-artists-for-alzheimers-hartz").
  const last = club.slug?.split("-").pop();
  const nameWords = new Set(plain([club.name, ...club.aliases].join(" ")).split(" "));
  if (last && last.length >= 3 && last.length <= 6 && !/\d/.test(last) && !nameWords.has(last)) out.add(last);
  for (const n of [club.name, ...club.aliases]) {
    for (const t of distinctiveTokens(n)) {
      if (t.length >= 3) out.add(t);
      if (t.length >= 6) out.add(t.slice(0, 5));
    }
    for (const i of initialisms(n)) if (i.length >= 3) out.add(i);
    const m = n.match(/\(([A-Za-z]{3,})\)/);
    if (m?.[1]) out.add(m[1].toLowerCase());
  }
  if (club.acronym) {
    const a = club.acronym.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (a.length >= 2) out.add(a);
  }
  for (const n of [club.name, ...club.aliases]) {
    // "PBHA's Harvard Square Homeless Shelter" goes by "hshs"; "S.T.A.G.E." by "stage";
    // "Public Health Innovation x Technology" by "phit".
    const bare = n.replace(/^(pbha[’']?s?|the)\s+/i, "").replace(/\([^)]*\)/g, " ");
    const ws = plain(bare)
      .split(" ")
      .filter((w) => w.length > 1 && !INITIAL_SKIP.has(w));
    for (const v of [ws, ws.filter((w) => w !== "harvard")]) {
      const i = v.map((w) => w[0]).join("");
      if (i.length >= 3) out.add(i);
    }
    for (const m of n.matchAll(/\b((?:[A-Za-z]\.){3,})/g)) out.add((m[1] ?? "").replace(/\./g, "").toLowerCase());
    for (const i of initialisms(bare)) if (i.length >= 3) out.add(i);
  }
  return [...out];
}

const INITIAL_SKIP = new Set(["of", "at", "the", "and", "for", "in", "a", "an", "to", "with", "on", "by", "s"]);

/** How many identity tokens a handle/host contains (0 = it names nothing about the club). PURE. */
export function identityScore(
  handle: string,
  club: Pick<AuditClub, "name" | "acronym" | "aliases"> & { slug?: string },
): number {
  const h = handle.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!h) return 0;
  const tokens = identityTokens(club);
  // A 2-letter acronym only counts at the very start or end ("hcs", "ci_harvard").
  return tokens.filter((t) => (t.length >= 3 ? h.includes(t) : h.startsWith(t) || h.endsWith(t))).length;
}

/** Registrable-ish host: lowercase, no "www.". PURE. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** "a.b.example.org" → "example.org" (good enough for .org/.com/.edu style hosts). PURE. */
export function baseDomain(host: string): string {
  const parts = host.split(".");
  return parts.slice(-2).join(".");
}

/** Words a domain is made of, e.g. "harvardcollegepoker.com" → "harvardcollegepoker". PURE. */
export function domainLabel(host: string): string {
  const parts = host.split(".");
  return (parts.length >= 2 ? parts[parts.length - 2] : parts[0]) ?? "";
}

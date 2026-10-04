import type { RankableLink } from "@hci/db/local";

/** Labels that are really CSS/markup scraped from a page, or too long to be a link name. */
export function isJunkLabel(label: string | null | undefined): boolean {
  if (!label) return true;
  const t = label.trim();
  return t.length === 0 || t.length > 60 || /[{};]/.test(t) || /^icon-/i.test(t);
}

/** A link's visible text: its own label when it reads like one, else the host/path or address. */
export function cleanLinkLabel(
  l: Pick<RankableLink, "label" | "url" | "handle">,
  kindLabel: string,
  fallback: string,
): string {
  const label = l.label?.trim() ?? "";
  if (isJunkLabel(label) || label.toLowerCase() === kindLabel.toLowerCase()) return fallback;
  return label;
}

/** The last path segment as words ("/jobs/web-associate" → "Web associate"), or null for ids. */
function pathWords(url: string): string | null {
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean).at(-1);
    if (!seg || !/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/i.test(seg) || seg.length > 40 || /\d{3,}/.test(seg)) return null;
    const words = seg
      .replace(/[-_]+/g, " ")
      .toLowerCase()
      .replace(/\b(mit|ai|hbs|hls|hks|seas|ui|ux)\b/g, (w) => w.toUpperCase());
    return words.charAt(0).toUpperCase() + words.slice(1);
  } catch {
    return null;
  }
}

/**
 * Visible labels for a list of links: each link's clean label, except that a label shared by
 * several links ("Apply for this role" ×7) gives way to its page name ("Web associate",
 * "Tour manager") so the rows can be told apart. PURE.
 */
export function distinctLinkLabels<T extends Pick<RankableLink, "label" | "url" | "handle">>(
  links: readonly T[],
  label: (l: T) => string,
): Map<T, string> {
  const base = new Map(links.map((l) => [l, label(l)] as const));
  const counts = new Map<string, number>();
  for (const v of base.values()) counts.set(v, (counts.get(v) ?? 0) + 1);
  return new Map(
    links.map((l) => {
      const v = base.get(l) ?? label(l);
      return [l, (counts.get(v) ?? 0) > 1 ? (pathWords(l.url) ?? v) : v] as const;
    }),
  );
}

/** Role addresses a student would write to first. */
const PREFERRED_EMAIL = /^(info|contact|hello|auditions?|recruit\w*|join|membership|apply)@/i;

function address(l: Pick<RankableLink, "url" | "handle">): string {
  return (l.handle ?? l.url.replace(/^mailto:/i, "")).toLowerCase();
}

/** Up to `max` emails (preferred role addresses first, else input order) and the rest. */
export function pickEmails<T extends Pick<RankableLink, "url" | "handle">>(
  emails: readonly T[],
  max = 2,
): { shown: T[]; hidden: T[] } {
  const seen = new Set<string>();
  const uniq = emails.filter((e) => {
    const a = address(e);
    if (seen.has(a)) return false;
    seen.add(a);
    return true;
  });
  const ranked = [
    ...uniq.filter((e) => PREFERRED_EMAIL.test(address(e))),
    ...uniq.filter((e) => !PREFERRED_EMAIL.test(address(e))),
  ];
  const shownSet = new Set(ranked.slice(0, max));
  // Keep the original order within each group.
  return { shown: uniq.filter((e) => shownSet.has(e)), hidden: uniq.filter((e) => !shownSet.has(e)) };
}

function destKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

const APPLY_KIND = new Set(["application_form", "application_page"]);

export interface MoreLinksPlan<T> {
  other: T[];
  applications: { shown: T[]; hidden: T[] };
  emails: { shown: T[]; hidden: T[] };
}

/**
 * Sorts the "More links" list into plain links, application links (3 at most up front,
 * none for an ended organization) and email addresses (2 up front). Links with the same
 * kind and destination collapse to one. PURE.
 */
export function planMoreLinks<T extends RankableLink>(
  links: readonly T[],
  opts: { ended?: boolean; maxApplications?: number; maxEmails?: number } = {},
): MoreLinksPlan<T> {
  const seen = new Set<string>();
  const uniq = links.filter((l) => {
    const key = `${l.kind}|${l.kind === "email" ? address(l) : destKey(l.url)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const apps = opts.ended ? [] : uniq.filter((l) => APPLY_KIND.has(l.kind));
  const max = opts.maxApplications ?? 3;
  return {
    other: uniq.filter((l) => !APPLY_KIND.has(l.kind) && l.kind !== "email"),
    applications: { shown: apps.slice(0, max), hidden: apps.slice(max) },
    emails: pickEmails(
      uniq.filter((l) => l.kind === "email"),
      opts.maxEmails ?? 2,
    ),
  };
}

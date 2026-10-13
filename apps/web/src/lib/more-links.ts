import { namesPastRound, type RankableLink } from "@hci/db/local";

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

// Hosts whose paths are ids, not names (forms.gle/Haetnz…, airtable.com/shrXr…).
const ID_PATH_HOSTS =
  /(^|\.)(forms\.gle|docs\.google\.com|airtable\.com|typeform\.com|jotform\.com|tally\.so|forms\.office\.com|bit\.ly|linktr\.ee)$/;
const GENERIC_TAIL = new Set(["viewform", "edit", "apply", "join", "index", "form", "forms", "home", "page"]);

/**
 * The last path segment as words ("/jobs/web-associate" → "Web associate"), or null when it
 * isn't a readable name: an id, a form host's path, one word, or a generic tail.
 */
function pathWords(url: string): string | null {
  try {
    const u = new URL(url);
    if (ID_PATH_HOSTS.test(u.hostname.replace(/^www\./, ""))) return null;
    const seg = u.pathname.split("/").filter(Boolean).at(-1);
    if (!seg || seg.length > 40 || !/^(?=.{4,}$)[a-z]+(?:[-_][a-z]+)*$/i.test(seg)) return null;
    const parts = seg.toLowerCase().split(/[-_]+/);
    if (parts.every((w) => GENERIC_TAIL.has(w) || /^\d+$/.test(w))) return null;
    const words = parts.join(" ").replace(/\b(mit|ai|hbs|hls|hks|seas|ui|ux)\b/g, (w) => w.toUpperCase());
    return words.charAt(0).toUpperCase() + words.slice(1);
  } catch {
    return null;
  }
}

/**
 * Visible labels for a list of links: each link's clean label, except that a label shared by
 * several links ("Apply for this role" ×7) gives way to its page name ("Web associate",
 * "Tour manager") so the rows can be told apart. Only when every link sharing the label has
 * a readable, distinct page name; otherwise the shared label stays. PURE.
 */
export function distinctLinkLabels<T extends Pick<RankableLink, "label" | "url" | "handle">>(
  links: readonly T[],
  label: (l: T) => string,
): Map<T, string> {
  const base = new Map(links.map((l) => [l, label(l)] as const));
  const groups = new Map<string, T[]>();
  for (const l of links) {
    const v = base.get(l) ?? label(l);
    groups.set(v, [...(groups.get(v) ?? []), l]);
  }
  const out = new Map(base);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const names = group.map((l) => pathWords(l.url));
    if (names.some((n) => n === null) || new Set(names).size < names.length) continue;
    group.forEach((l, i) => out.set(l, names[i] ?? label(l)));
  }
  return out;
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
 * kind and destination collapse to one. With `now`, application links whose own words name
 * a round already over ("Spring 2026 Comp Interest Form") go after the others. PURE.
 */
export function planMoreLinks<T extends RankableLink>(
  links: readonly T[],
  opts: { ended?: boolean; maxApplications?: number; maxEmails?: number; now?: Date } = {},
): MoreLinksPlan<T> {
  const seen = new Set<string>();
  const uniq = links.filter((l) => {
    const key = `${l.kind}|${l.kind === "email" ? address(l) : destKey(l.url)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const now = opts.now;
  const past = (l: T) => (now ? namesPastRound(l, now) : false);
  const apps = opts.ended
    ? []
    : uniq.filter((l) => APPLY_KIND.has(l.kind)).sort((a, b) => Number(past(a)) - Number(past(b)));
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

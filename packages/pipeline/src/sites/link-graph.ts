import { classifyLink, normalizeName, siteKey } from "@hci/core";
import type { DocLink } from "../parse/document";
import { excludedSiteHost } from "./candidates";
import { hostOf } from "./org-page";

/**
 * Link-graph candidates (ADR 0038): links on pages we already stored whose anchor text IS
 * a club's name, alias or acronym. PURE. A match is only a lead: a website still has to
 * pass `siteIdentity` on its own home page before it's attached, and ambiguous keys (shared
 * by two clubs) and one-word names ("Baseball", "Running") never match.
 */
export interface NamedClub {
  id: string;
  name: string;
  acronym: string | null;
  aliases: readonly string[];
}

export interface AnchorMatch {
  clubId: string;
  url: string;
  anchor: string;
  kind: "website" | "social";
}

/** Hosts that link to clubs but are never a club's own site or account. */
const NEVER_TARGET =
  /(^|\.)(wikimedia\.org|wikidata\.org|soco\.college\.harvard\.edu|thehub\.harvard\.edu|careerservices\.fas\.harvard\.edu|engage\.[\w.-]+|archive\.org|doi\.org|kiddle\.co|harvardindependent\.com|theharvardpoliticalreview\.com|thecrimson\.com)$/i;

export interface NameKeys {
  names: Map<string, string>;
  acronyms: Map<string, string>;
}

/** Name and acronym keys → club id, without keys two clubs share. PURE. */
export function buildNameKeys(clubs: readonly NamedClub[]): NameKeys {
  const names = new Map<string, string | null>();
  const acronyms = new Map<string, string | null>();
  const put = (m: Map<string, string | null>, k: string, id: string) => {
    const cur = m.get(k);
    m.set(k, cur === undefined || cur === id ? id : null);
  };
  for (const c of clubs) {
    for (const n of [c.name, ...c.aliases]) {
      const k = normalizeName(n);
      if (k.split(" ").length >= 2) put(names, k, c.id);
    }
    const a = c.acronym?.replace(/[^A-Za-z0-9&]/g, "") ?? "";
    if (a.length >= 3) put(acronyms, a, c.id);
  }
  const keep = (m: Map<string, string | null>) => new Map([...m].filter((e): e is [string, string] => e[1] !== null));
  return { names: keep(names), acronyms: keep(acronyms) };
}

/** Club links on one page, matched by exact anchor text. PURE. */
export function anchorMatches(pageUrl: string, links: readonly DocLink[], keys: NameKeys): AnchorMatch[] {
  const pageSite = siteKey(pageUrl);
  const out = new Map<string, AnchorMatch>();
  for (const l of links) {
    const anchor = (l.text ?? "").replace(/\s+/g, " ").trim();
    if (anchor.length < 3 || anchor.length > 120) continue;
    const host = hostOf(l.url);
    if (!host || NEVER_TARGET.test(host)) continue;
    if (pageSite && siteKey(l.url) === pageSite) continue;
    const clubId =
      keys.names.get(normalizeName(anchor)) ?? keys.acronyms.get(anchor.replace(/[^A-Za-z0-9&]/g, "")) ?? null;
    if (!clubId) continue;
    const link = classifyLink(l.url);
    if (!link || link.isPersonal || link.isContentItem) continue;
    let kind: AnchorMatch["kind"];
    if (["instagram", "linkedin", "facebook", "x", "youtube", "tiktok"].includes(link.kind)) kind = "social";
    else if (link.kind === "website" && !excludedSiteHost(l.url)) kind = "website";
    else if (link.kind === "website" && /(^|\.)hcs\.harvard\.edu$/.test(host)) kind = "website";
    else continue;
    const key = `${clubId}|${link.url}`;
    if (!out.has(key)) out.set(key, { clubId, url: link.url, anchor, kind });
  }
  return [...out.values()];
}

/** The site root to check for a matched link: HCS "~name" paths keep their path. PURE. */
export function siteRootOf(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const tilde = /^\/~[\w-]+/.exec(u.pathname);
    if (host.replace(/^www\./, "") === "hcs.harvard.edu")
      // HCS's own pages are not a club's site; only a "~name" home is.
      return tilde ? `https://hcs.harvard.edu${tilde[0]}/` : null;
    if (/(^|\.)(sites\.google\.com|github\.io|wixsite\.com)$/.test(host)) {
      const seg = u.pathname.split("/").filter(Boolean);
      const keep = host.endsWith("sites.google.com") ? seg.slice(0, 2) : seg.slice(0, 1);
      return `https://${host}/${keep.join("/")}${keep.length ? "/" : ""}`;
    }
    return `https://${host}/`;
  } catch {
    return null;
  }
}

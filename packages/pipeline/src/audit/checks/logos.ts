import { BUILDER_CDN, LOGO_PICKER, OTHER_MARK, WHITE_ONLY } from "../../extract/logo";
import { baseDomain, hostOf } from "../text";
import type { AuditClaim, AuditClub, AuditData, AuditFinding, Confidence, Severity } from "../types";

/**
 * Logo checks. PURE: decided from the image URL (filename, host, size parameters) and the
 * club's own sites; `--check-urls` adds a live HEAD check for broken images (run.ts).
 */

const PIXEL = /(1x1|pixel|spacer|blank|transparent\.gif|tracking)/i;
// Whole filename words only: "team-photo.jpg" is a photo, "Firefly_RemoveBackground.png"
// (an editing tool's export name) and "teamwork-logo" are not (audit follow-up 2026-10-01).
const PHOTO =
  /(^|[-_.\s\d]|%20)(gallery|photos?|img_\d+|dsc_?\d+|image\d+|team|group|flyer|banner|hero|cover|header-bg|background)(?=$|[-_.\s\d]|%20)/i;
const FAVICON = /favicon|apple-touch-icon|icon-\d+x\d+|android-chrome/i;

function size(url: string): number | null {
  const m =
    url.match(/[?&/,]w[_=](\d{1,4})/i) ??
    url.match(/-(\d{2,4})x\d{2,4}\./) ??
    url.match(/favicon-(\d+)x\d+/i) ??
    url.match(/format=(\d+)w/);
  return m?.[1] ? Number(m[1]) : null;
}

function finding(
  club: AuditClub,
  claim: AuditClaim,
  check: string,
  severity: Severity,
  confidence: Confidence,
  detail: string,
  reject: boolean,
): AuditFinding {
  return {
    check,
    area: "logo",
    severity,
    confidence,
    clubId: club.id,
    slug: club.slug,
    subject: String(claim.value),
    detail,
    displayed: club.displayedClaimIds.has(claim.id),
    fix: reject ? { kind: "reject_claims", claimIds: [claim.id], reason: `audit ${check}: ${detail}` } : null,
  };
}

export function checkLogos(data: AuditData): AuditFinding[] {
  const out: AuditFinding[] = [];
  const siteHosts = new Map<string, Set<string>>();
  for (const l of data.links)
    if (l.kind === "website") {
      const s = siteHosts.get(l.clubId) ?? new Set<string>();
      s.add(baseDomain(hostOf(l.url)));
      siteHosts.set(l.clubId, s);
    }
  const logos = data.claims.filter((c) => c.fieldKey === "club.logo" && typeof c.value === "string");

  for (const claim of logos) {
    const club = data.clubs.get(claim.clubId);
    if (!club) continue;
    const url = claim.value as string;
    let file = "";
    try {
      file = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    } catch {
      out.push(finding(club, claim, "logo.bad_url", "high", "high", "not a valid URL", true));
      continue;
    }
    const host = hostOf(url);
    const own = siteHosts.get(club.id) ?? new Set<string>();
    const pageHosts = new Set(claim.evidence.map((e) => baseDomain(hostOf(e.sourceUrl))));

    if (PIXEL.test(file)) {
      out.push(
        finding(club, claim, "logo.tracking_pixel", "high", "high", `"${file}" is a spacer/tracking image`, true),
      );
      continue;
    }
    // A club's own Instagram profile picture (account-checked on import, ADR 0050) is served
    // from Instagram's CDN; the "instagram" in its host isn't another organization's mark.
    const ownPicture = claim.evidence.some((e) => e.extractor === "instagram-picture");
    if (!ownPicture && (OTHER_MARK.test(file) || OTHER_MARK.test(host))) {
      out.push(
        finding(
          club,
          claim,
          "logo.other_org_mark",
          "critical",
          "high",
          `"${file}" is another organization's mark (sponsor, Harvard, platform)`,
          true,
        ),
      );
      continue;
    }
    // A logo served from a third-party domain that is neither a site builder's CDN nor one
    // of the club's sites (a widget, a national organization's favicon).
    // The logos pass checked the host against the page it actually read (after redirects).
    const picked = claim.evidence.some((e) => e.extractor === LOGO_PICKER.name);
    if (!picked && !BUILDER_CDN.test(host) && !own.has(baseDomain(host)) && !pageHosts.has(baseDomain(host))) {
      out.push(
        finding(
          club,
          claim,
          "logo.third_party_host",
          "high",
          "high",
          `served by ${host}, not by the club's site`,
          true,
        ),
      );
      continue;
    }
    if (/[,_/]blur_\d/.test(url)) {
      out.push(
        finding(club, claim, "logo.blurred_placeholder", "high", "high", "a blurred lazy-load placeholder", true),
      );
      continue;
    }
    // The logos pass measured its picks; a white-looking name is only a guess beside that.
    const measured = claim.evidence.some((e) => e.extractor === LOGO_PICKER.name);
    if (!measured && WHITE_ONLY.test(file.replace(/\.[a-z]+$/i, "")) && /\.(png|svg|webp)$/i.test(file)) {
      out.push(
        finding(club, claim, "logo.white_only", "high", "high", `"${file}" is a white logo for dark backgrounds`, true),
      );
      continue;
    }
    const px = size(url);
    if (px !== null && px <= 32)
      out.push(finding(club, claim, "logo.tiny", "medium", "medium", `about ${px}px wide`, false));
    // The logos pass chose a favicon only because nothing better on the page passed.
    if (FAVICON.test(file) && !measured) {
      const better = logos.some((o) => o.clubId === club.id && o.id !== claim.id && !FAVICON.test(String(o.value)));
      out.push(
        better
          ? finding(
              club,
              claim,
              "logo.favicon_when_logo_exists",
              "medium",
              "high",
              "a favicon, while the club has a real logo",
              true,
            )
          : finding(club, claim, "logo.favicon", "low", "medium", "a browser favicon used as the logo", false),
      );
    }
    if (PHOTO.test(file) && !/logo/i.test(file))
      out.push(
        finding(club, claim, "logo.photo_like", "medium", "medium", `"${file}" looks like a photo, not a logo`, false),
      );
  }
  return out;
}

import { describe, expect, it } from "vitest";
import { checkCategories } from "../src/audit/checks/categories";
import { checkConsistency } from "../src/audit/checks/consistency";
import { checkContent } from "../src/audit/checks/content";
import { checkDuplicates, nameKeys } from "../src/audit/checks/duplicates";
import { checkFacts } from "../src/audit/checks/facts";
import { checkLinks, sameOrgName, slugNamesOther, titleIsOtherOrg } from "../src/audit/checks/links";
import { checkLogos } from "../src/audit/checks/logos";
import { checkPress } from "../src/audit/checks/press";
import { checkRecruiting } from "../src/audit/checks/recruiting";
import { runChecks } from "../src/audit/run";
import { identityScore, namesClub } from "../src/audit/text";
import { pageYears } from "../src/recruiting/signals";
import type { AuditClaim, AuditClub, AuditData, AuditEvidence, AuditLink } from "../src/audit/types";
import {
  duesProblem,
  eventDateProblem,
  leadershipApplicationProblem,
  hoursProblem,
  memberCountProblem,
  negatedProcessProblem,
  openMembershipProblem,
  outsiderApplicationProblem,
  outsiderLinkProblem,
  selfDescribedSelectivityProblem,
  weekdayProblem,
} from "../src/extract/evidence-rules";
import { checkJoining } from "../src/audit/checks/joining";
import { UNKNOWN_JOINING, type Joining } from "@hci/core";

/**
 * Regression cases from the first data-quality audit (ADR 0033). Each "flags" case is a real
 * error found in the index; each "keeps" case is a real, correct record an earlier draft of
 * the check wrongly flagged. Club names are real index entries.
 */

const NOW = new Date("2026-10-01T12:00:00Z");
let seq = 0;
const id = (p: string) => `${p}-${++seq}`;

function club(name: string, over: Partial<AuditClub> = {}): AuditClub {
  return {
    id: id("club"),
    slug: name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    name,
    acronym: null,
    aliases: [],
    projectedAliases: [],
    college: true,
    affiliation: "harvard_college",
    topCategories: [],
    categories: [],
    displayedClaimIds: new Set(),
    shortDescription: null,
    joining: null,
    activityStatus: "active",
    ...over,
  };
}
function evidence(over: Partial<AuditEvidence> = {}): AuditEvidence {
  return {
    sourceId: id("src"),
    sourceUrl: "https://club.example/",
    sourceType: "club_website",
    tier: 2,
    ownerClubId: null,
    method: "html_parse",
    extractor: "site-deterministic",
    quote: null,
    confidence: 0.855,
    isDirect: true,
    observedAt: NOW,
    snapshotId: id("snap"),
    snapshotSourceId: null,
    snapshotFetchedAt: NOW,
    ...over,
  };
}
function claimOf(
  c: AuditClub,
  fieldKey: string,
  value: unknown,
  ev: Partial<AuditEvidence>[] = [{}],
  over: Partial<AuditClaim> = {},
): AuditClaim {
  return {
    id: id("claim"),
    clubId: c.id,
    fieldKey,
    value,
    status: "active",
    assertionKind: "stated",
    termKey: null,
    firstObservedAt: NOW,
    lastObservedAt: NOW,
    createdAt: NOW,
    evidence: ev.map(evidence),
    ...over,
  };
}
function linkOf(c: AuditClub, kind: string, url: string, over: Partial<AuditLink> = {}): AuditLink {
  return {
    clubId: c.id,
    kind,
    url,
    normalizedUrl: url.replace(/\/$/, "").toLowerCase(),
    handle: null,
    label: null,
    status: "unverified",
    discoveredVia: ["public_web"],
    claimIds: [id("linkclaim")],
    pageTitle: null,
    lastFetch: null,
    lastSnapshot: null,
    formClosed: false,
    ...over,
  };
}
function data(clubs: AuditClub[], parts: Partial<AuditData> = {}): AuditData {
  return {
    now: NOW,
    clubs: new Map(clubs.map((c) => [c.id, c])),
    claims: [],
    rejectedLinkClaims: [],
    rejectedDatePages: new Map(),
    links: [],
    cycles: [],
    decidedPairs: new Set(),
    snapshotText: new Map(),
    categoryTop: new Map(),
    articleText: new Map(),
    dismissed: new Set(),
    ...parts,
  };
}
const checks = (fs: { check: string }[]) => fs.map((f) => f.check);

describe("evidence rules shared by the extractors and the audit", () => {
  it("member counts must count members", () => {
    const bad: [string, number][] = [
      ["WISHR has two active mailing lists with over 1300 members on each.", 1300],
      ["Graduates join a community of 800+ members, gain access to HFAC's mailing list", 800],
      ["Recently over 100 members of the Haitian community gathered at a networking event.", 100],
      [
        "the President shall call a general meeting when a petition, signed by at least 50 members of the HRDC, requests one",
        50,
      ],
      [
        "HRO Board consists of an elected Executive Board of 8 members who oversee a General Board of 15-25 members.",
        25,
      ],
      ["1,200+ active", 1200],
      ["Waterman Award, the PECASE Award, and is a Fellow of the ACM and the AAAS.", 20],
      // A worldwide network (alumni, professionals), not the student membership.
      ["the largest biotech community, with more than 6,400 global members", 6400],
      ["We are a network of 2,000 worldwide members across industry", 2000],
    ];
    for (const [q, n] of bad) expect(memberCountProblem(q, [n]), q).not.toBeNull();
    const good: [string, number][] = [
      [
        "Today's Harvard Glee Club consists of about 70 members of all gender identities, mostly undergraduates, drawing from Harvard's schools",
        70,
      ],
      ["Currently, we have 350+ active members, a 1,500+ following, and an established network", 350],
      ["250+ Harvard College students", 250],
      ["a dynamic group of 700+ enterprising young women", 700],
      ["The Harvard Glee Club is a 60-voice, tenor-bass choral ensemble", 60],
    ];
    for (const [q, n] of good) expect(memberCountProblem(q, [n]), q).toBeNull();
  });

  it("hours come from the club's commitment, not job postings", () => {
    expect(hoursProblem("Permanent: 39 hours per week", [39])?.check).toBe("hours_implausible");
    expect(
      hoursProblem("you must be willing to work at least 8 hours a week to be eligible for this position", [8])?.check,
    ).toBe("hours_from_job_posting");
    expect(hoursProblem("Each member is expected to contribute 5-7 hours per week.", [5, 7])).toBeNull();
  });

  it("dues are membership dues", () => {
    expect(duesProblem("The event is free for accepted hackers, including meals and workshops.", null)).not.toBeNull();
    expect(duesProblem("There a no buy-ins at games hosted by the Harvard Poker Club.", null)).not.toBeNull();
    expect(duesProblem("access to the HUFSC-Only Ice at the rink for $25/semester", 25)).not.toBeNull();
    expect(duesProblem("The program is free and we do not take equity.", null)).not.toBeNull();
    expect(duesProblem("There is a nominal annual membership fee of $10 to cover society activities.", 10)).toBeNull();
    expect(duesProblem("joining the HCDU and attending debate tournaments is completely free", null)).toBeNull();
    expect(duesProblem("Semester Dues", null)).toBeNull();
  });

  it('"open to all" must be about membership', () => {
    for (const q of [
      "Auditions are open to all Harvard undergraduates who play Violin, Viola, Cello or Bass.",
      "The HCDU spring comp is open and completion based for all Harvard enrolled students!!",
      "Sunday Education events are open to all students who wish to attend, not just competitors!",
      "We'll have tons of sweet treats from the bakery… Open to all Harvard students!",
      "JWU's athletic department saw a 34% drop in ACL tears by using this data.",
      // ADR 0040: an open audition, an event listing, events "regardless of membership".
      "Everyone is welcome to audition, regardless of singing or musical experience!",
      "OPEN TO ALL - REGISTRATION REQUIRED",
      "FREE & OPEN TO ALL",
      "Our events are open to all students regardless of membership status throughout the year.",
    ])
      expect(openMembershipProblem(q), q).not.toBeNull();
    for (const q of [
      "Joining is really easy—we have no comp process or application—and is open to all Harvard College students.",
      "The Harvard College Hellenic Society is open to everyone.",
      "We happily accept any college volunteer as long as they're willing to commit to one day a week.",
      "All class years, schools, and concentrations are welcome!",
    ])
      expect(openMembershipProblem(q), q).toBeNull();
  });

  it("a club that comps or auditions is open only when a quote says there is no selection", () => {
    const hia = club("Harvard Investment Association");
    const band = club("Harvard University Band");
    const dins = club("Harvard Din & Tonics");
    const hpvt = club("Harvard College Human-Powered Vehicle Team");
    const found = checkFacts(
      data([hia, band, dins, hpvt], {
        claims: [
          claimOf(hia, "club.join_mode", "comp", [{ quote: "Our fall comp starts in September." }]),
          claimOf(hia, "club.join_mode", "open", [{ quote: "Open to all Harvard College undergraduates." }]),
          claimOf(band, "club.join_mode", "audition", [{ quote: "Auditions are held during the first week." }]),
          claimOf(band, "club.join_mode", "open", [
            {
              quote: "anyone who wants to join the Band can join",
              sourceUrl: "https://harvardband.org/auditions",
            },
          ]),
          claimOf(dins, "club.join_mode", "audition", [{ quote: "The Din & Tonics hold auditions each fall." }]),
          claimOf(dins, "club.join_mode", "open", [
            { quote: "No appointment needed; just show up!", sourceUrl: "https://dins.com/audition" },
          ]),
          claimOf(hpvt, "club.join_mode", "comp", [
            { quote: "Though the HPVT currently does not have a comp process, ES51 is recommended preparation." },
          ]),
          claimOf(hpvt, "club.join_mode", "open", [
            { quote: 'Currently we have no "comp" process, just email us if you\'d like to join.' },
          ]),
        ],
      }),
    );
    const bySlug = (slug: string) => found.filter((f) => f.slug === slug).map((f) => `${f.check} ${f.subject}`);
    expect(bySlug(hia.slug)).toEqual(['join.open_beside_process club.join_mode: "open"']);
    expect(bySlug(band.slug)).toEqual([]);
    expect(bySlug(dins.slug)).toEqual(['join.open_beside_process club.join_mode: "open"']);
    // The comp is the negated one; "open" stays.
    expect(bySlug(hpvt.slug)).toEqual(['join.process_negated club.join_mode: "comp"']);
  });

  it("a stated weekday must match the stored date", () => {
    expect(weekdayProblem("Saturday, Feb. 26", "2027-02-26")?.check).toBe("weekday_mismatch");
    expect(weekdayProblem("FRIDAY, SEPTEMBER 5", "2026-09-05")).not.toBeNull();
    expect(weekdayProblem("Sunday 9/6", "2026-09-06")).toBeNull();
    expect(weekdayProblem("Saturday Feb 12 – Saturday Feb 26", "2022-02-26")).toBeNull();
    // Two different weekdays: can't tell which one the date is.
    expect(weekdayProblem("Friday or Saturday, Feb. 26", "2027-02-26")).toBeNull();
  });
});

describe("link checks", () => {
  it("rejects directory pages of other organizations, judging fetched pages by title", () => {
    const hbs = club("HBS Entrepreneurship Club", { college: false });
    expect(slugNamesOther("fintech-club", hbs)).toBe(true);
    expect(titleIsOtherOrg("Entrepreneurship Through Acquisition Club | MBA", hbs)).toBe(true);
    // PBHA's CMS keeps a copied page's slug: the title is what the page is about.
    const y2y = club("PBHA's Y2Y Harvard Square");
    expect(titleIsOtherOrg("Y2Y Harvard Square — PBHA", y2y)).toBe(false);
    expect(
      slugNamesOther(
        "hartz",
        club("PBHA's Harvard Artists for Alzheimer's", { slug: "harvard-artists-for-alzheimers-hartz" }),
      ),
    ).toBe(false);
    expect(slugNamesOther("rite", club("PBHA's Recent Immigrant Term-Time Enrichment"))).toBe(false);
    expect(slugNamesOther("boston-refugee-youth-enrichment", club("BRYE Summer"))).toBe(false);
    expect(slugNamesOther("fxrbkxgwn1q8g66n2lxo57obwrecg0", club("Franklin Teen"))).toBe(false);
    // Spelling variants of the club's own name.
    expect(
      sameOrgName("Harvard College Black Prelaw Association", "Harvard Undergraduate Black Pre-Law Association"),
    ).toBe(true);
    expect(sameOrgName("Harvard GSAS Biotechnology Club", "Harvard GSAS Biotech Club")).toBe(true);
    expect(titleIsOtherOrg("CampusLabs Identity System", club("HKS AI and Tech Policy Caucus"))).toBeNull();
  });

  it("rejects dead, parked and hijacked websites but not renames", () => {
    const thud = club("HarvardTHUD");
    const hcura = club("HCURA");
    const tv = club("Harvard Undergraduate Television");
    const seds = club("Students for the Exploration and Development of Space");
    const d = data([thud, hcura, tv, seds], {
      links: [
        linkOf(thud, "website", "https://harvardthud.com", {
          lastSnapshot: { finalUrl: "https://www.portailrepit.com/", parked: false, at: NOW },
        }),
        linkOf(hcura, "website", "https://hcura.org", {
          lastSnapshot: { finalUrl: "https://www.harvardresearch.org/", parked: false, at: NOW },
        }),
        linkOf(tv, "website", "https://flybyblog.com/?p=1668", {
          lastSnapshot: {
            finalUrl: "https://www.hugedomains.com/domain_profile.cfm?d=flybyblog.com",
            parked: true,
            at: NOW,
          },
        }),
        linkOf(seds, "website", "https://hcs.harvard.edu/~seds", {
          lastFetch: { status: "http_error", httpStatus: 404, at: NOW },
        }),
      ],
    });
    const fs = checkLinks(d);
    const by = (c: AuditClub) =>
      fs.filter((f) => f.clubId === c.id && f.fix && f.confidence === "high").map((f) => f.check);
    expect(by(thud)).toContain("link.redirects_unrelated");
    expect(by(hcura)).toEqual([]);
    expect(by(tv)).toContain("link.parked_domain");
    expect(by(seds)).toContain("link.dead");
  });

  it("rejects handles that aren't the club's", () => {
    const humg = club("Harvard Undergraduate Marketing Group");
    const thurj = club("THURJ");
    const bee = club("Bee Club");
    const plant = club("Harvard Undergraduate Plant Based");
    const hucbe = club("Harvard Undergraduate Consulting on Business and the Environment");
    const site = (c: AuditClub, kind: string, url: string, handle: string) =>
      linkOf(c, kind, url, { handle, discoveredVia: ["club_website"] });
    const d = data([humg, thurj, bee, plant, hucbe], {
      links: [
        site(humg, "instagram", "https://www.instagram.com/alicetjacob", "alicetjacob"),
        site(humg, "instagram", "https://www.instagram.com/harvardumg", "harvardumg"),
        site(thurj, "instagram", "https://www.instagram.com/wpzoom", "wpzoom"),
        linkOf(bee, "facebook", "https://www.facebook.com/theharvardcrimson", { handle: "theharvardcrimson" }),
        linkOf(plant, "instagram", "https://www.instagram.com/crueltyfreeneu", { handle: "crueltyfreeneu" }),
        linkOf(hucbe, "facebook", "https://www.facebook.com/people", { handle: "people" }),
        site(hucbe, "facebook", "https://www.facebook.com/hu.cbe.21", "hu.cbe.21"),
      ],
    });
    const rejected = checkLinks(d)
      .filter((f) => f.fix && f.confidence === "high")
      .map((f) => f.subject);
    expect(rejected).toEqual(
      expect.arrayContaining([
        "https://www.instagram.com/alicetjacob",
        "https://www.instagram.com/wpzoom",
        "https://www.facebook.com/theharvardcrimson",
        "https://www.instagram.com/crueltyfreeneu",
        "https://www.facebook.com/people",
      ]),
    );
    expect(rejected).not.toContain("https://www.instagram.com/harvardumg");
    expect(rejected).not.toContain("https://www.facebook.com/hu.cbe.21");
  });

  it("rejects a school's accounts on a club that only shares its acronym, YouTube included", () => {
    const hbsClub = club("HBS Entrepreneurship Club");
    const crimson = club("The Harvard Crimson");
    const iop = club("Harvard Institute of Politics", { acronym: "IOP" });
    const roxbury = club("Roxbury Youth Initiative");
    const site = (c: AuditClub, kind: string, url: string, handle: string) =>
      linkOf(c, kind, url, { handle, discoveredVia: ["club_website"] });
    const d = data([hbsClub, crimson, iop, roxbury], {
      links: [
        site(hbsClub, "tiktok", "https://www.tiktok.com/@harvardhbs", "harvardhbs"),
        site(hbsClub, "youtube", "https://www.youtube.com/user/harvardbschool", "harvardbschool"),
        site(crimson, "instagram", "https://www.instagram.com/thecrimson", "thecrimson"),
        site(iop, "instagram", "https://www.instagram.com/harvardiop", "harvardiop"),
        site(roxbury, "youtube", "https://www.youtube.com/user/wixmypage", "wixmypage"),
        // An unfamiliar YouTube handle stays: channels are often named after a person or show.
        site(roxbury, "youtube", "https://www.youtube.com/@ryitalks", "ryitalks"),
      ],
    });
    const rejected = checkLinks(d)
      .filter((f) => f.fix && f.confidence === "high")
      .map((f) => f.subject);
    expect(rejected).toEqual(
      expect.arrayContaining([
        "https://www.tiktok.com/@harvardhbs",
        "https://www.youtube.com/user/harvardbschool",
        "https://www.youtube.com/user/wixmypage",
      ]),
    );
    expect(rejected).not.toContain("https://www.instagram.com/thecrimson");
    expect(rejected).not.toContain("https://www.instagram.com/harvardiop");
    expect(rejected).not.toContain("https://www.youtube.com/@ryitalks");
  });

  it("also rejects the facts a wrong page left behind", () => {
    const hbs = club("HBS Entrepreneurship Club", { college: false });
    const page = "https://hbs.edu/mba/student-life/activities-government-and-clubs/student-clubs/fintech-club";
    const summary = claimOf(hbs, "club.summary", "A fintech club.", [{ sourceUrl: page }]);
    const fs = checkLinks(data([hbs], { claims: [summary], links: [linkOf(hbs, "website", page)] }));
    const fix = fs.find((f) => f.check === "link.directory_page_other_org")?.fix;
    expect(fix?.kind === "reject_claims" ? fix.claimIds : []).toContain(summary.id);
  });
});

describe("content checks", () => {
  it("rejects listing text and page furniture; only flags cosmetic problems", () => {
    const vgdc = club("Harvard College Video Game Development Club");
    const hmmt = club("Harvard-MIT Mathematics Tournament");
    const sp = club("The Harvard Speech and Parliamentary Debate Society");
    const ev = {
      method: "llm",
      extractor: "llm-summary",
      quote: "Video Game Development Club (VGDC) - Dedicated to the learning and practice of video game development",
    };
    const d = data([vgdc, hmmt, sp], {
      claims: [
        claimOf(
          vgdc,
          "club.summary",
          "Student group dedicated to video game development, listed among computer science clubs.",
          [ev],
        ),
        claimOf(
          hmmt,
          "club.long_description",
          "This page is for current students at Harvard or MIT who are interested in helping.",
        ),
        claimOf(
          sp,
          "club.short_description",
          "fields one of the top intercollegiate debate teams in the world.[citation needed]",
        ),
      ],
    });
    const fs = checkContent(d);
    const fixed = fs.filter((f) => f.fix && f.confidence === "high").map((f) => f.check);
    expect(fixed).toEqual(expect.arrayContaining(["summary.describes_listing", "description.junk"]));
    // Sourced text with Wikipedia markers or a lowercase start is cleaned on display, not flagged.
    expect(fs.filter((f) => f.slug === sp.slug)).toEqual([]);
  });
});

describe("recruiting checks", () => {
  it("rejects dates whose weekday shows an old page, and event dates", () => {
    const cbb = club("The Crimson: Business Board");
    const opp = club("Harvard Opportunes");
    const d = data([cbb, opp], {
      claims: [
        claimOf(cbb, "cycle.deadline", { at: "2027-02-26", precision: "date", sourceText: "Saturday, Feb. 26" }, [{}], {
          termKey: "2027-spring",
        }),
        claimOf(
          opp,
          "cycle.opens_at",
          {
            at: "2026-09-03T20:00:00-04:00",
            precision: "datetime",
            sourceText: "OPEN REHEARSAL: Thursday, September 3, 7-8pm",
          },
          [{}],
          { termKey: "2026-fall" },
        ),
      ],
    });
    const fs = checkRecruiting(d).filter((f) => f.fix);
    expect(checks(fs)).toEqual(["recruiting.weekday_mismatch", "recruiting.event_date_not_application"]);
  });
});

describe("logo checks", () => {
  it("rejects sponsors' and widgets' marks, placeholders and white logos", () => {
    const cdt = club("Harvard Crimson Dance Team");
    const sci = club("Scientista");
    const hucbe = club("Harvard Undergraduate Consulting on Business and the Environment");
    const csa = club("Harvard-Radcliffe Chinese Students Association");
    const hss = club("Harvard College Symphony Society");
    const logo = (c: AuditClub, url: string) => claimOf(c, "club.logo", url, [{ sourceUrl: "https://club.example/" }]);
    const d = data([cdt, sci, hucbe, csa, hss], {
      claims: [
        logo(cdt, "https://static.wixstatic.com/media/02e630_x~mv2.webp/v1/fill/w_276,h_125/coop_harvard_logo1.webp"),
        logo(sci, "http://img.surfing-waves.com/images/swlogo.png"),
        logo(
          hucbe,
          "https://static.wixstatic.com/media/f3769f_x~mv2.png/v1/crop/x_2,y_0,w_690,h_251/fill/w_69,h_25,al_c,q_85,blur_2/x.png",
        ),
        logo(csa, "https://harvardradcliffecsa.org/imgs/whitelogotext.png"),
        logo(hss, "https://images.squarespace-cdn.com/content/v1/5fbd/HSS_Identifier_Burgundy.png"),
        logo(hss, "https://images.squarespace-cdn.com/content/v1/5fbd/favicon.ico?format=100w"),
      ],
    });
    const fixed = checkLogos(d).filter((f) => f.fix && f.confidence === "high");
    expect(fixed.map((f) => f.slug).sort()).toEqual([cdt.slug, csa.slug, hucbe.slug, hss.slug, sci.slug].sort());
    expect(fixed.find((f) => f.slug === hss.slug)?.subject).toMatch(/favicon/);
  });

  it("calls a filename photo-like only on whole words", () => {
    const j = club("Fictional Research Journal");
    const photoLike = (url: string) =>
      checkLogos(data([j], { claims: [claimOf(j, "club.logo", url, [{ sourceUrl: "https://club.example/" }])] })).some(
        (f) => f.check === "logo.photo_like",
      );
    expect(
      photoLike("https://club.example/wp-content/uploads/2026/09/cropped-Firefly_RemoveBackground-300x136.png"),
    ).toBe(false);
    expect(photoLike("https://club.example/uploads/teamwork-mark.png")).toBe(false);
    expect(photoLike("https://club.example/uploads/team-photo-2025.jpg")).toBe(true);
    expect(photoLike("https://club.example/uploads/IMG_4031.jpg")).toBe(true);
  });
});

describe("news mentions", () => {
  it("rejects stories that don't name the club; a truncated quote is only reviewed", () => {
    const ussl = club("Harvard Undergraduate Urban Sustainability Lab");
    const rugby = club("Harvard Men's Rugby Club");
    const jas = club("The John Adams Society: A Harvard Undergraduate Debating Society");
    const press = (c: AuditClub, quote: string) =>
      claimOf(c, "club.press_mention", { title: "Story", url: `https://news.example/${id("a")}` }, [
        { quote, sourceType: "harvard_crimson" },
      ]);
    const d = data([ussl, rugby, jas], {
      claims: [
        press(
          ussl,
          "ENCE builds on Harvard's current climate offerings, which include an environmental fellowship program.",
        ),
        press(ussl, `${"x ".repeat(119)}x`),
        press(rugby, "Harvard Rugby Club Packs Up Winnebagos And Heads South for the Dreadnought Tour"),
        press(jas, "the rising conspicuity of the John Adams Society, a conservative debating group"),
      ],
    });
    const fs = checkPress(d);
    expect(fs.filter((f) => f.check === "press.does_not_name_club").map((f) => f.slug)).toEqual([ussl.slug]);
    expect(fs.filter((f) => f.check === "press.name_after_cut").every((f) => !f.fix)).toBe(true);
    expect(
      namesClub(
        "Legislative Director of Act on a Dream at Harvard College",
        club("Harvard College Act On A Dream Student Organization"),
      ),
    ).toBe(true);
  });
});

describe("duplicates", () => {
  it("normalizes names so one organization listed twice is caught", () => {
    expect(nameKeys("Skiing (Club Sport)")).toEqual(nameKeys("Harvard Ski Club"));
    expect(nameKeys("PBHA Boston Refugee Youth Enrichment (BRYE) Tutoring")).toContain(nameKeys("BRYE Tutoring")[0]);
    expect(nameKeys("PBHA's Keylatch Mentor Program")).toEqual(nameKeys("Keylatch Mentoring"));
    expect(nameKeys("Harvard for Japan")).not.toEqual(nameKeys("Harvard Undergraduate Japan Society"));
    expect(nameKeys("Harvard Men's Soccer Club")).not.toEqual(nameKeys("Harvard Women's Soccer Club"));
  });

  it("merges only at high confidence, never a decided pair, and keeps the better-sourced club", () => {
    const ski = club("Harvard Ski Club");
    const skiing = club("Skiing (Club Sport)");
    const thud = club("HarvardTHUD", { shortDescription: "(The Harvard Undergraduate Drummers)" });
    const drummers = club("The Harvard Undergraduate Drummers");
    const bio1 = club("Harvard College Biotechnology Club");
    const bio2 = club("Harvard Undergraduate Biotechnology Club");
    const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const d = data([ski, skiing, thud, drummers, bio1, bio2], {
      claims: [claimOf(skiing, "club.name", "Skiing (Club Sport)", [{}, {}])],
      decidedPairs: new Set([key(bio1.id, bio2.id)]),
    });
    const merges = checkDuplicates(d).filter((f) => f.fix?.kind === "merge");
    expect(merges.map((f) => f.subject).sort()).toEqual(
      [`${ski.slug} → ${skiing.slug}`, `${thud.slug} → ${drummers.slug}`].sort(),
    );
  });
});

describe("renames found through shared accounts", () => {
  it("merges a club listed under an old acronym when the other uses it as a handle and they share a page", () => {
    const hcura = club("HCURA");
    const hura = club("Harvard Undergraduate Research Association");
    const fb = "https://facebook.com/harvardresearch";
    const d = data([hcura, hura], {
      links: [
        linkOf(hcura, "facebook", fb, { normalizedUrl: fb }),
        linkOf(hura, "facebook", fb, { normalizedUrl: fb }),
        linkOf(hura, "linkedin", "https://linkedin.com/company/hcura", { handle: "hcura" }),
      ],
    });
    expect(checkDuplicates(d).filter((f) => f.fix?.kind === "merge")).toHaveLength(1);
    // Without a shared page, a matching handle alone is not enough.
    const d2 = data([hcura, hura], {
      links: [linkOf(hura, "linkedin", "https://linkedin.com/company/hcura", { handle: "hcura" })],
    });
    expect(checkDuplicates(d2).filter((f) => f.fix?.kind === "merge")).toHaveLength(0);
  });
});

describe("summary output checks", () => {
  it("refuses summaries about the listing or with hype the source lacks", async () => {
    const { checkSummary } = await import("../src/stages/summarize");
    const text = "GSAS Harvard Big Data Club (HBDC) - GSAS club focusing on big data";
    expect(
      checkSummary(
        {
          summary: "Graduate club centered on big data, listed for students in applied mathematics.",
          basis_quote: "GSAS club focusing on big data",
        },
        text,
      ),
    ).toMatchObject({ ok: false });
    expect(
      checkSummary(
        {
          summary: "The premier graduate club for big data at Harvard and beyond.",
          basis_quote: "GSAS club focusing on big data",
        },
        text,
      ),
    ).toMatchObject({ ok: false });
    expect(
      checkSummary(
        {
          summary: "Graduate student club focused on big data and its applications.",
          basis_quote: "GSAS club focusing on big data",
        },
        text,
      ),
    ).toMatchObject({ ok: true });
  });
});

describe("consistency", () => {
  it("rejects facts whose only source is a website rejected for the club, but not Harvard directory facts", () => {
    const hmc = club("Harvard Model Congress");
    const rejectedSite = claimOf(hmc, "club.link", { kind: "website", url: "https://hmcsanfran.org" }, [{}], {
      status: "rejected",
    });
    const fromSf = claimOf(hmc, "cycle.deadline", { at: "2026-10-05", precision: "date" }, [
      { sourceUrl: "https://hmcsanfran.org/apply" },
    ]);
    const fromPbha = claimOf(hmc, "club.short_description", "Text", [
      { sourceUrl: "https://hmcsanfran.org/x", sourceType: "harvard_official", tier: 1 },
    ]);
    const d = data([hmc], { claims: [fromSf, fromPbha], rejectedLinkClaims: [rejectedSite] });
    const fixed = checkConsistency(d).filter((f) => f.check === "consistency.evidence_from_rejected_site");
    expect(fixed.flatMap((f) => (f.fix?.kind === "reject_claims" ? f.fix.claimIds : []))).toEqual([fromSf.id]);
  });

  it("flags overstated confidence and projections that show inactive claims", () => {
    const c = club("Harvard Chess Club", { displayedClaimIds: new Set(["gone"]) });
    const over = claimOf(c, "club.short_description", "Chess.", [{ confidence: 0.99 }]);
    const fs = checkConsistency(data([c], { claims: [over] }));
    expect(checks(fs)).toEqual(
      expect.arrayContaining(["consistency.confidence_overstated", "consistency.displays_inactive_claim"]),
    );
  });
});

describe("runChecks", () => {
  it("rejects a claim once even when two checks flag it, highest-ranked first", () => {
    const c = club("Harvard Undergraduate Plant Based");
    const l = linkOf(c, "instagram", "https://www.instagram.com/crueltyfreeneu", { handle: "crueltyfreeneu" });
    const fs = runChecks(data([c], { links: [l, { ...l }] }), ["links"]);
    const ids = fs.flatMap((f) => (f.fix?.kind === "reject_claims" ? f.fix.claimIds : []));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("review round (ADR 0033)", () => {
  it("rejects descriptions that are only years", () => {
    const fly = club("Fly Club");
    const jazz = club("Harvard Jazz Orchestra");
    const deepam = club("Harvard Undergraduate Deepam");
    const d = data([fly, jazz, deepam], {
      claims: [
        claimOf(fly, "club.short_description", "(1836, 1878)"),
        claimOf(jazz, "club.short_description", "founded in 1971."),
        claimOf(deepam, "club.short_description", "performs Bharatanatyam."),
      ],
    });
    const junk = checkContent(d).filter((f) => f.check === "description.junk");
    expect(junk.map((f) => f.slug).sort()).toEqual([fly.slug, jazz.slug].sort());
  });

  it("rejects website-builder template copy (Wix 'Visitors will want to know…')", () => {
    const cssa = club("Harvard Chinese Students & Scholars Association");
    const ok = club("Harvard Undergraduate Design Collective");
    const d = data([cssa, ok], {
      claims: [
        claimOf(
          cssa,
          "club.short_description",
          "Visitors will want to know who is on the other side of the page. Use this space to write about yourself.",
        ),
        claimOf(
          cssa,
          "club.long_description",
          "Article One: Name and Relation with HCSSA The name of this organization shall be the Harvard Chinese Students and Scholars Association.",
        ),
        claimOf(ok, "club.short_description", "A space to learn design tools and visitors' favorite projects."),
      ],
    });
    const junk = checkContent(d).filter((f) => f.check === "description.junk");
    expect(junk.map((f) => f.slug)).toEqual([cssa.slug, cssa.slug]);
  });

  it("treats a conference's registration dates as events, not recruiting", () => {
    for (const q of [
      "Early Bird Registration Deadline*: July 10, 2026",
      "Priority Registration Deadline: September 1, 2026",
      "Session II Registration Deadline: November 6, 2026",
      "Registration Opens*: May 18, 2026",
    ])
      expect(eventDateProblem(q), q).not.toBeNull();
    expect(eventDateProblem("Applications are due September 12th at 11:59 PM.")).toBeNull();
  });

  it("rejects a stored date that names only a weekday", () => {
    const c = club("Example Theater Club");
    const weekday = claimOf(
      c,
      "cycle.deadline",
      { at: "2026-10-04T14:00:00-04:00", precision: "datetime", sourceText: "due at 2:00 pm on Sunday" },
      [{ quote: "Pitches are due at 2:00 pm on Sunday.", snapshotFetchedAt: new Date("2026-09-30T12:00:00Z") }],
      { termKey: "2026-fall" },
    );
    const dated = claimOf(
      c,
      "cycle.deadline",
      { at: "2026-10-09", precision: "date", sourceText: "due Friday, October 9" },
      [{ quote: "Applications are due Friday, October 9." }],
      { termKey: "2026-fall" },
    );
    const got = checkRecruiting(data([c], { claims: [weekday, dated] })).filter(
      (f) => f.check === "recruiting.weekday_only_date",
    );
    expect(got.map((f) => f.subject)).toEqual([expect.stringContaining("2026-10-04")]);
  });

  it("drops a cycle's other claims when its term came only from rejected dates (ADR 0039)", () => {
    const c = club("Example Business Board");
    const old = { snapshotId: "snap-2022-page" };
    // The guessed-year dates on this page were rejected; its stage list for "2027-spring" remains.
    const stages = claimOf(c, "cycle.stages", [{ kind: "info_session" }], [old], { termKey: "2027-spring" });
    const otherPage = claimOf(c, "cycle.stages", [{ kind: "interview" }], [{ snapshotId: "snap-other" }], {
      termKey: "2027-spring",
    });
    const rejectedDatePages = new Map([[`${c.id}|2027-spring`, new Set(["snap-2022-page"])]]);
    const got = checkRecruiting(data([c], { claims: [stages, otherPage], rejectedDatePages })).filter(
      (f) => f.check === "recruiting.term_from_rejected_dates",
    );
    expect(got.map((f) => f.fix?.kind === "reject_claims" && f.fix.claimIds)).toEqual([[stages.id]]);
    // A live date for the cycle keeps everything.
    const live = claimOf(c, "cycle.deadline", { at: "2027-02-20", precision: "date" }, [{}], {
      termKey: "2027-spring",
    });
    expect(
      checkRecruiting(data([c], { claims: [stages, live], rejectedDatePages })).filter(
        (f) => f.check === "recruiting.term_from_rejected_dates",
      ),
    ).toEqual([]);
  });

  it("never reads 'no auditions' as an audition", () => {
    // Real quotes behind active claims before this check existed.
    expect(
      negatedProcessProblem("tryout", "There are no tryouts and no cuts; every practice includes instruction."),
    ).not.toBeNull();
    expect(
      negatedProcessProblem("audition", "AADT is proud of our non-audition, all-are-welcome policy."),
    ).not.toBeNull();
    expect(negatedProcessProblem("audition", "We hold no auditions and require no prior experience.")).not.toBeNull();
    expect(
      negatedProcessProblem("comp", "Joining is really easy—we have no comp process or application."),
    ).not.toBeNull();
    // A process that exists, or one negated for some roles only, stays.
    expect(negatedProcessProblem("audition", "Auditions are held each September.")).toBeNull();
    expect(
      negatedProcessProblem(
        "audition",
        "No auditions for the chorus; soloists audition in October. Auditions are short.",
      ),
    ).toBeNull();
  });

  it("reads outsider applications from the sentence or the text right around it", () => {
    expect(outsiderApplicationProblem("partial scholarship Applications are due on October 8th, 2026.")).not.toBeNull();
    expect(outsiderApplicationProblem("Deadline October 2, 2026, capped at 100 entries.")).not.toBeNull();
    // A national organization's program deadline, posted on its own site (Nucleate class).
    expect(
      outsiderApplicationProblem("Applications are open! The deadline for US chapters is October 20th."),
    ).not.toBeNull();
    expect(
      outsiderApplicationProblem(
        "Applications are due October 10th.",
        "Teams are expected to obtain consent from respective tech transfer offices to enter. Applications are due October 10th.",
      ),
    ).not.toBeNull();
    expect(outsiderLinkProblem("Alumni Partnering Portal", "https://airtable.com/appX/shrY")).not.toBeNull();
    expect(outsiderLinkProblem("Become a sponsor", "https://forms.gle/x")).not.toBeNull();
    expect(outsiderLinkProblem("Apply to join", "https://forms.gle/x")).toBeNull();
    // HFAC: a stock-pitch competition is not how members join; the comp page is.
    expect(
      outsiderLinkProblem("HFAC x Citadel 2026 Stock Pitch Comp", "https://harvardfac.org/hfac-citadel-pitch-comp"),
    ).not.toBeNull();
    expect(outsiderLinkProblem("Comp", "https://harvardfac.org/comp-1")).toBeNull();
    expect(outsiderApplicationProblem("Member applications are due September 12.")).toBeNull();
    expect(outsiderApplicationProblem("Applications are due September 12th at 11:59 PM.")).toBeNull();
    expect(outsiderApplicationProblem("BIT is Hiring in London, Apply by February 22nd")).not.toBeNull();
    // A timeline step on a page that mentions a high-school outreach project far away stays.
    const page = `ENVISION empowers high school students to explore STEM. ${"Project details. ".repeat(60)}By Sep 22 teams are selected.`;
    expect(outsiderApplicationProblem("By Sep 22 teams are selected.", page)).toBeNull();
    expect(
      outsiderApplicationProblem(
        "Deadline October 2, 2026",
        "A writing competition for high school students. Deadline October 2, 2026",
      ),
    ).not.toBeNull();
  });

  it("reads a page's years from apostrophe terms and hyphenated URL paths", () => {
    const at = new Date("2026-10-01T12:00:00Z");
    expect(pageYears({ url: "https://hrdc.test/news/spring-2016-applications", title: null, text: "" }, at)).toEqual([
      2016,
    ]);
    expect(
      pageYears({ url: "https://x.test/", title: null, text: "Spring ’16 PRE-APPLICATION — due 11/22" }, at),
    ).toEqual([2016]);
    // A class year is not the page's date.
    expect(pageYears({ url: "https://x.test/", title: null, text: "Welcome, Class of ’29!" }, at)).toEqual([]);
  });

  it("rejects a date whose year was guessed on an old page, keeps one the page dates", () => {
    const hrdc = club("The Harvard-Radcliffe Dramatic Club");
    const lho = club("Lowell House Opera");
    const old = claimOf(
      hrdc,
      "cycle.deadline",
      { at: "2026-11-22", precision: "date", sourceText: "due 11/22" },
      [
        {
          quote: "Spring ’16 PRE-APPLICATION— due 11/22",
          snapshotId: "s-old",
          sourceUrl: "https://hrdc.test/news/spring-2016-applications",
        },
      ],
      { termKey: "2026-fall" },
    );
    const current = claimOf(
      lho,
      "cycle.deadline",
      { at: "2026-10-23", precision: "date", sourceText: "October 23" },
      [{ quote: "Submit materials by October 23.", snapshotId: "s-new", sourceUrl: "https://lho.test/audition" }],
      { termKey: "2026-fall" },
    );
    const d = data([hrdc, lho], {
      claims: [old, current],
      snapshotText: new Map([
        ["s-old", "Spring ’16 PRE-APPLICATION— due 11/22"],
        ["s-new", "2026–27 season. Submit materials by October 23."],
      ]),
    });
    const flagged = checkRecruiting(d).filter((f) => f.check === "recruiting.year_guessed_on_old_page");
    expect(flagged.map((f) => f.slug)).toEqual([hrdc.slug]);
  });

  it("rejects a yearless date on a news post that states no year at all (ADR 0040)", () => {
    const hrdc = club("The Harvard-Radcliffe Dramatic Club");
    const lho = club("Lowell House Opera");
    const pool = claimOf(
      hrdc,
      "cycle.deadline",
      { at: "2026-12-21", precision: "date", sourceText: "due by the time of the last exam on Dec. 21" },
      [
        {
          quote: "Applications are due by the time of the last exam on Dec. 21.",
          snapshotId: "s-pool",
          sourceUrl: "https://hrdc.test/news/adams-pool-theater-applications",
        },
      ],
      { termKey: "2026-fall" },
    );
    // The club's own audition page (not a post) with no year: the year is the current one.
    const audition = claimOf(
      lho,
      "cycle.deadline",
      { at: "2026-10-23", precision: "date", sourceText: "October 23" },
      [{ quote: "Submit materials by October 23.", snapshotId: "s-aud", sourceUrl: "https://lho.test/audition" }],
      { termKey: "2026-fall" },
    );
    const d = data([hrdc, lho], {
      claims: [pool, audition],
      snapshotText: new Map([
        [
          "s-pool",
          "Apply to direct or produce in the Adams Pool! Applications are due by the time of the last exam on Dec. 21.",
        ],
        ["s-aud", "Submit materials by October 23."],
      ]),
    });
    const flagged = checkRecruiting(d).filter((f) => f.check === "recruiting.year_guessed_on_old_page");
    expect(flagged.map((f) => f.slug)).toEqual([hrdc.slug]);
    // A production or venue application is not an application to join.
    expect(eventDateProblem("Adams Pool Theater Applications – Harvard-Radcliffe Dramatic Club")).not.toBeNull();
    expect(leadershipApplicationProblem("Apply to Join HUMA Board 2025-26!")).not.toBeNull();
    expect(leadershipApplicationProblem("Board Applications Apply here before 1/24/2024.")).not.toBeNull();
    expect(
      leadershipApplicationProblem(
        "Our application consists of a resume drop & an interview with members of the Board.",
      ),
    ).toBeNull();
    expect(
      leadershipApplicationProblem(
        "If you're interested in joining HUSL or becoming a board member, fill out the form below.",
      ),
    ).toBeNull();
  });

  it("tells a scholarship or delegate form from a club's application form", () => {
    expect(
      outsiderLinkProblem("this form", "https://forms.gle/x", "https://hmcasia.org/full-scholarship-application"),
    ).not.toBeNull();
    expect(outsiderLinkProblem("Apply", "https://swe.org/apply-for-a-swe-scholarship")).not.toBeNull();
    expect(outsiderLinkProblem("Delegate Registration", "https://example-mun.test/register")).not.toBeNull();
    expect(
      outsiderLinkProblem("Apply to join our board", "https://forms.gle/x", "https://example.test/join"),
    ).toBeNull();
    expect(outsiderLinkProblem("Register for tryouts", "https://forms.gle/x")).toBeNull();
  });

  it("drops the career center's blanket pre-professional label only where the club has another category", () => {
    const signet = club("The Signet Society", { topCategories: ["social", "pre-professional"] });
    const woodbridge = club("Woodbridge Society of International Students", { topCategories: ["pre-professional"] });
    const stamp = (c: AuditClub) =>
      claimOf(c, "club.category", "pre-professional", [{ extractor: "mignone-student-clubs", method: "html_parse" }]);
    const d = data([signet, woodbridge], {
      claims: [
        stamp(signet),
        claimOf(signet, "club.category", "social", [{ extractor: "llm-categorize", method: "llm" }]),
        stamp(woodbridge),
      ],
      categoryTop: new Map([
        ["social", "social"],
        ["pre-professional", "pre-professional"],
      ]),
    });
    const fixed = checkCategories(d).filter((f) => f.check === "category.career_center_stamp" && f.fix);
    expect(fixed.map((f) => f.slug)).toEqual([signet.slug]);
  });

  it("treats Wikipedia's section and a categorizer reading the career page as the same stamp, unless the name is business-like", () => {
    const robots = club("Fictional Robotics Club", { topCategories: ["technology", "pre-professional"] });
    const quant = club("Fictional Quant Traders", { topCategories: ["technology", "pre-professional"] });
    const listed = (c: AuditClub) =>
      claimOf(c, "club.category", "pre-professional", [
        { extractor: "mignone-student-clubs", method: "html_parse" },
        { extractor: "wikipedia-harvard-orgs", method: "html_parse" },
        {
          extractor: "llm-categorize",
          method: "llm",
          sourceUrl: "https://careerservices.fas.harvard.edu/organizations/x",
        },
      ]);
    const d = data([robots, quant], {
      claims: [
        listed(robots),
        claimOf(robots, "club.category", "technology", [{ extractor: "seas-student-orgs", method: "html_parse" }]),
        listed(quant),
        claimOf(quant, "club.category", "technology", [{ extractor: "seas-student-orgs", method: "html_parse" }]),
      ],
      categoryTop: new Map([
        ["technology", "technology"],
        ["pre-professional", "pre-professional"],
      ]),
    });
    const fixed = checkCategories(d).filter((f) => f.check === "category.career_center_stamp" && f.fix);
    expect(fixed.map((f) => f.slug)).toEqual([robots.slug]);
  });

  it("settles a cut news quote with the stored article", () => {
    const opp = club("Harvard Opportunes");
    const cut = `${"x ".repeat(119)}x`;
    const article = (c: AuditClub, snapshotId: string) =>
      claimOf(c, "club.press_mention", { title: "Story", url: `https://news.example/${snapshotId}` }, [
        { quote: cut, snapshotId, sourceType: "harvard_crimson" },
      ]);
    const d = data([opp], {
      claims: [article(opp, "named"), article(opp, "unnamed")],
      articleText: new Map([
        ["named", "… the Harvard Opportunes performed at Sanders …"],
        ["unnamed", "An article about something else entirely."],
      ]),
    });
    const fs = checkPress(d);
    expect(fs.map((f) => f.check)).toEqual(["press.does_not_name_club"]);
    expect(fs[0]?.subject).toBe("https://news.example/unnamed");
  });

  it("reads 'harvard' + an abbreviation as the club's handle", () => {
    expect(identityScore("harvardcap", club("Harvard Undergraduate Capital Partners"))).toBeGreaterThan(0);
    expect(identityScore("harvardrepclub", club("The Harvard Republican Club"))).toBeGreaterThan(0);
    expect(identityScore("harvardir", club("The Harvard International Review"))).toBeGreaterThan(0);
    expect(identityScore("hgscf", club("Harvard Undergraduate Christian Fellowship"))).toBe(0);
  });

  it("stops reporting findings a person dismissed", () => {
    const c = club("Harvard Undergraduate Plant Based");
    const l = linkOf(c, "instagram", "https://www.instagram.com/someoneelse", { handle: "someoneelse" });
    expect(runChecks(data([c], { links: [l] }), ["links"])).toHaveLength(1);
    const dismissed = new Set([`social.unrelated_handle|${c.id}|*`]);
    expect(runChecks(data([c], { links: [l], dismissed }), ["links"])).toHaveLength(0);
  });

  it("doesn't call a verb marketing", () => {
    const c = club("PBHA's Harvard Artists for Alzheimer's");
    const summary = claimOf(
      c,
      "club.summary",
      "Student volunteers leading weekly themed art activities for nursing home residents.",
      [{ method: "llm", extractor: "llm-summary", quote: "HARTZ provides weekly art programming", snapshotId: "p" }],
    );
    const d = data([c], {
      claims: [summary],
      snapshotText: new Map([["p", "HARTZ provides weekly art programming and companionship"]]),
    });
    expect(checkContent(d).map((f) => f.check)).not.toContain("summary.marketing_language");
  });
});

describe("launch audit (2026-10-01)", () => {
  it("rejects descriptions that name people or are contact/team-page text", () => {
    const hureig = club("Harvard Undergraduate Real Estate Investment Group");
    const pbha = club("PBHA's Keylatch Mentoring");
    const sca = club("Small Claims Advisory Service");
    const peer = club("Contact Peer Counseling");
    const d = data([hureig, pbha, sca, peer], {
      claims: [
        claimOf(
          hureig,
          "club.short_description",
          "Harvard's real estate group, led by Jaeden Kinlock and Landon Elks.",
        ),
        claimOf(pbha, "club.short_description", "Staff Contact Information: Tati Burgos tatiana@pbha.org"),
        // "contact information" inside a real description is fine.
        claimOf(sca, "club.short_description", "Gives residents relevant laws and contact information to get help."),
        // A club whose name starts with "Contact" is not a contact line.
        claimOf(peer, "club.short_description", "Contact Peer Counseling is a confidential peer counseling group."),
      ],
    });
    const fs = checkContent(d).filter((f) => f.fix);
    expect(fs.map((f) => [f.slug, f.check]).sort()).toEqual(
      [
        [hureig.slug, "description.names_people"],
        [pbha.slug, "description.junk"],
      ].sort(),
    );
  });

  it("names_people leaves public figures and roles without names alone", async () => {
    const { namedLeader } = await import("../src/audit/checks/content");
    expect(namedLeader("a living memorial to President John F. Kennedy.")).toBeNull();
    expect(namedLeader("Weekly meetings led by the student chair")).toBeNull();
    // Founding stories name students without "founded by".
    expect(
      namedLeader("In the fall of 1986, Morgan Inniss and Craig Hickman, two college freshmen, noticed a gap."),
    ).toBe("Morgan Inniss");
    expect(namedLeader("Jane Doe, a junior in Lowell House, started the group.")).toBe("Jane Doe");
    expect(namedLeader("Harvard College, a student-run group, hosts events.")).toBeNull();
    expect(namedLeader("Harvard Investment Association, the oldest group of undergraduate investors.")).toBeNull();
    expect(namedLeader("Harvard Undergraduate Research Association, a community of undergraduates.")).toBeNull();
    expect(namedLeader("Contact one of our comp directors, Valencia Zhang")).toBe("Valencia Zhang");
    expect(namedLeader("In 2019, our founders, Olivia Ostrover and Mackenzie Barta")).toBe("Olivia Ostrover");
  });

  it("flags a website whose host no longer resolves, for review", () => {
    const ewb = club("Harvard College Engineers Without Borders");
    const d = data([ewb], {
      links: [
        linkOf(ewb, "website", "https://harvardewb.org", {
          lastFetch: {
            status: "network_error",
            httpStatus: null,
            at: NOW,
            error: "host unreachable: getaddrinfo ENOTFOUND harvardewb.org",
          },
        }),
      ],
    });
    // One failed fetch is a lead, not a dead site (a local DNS outage looks the same).
    const f = checkLinks(d).find((x) => x.check === "link.unreachable");
    expect(f).toMatchObject({ severity: "medium", fix: null });
    // A week of failures with no success in between is "high" (still review-only).
    const week = data([ewb], {
      links: [
        linkOf(ewb, "website", "https://harvardewb.org", {
          lastFetch: {
            status: "network_error",
            httpStatus: null,
            at: NOW,
            error: "host unreachable: getaddrinfo ENOTFOUND harvardewb.org",
            failures: 3,
            failingSince: new Date(NOW.getTime() - 10 * 86_400_000),
          },
        }),
      ],
    });
    expect(checkLinks(week).find((x) => x.check === "link.unreachable")).toMatchObject({
      severity: "high",
      confidence: "high",
      fix: null,
    });
  });

  it("tells certificate problems apart from dead hosts", () => {
    const c = club("Fictional Medical Innovation Alliance");
    const tls = (error: string) =>
      checkLinks(
        data([c], {
          links: [
            linkOf(c, "website", "https://fictional-alliance.example", {
              lastFetch: { status: "network_error", httpStatus: null, at: NOW, error: `host unreachable: ${error}` },
            }),
          ],
        }),
      ).map((x) => [x.check, x.severity]);
    expect(tls("Hostname/IP does not match certificate's altnames")).toEqual([["link.tls_error", "low"]]);
    expect(tls("unable to get local issuer certificate")).toEqual([["link.tls_chain_incomplete", "low"]]);
    expect(tls("The operation was aborted due to timeout")).toEqual([["link.unreachable", "medium"]]);
  });

  it("flags personal, placeholder and malformed email links; keeps role addresses", () => {
    const hsa = club("Harvard Student Agencies", { acronym: "HSA" });
    const d = data([hsa], {
      links: [
        linkOf(hsa, "email", "mailto:charlie.meyer@hsa.net"),
        linkOf(hsa, "email", "mailto:info@mysite.com"),
        linkOf(hsa, "email", "mailto:tutoring@hsa.net"),
        linkOf(hsa, "email", "mailto:info@hsa.net"),
      ],
    });
    const fs = checkLinks(d).filter((f) => f.check.endsWith("_email"));
    expect(fs.map((f) => [f.subject, f.check, Boolean(f.fix)])).toEqual([
      ["mailto:charlie.meyer@hsa.net", "link.personal_email", false],
      ["mailto:info@mysite.com", "link.placeholder_email", true],
    ]);
  });
});

describe("self-described selectivity is about joining the club", () => {
  it("keeps the club's own process and rejects colleges, partners and outward programs", () => {
    const ok = [
      "BDC actively selects the most talented students at Harvard through a highly competitive recruitment process.",
      "Members are selected among graduates of the comp through a highly competitive process, yielding a 2.7% acceptance rate.",
      "Our application process is highly selective.",
    ];
    const bad = [
      "Successful admission at the country’s most prestigious and highly competitive colleges such as Harvard, MIT, Stanford, and Yale requires a highly orchestrated process.",
      "We work with a highly selective group of partners from public market leaders to defining technology startups.",
      "GlobalWE has since launched a highly selective Global Ambassador Program to extend its mission beyond Harvard.",
      "Consulting is a highly competitive industry.",
      "The event was highly competitive this year.",
    ];
    for (const q of ok) expect(selfDescribedSelectivityProblem(q), q).toBeNull();
    for (const q of bad) expect(selfDescribedSelectivityProblem(q), q).not.toBeNull();
  });
});

describe("descriptions spoken by another organization", () => {
  it("rejects a sponsor's 'At X, our mission' and keeps the club's own", async () => {
    const { otherOrganizationProblem } = await import("../src/extract/evidence-rules");
    const club = { name: "The Crimson: Business Board", acronym: null, aliases: [] };
    expect(
      otherOrganizationProblem(
        "At College Ready, our mission is to help families build similar success stories.",
        club,
      ),
    ).not.toBeNull();
    expect(
      otherOrganizationProblem("At Harvard Union, we are dedicated to fostering intellectual growth.", {
        name: "Harvard College Union Society",
        acronym: null,
        aliases: [],
      }),
    ).toBeNull();
    expect(
      otherOrganizationProblem("At HUUSL, we provide undergraduates with ways to engage with urban issues.", {
        name: "Harvard Undergraduate Urban Sustainability Lab",
        acronym: "HUUSL",
        aliases: [],
      }),
    ).toBeNull();
    expect(otherOrganizationProblem("Our mission is to build community.", club)).toBeNull();
    // The club's own initials, with no acronym on record.
    expect(
      otherOrganizationProblem("At HESIRC, we host speakers on global affairs.", {
        name: "Harvard Extension School International Relations Club",
        acronym: null,
        aliases: [],
      }),
    ).toBeNull();
  });
});

describe("facts from posts and outsider programs", () => {
  it("knows a post or article URL from a page about the club", async () => {
    const { isArticleUrl } = await import("../src/extract/evidence-rules");
    for (const u of [
      "https://club.example/blog/2025/1/9/what-about-deontology",
      "https://club.example/pubarchives/2019/10/how-should-we-think",
      "https://club.example.tumblr.com/post/1560/bit-is-hiring",
      "https://club.example/2011/12/03/launching-the-challenge",
      "https://business.example.com/case-study-campus-recruiters",
      "https://club.example/news/adams-pool-theater-applications",
    ])
      expect(isArticleUrl(u), u).toBe(true);
    for (const u of [
      "https://club.example/",
      "https://club.example/about",
      "https://club.example/join",
      "https://club.example/news",
    ])
      expect(isArticleUrl(u), u).toBe(false);
  });
  it("reads outsider programs from the text around an application", () => {
    expect(
      outsiderApplicationProblem(
        "APPLY HERE!",
        "Graduate students invited to apply for the Mind Brain fellowship. APPLY HERE!",
      ),
    ).not.toBeNull();
    expect(
      outsiderApplicationProblem(
        "Applications are open until March 12, 2018.",
        "Apply to the Summer Institute on Bounded Rationality. Applications are open until March 12, 2018.",
      ),
    ).not.toBeNull();
    expect(
      outsiderApplicationProblem(
        "Applications for new tutors are due Friday.",
        "Our program tutors teens in Chinatown. Applications for new tutors are due Friday.",
      ),
    ).toBeNull();
    // A club that recruits members and also runs a high-school contest still recruits.
    expect(
      outsiderApplicationProblem(
        "Applications for the Fall 2026 semester are now closed.",
        "Interested in joining the review? Applications for the Fall 2026 semester are now closed. The High School Essay Contest is accepting submissions.",
      ),
    ).toBeNull();
  });
});

describe("recruiting dates near program mentions", () => {
  it("keeps a club's own fellowship that mentions startups; rejects a startup pitch competition", () => {
    expect(
      outsiderApplicationProblem(
        "Fall 2026 applications closed on September 29th, 2026.",
        "Why Apply? We keep close relationships with a growing network of early-stage startups. Fall 2026 applications closed on September 29th, 2026.",
      ),
    ).toBeNull();
    expect(
      outsiderApplicationProblem(
        "The deadline to apply is March 25th, 2026.",
        "Pitch your startup. We are opening our pitch competition to startups globally. The deadline to apply is March 25th, 2026.",
      ),
    ).not.toBeNull();
  });
});

describe("joining inconsistencies (ADR 0041)", () => {
  const facts = (over: Partial<Joining>): Joining => ({ ...UNKNOWN_JOINING, ...over });
  it("reports mixed access, first-year and comp conflicts, never fixing them", () => {
    const band = club("Harvard University Band", {
      joining: facts({ access: "mixed", general: ["open", "audition"], conflicts: ["access"] }),
    });
    const both = club("Two Pages Club", { joining: facts({ conflicts: ["firstYears", "comp"] }) });
    const fine = club("Open Chess Club", { joining: facts({ access: "open", general: ["open"] }) });
    const found = checkJoining(data([band, both, fine]));
    expect(found.map((f) => [f.slug, f.check]).sort()).toEqual([
      ["harvard-university-band", "joining.mixed_access"],
      ["two-pages-club", "joining.comp_conflict"],
      ["two-pages-club", "joining.first_years_conflict"],
    ]);
    expect(found.every((f) => f.fix === null)).toBe(true);
  });

  it("flags an ended club whose recruiting shows as open", () => {
    const ended = club("Undergraduate Council", { activityStatus: "defunct" });
    const found = checkJoining(
      data([ended], {
        cycles: [
          {
            id: "cy1",
            clubId: ended.id,
            termKey: "2026-fall",
            opens: null,
            deadline: { at: "2026-10-20", precision: "date" },
            statedStatus: null,
          },
        ],
      }),
    );
    expect(found.map((f) => f.check)).toEqual(["joining.inactive_recruiting"]);
  });
});

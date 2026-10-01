import { describe, expect, it } from "vitest";
import { checkConsistency } from "../src/audit/checks/consistency";
import { checkContent } from "../src/audit/checks/content";
import { checkDuplicates, nameKeys } from "../src/audit/checks/duplicates";
import { checkLinks, sameOrgName, slugNamesOther, titleIsOtherOrg } from "../src/audit/checks/links";
import { checkLogos } from "../src/audit/checks/logos";
import { checkPress } from "../src/audit/checks/press";
import { checkRecruiting } from "../src/audit/checks/recruiting";
import { runChecks } from "../src/audit/run";
import { namesClub } from "../src/audit/text";
import type { AuditClaim, AuditClub, AuditData, AuditEvidence, AuditLink } from "../src/audit/types";
import {
  duesProblem,
  hoursProblem,
  memberCountProblem,
  openMembershipProblem,
  weekdayProblem,
} from "../src/extract/evidence-rules";

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
    links: [],
    cycles: [],
    decidedPairs: new Set(),
    snapshotText: new Map(),
    categoryTop: new Map(),
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
    expect(checks(fs)).toEqual(expect.arrayContaining(["description.wiki_markers", "description.fragment"]));
    expect(fs.filter((f) => f.slug === sp.slug).every((f) => !f.fix)).toBe(true);
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

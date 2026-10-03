import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { normalizeUrl } from "@hci/core";
import { createClub, schema, type Db } from "@hci/db";
import { createTestDb } from "@hci/db/testing";
import type { PageRenderer } from "../src/fetch/browser-fetcher";
import { silentLogger } from "../src/logger";
import { MemorySnapshotStore } from "../src/snapshots/store";
import {
  MIN_GAP_MS,
  blockSignal,
  collectInstagramFollowers,
  ogDescription,
  pickTargets,
  replaceBySlug,
} from "../src/stages/instagram-collect";
import {
  accountProblem,
  displayNameMatchesClub,
  parseProfileDescription,
  profileTextIdentity,
  runInstagramFollowers,
} from "../src/stages/instagram-followers";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/instagram-followers/${name}`, import.meta.url), "utf8");
const OG =
  "12K Followers, 250 Following, 282 Posts - See Instagram photos and videos from The Fictional Gazette (@fixturegazette)";
const SNIPPET =
  "4,356 followers, 232 following, 269 posts – The Fictional Gazette (@fixturegazette) on Instagram: “Ask @someoneelse (@otheraccount) about it”";

describe("profileTextIdentity", () => {
  it("reads the handle and display name from og:description and search snippets", () => {
    expect(profileTextIdentity(OG)).toEqual({ handle: "fixturegazette", displayName: "The Fictional Gazette" });
    // The bio quoted after the account may name other accounts; the first is the account's own.
    expect(profileTextIdentity(SNIPPET)).toEqual({ handle: "fixturegazette", displayName: "The Fictional Gazette" });
  });
  it("handles a missing display name and text that names no account", () => {
    expect(
      profileTextIdentity("514 followers, 12 following, 90 posts – see Instagram photos and videos from (@fixturex)"),
    ).toEqual({ handle: "fixturex", displayName: null });
    expect(
      profileTextIdentity("1 Followers, 2 Following, 3 Posts - See Instagram photos and videos from @fixturey"),
    ).toEqual({ handle: "fixturey", displayName: null });
    expect(profileTextIdentity("282 posts 11.9K followers 219 following (owner screenshot)").handle).toBeNull();
  });
});

describe("parseProfileDescription", () => {
  it("reads K/M and exact counts", () => {
    expect(parseProfileDescription(OG)).toEqual({
      followers: 12000,
      followersText: "12K Followers",
      handle: "fixturegazette",
      displayName: "The Fictional Gazette",
    });
    expect(parseProfileDescription(SNIPPET)?.followers).toBe(4356);
    expect(parseProfileDescription("1.2M Followers, 3 Following, 4 Posts - X (@x)")?.followers).toBe(1_200_000);
    expect(parseProfileDescription("12.5K Followers, 3 Following - X (@x)")?.followers).toBe(12_500);
  });
  it("returns null when the text doesn't open with a follower count", () => {
    expect(parseProfileDescription("250 Following, 12K Followers")).toBeNull();
    expect(parseProfileDescription("See Instagram photos and videos")).toBeNull();
  });
  it("reads the og:description from a saved profile page", () => {
    expect(ogDescription(fixture("profile.html"))).toBe(OG);
    expect(ogDescription(fixture("login-wall.html"))).toBeNull();
  });
});

describe("displayNameMatchesClub", () => {
  const club = (name: string, acronyms: string[] = []) => ({ names: [name], acronyms });
  it("matches a name made only of boilerplate word for word, and a short form without its closing generic word", () => {
    expect(displayNameMatchesClub("Harvard Undergraduate Association", club("Harvard Undergraduate Association"))).toBe(
      true,
    );
    expect(displayNameMatchesClub("Harvard Undergraduate Society", club("Harvard Undergraduate Association"))).toBe(
      false,
    );
    expect(
      displayNameMatchesClub("Harvard ROTC Association", club("Harvard Reserve Officer Training Corps Association")),
    ).toBe(true);
  });
  it("matches when the club's distinctive words are in the display name", () => {
    expect(displayNameMatchesClub("Active Minds @ Harvard/CAMHS", club("Active Minds Student Chapter at CAMHS"))).toBe(
      true,
    );
    expect(displayNameMatchesClub("Harvard Microbio Society", club("Harvard Undergraduate Microbiology Society"))).toBe(
      true,
    );
  });
  it("matches the club's acronym or the initials of its name", () => {
    expect(displayNameMatchesClub("Harvard CSSA", club("Harvard Chinese Students and Scholars Association"))).toBe(
      true,
    );
    expect(displayNameMatchesClub("HUNSA", club("Harvard Undergraduate Nepali Student Association"))).toBe(true);
    expect(displayNameMatchesClub("WHRB 95.3", club("Harvard Radio Broadcasting", ["WHRB"]))).toBe(true);
  });
  it("does not match on one shared common word or boilerplate", () => {
    expect(displayNameMatchesClub("Harvard Club Soccer", club("Men's Club Soccer"))).toBe(false);
    expect(displayNameMatchesClub("Harvard Chinese Students Association", club("Chinese Christian Fellowship"))).toBe(
      false,
    );
    expect(displayNameMatchesClub("Harvard College", club("Harvard College Robotics Club"))).toBe(false);
    expect(displayNameMatchesClub("BASHA", club("Bengali Association of Students at Harvard College"))).toBe(false);
  });
});

describe("accountProblem", () => {
  const club = { names: ["The Fictional Gazette"], acronyms: [] };
  const entry = { handle: "fixturegazette", evidence: OG };
  it("needs the text to name the account", () => {
    expect(
      accountProblem({
        entry: { ...entry, evidence: "282 posts 12K followers" },
        club,
        linkStatus: "verified",
        sharedWith: [],
      }),
    ).toMatchObject({ scope: "text" });
    expect(
      accountProblem({ entry: { ...entry, handle: "other" }, club, linkStatus: "verified", sharedWith: [] })?.why,
    ).toMatch(/doesn't name @other/);
  });
  it("accepts a verified or probable link, or a display name that names the club", () => {
    const other = { names: ["Fixture Rowing"], acronyms: [] };
    expect(accountProblem({ entry, club: other, linkStatus: "verified", sharedWith: [] })).toBeNull();
    expect(accountProblem({ entry, club: other, linkStatus: "probable", sharedWith: [] })).toBeNull();
    expect(accountProblem({ entry, club, linkStatus: "unverified", sharedWith: [] })).toBeNull();
    expect(accountProblem({ entry, club, linkStatus: null, sharedWith: [] })).toBeNull();
    expect(accountProblem({ entry, club: other, linkStatus: "unverified", sharedWith: [] })).toMatchObject({
      scope: "account",
    });
    expect(accountProblem({ entry, club, linkStatus: "rejected", sharedWith: [] })?.why).toMatch(/rejected link/);
  });
  it("an account on two clubs is settled only by a verified link", () => {
    expect(accountProblem({ entry, club, linkStatus: "probable", sharedWith: ["fixture-b"] })?.why).toMatch(
      /also linked to fixture-b/,
    );
    expect(accountProblem({ entry, club, linkStatus: "verified", sharedWith: ["fixture-b"] })).toBeNull();
  });
});

describe("collector helpers", () => {
  it("recognizes block signals", () => {
    expect(blockSignal("https://www.instagram.com/accounts/login/?next=%2Fx%2F&is_from_rle")).toMatch(/rate limited/);
    expect(blockSignal("https://www.instagram.com/accounts/login/?next=%2Fx%2F")).toMatch(/login/);
    expect(blockSignal("https://www.instagram.com/challenge/?next=/x/")).toMatch(/challenge/);
    expect(blockSignal("https://www.instagram.com/fixturegazette/")).toBeNull();
  });
  it("picks one account per club, best link first, unread clubs first", () => {
    const t = pickTargets(
      [
        { slug: "b", url: "https://www.instagram.com/b_unverified/", status: "unverified" },
        { slug: "b", url: "https://www.instagram.com/b_verified/", status: "verified" },
        { slug: "a", url: "https://www.instagram.com/a/", status: "probable" },
        { slug: "c", url: "https://www.instagram.com/c/", status: "rejected" },
        { slug: "d", url: "https://www.instagram.com/explore/", status: "verified" },
      ],
      [
        { slug: "a", observedAt: "2026-10-01T00:00:00Z", source: "instagram" },
        { slug: "b", observedAt: "2026-09-01T00:00:00Z", source: "brave" },
      ],
    );
    expect(t.map((x) => [x.slug, x.handle])).toEqual([
      ["b", "b_verified"],
      ["a", "a"],
    ]);
    expect(
      pickTargets([{ slug: "a", url: "https://www.instagram.com/a/", status: "probable" }], [], { clubs: ["z"] }),
    ).toEqual([]);
  });
  it("replaces entries by slug", () => {
    expect(
      replaceBySlug(
        [
          { slug: "b", n: 1 },
          { slug: "a", n: 1 },
        ],
        { slug: "b", n: 2 },
      ),
    ).toEqual([
      { slug: "a", n: 1 },
      { slug: "b", n: 2 },
    ]);
  });
});

describe("collectInstagramFollowers + account check (DB)", () => {
  let db: Db;
  let close: () => Promise<void>;
  const store = new MemorySnapshotStore();
  const NOW = new Date("2026-10-04T12:00:00Z");
  const dir = mkdtempSync(join(tmpdir(), "hci-ig-"));
  const ids: Record<string, string> = {};
  // club_link is a resolver projection (rebuilt from claims), so the links a test sets are
  // re-applied before each run.
  const wanted = new Map<string, { slug: string; handle: string; status: string }>();
  const link = async (slug: string, handle: string, status: string) => {
    wanted.set(`${slug} ${handle}`, { slug, handle, status });
    await applyLink(slug, handle, status);
  };
  const relink = async () => {
    for (const l of wanted.values()) await applyLink(l.slug, l.handle, l.status);
  };
  const applyLink = async (slug: string, handle: string, status: string) => {
    const url = `https://www.instagram.com/${handle}/`;
    await db
      .insert(schema.clubLink)
      .values({ clubId: ids[slug]!, kind: "instagram", url, normalizedUrl: normalizeUrl(url)!, handle, status })
      .onConflictDoUpdate({ target: [schema.clubLink.clubId, schema.clubLink.normalizedUrl], set: { status } });
  };
  const followers = async (slug: string) =>
    (await db.select({ n: schema.club.instagramFollowers }).from(schema.club).where(eq(schema.club.slug, slug)))[0]
      ?.n ?? null;
  const claimStatuses = async (slug: string) =>
    (
      await db
        .select({ status: schema.claim.status, reason: schema.claim.statusReason })
        .from(schema.claim)
        .where(and(eq(schema.claim.clubId, ids[slug]!), eq(schema.claim.fieldKey, "club.instagram_followers")))
    ).map((c) => c.status);
  const soccer = (slug: string, followers = 800) => ({
    slug,
    handle: "fixtureclubsoccer",
    url: "https://www.instagram.com/fixtureclubsoccer/",
    followers,
    followersText: `${followers} Followers`,
    evidence: `${followers} Followers, 10 Following, 5 Posts - See Instagram photos and videos from Fixture Club Soccer (@fixtureclubsoccer)`,
    source: "instagram",
    evidenceUrl: "https://www.instagram.com/fixtureclubsoccer/",
    observedAt: "2026-10-03T00:00:00.000Z",
  });
  const run = async (entries: unknown[], dryRun = false) => {
    await relink();
    return runInstagramFollowers({ db, store, logger: silentLogger, now: () => NOW }, { entries, dryRun });
  };

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    for (const [slug, name] of [
      ["fixture-mens-soccer", "Fixture Men's Club Soccer"],
      ["fixture-womens-soccer", "Fixture Women's Club Soccer"],
      ["fixture-gazette", "The Fictional Gazette"],
      ["fixture-rowing", "Fixture Rowing Team"],
    ] as const)
      ids[slug] = (await createClub(db, { name, slug, dataOrigin: "fixture" })).id;
  });
  afterAll(() => close());

  it("writes a count for a probable link; rejects it once the account is also on another club; revives on verification", async () => {
    await link("fixture-mens-soccer", "fixtureclubsoccer", "probable");
    expect((await run([soccer("fixture-mens-soccer")])).written).toBe(1);
    expect(await followers("fixture-mens-soccer")).toBe(800);

    await link("fixture-womens-soccer", "fixtureclubsoccer", "unverified");
    const dry = await run([soccer("fixture-mens-soccer")], true);
    expect(dry.rejected).toBe(1);
    expect(await claimStatuses("fixture-mens-soccer")).toEqual(["active"]);

    const r = await run([soccer("fixture-mens-soccer")]);
    expect(r.written).toBe(0);
    expect(r.rejected).toBe(1);
    expect(r.outcomes[0]?.result).toMatch(/also linked to fixture-womens-soccer.*rejected 1 earlier claim/);
    expect(await claimStatuses("fixture-mens-soccer")).toEqual(["rejected"]);
    expect(await followers("fixture-mens-soccer")).toBeNull();

    // The women's team: unverified and the name doesn't settle it either.
    expect((await run([soccer("fixture-womens-soccer")])).outcomes[0]?.result).toMatch(/^skipped: @fixtureclubsoccer/);

    await link("fixture-mens-soccer", "fixtureclubsoccer", "verified");
    expect((await run([soccer("fixture-mens-soccer")])).written).toBe(1);
    expect(await claimStatuses("fixture-mens-soccer")).toEqual(["active"]);
    expect(await followers("fixture-mens-soccer")).toBe(800);
  });

  it("skips an account in the file under two slugs unless verified for the club", async () => {
    const r = await run([
      {
        ...soccer("fixture-gazette", 10),
        handle: "fixturegazette",
        url: "https://www.instagram.com/fixturegazette/",
        evidence: "10 Followers, 1 Following - The Fictional Gazette (@fixturegazette)",
        followersText: "10 Followers",
      },
      {
        ...soccer("fixture-rowing", 10),
        handle: "fixturegazette",
        url: "https://www.instagram.com/fixturegazette/",
        evidence: "10 Followers, 1 Following - The Fictional Gazette (@fixturegazette)",
        followersText: "10 Followers",
      },
    ]);
    expect(r.outcomes.map((o) => o.result)).toEqual([
      expect.stringMatching(/also linked to fixture-rowing/),
      expect.stringMatching(/also linked to fixture-gazette/),
    ]);
  });

  it("a saved text that doesn't name the account rejects only its own value", async () => {
    await link("fixture-gazette", "fixturegazette", "verified");
    const g = (followers: number, evidence: string, observedAt: string) => ({
      ...soccer("fixture-gazette", followers),
      handle: "fixturegazette",
      url: "https://www.instagram.com/fixturegazette/",
      evidenceUrl: "https://www.instagram.com/fixturegazette/",
      evidence,
      observedAt,
    });
    const named = (n: number) => `${n} Followers, 1 Following - The Fictional Gazette (@fixturegazette)`;
    await run([g(20, named(20), "2026-10-01T00:00:00.000Z"), g(30, named(30), "2026-10-02T00:00:00.000Z")]);
    const r = await run([
      g(20, named(20), "2026-10-01T00:00:00.000Z"),
      g(30, "30 followers (screenshot)", "2026-10-02T00:00:00.000Z"),
    ]);
    expect(r.rejected).toBe(1);
    const rows = await db
      .select({ value: schema.claim.value, status: schema.claim.status })
      .from(schema.claim)
      .where(
        and(eq(schema.claim.clubId, ids["fixture-gazette"]!), eq(schema.claim.fieldKey, "club.instagram_followers")),
      );
    expect(Object.fromEntries(rows.map((x) => [String(x.value), x.status]))).toMatchObject({
      20: "active",
      30: "rejected",
    });
    expect(await followers("fixture-gazette")).toBe(20);
  });

  it("collects politely, saves after each profile and stops at the first login redirect", async () => {
    await link("fixture-gazette", "fixturegazette", "verified");
    await link("fixture-rowing", "fixturerowing", "unverified");
    const file = join(dir, "followers.json");
    writeFileSync(file, "[]");
    const slept: number[] = [];
    const visited: string[] = [];
    const pages: Record<string, { html: string; finalUrl: string }> = {
      "https://www.instagram.com/fixtureclubsoccer/": {
        html: fixture("profile.html").replaceAll("fixturegazette", "fixtureclubsoccer"),
        finalUrl: "https://www.instagram.com/fixtureclubsoccer/",
      },
      "https://www.instagram.com/fixturegazette/": {
        html: fixture("login-wall.html"),
        finalUrl: "https://www.instagram.com/accounts/login/?next=%2Ffixturegazette%2F&is_from_rle",
      },
    };
    let closed = false;
    const reader: PageRenderer = {
      render: async (url) => {
        visited.push(url);
        const p = pages[url];
        if (!p) throw new Error(`unexpected ${url}`);
        return p;
      },
      close: async () => {
        closed = true;
      },
    };
    const deps = {
      db,
      logger: silentLogger,
      openReader: async () => reader,
      now: () => NOW,
      sleep: async (ms: number) => {
        slept.push(ms);
      },
      random: () => 0.5,
    };

    await relink();
    let opened = false;
    const dry = await collectInstagramFollowers(
      { ...deps, openReader: async () => ((opened = true), reader) },
      { file, dryRun: true },
    );
    expect(opened).toBe(false);
    expect(dry.targets.map((t) => t.slug)).toEqual([
      "fixture-gazette",
      "fixture-mens-soccer",
      "fixture-rowing",
      "fixture-womens-soccer",
    ]);

    await relink();
    const r = await collectInstagramFollowers(deps, {
      file,
      clubs: ["fixture-mens-soccer", "fixture-gazette", "fixture-rowing"],
    });
    // gazette is first (alphabetical, none read yet) and is a login redirect: the run stops there.
    expect(visited).toEqual(["https://www.instagram.com/fixturegazette/"]);
    expect(r.stopped).toMatch(/rate limited/);
    expect(r.saved).toBe(0);
    expect(closed).toBe(true);

    // Without the block, the next profile is read and saved; pages are ≥ 10 s apart.
    pages["https://www.instagram.com/fixturegazette/"] = {
      html: fixture("profile.html"),
      finalUrl: "https://www.instagram.com/fixturegazette/",
    };
    visited.length = 0;
    await relink();
    const r2 = await collectInstagramFollowers(deps, { file, clubs: ["fixture-mens-soccer", "fixture-gazette"] });
    expect(r2.stopped).toBeNull();
    expect(r2.saved).toBe(2);
    expect(slept).toEqual([MIN_GAP_MS + 2500]);
    const saved = JSON.parse(readFileSync(file, "utf8")) as {
      slug: string;
      followers: number;
      source: string;
      evidence: string;
    }[];
    expect(saved.map((e) => [e.slug, e.followers, e.source])).toEqual([
      ["fixture-gazette", 12000, "instagram"],
      ["fixture-mens-soccer", 12000, "instagram"],
    ]);
    expect(saved[0]?.evidence).toBe(OG);
  });

  it("treats three profiles in a row without a description as a block", async () => {
    await relink();
    const file = join(dir, "missing.json");
    writeFileSync(file, "[]");
    const visited: string[] = [];
    const r = await collectInstagramFollowers(
      {
        db,
        logger: silentLogger,
        now: () => NOW,
        sleep: async () => {},
        openReader: async () => ({
          render: async (url) => {
            visited.push(url);
            return { html: fixture("login-wall.html"), finalUrl: url };
          },
          close: async () => {},
        }),
      },
      { file },
    );
    expect(visited).toHaveLength(3);
    expect(r.stopped).toMatch(/three|3 profiles in a row/);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual([]);
  });
});

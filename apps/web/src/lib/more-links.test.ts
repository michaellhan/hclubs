import { describe, expect, it } from "vitest";
import type { RankableLink } from "@hci/db/local";
import { cleanLinkLabel, distinctLinkLabels, isJunkLabel, pickEmails, planMoreLinks } from "./more-links";

const L = (kind: RankableLink["kind"], url: string, label: string | null = null): RankableLink => ({
  kind,
  url,
  handle: null,
  label,
  status: "verified",
  confidence: 1,
});

describe("labels", () => {
  it("flags CSS, icon classes and long text", () => {
    expect(isJunkLabel(".x{color:red}")).toBe(true);
    expect(isJunkLabel("icon-comp Comp")).toBe(true);
    expect(isJunkLabel("a".repeat(61))).toBe(true);
    expect(isJunkLabel("Spring comp")).toBe(false);
    expect(isJunkLabel(null)).toBe(true);
  });
  it("falls back for junk or kind-only labels", () => {
    const l = L("other", "https://x.org/a", "icon-comp Comp");
    expect(cleanLinkLabel(l, "Other", "x.org/a")).toBe("x.org/a");
    expect(cleanLinkLabel(L("other", "https://x.org", "Join us"), "Other", "x.org")).toBe("Join us");
    expect(cleanLinkLabel(L("other", "https://x.org", "other"), "Other", "x.org")).toBe("x.org");
  });
});

describe("pickEmails", () => {
  const e = (a: string) => L("email", `mailto:${a}`);
  it("prefers role addresses and caps at two", () => {
    const r = pickEmails([e("a@x.org"), e("treasurer@x.org"), e("auditions@x.org"), e("info@x.org")]);
    expect(r.shown.map((x) => x.url)).toEqual(["mailto:auditions@x.org", "mailto:info@x.org"]);
    expect(r.hidden).toHaveLength(2);
  });
  it("falls back to the first and dedupes", () => {
    const r = pickEmails([e("a@x.org"), e("A@x.org"), e("b@x.org"), e("c@x.org")]);
    expect(r.shown.map((x) => x.url)).toEqual(["mailto:a@x.org", "mailto:b@x.org"]);
    expect(r.hidden).toHaveLength(1);
  });
});

describe("planMoreLinks", () => {
  const apps = [1, 2, 3, 4, 5].map((i) => L("application_form", `https://forms.gle/${i}`));
  it("shows three applications and discloses the rest", () => {
    const p = planMoreLinks(apps);
    expect(p.applications.shown).toHaveLength(3);
    expect(p.applications.hidden).toHaveLength(2);
  });
  it("drops applications for ended organizations", () => {
    const p = planMoreLinks([...apps, L("other", "https://x.org/a")], { ended: true });
    expect(p.applications.shown).toHaveLength(0);
    expect(p.other).toHaveLength(1);
  });
  it("dedupes same kind and destination", () => {
    const p = planMoreLinks([L("other", "https://www.x.org/a/"), L("other", "https://x.org/a")]);
    expect(p.other).toHaveLength(1);
  });
});

describe("distinctLinkLabels", () => {
  const link = (url: string, label: string | null) => ({ url, label, handle: null });
  const run = (links: ReturnType<typeof link>[]) => {
    const out = distinctLinkLabels(links, (l) => l.label ?? l.url);
    return links.map((l) => out.get(l));
  };
  it("names repeated labels by their page, leaves unique ones alone", () => {
    expect(
      run([
        link("https://work.hsa.net/jobs/web-associate", "Apply for this role"),
        link("https://work.hsa.net/jobs/mit-tour-guide", "Apply for this role"),
        link("https://work.hsa.net/jobs/instructor", "Apply for this role"),
        link("https://club.org/join", "Join us"),
      ]),
    ).toEqual(["Web associate", "MIT tour guide", "Instructor", "Join us"]);
  });

  it("keeps the shared label when any page name is an id, a form path, or not distinct", () => {
    const forms = [
      link("https://docs.google.com/forms/d/e/a/viewform", "Join Us"),
      link("https://docs.google.com/forms/d/e/b/viewform", "Join Us"),
    ];
    expect(run(forms)).toEqual(["Join Us", "Join Us"]);
    const ids = [link("https://forms.gle/Haetnzodlykkikz89", "Apply"), link("https://club.org/apply-now", "Apply")];
    expect(run(ids)).toEqual(["Apply", "Apply"]);
    const same = [link("https://a.org/x/join", "Join"), link("https://b.org/join", "Join")];
    expect(run(same)).toEqual(["Join", "Join"]);
  });
});

describe("planMoreLinks with now", () => {
  it("lists forms naming a round that is over after the others", () => {
    const old = { ...L("application_form", "https://forms.gle/spring", "Interest form"), term: "2026-spring" };
    const cur = L("application_page", "https://club.example/join", "Join");
    const plan = planMoreLinks([old, cur], { now: new Date("2026-10-12T16:00:00Z") });
    expect(plan.applications.shown.map((l) => l.url)).toEqual([
      "https://club.example/join",
      "https://forms.gle/spring",
    ]);
  });
});

describe("planMoreLinks twin domains", () => {
  it("keeps one of the same labelled page on a club's twin domains", () => {
    const a = L("application_page", "https://harvardcollegedebatingunion.org/join", "Join Us");
    const b = L("application_page", "https://harvarddebatingunion.org/join", "Join Us");
    expect(planMoreLinks([a, b]).applications.shown).toEqual([a]);
  });
});

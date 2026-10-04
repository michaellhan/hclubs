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
  it("names repeated labels by their page, leaves unique ones alone", () => {
    const links = [
      link("https://work.hsa.net/jobs/web-associate", "Apply for this role"),
      link("https://work.hsa.net/jobs/tour-manager", "Apply for this role"),
      link("https://work.hsa.net/jobs/12345", "Apply for this role"),
      link("https://work.hsa.net/jobs/mit-tour-guide", "Apply for this role"),
      link("https://club.org/join", "Join us"),
    ];
    const out = distinctLinkLabels(links, (l) => l.label ?? l.url);
    expect(links.map((l) => out.get(l))).toEqual([
      "Web associate",
      "Tour manager",
      "Apply for this role",
      "MIT tour guide",
      "Join us",
    ]);
  });
});

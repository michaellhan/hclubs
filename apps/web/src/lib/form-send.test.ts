import { describe, expect, it } from "vitest";
import { feedbackDetails, feedbackPage } from "./feedback";
import { formPost } from "./form-send";

const PREFILL =
  "https://docs.google.com/forms/d/e/1FAIpQLSfS77QH4vTHQ3OrSR-IHATf_43lkD8kVlIDU4z3dzUUoncOhg/viewform?usp=pp_url&entry.1487349995=Crimson%20%5Bcrimson%5D&entry.101658200=Website&entry.1414800944=Website%3A%20https%3A%2F%2Fx.org%0AWhere%3A%20y";

describe("formPost", () => {
  it("posts a prefill link's answers to the form's response endpoint", () => {
    const post = formPost(PREFILL);
    expect(post?.action).toBe(
      "https://docs.google.com/forms/d/e/1FAIpQLSfS77QH4vTHQ3OrSR-IHATf_43lkD8kVlIDU4z3dzUUoncOhg/formResponse",
    );
    expect(post?.body.get("entry.1487349995")).toBe("Crimson [crimson]");
    expect(post?.body.get("entry.1414800944")).toBe("Website: https://x.org\nWhere: y");
    expect(post?.body.has("usp")).toBe(false);
  });

  it("leaves blank answers out", () => {
    const post = formPost(PREFILL.replace("Crimson%20%5Bcrimson%5D", ""));
    expect(post?.body.has("entry.1487349995")).toBe(false);
  });

  it("refuses links that aren't Google Form prefill links", () => {
    expect(formPost("mailto:a@b.co?subject=x")).toBeNull();
    expect(formPost("https://evil.example/forms/d/e/x/viewform?entry.1=a")).toBeNull();
    expect(formPost("https://docs.google.com/forms/d/e/x/viewform")).toBeNull();
    expect(formPost("not a url")).toBeNull();
  });
});

describe("feedback form", () => {
  it("keeps only a site path as the page", () => {
    expect(feedbackPage("/clubs/crimson")).toBe("/clubs/crimson");
    expect(feedbackPage("//evil.example")).toBeNull();
    expect(feedbackPage("https://evil.example")).toBeNull();
    expect(feedbackPage(null)).toBeNull();
  });
  it("sends nothing without a message", () => {
    expect(feedbackDetails("  ", "/clubs")).toBe("");
    expect(feedbackDetails("Search is slow", "/clubs")).toBe("Search is slow\n\nPage: /clubs");
  });
});

import { describe, expect, it } from "vitest";
import { decodeLeftoverEntities, htmlToDocument } from "../src/parse/document";

describe("meta descriptions escaped twice (1.16.51)", () => {
  it("reads &amp;amp; as &", () => {
    const html =
      '<html><head><meta name="description" content="GroupGear makes SEAMLESS, &amp;amp; HIGH-QUALITY orders"></head><body></body></html>';
    expect(htmlToDocument(html, "https://groupgear.example/").metaDescription).toBe(
      "GroupGear makes SEAMLESS, & HIGH-QUALITY orders",
    );
  });

  it("leaves a lone ampersand and unknown names alone", () => {
    expect(decodeLeftoverEntities("Cleaners & Dorm Essentials &copy;")).toBe("Cleaners & Dorm Essentials &copy;");
    expect(decodeLeftoverEntities("it&#39;s")).toBe("it's");
  });
});

describe("customer and closure dates aren't recruiting deadlines (1.16.51)", () => {
  it("a place closed on a date is a closure notice", async () => {
    const { closureNoticeProblem, outsiderApplicationProblem } = await import("../src/extract/evidence-rules");
    expect(closureNoticeProblem("PLEASE NOTE: Harvard Yard is closed on October 30th from 2-8 PM.")).not.toBeNull();
    expect(closureNoticeProblem("Applications are closed on October 30th.")).toBeNull();
    expect(outsiderApplicationProblem("Apply by 8/9 at 11:59pm EDT to lock in your $300 discount.")).not.toBeNull();
    expect(outsiderApplicationProblem("Apply by 9/9 to join our analyst class.")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { recruitingRedirectHref } from "./recruiting-redirect";

describe("recruitingRedirectHref", () => {
  it("lands on the Recruiting now filter", () => {
    expect(recruitingRedirectHref("")).toBe("/clubs?recruiting=1");
  });
  it("keeps the board's category and process filters, drops the class year", () => {
    expect(recruitingRedirectHref("?category=technology&join=comp&class=first_year&within=7")).toBe(
      "/clubs?recruiting=1&category=technology&join=comp",
    );
  });
  it("drops malformed values and class years the directory can't filter by", () => {
    expect(recruitingRedirectHref("?category=%3Cx%3E&class=junior")).toBe("/clubs?recruiting=1");
  });
});

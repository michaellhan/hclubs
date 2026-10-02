import { describe, expect, it } from "vitest";
import { typeaheadSubline } from "./typeahead";

type Joining = Parameters<typeof typeaheadSubline>[0]["joining"];
const joining = (over: Partial<Joining>): Joining =>
  ({ access: null, general: [], roles: [], comp: null, noCuts: false, conflicts: [], ...over }) as unknown as Joining;

describe("typeaheadSubline", () => {
  it("joins category and joining text", () => {
    expect(
      typeaheadSubline({
        categories: [{ name: "Consulting" }],
        joining: joining({ access: "process", general: ["application", "comp"] }),
      }),
    ).toBe("Consulting · Application, comp");
  });
  it("leaves out what is unknown", () => {
    expect(typeaheadSubline({ categories: [{ name: "Dance" }], joining: joining({}) })).toBe("Dance");
    expect(typeaheadSubline({ categories: [], joining: joining({ access: "open", general: ["open"] }) })).toBe(
      "Open membership",
    );
    expect(typeaheadSubline({ categories: [], joining: joining({}) })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { scanText } from "../src/privacy-scan";

describe("privacy scan of the built site", () => {
  const kinds = (text: string, names: string[] = []) => scanText("x.html", text, names).map((f) => f.kind);

  it("flags personal addresses and keeps club role addresses", () => {
    expect(kinds("Contact jane.doe@college.harvard.edu")).toEqual(["email"]);
    expect(kinds("Write to board@exampleclub.org or info@exampleclub.org")).toEqual([]);
    expect(kinds("hcs@hcs.harvard.edu", ["Harvard Computer Society", "HCS"])).toEqual([]);
    expect(kinds("logo@2x.png and hclubsapp@gmail.com")).toEqual([]);
  });

  it("flags phone numbers but not years, ids or prices", () => {
    expect(kinds("Call (617) 495-1000")).toEqual(["phone"]);
    expect(kinds("Founded 1981; 2026-10-01; $1,250.00; id 01a0f17d-5d6c")).toEqual([]);
  });

  it("flags evidence quotes and personal details in link queries", () => {
    expect(kinds('{"quote":"Led by Jane Doe"}')).toEqual(["evidence_quote"]);
    expect(kinds('{"quote":null}')).toEqual([]);
    expect(kinds('<a href="https://forms.example/apply?email=jane%40x.com">')).toContain("query_pii");
    expect(kinds('<a href="https://example.org/apply?name={club}">')).toEqual([]);
  });
});

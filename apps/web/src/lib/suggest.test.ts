import { describe, expect, it } from "vitest";
import { contributionTopic, parseProposals, postedLink } from "@hci/core";
import { answerIsLink, fieldKind, promptQuestion, suggestDetails } from "./suggest";

describe("suggestDetails", () => {
  const deadline = contributionTopic("deadline");

  it("sends only answered prompts, as lines the importer reads back", () => {
    const details = suggestDetails(deadline, { Deadline: "October 20, 2026 11:59 PM", Term: "  " });
    expect(details).toBe("Deadline: October 20, 2026 11:59 PM");
    const proposals = parseProposals(details, { submittedAt: new Date("2026-10-03T12:00:00Z") });
    expect(proposals.map((p) => p.label)).toEqual(["Deadline"]);
  });

  it("adds the source link as its own line, which the importer takes as the evidence URL", () => {
    const details = suggestDetails(deadline, { Deadline: "Oct 20" }, { source: "https://example.org/apply" });
    expect(details).toBe("Deadline: Oct 20\nWhere this is posted: https://example.org/apply");
    expect(postedLink(details)).toBe("https://example.org/apply");
  });

  it("sends nothing for an untouched form, even with a source link", () => {
    expect(suggestDetails(deadline, {}, { source: "https://example.org" })).toBe("");
  });

  it("keeps a free message for topics without prompts", () => {
    const other = contributionTopic("other");
    expect(suggestDetails(other, {}, { message: "They meet on Fridays now." })).toBe("They meet on Fridays now.");
  });

  it("joins a multi-line answer into one line so continuation lines don't go astray", () => {
    expect(suggestDetails(contributionTopic("incorrect_info"), { "What's wrong": "a\nb" })).toBe("What's wrong: a b");
  });

  it("asks links as URLs and explanations as text areas", () => {
    expect(fieldKind("Website")).toBe("url");
    expect(fieldKind("What's wrong")).toBe("long");
    expect(fieldKind("Dues")).toBe("text");
  });
});

describe("how prompts are asked", () => {
  it("asks a question that doesn't repeat the topic, for every prompt the form offers", () => {
    expect(promptQuestion("Instagram")).toBe("The club's Instagram");
    const keys = [
      "joining_process",
      "deadline",
      "application_link",
      "time_commitment",
      "eligibility",
      "dues",
      "member_count",
      "website",
      "instagram",
      "missing_info",
      "incorrect_info",
      "inactive",
      "renamed",
      "duplicate",
    ] as const;
    for (const k of keys)
      for (const p of contributionTopic(k).prompts) expect(promptQuestion(p.label)).not.toBe(p.label);
  });

  it("skips 'where is this posted' only when the answer is itself the link", () => {
    expect(answerIsLink(contributionTopic("instagram"))).toBe(true);
    expect(answerIsLink(contributionTopic("website"))).toBe(true);
    expect(answerIsLink(contributionTopic("application_link"))).toBe(true);
    expect(answerIsLink(contributionTopic("deadline"))).toBe(false);
    expect(answerIsLink(contributionTopic("missing_info"))).toBe(false);
  });
});

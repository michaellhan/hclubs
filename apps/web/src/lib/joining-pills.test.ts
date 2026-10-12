import { describe, expect, it } from "vitest";
import { joinPills } from "./joining-pills";

const labels = (r: ReturnType<typeof joinPills>) => r.pills.map((p) => p.label);

describe("joinPills", () => {
  it("reads an audition with no cuts as one pill, never beside Open membership", () => {
    expect(labels(joinPills(["audition", "open"], true, 2))).toEqual(["Audition, no cuts"]);
  });
  it("lets a process outrank open membership", () => {
    expect(labels(joinPills(["comp", "open"], false, 2))).toEqual(["Comp"]);
  });
  it("collapses open and attendance-based into one pill", () => {
    expect(labels(joinPills(["open", "attendance_based"], false, 2))).toEqual(["Open membership"]);
    expect(labels(joinPills(["attendance_based"], false, 2))).toEqual(["Attendance-based"]);
  });
  it("caps at max and names the rest", () => {
    const r = joinPills(["application", "comp", "audition"], false, 2);
    expect(labels(r)).toEqual(["Application", "Comp"]);
    expect(r.hidden).toEqual(["Audition"]);
  });
  it("is empty for no modes", () => expect(joinPills([], false, 2).pills).toEqual([]));
});

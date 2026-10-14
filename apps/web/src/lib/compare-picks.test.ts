import { describe, expect, it } from "vitest";
import { trayFromLink, trayWithoutUnknown } from "./compare-picks";

describe("trayWithoutUnknown", () => {
  it("drops slugs the index no longer lists, keeping order", () => {
    expect(trayWithoutUnknown(["a", "gone", "b"], new Set(["a", "b"]))).toEqual(["a", "b"]);
  });
});

describe("trayFromLink", () => {
  it("keeps the resolved clubs' current slugs", () => {
    expect(trayFromLink([{ slug: "a" }, { slug: "b" }])).toEqual(["a", "b"]);
  });
  it("leaves the tray alone while loading", () => {
    expect(trayFromLink(null)).toBeNull();
  });
  it("leaves the tray alone when no club in the link exists (all dead slugs)", () => {
    expect(trayFromLink([])).toBeNull();
  });
});

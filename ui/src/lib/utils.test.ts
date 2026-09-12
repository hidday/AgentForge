import { describe, it, expect } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("joins multiple class strings", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("drops falsy values (undefined, null, false, empty string)", () => {
    expect(cn("a", undefined, null, false, "", "b")).toBe("a b");
  });

  it("merges conflicting tailwind classes, keeping the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("supports conditional object syntax", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c");
  });

  it("returns an empty string for no arguments", () => {
    expect(cn()).toBe("");
  });

  it("returns an empty string when every input is falsy", () => {
    expect(cn(undefined, null, false)).toBe("");
  });
});

describe("relativeTime", () => {
  it("returns 'just now' for under a minute", () => {
    const t = new Date(Date.now() - 30_000);
    expect(relativeTime(t)).toBe("just now");
  });

  it("returns 'just now' at exactly 0 seconds elapsed", () => {
    expect(relativeTime(new Date())).toBe("just now");
  });

  it("returns minutes ago for under an hour", () => {
    const t = new Date(Date.now() - 5 * 60_000);
    expect(relativeTime(t)).toBe("5m ago");
  });

  it("returns hours ago for under a day", () => {
    const t = new Date(Date.now() - 3 * 60 * 60_000);
    expect(relativeTime(t)).toBe("3h ago");
  });

  it("returns days ago for a day or more", () => {
    const t = new Date(Date.now() - 2 * 24 * 60 * 60_000);
    expect(relativeTime(t)).toBe("2d ago");
  });

  it("accepts an ISO date string in addition to a Date object", () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(relativeTime(iso)).toBe("5m ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a date into a locale-based month/day/time string", () => {
    const result = formatTimestamp("2024-03-15T08:30:45Z");
    // Avoid asserting on exact locale-dependent hour formatting; assert on
    // the stable, timezone-independent pieces instead.
    expect(result).toContain("Mar");
    expect(result).toContain("15");
  });

  it("accepts a Date object as well as a string", () => {
    const date = new Date("2024-01-01T00:00:00Z");
    const result = formatTimestamp(date);
    expect(result).toContain("Jan");
    expect(result).toContain("1");
  });
});

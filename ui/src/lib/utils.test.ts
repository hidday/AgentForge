import { describe, it, expect } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("joins multiple simple class strings", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("ignores falsy inputs (undefined, null, false, empty string)", () => {
    expect(cn("foo", undefined, null, false, "", "bar")).toBe("foo bar");
  });

  it("returns an empty string when called with no meaningful input", () => {
    expect(cn()).toBe("");
    expect(cn(undefined, null, false)).toBe("");
  });

  it("flattens arrays of class values", () => {
    expect(cn(["foo", "bar"], "baz")).toBe("foo bar baz");
  });

  it("supports object syntax, including conditionally-falsy keys", () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe("foo baz");
  });

  it("merges conflicting Tailwind utility classes, keeping the last one", () => {
    // tailwind-merge should resolve conflicting padding utilities to the last value
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("merges conflicting Tailwind color classes, keeping the last one", () => {
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("keeps non-conflicting classes from different inputs together", () => {
    expect(cn("flex items-center", "gap-2")).toBe("flex items-center gap-2");
  });
});

describe("relativeTime", () => {
  it("returns 'just now' for a timestamp less than 60 seconds ago", () => {
    const now = new Date();
    const thirtySecondsAgo = new Date(now.getTime() - 30 * 1000);
    expect(relativeTime(thirtySecondsAgo)).toBe("just now");
  });

  it("returns 'just now' for the current instant (0 seconds ago)", () => {
    const now = new Date();
    expect(relativeTime(now)).toBe("just now");
  });

  it("returns minutes-ago format for a timestamp under an hour old", () => {
    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
    expect(relativeTime(fiveMinAgo)).toBe("5m ago");
  });

  it("returns hours-ago format for a timestamp under a day old", () => {
    const now = new Date();
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    expect(relativeTime(threeHoursAgo)).toBe("3h ago");
  });

  it("returns days-ago format for a timestamp a day or more old", () => {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    expect(relativeTime(twoDaysAgo)).toBe("2d ago");
  });

  it("accepts an ISO date string as well as a Date object", () => {
    const now = new Date();
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    expect(relativeTime(tenMinAgo)).toBe("10m ago");
  });

  it("handles the boundary right at 60 seconds (rolls over to minutes)", () => {
    const now = new Date();
    const exactlySixty = new Date(now.getTime() - 60 * 1000);
    expect(relativeTime(exactlySixty)).toBe("1m ago");
  });

  it("handles the boundary right at 60 minutes (rolls over to hours)", () => {
    const now = new Date();
    const exactlySixtyMin = new Date(now.getTime() - 60 * 60 * 1000);
    expect(relativeTime(exactlySixtyMin)).toBe("1h ago");
  });

  it("handles the boundary right at 24 hours (rolls over to days)", () => {
    const now = new Date();
    const exactlyDay = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    expect(relativeTime(exactlyDay)).toBe("1d ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a Date object into a localized month/day/time string", () => {
    const date = new Date("2024-03-15T09:05:03Z");
    const result = formatTimestamp(date);
    // Exact formatting is locale/timezone dependent, but it must include the
    // month abbreviation and day, and be non-empty.
    expect(result).toContain("Mar");
    expect(result).toContain("15");
  });

  it("accepts an ISO date string as well as a Date object", () => {
    const result = formatTimestamp("2024-12-25T00:00:00Z");
    expect(result).toContain("Dec");
    expect(result).toContain("25");
  });

  it("includes hour, minute, and second components", () => {
    const result = formatTimestamp(new Date("2024-06-01T12:34:56Z"));
    // en-US locale time format uses ':' separators for h/m/s
    expect(result.split(":").length - 1).toBeGreaterThanOrEqual(2);
  });
});

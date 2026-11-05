import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("joins multiple class names", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("drops falsy values (undefined, null, false, empty string)", () => {
    expect(cn("a", undefined, null, false, "", "b")).toBe("a b");
  });

  it("merges conflicting tailwind classes, keeping the last one (tailwind-merge)", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("supports conditional object syntax from clsx", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c");
  });

  it("returns an empty string when given no meaningful input", () => {
    expect(cn()).toBe("");
    expect(cn(undefined, null, false)).toBe("");
  });

  it("flattens arrays of class values", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });
});

describe("relativeTime", () => {
  const NOW = new Date("2024-06-15T12:00:00Z").getTime();

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for a timestamp less than 60 seconds ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const thirtySecondsAgo = new Date(NOW - 30 * 1000).toISOString();
    expect(relativeTime(thirtySecondsAgo)).toBe("just now");
  });

  it("returns minutes-ago format for a timestamp under an hour old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const fiveMinAgo = new Date(NOW - 5 * 60 * 1000).toISOString();
    expect(relativeTime(fiveMinAgo)).toBe("5m ago");
  });

  it("returns hours-ago format for a timestamp under a day old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const threeHoursAgo = new Date(NOW - 3 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(threeHoursAgo)).toBe("3h ago");
  });

  it("returns days-ago format for a timestamp a day or more old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const twoDaysAgo = new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(twoDaysAgo)).toBe("2d ago");
  });

  it("accepts a Date object as well as a string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const date = new Date(NOW - 10 * 1000);
    expect(relativeTime(date)).toBe("just now");
  });

  it("boundary: exactly 60 seconds ago rolls over to minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const exactlySixty = new Date(NOW - 60 * 1000).toISOString();
    expect(relativeTime(exactlySixty)).toBe("1m ago");
  });
});

describe("formatTimestamp", () => {
  it("formats an ISO string into a short month/day/time string", () => {
    const result = formatTimestamp("2024-01-05T08:30:15Z");
    // Locale-dependent, but should include the month abbreviation and day.
    expect(result).toContain("Jan");
    expect(result).toContain("5");
  });

  it("accepts a Date object", () => {
    const result = formatTimestamp(new Date("2024-03-01T00:00:00Z"));
    expect(result).toContain("Mar");
  });
});

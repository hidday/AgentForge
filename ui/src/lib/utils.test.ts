import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("joins multiple string class names with spaces", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("drops falsy values (undefined, null, false, empty string)", () => {
    expect(cn("foo", undefined, null, false, "", "bar")).toBe("foo bar");
  });

  it("supports the clsx object syntax, including conditionals", () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe("foo baz");
  });

  it("supports arrays of class values", () => {
    expect(cn(["foo", "bar"], "baz")).toBe("foo bar baz");
  });

  it("merges conflicting tailwind utility classes, keeping the last one", () => {
    // tailwind-merge should resolve conflicting padding utilities to the
    // last one specified rather than concatenating both.
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("merges conflicting classes even when passed conditionally", () => {
    expect(cn("text-sm", { "text-lg": true })).toBe("text-lg");
  });

  it("returns an empty string when given no meaningful input", () => {
    expect(cn()).toBe("");
    expect(cn(undefined, null, false)).toBe("");
  });

  it("keeps non-conflicting classes from multiple sources", () => {
    expect(cn("flex items-center", "gap-2")).toBe("flex items-center gap-2");
  });
});

describe("relativeTime", () => {
  const NOW = new Date("2024-06-15T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for a timestamp less than a minute ago", () => {
    const thirtySecondsAgo = new Date(NOW.getTime() - 30 * 1000).toISOString();
    expect(relativeTime(thirtySecondsAgo)).toBe("just now");
  });

  it("returns 'just now' for the exact current instant (0 diff)", () => {
    expect(relativeTime(NOW.toISOString())).toBe("just now");
  });

  it("returns 'just now' at the boundary just under 60 seconds", () => {
    const boundary = new Date(NOW.getTime() - 59 * 1000).toISOString();
    expect(relativeTime(boundary)).toBe("just now");
  });

  it("returns minutes-ago for times between 1 and 59 minutes", () => {
    const fiveMinAgo = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();
    expect(relativeTime(fiveMinAgo)).toBe("5m ago");
  });

  it("returns '1m ago' at the 60-second boundary", () => {
    const exactlyOneMinute = new Date(NOW.getTime() - 60 * 1000).toISOString();
    expect(relativeTime(exactlyOneMinute)).toBe("1m ago");
  });

  it("returns hours-ago for times between 1 and 23 hours", () => {
    const threeHoursAgo = new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(threeHoursAgo)).toBe("3h ago");
  });

  it("returns '1h ago' at the 60-minute boundary", () => {
    const exactlyOneHour = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
    expect(relativeTime(exactlyOneHour)).toBe("1h ago");
  });

  it("returns days-ago for times 24 hours or more in the past", () => {
    const twoDaysAgo = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(twoDaysAgo)).toBe("2d ago");
  });

  it("returns '1d ago' at the 24-hour boundary", () => {
    const exactlyOneDay = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(exactlyOneDay)).toBe("1d ago");
  });

  it("accepts a Date object directly, not just a string", () => {
    const fiveMinAgoDate = new Date(NOW.getTime() - 5 * 60 * 1000);
    expect(relativeTime(fiveMinAgoDate)).toBe("5m ago");
  });

  it("handles large multi-day differences", () => {
    const thirtyDaysAgo = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(thirtyDaysAgo)).toBe("30d ago");
  });
});

describe("formatTimestamp", () => {
  it("formats an ISO string into month, day, hour, minute, second", () => {
    const result = formatTimestamp("2024-03-05T14:30:45.000Z");
    // Avoid asserting on an exact locale-formatted string, since the exact
    // hour depends on the test runner's timezone; instead assert the
    // overall shape produced by the toLocaleString options used.
    expect(result).toMatch(/^Mar \d{1,2}, \d{2}:\d{2}:\d{2}\s?(AM|PM)$/);
  });

  it("accepts a Date object directly, not just a string", () => {
    const result = formatTimestamp(new Date("2024-12-25T00:00:00.000Z"));
    expect(result).toMatch(/^Dec \d{1,2}, \d{2}:\d{2}:\d{2}\s?(AM|PM)$/);
  });

  it("produces different output for different input dates", () => {
    const jan = formatTimestamp("2024-01-01T00:00:00.000Z");
    const jul = formatTimestamp("2024-07-15T00:00:00.000Z");
    expect(jan).not.toBe(jul);
    expect(jan).toContain("Jan");
    expect(jul).toContain("Jul");
  });

  it("is deterministic for the same input", () => {
    const a = formatTimestamp("2024-05-10T08:15:00.000Z");
    const b = formatTimestamp("2024-05-10T08:15:00.000Z");
    expect(a).toBe(b);
  });
});

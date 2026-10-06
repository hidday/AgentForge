import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils";

describe("cn", () => {
  it("joins plain class name strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values (undefined, null, false)", () => {
    expect(cn("a", undefined, null, false, "b")).toBe("a b");
  });

  it("merges conflicting tailwind utility classes, keeping the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("returns an empty string when given no meaningful input", () => {
    expect(cn()).toBe("");
  });

  it("supports conditional object syntax from clsx", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for a timestamp less than 60 seconds old', () => {
    const now = new Date("2024-01-01T00:01:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const thirtySecondsAgo = new Date(now.getTime() - 30_000).toISOString();
    expect(relativeTime(thirtySecondsAgo)).toBe("just now");
  });

  it('returns "just now" at the exact boundary of 0 seconds', () => {
    const now = new Date("2024-01-01T00:01:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(now.toISOString())).toBe("just now");
  });

  it("returns minutes-ago for a timestamp between 1 and 59 minutes old", () => {
    const now = new Date("2024-01-01T01:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60_000).toISOString();
    expect(relativeTime(fiveMinutesAgo)).toBe("5m ago");
  });

  it("returns hours-ago for a timestamp between 1 and 23 hours old", () => {
    const now = new Date("2024-01-02T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60_000).toISOString();
    expect(relativeTime(threeHoursAgo)).toBe("3h ago");
  });

  it("returns days-ago for a timestamp 24 hours old or more", () => {
    const now = new Date("2024-01-10T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60_000).toISOString();
    expect(relativeTime(twoDaysAgo)).toBe("2d ago");
  });

  it("accepts a Date instance directly, not just an ISO string", () => {
    const now = new Date("2024-01-01T01:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60_000);
    expect(relativeTime(tenMinutesAgo)).toBe("10m ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a localized month/day/hour/minute/second string", () => {
    const result = formatTimestamp("2024-03-15T10:30:45.000Z");
    // Avoid asserting an exact locale string (timezone-dependent); check shape instead.
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/15/);
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  it("produces the same output for an equivalent Date instance as for its ISO string", () => {
    const iso = "2024-07-04T12:00:00.000Z";
    expect(formatTimestamp(new Date(iso))).toBe(formatTimestamp(iso));
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("merges class names, dropping falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("resolves conflicting tailwind utility classes via tailwind-merge", () => {
    // twMerge should keep only the last conflicting padding utility.
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("supports conditional object syntax from clsx", () => {
    expect(cn({ foo: true, bar: false }, "baz")).toBe("foo baz");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for durations under 60 seconds", () => {
    const now = new Date("2026-01-01T00:01:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const thirtySecondsAgo = new Date(now.getTime() - 30_000).toISOString();
    expect(relativeTime(thirtySecondsAgo)).toBe("just now");
  });

  it("returns 'just now' at exactly 0 seconds elapsed", () => {
    const now = new Date("2026-01-01T00:01:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(now.toISOString())).toBe("just now");
  });

  it("returns minutes-ago for durations of at least 60 seconds but under an hour", () => {
    const now = new Date("2026-01-01T01:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60_000).toISOString();
    expect(relativeTime(fiveMinutesAgo)).toBe("5m ago");
  });

  it("returns hours-ago for durations of at least an hour but under a day", () => {
    const now = new Date("2026-01-02T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60_000).toISOString();
    expect(relativeTime(threeHoursAgo)).toBe("3h ago");
  });

  it("returns days-ago for durations of a day or more", () => {
    const now = new Date("2026-01-10T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60_000).toISOString();
    expect(relativeTime(twoDaysAgo)).toBe("2d ago");
  });

  it("accepts a Date instance directly, not just a string", () => {
    const now = new Date("2026-01-01T00:10:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const tenMinutesAgo = new Date(now.getTime() - 10 * 60_000);
    expect(relativeTime(tenMinutesAgo)).toBe("10m ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string as a short month/day/time string", () => {
    const result = formatTimestamp("2026-03-15T14:30:45.000Z");
    // Locale-formatted; assert on the pieces that must appear regardless of TZ.
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/15/);
  });

  it("accepts a Date instance directly", () => {
    const date = new Date("2026-07-04T09:05:00.000Z");
    const result = formatTimestamp(date);
    expect(result).toMatch(/Jul/);
    expect(result).toMatch(/4/);
  });
});

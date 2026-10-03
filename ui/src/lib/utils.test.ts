import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils";

describe("cn", () => {
  it("joins simple class name strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values (undefined, null, false, empty string)", () => {
    expect(cn("a", undefined, null, false, "", "b")).toBe("a b");
  });

  it("merges conflicting tailwind classes, keeping the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("applies conditional object syntax from clsx", () => {
    expect(cn({ foo: true, bar: false }, "baz")).toBe("foo baz");
  });

  it("returns an empty string for no input", () => {
    expect(cn()).toBe("");
  });
});

describe("relativeTime", () => {
  const FIXED_NOW = new Date("2026-01-01T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for a timestamp seconds in the past', () => {
    const date = new Date(FIXED_NOW.getTime() - 30 * 1000);
    expect(relativeTime(date)).toBe("just now");
  });

  it('returns "just now" right at the 0-second boundary', () => {
    expect(relativeTime(FIXED_NOW)).toBe("just now");
  });

  it("stays on the seconds branch at 59 seconds (just under the minute boundary)", () => {
    const date = new Date(FIXED_NOW.getTime() - 59 * 1000);
    expect(relativeTime(date)).toBe("just now");
  });

  it("crosses into the minutes branch at exactly 60 seconds", () => {
    const date = new Date(FIXED_NOW.getTime() - 60 * 1000);
    expect(relativeTime(date)).toBe("1m ago");
  });

  it("formats minutes ago", () => {
    const date = new Date(FIXED_NOW.getTime() - 5 * 60 * 1000);
    expect(relativeTime(date)).toBe("5m ago");
  });

  it("stays on the minutes branch at 59 minutes (just under the hour boundary)", () => {
    const date = new Date(FIXED_NOW.getTime() - 59 * 60 * 1000);
    expect(relativeTime(date)).toBe("59m ago");
  });

  it("crosses into the hours branch at exactly 60 minutes", () => {
    const date = new Date(FIXED_NOW.getTime() - 60 * 60 * 1000);
    expect(relativeTime(date)).toBe("1h ago");
  });

  it("formats hours ago", () => {
    const date = new Date(FIXED_NOW.getTime() - 3 * 60 * 60 * 1000);
    expect(relativeTime(date)).toBe("3h ago");
  });

  it("stays on the hours branch at 23 hours (just under the day boundary)", () => {
    const date = new Date(FIXED_NOW.getTime() - 23 * 60 * 60 * 1000);
    expect(relativeTime(date)).toBe("23h ago");
  });

  it("crosses into the days branch at exactly 24 hours", () => {
    const date = new Date(FIXED_NOW.getTime() - 24 * 60 * 60 * 1000);
    expect(relativeTime(date)).toBe("1d ago");
  });

  it("formats days ago", () => {
    const date = new Date(FIXED_NOW.getTime() - 10 * 24 * 60 * 60 * 1000);
    expect(relativeTime(date)).toBe("10d ago");
  });

  it("accepts an ISO date string in addition to a Date object", () => {
    const iso = new Date(FIXED_NOW.getTime() - 5 * 60 * 1000).toISOString();
    expect(relativeTime(iso)).toBe("5m ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a Date into a short month/day/time string", () => {
    const date = new Date("2026-03-15T09:05:07.000Z");
    const result = formatTimestamp(date);
    // en-US short format: "Mar 15, 09:05:07 AM" (exact minute/hour depend on local TZ,
    // so assert on the stable, TZ-independent pieces instead of the full string).
    expect(result).toContain("Mar");
    expect(result).toContain("15");
  });

  it("accepts an ISO date string in addition to a Date object", () => {
    const iso = "2026-07-04T00:00:00.000Z";
    const result = formatTimestamp(iso);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("produces the same output for equivalent Date and string inputs", () => {
    const iso = "2026-07-04T12:34:56.000Z";
    expect(formatTimestamp(iso)).toBe(formatTimestamp(new Date(iso)));
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("merges class names, applying tailwind-merge conflict resolution", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("drops falsy values", () => {
    expect(cn("foo", false, null, undefined, "", "bar")).toBe("foo bar");
  });

  it("returns an empty string for no inputs", () => {
    expect(cn()).toBe("");
  });

  it("supports conditional object syntax from clsx", () => {
    expect(cn({ active: true, disabled: false }, "base")).toBe("active base");
  });
});

describe("relativeTime", () => {
  const NOW = new Date("2024-06-01T12:00:00Z").getTime();

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for timestamps under a minute old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeTime(new Date(NOW - 30_000).toISOString())).toBe("just now");
  });

  it("returns 'just now' at exactly 0 seconds elapsed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeTime(new Date(NOW).toISOString())).toBe("just now");
  });

  it("returns minutes-ago format between 1 and 59 minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeTime(new Date(NOW - 5 * 60_000).toISOString())).toBe("5m ago");
  });

  it("returns hours-ago format between 1 and 23 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeTime(new Date(NOW - 3 * 3_600_000).toISOString())).toBe("3h ago");
  });

  it("returns days-ago format at 24 hours and beyond", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeTime(new Date(NOW - 2 * 86_400_000).toISOString())).toBe("2d ago");
  });

  it("accepts a Date object directly, not just a string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeTime(new Date(NOW - 90_000))).toBe("1m ago");
  });

  it("boundary: exactly 60 seconds rolls over to minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeTime(new Date(NOW - 60_000).toISOString())).toBe("1m ago");
  });

  it("boundary: exactly 60 minutes rolls over to hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeTime(new Date(NOW - 3_600_000).toISOString())).toBe("1h ago");
  });

  it("boundary: exactly 24 hours rolls over to days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeTime(new Date(NOW - 86_400_000).toISOString())).toBe("1d ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a locale-based short representation", () => {
    const result = formatTimestamp("2024-03-15T09:05:00Z");
    // en-US locale formatting: "Mar 15, HH:MM:SS" — assert on the stable pieces
    expect(result).toContain("Mar");
    expect(result).toContain("15");
  });

  it("formats a Date object the same way it formats an equivalent string", () => {
    const date = new Date("2024-03-15T09:05:00Z");
    expect(formatTimestamp(date)).toBe(formatTimestamp(date.toISOString()));
  });
});

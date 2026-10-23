import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("merges class name strings together", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", undefined, null, false, "b")).toBe("a b");
  });

  it("lets a later conflicting tailwind class win over an earlier one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("supports conditional object syntax", () => {
    expect(cn({ a: true, b: false })).toBe("a");
  });
});

describe("relativeTime", () => {
  const NOW = new Date("2024-06-01T12:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for a timestamp less than 60 seconds ago", () => {
    const thirtySecondsAgo = new Date(NOW.getTime() - 30 * 1000).toISOString();
    expect(relativeTime(thirtySecondsAgo)).toBe("just now");
  });

  it("returns 'just now' for the current instant (boundary at 0s)", () => {
    expect(relativeTime(NOW.toISOString())).toBe("just now");
  });

  it("returns minutes-ago for a timestamp between 1 and 59 minutes ago", () => {
    const fiveMinAgo = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();
    expect(relativeTime(fiveMinAgo)).toBe("5m ago");
  });

  it("returns hours-ago for a timestamp between 1 and 23 hours ago", () => {
    const threeHoursAgo = new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(threeHoursAgo)).toBe("3h ago");
  });

  it("returns days-ago for a timestamp 24 hours or more in the past", () => {
    const twoDaysAgo = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(twoDaysAgo)).toBe("2d ago");
  });

  it("accepts a Date instance directly, not just a string", () => {
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60 * 1000);
    expect(relativeTime(oneHourAgo)).toBe("1h ago");
  });
});

describe("formatTimestamp", () => {
  it("formats an ISO string into a short, human-readable timestamp", () => {
    const formatted = formatTimestamp("2024-06-01T12:34:56Z");
    // Exact rendering depends on locale/timezone of the test runner, but it
    // must include the year-less month/day and the seconds component.
    expect(formatted).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    expect(formatted).not.toContain("2024");
  });

  it("accepts a Date instance directly", () => {
    const formatted = formatTimestamp(new Date("2024-01-15T00:00:00Z"));
    expect(typeof formatted).toBe("string");
    expect(formatted.length).toBeGreaterThan(0);
  });
});

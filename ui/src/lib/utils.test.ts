import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils";

describe("cn", () => {
  it("joins simple class strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("merges conflicting tailwind classes, keeping the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("applies conditional object syntax", () => {
    expect(cn("base", { active: true, hidden: false })).toBe("base active");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for a timestamp less than 60 seconds ago", () => {
    const now = new Date("2026-01-01T00:00:30Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(new Date("2026-01-01T00:00:00Z"))).toBe("just now");
  });

  it("returns minutes ago for a timestamp under an hour old", () => {
    const now = new Date("2026-01-01T00:10:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(new Date("2026-01-01T00:05:00Z"))).toBe("5m ago");
  });

  it("returns hours ago for a timestamp under a day old", () => {
    const now = new Date("2026-01-01T05:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(new Date("2026-01-01T02:00:00Z"))).toBe("3h ago");
  });

  it("returns days ago for a timestamp a day or more old", () => {
    const now = new Date("2026-01-05T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(new Date("2026-01-01T00:00:00Z"))).toBe("4d ago");
  });

  it("accepts a string date as input", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2025-12-31T23:59:50Z")).toBe("just now");
  });
});

describe("formatTimestamp", () => {
  it("formats a date into a short month/day/time string", () => {
    const result = formatTimestamp(new Date("2026-03-15T14:05:09Z"));
    // Avoid asserting exact locale-rendered time (depends on the test
    // machine's timezone) — just check the shape/content we control.
    expect(result).toMatch(/Mar 15,/);
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  it("accepts a string date as input", () => {
    const result = formatTimestamp("2026-07-04T00:00:00Z");
    expect(result).toMatch(/Jul (3|4),/);
  });
});

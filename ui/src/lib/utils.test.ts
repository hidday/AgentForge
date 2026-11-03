import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils";

describe("cn", () => {
  it("merges plain class name strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });

  it("resolves conflicting tailwind classes, keeping the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("supports conditional object syntax", () => {
    expect(cn("base", { active: true, hidden: false })).toBe("base active");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for a timestamp less than 60s ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:30Z"));
    expect(relativeTime("2026-01-01T00:00:00Z")).toBe("just now");
  });

  it("returns minutes-ago for a timestamp under an hour old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:10:00Z"));
    expect(relativeTime("2026-01-01T00:00:00Z")).toBe("10m ago");
  });

  it("returns hours-ago for a timestamp under a day old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T05:00:00Z"));
    expect(relativeTime("2026-01-01T00:00:00Z")).toBe("5h ago");
  });

  it("returns days-ago for a timestamp a day or more old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-05T00:00:00Z"));
    expect(relativeTime("2026-01-01T00:00:00Z")).toBe("4d ago");
  });

  it("accepts a Date instance as well as a string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:30Z"));
    expect(relativeTime(new Date("2026-01-01T00:00:00Z"))).toBe("just now");
  });

  it("handles the boundary exactly at 60 seconds (rolls over to minutes)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:01:00Z"));
    expect(relativeTime("2026-01-01T00:00:00Z")).toBe("1m ago");
  });

  it("handles the boundary exactly at 60 minutes (rolls over to hours)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T01:00:00Z"));
    expect(relativeTime("2026-01-01T00:00:00Z")).toBe("1h ago");
  });

  it("handles the boundary exactly at 24 hours (rolls over to days)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    expect(relativeTime("2026-01-01T00:00:00Z")).toBe("1d ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a short month/day/time representation", () => {
    const result = formatTimestamp("2026-03-15T14:30:00Z");
    // Locale-dependent exact spacing, but must contain the formatted month/day and time parts.
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/15/);
  });

  it("accepts a Date instance as well as a string", () => {
    const d = new Date("2026-03-15T14:30:00Z");
    expect(formatTimestamp(d)).toBe(formatTimestamp(d.toISOString()));
  });

  it("does not include the year in the formatted output", () => {
    const result = formatTimestamp("2026-03-15T14:30:00Z");
    expect(result).not.toContain("2026");
  });
});

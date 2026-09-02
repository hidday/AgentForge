import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("merges plain class name strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("resolves conflicting tailwind classes, keeping the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("handles conditional object syntax from clsx", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c");
  });

  it("returns an empty string when given no meaningful input", () => {
    expect(cn()).toBe("");
    expect(cn(false, undefined, null)).toBe("");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for a time under a minute ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:30Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("just now");
  });

  it("returns 'just now' at the zero-second boundary", () => {
    vi.useFakeTimers();
    const now = new Date("2024-01-01T00:00:00Z");
    vi.setSystemTime(now);
    expect(relativeTime(now)).toBe("just now");
  });

  it("returns minutes ago for a time under an hour ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:05:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("5m ago");
  });

  it("returns hours ago for a time under a day ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T05:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("5h ago");
  });

  it("returns days ago for a time a day or more in the past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-05T00:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("4d ago");
  });

  it("accepts a Date instance as well as a string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:05:00Z"));
    expect(relativeTime(new Date("2024-01-01T00:00:00Z"))).toBe("5m ago");
  });

  it("crosses the minute boundary correctly at exactly 60 seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:01:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("1m ago");
  });

  it("crosses the hour boundary correctly at exactly 60 minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T01:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("1h ago");
  });

  it("crosses the day boundary correctly at exactly 24 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-02T00:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("1d ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a short localized timestamp", () => {
    const formatted = formatTimestamp("2024-03-15T14:30:45Z");
    expect(typeof formatted).toBe("string");
    // Locale-formatted string should include the month abbreviation and year-free day/time parts.
    expect(formatted).toMatch(/Mar/);
    expect(formatted).toContain("15");
  });

  it("accepts a Date instance", () => {
    const formatted = formatTimestamp(new Date("2024-03-15T14:30:45Z"));
    expect(formatted).toMatch(/Mar/);
  });
});

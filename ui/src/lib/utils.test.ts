import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("merges plain class name strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values (undefined, null, false)", () => {
    expect(cn("a", undefined, null, false, "b")).toBe("a b");
  });

  it("resolves conflicting tailwind classes, keeping the last one", () => {
    // tailwind-merge should collapse conflicting padding utilities
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("supports conditional object syntax from clsx", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c");
  });

  it("returns an empty string when given no meaningful input", () => {
    expect(cn()).toBe("");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for a timestamp less than 60s ago", () => {
    const now = new Date("2024-01-01T00:00:30Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("just now");
  });

  it("returns minutes ago for a timestamp under an hour old", () => {
    const now = new Date("2024-01-01T00:10:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("10m ago");
  });

  it("returns hours ago for a timestamp under a day old", () => {
    const now = new Date("2024-01-01T05:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("5h ago");
  });

  it("returns days ago for a timestamp a day or more old", () => {
    const now = new Date("2024-01-05T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("4d ago");
  });

  it("accepts a Date object as well as a string", () => {
    const now = new Date("2024-01-01T00:00:45Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(new Date("2024-01-01T00:00:00Z"))).toBe("just now");
  });

  it("boundary: exactly 60 seconds is reported in minutes, not 'just now'", () => {
    const now = new Date("2024-01-01T00:01:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("1m ago");
  });

  it("boundary: exactly 60 minutes is reported in hours", () => {
    const now = new Date("2024-01-01T01:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("1h ago");
  });

  it("boundary: exactly 24 hours is reported in days", () => {
    const now = new Date("2024-01-02T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("1d ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a short localized timestamp", () => {
    const formatted = formatTimestamp("2024-03-05T14:30:45Z");
    // Depends on locale, but the formatted output should be a non-empty
    // string distinct from the raw ISO input and contain the month.
    expect(typeof formatted).toBe("string");
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted).not.toBe("2024-03-05T14:30:45Z");
    expect(formatted).toMatch(/Mar/);
  });

  it("accepts a Date object", () => {
    const formatted = formatTimestamp(new Date("2024-03-05T14:30:45Z"));
    expect(formatted).toMatch(/Mar/);
  });
});

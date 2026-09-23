import { describe, it, expect } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("merges plain class name strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });

  it("merges conflicting tailwind classes, keeping the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("supports conditional object syntax", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c");
  });
});

describe("relativeTime", () => {
  it("returns 'just now' for timestamps less than 60 seconds ago", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 30_000))).toBe("just now");
  });

  it("returns 'just now' at the 0 second boundary", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now))).toBe("just now");
  });

  it("returns minutes for timestamps under an hour ago", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 5 * 60_000))).toBe("5m ago");
  });

  it("returns hours for timestamps under a day ago", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 3 * 60 * 60_000))).toBe("3h ago");
  });

  it("returns days for timestamps a day or more ago", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 2 * 24 * 60 * 60_000))).toBe("2d ago");
  });

  it("accepts an ISO date string as well as a Date", () => {
    const now = Date.now();
    const iso = new Date(now - 5 * 60_000).toISOString();
    expect(relativeTime(iso)).toBe("5m ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a date into a short month/day/time string", () => {
    const result = formatTimestamp("2024-03-15T10:30:00Z");
    // en-US locale short format: e.g. "Mar 15, 10:30:00 AM"
    expect(result).toContain("15");
    expect(result).toMatch(/Mar/);
  });

  it("accepts a Date object", () => {
    const date = new Date("2024-01-01T00:00:00Z");
    const result = formatTimestamp(date);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

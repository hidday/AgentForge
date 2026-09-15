import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("merges class name strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("resolves conflicting tailwind classes via tailwind-merge (last wins)", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for a timestamp under 60 seconds old", () => {
    const now = new Date("2024-01-01T00:01:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const then = new Date("2024-01-01T00:00:30Z").toISOString();
    expect(relativeTime(then)).toBe("just now");
  });

  it("returns minutes ago for a timestamp between 1 and 59 minutes old", () => {
    const now = new Date("2024-01-01T01:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const then = new Date("2024-01-01T00:55:00Z").toISOString();
    expect(relativeTime(then)).toBe("5m ago");
  });

  it("returns hours ago for a timestamp between 1 and 23 hours old", () => {
    const now = new Date("2024-01-02T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const then = new Date("2024-01-01T20:00:00Z").toISOString();
    expect(relativeTime(then)).toBe("4h ago");
  });

  it("returns days ago for a timestamp 24 hours or older", () => {
    const now = new Date("2024-01-10T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const then = new Date("2024-01-07T00:00:00Z").toISOString();
    expect(relativeTime(then)).toBe("3d ago");
  });

  it("accepts a Date object as well as a string", () => {
    const now = new Date("2024-01-01T00:01:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const then = new Date("2024-01-01T00:00:30Z");
    expect(relativeTime(then)).toBe("just now");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a locale-formatted timestamp with month/day/hour/minute/second", () => {
    const result = formatTimestamp("2024-03-15T14:30:45Z");
    // Avoid asserting an exact locale string (timezone-dependent); assert shape/content instead.
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/15/);
    expect(typeof result).toBe("string");
  });

  it("formats a Date object the same way as an equivalent date string", () => {
    const date = new Date("2024-03-15T14:30:45Z");
    expect(formatTimestamp(date)).toBe(formatTimestamp(date.toISOString()));
  });
});

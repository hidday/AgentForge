import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("joins plain class name strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });

  it("merges conflicting tailwind classes, keeping the last one", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("supports conditional object syntax", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for timestamps under a minute old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:30Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("just now");
  });

  it("returns minutes ago for timestamps under an hour old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:10:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("10m ago");
  });

  it("returns hours ago for timestamps under a day old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T05:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("5h ago");
  });

  it("returns days ago for timestamps a day or more old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-05T00:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("4d ago");
  });

  it("accepts a Date object as well as a string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:30Z"));
    expect(relativeTime(new Date("2024-01-01T00:00:00Z"))).toBe("just now");
  });

  it("boundary: exactly 60 seconds rolls over to minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:01:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("1m ago");
  });

  it("boundary: exactly 60 minutes rolls over to hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T01:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("1h ago");
  });

  it("boundary: exactly 24 hours rolls over to days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-02T00:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("1d ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a locale timestamp with month/day/hour/minute/second", () => {
    const result = formatTimestamp("2024-03-15T14:30:45Z");
    // Avoid asserting exact locale-formatted text (timezone dependent); check shape instead.
    expect(result).toMatch(/[A-Za-z]{3}\s+\d{1,2},?\s+\d{2}:\d{2}:\d{2}/);
  });

  it("accepts a Date object", () => {
    const result = formatTimestamp(new Date("2024-03-15T14:30:45Z"));
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("joins multiple class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });

  it("merges conflicting tailwind classes, keeping the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("supports conditional object syntax", () => {
    expect(cn({ a: true, b: false })).toBe("a");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for a timestamp less than 60 seconds ago", () => {
    const now = new Date("2026-01-01T00:00:30.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2026-01-01T00:00:00.000Z")).toBe("just now");
  });

  it("returns minutes-ago for a timestamp under an hour old", () => {
    const now = new Date("2026-01-01T00:10:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2026-01-01T00:05:00.000Z")).toBe("5m ago");
  });

  it("returns hours-ago for a timestamp under a day old", () => {
    const now = new Date("2026-01-01T05:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2026-01-01T02:00:00.000Z")).toBe("3h ago");
  });

  it("returns days-ago for a timestamp a day or more old", () => {
    const now = new Date("2026-01-05T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2026-01-01T00:00:00.000Z")).toBe("4d ago");
  });

  it("accepts a Date instance in addition to a string", () => {
    const now = new Date("2026-01-01T00:10:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(new Date("2026-01-01T00:05:00.000Z"))).toBe("5m ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a short, human-readable timestamp", () => {
    const result = formatTimestamp("2026-03-15T14:30:45.000Z");
    // en-US locale formatting with month/day/hour/minute/second — assert
    // the stable structural pieces rather than the whole locale string,
    // since exact spacing can vary across ICU versions.
    expect(result).toContain("Mar");
    expect(result).toContain("15");
  });

  it("accepts a Date instance", () => {
    const result = formatTimestamp(new Date("2026-03-15T14:30:45.000Z"));
    expect(result).toContain("Mar");
  });
});

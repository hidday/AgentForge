import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("merges class names and dedupes conflicting Tailwind classes", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for timestamps under a minute old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:30Z"));
    expect(relativeTime("2026-01-01T00:00:00Z")).toBe("just now");
  });

  it("returns minutes-ago for timestamps under an hour old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:10:00Z"));
    expect(relativeTime("2026-01-01T00:00:00Z")).toBe("10m ago");
  });

  it("returns hours-ago for timestamps under a day old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T05:00:00Z"));
    expect(relativeTime("2026-01-01T00:00:00Z")).toBe("5h ago");
  });

  it("returns days-ago for timestamps a day or more old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-05T00:00:00Z"));
    expect(relativeTime("2026-01-01T00:00:00Z")).toBe("4d ago");
  });

  it("accepts a Date instance as well as a string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:30Z"));
    expect(relativeTime(new Date("2026-01-01T00:00:00Z"))).toBe("just now");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a locale-aware short timestamp", () => {
    const result = formatTimestamp("2026-03-15T14:30:00Z");
    // Avoid asserting on exact locale-formatted text (TZ-dependent); check shape instead.
    expect(result).toMatch(/\w{3} \d{1,2}, \d{2}:\d{2}:\d{2}/);
  });

  it("accepts a Date instance", () => {
    const result = formatTimestamp(new Date("2026-03-15T14:30:00Z"));
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

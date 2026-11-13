import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("merges class names and dedupes conflicting tailwind classes", () => {
    expect(cn("text-sm", "font-bold")).toBe("text-sm font-bold");
    // tailwind-merge should keep only the last conflicting padding utility
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("drops falsy values", () => {
    const shouldInclude = false;
    expect(cn("a", shouldInclude && "b", undefined, null, "c")).toBe("a c");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for timestamps under 60 seconds old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:30Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("just now");
  });

  it("returns minutes ago for timestamps under 60 minutes old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:10:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("10m ago");
  });

  it("returns hours ago for timestamps under 24 hours old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T05:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("5h ago");
  });

  it("returns days ago for timestamps 24 hours or older", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-03T00:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("2d ago");
  });

  it("accepts a Date instance as well as a string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:30Z"));
    expect(relativeTime(new Date("2024-01-01T00:00:00Z"))).toBe("just now");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a short localized timestamp", () => {
    const result = formatTimestamp("2024-03-15T10:30:00Z");
    // Exact locale rendering can vary by environment timezone, so assert on
    // the stable structural pieces (month abbreviation + day) rather than
    // the full string, which would make the test brittle to TZ differences.
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  it("accepts a Date instance", () => {
    const result = formatTimestamp(new Date("2024-03-15T10:30:00Z"));
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

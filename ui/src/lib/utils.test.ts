import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("merges class names and dedupes tailwind conflicts", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for timestamps under a minute old", () => {
    const now = new Date("2024-01-01T00:00:30Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("just now");
  });

  it("returns 'just now' right at the boundary (59s)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:59Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("just now");
  });

  it("returns minutes ago once past 60 seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:05:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("5m ago");
  });

  it("returns hours ago once past 60 minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T03:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("3h ago");
  });

  it("returns days ago once past 24 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-03T00:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("2d ago");
  });

  it("accepts a Date instance as well as a string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:05:00Z"));
    expect(relativeTime(new Date("2024-01-01T00:00:00Z"))).toBe("5m ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a localized short timestamp", () => {
    const result = formatTimestamp("2024-03-15T10:30:00Z");
    // Avoid asserting exact locale output across environments/timezones;
    // just assert it contains the expected date parts.
    expect(result).toContain("Mar");
    expect(result).toContain("15");
  });

  it("accepts a Date instance", () => {
    const result = formatTimestamp(new Date("2024-03-15T10:30:00Z"));
    expect(result).toContain("Mar");
  });
});

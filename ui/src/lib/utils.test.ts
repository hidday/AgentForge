import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("merges class names and dedupes conflicting tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("drops falsy values", () => {
    const isBar: boolean = false;
    expect(cn("foo", isBar && "bar", undefined, null, "baz")).toBe("foo baz");
  });

  it("returns an empty string when given no usable classes", () => {
    expect(cn()).toBe("");
  });
});

describe("relativeTime", () => {
  const NOW = new Date("2024-06-15T12:00:00Z").getTime();

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for timestamps under 60 seconds old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const date = new Date(NOW - 30 * 1000).toISOString();
    expect(relativeTime(date)).toBe("just now");
  });

  it("returns 'just now' at exactly 0 seconds elapsed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeTime(new Date(NOW).toISOString())).toBe("just now");
  });

  it("formats minutes when between 1 and 59 minutes old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const date = new Date(NOW - 5 * 60 * 1000).toISOString();
    expect(relativeTime(date)).toBe("5m ago");
  });

  it("formats hours when between 1 and 23 hours old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const date = new Date(NOW - 3 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(date)).toBe("3h ago");
  });

  it("formats days when 24 hours or older", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const date = new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(date)).toBe("2d ago");
  });

  it("accepts a Date instance as well as a string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const date = new Date(NOW - 10 * 1000);
    expect(relativeTime(date)).toBe("just now");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a short localized timestamp", () => {
    const result = formatTimestamp("2024-01-05T08:30:15Z");
    expect(result).toMatch(/Jan/);
    expect(result).toMatch(/5/);
  });

  it("formats a Date instance the same way as an ISO string", () => {
    const iso = "2024-03-10T14:45:00Z";
    expect(formatTimestamp(iso)).toBe(formatTimestamp(new Date(iso)));
  });
});

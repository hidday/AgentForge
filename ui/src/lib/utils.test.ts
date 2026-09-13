import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("merges class names, dropping falsy values", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });

  it("resolves conflicting tailwind classes to the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("returns an empty string when given no usable input", () => {
    expect(cn()).toBe("");
  });
});

describe("relativeTime", () => {
  const NOW = new Date("2026-01-10T12:00:00.000Z");

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for a timestamp less than 60 seconds ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const thirtySecondsAgo = new Date(NOW.getTime() - 30 * 1000).toISOString();
    expect(relativeTime(thirtySecondsAgo)).toBe("just now");
  });

  it("returns 'just now' at the zero-second boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeTime(NOW.toISOString())).toBe("just now");
  });

  it("returns minutes ago once at least 60 seconds have elapsed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const sixtySecondsAgo = new Date(NOW.getTime() - 60 * 1000).toISOString();
    expect(relativeTime(sixtySecondsAgo)).toBe("1m ago");
  });

  it("returns minutes ago for under an hour", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const fortyFiveMinutesAgo = new Date(NOW.getTime() - 45 * 60 * 1000).toISOString();
    expect(relativeTime(fortyFiveMinutesAgo)).toBe("45m ago");
  });

  it("returns hours ago once at least 60 minutes have elapsed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
    expect(relativeTime(oneHourAgo)).toBe("1h ago");
  });

  it("returns hours ago for under a day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const tenHoursAgo = new Date(NOW.getTime() - 10 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(tenHoursAgo)).toBe("10h ago");
  });

  it("returns days ago once at least 24 hours have elapsed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const oneDayAgo = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(oneDayAgo)).toBe("1d ago");
  });

  it("returns days ago for a multi-day gap", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const fiveDaysAgo = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(fiveDaysAgo)).toBe("5d ago");
  });

  it("accepts a Date instance as well as a string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const dateObj = new Date(NOW.getTime() - 5 * 1000);
    expect(relativeTime(dateObj)).toBe("just now");
  });
});

describe("formatTimestamp", () => {
  it("formats a Date using short month, numeric day, and 2-digit time fields", () => {
    const date = new Date("2026-06-15T09:05:03.000Z");
    const expected = date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    expect(formatTimestamp(date)).toBe(expected);
    // Sanity-check the shape: short month name, numeric day, HH:MM:SS with AM/PM.
    expect(formatTimestamp(date)).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}:\d{2}\s?(AM|PM)$/);
  });

  it("accepts an ISO date string as well as a Date instance", () => {
    const iso = "2026-12-25T23:59:59.000Z";
    expect(formatTimestamp(iso)).toBe(formatTimestamp(new Date(iso)));
  });
});

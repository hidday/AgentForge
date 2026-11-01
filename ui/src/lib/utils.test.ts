import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils";

describe("cn", () => {
  it("merges plain class strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });

  it("lets a later conflicting tailwind class win (tailwind-merge dedup)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});

describe("relativeTime", () => {
  const NOW = new Date("2024-06-01T12:00:00.000Z").getTime();

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for a timestamp under 60 seconds old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const thirtySecondsAgo = new Date(NOW - 30_000).toISOString();
    expect(relativeTime(thirtySecondsAgo)).toBe("just now");
  });

  it("returns minutes-ago for a timestamp under an hour old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const fiveMinutesAgo = new Date(NOW - 5 * 60_000).toISOString();
    expect(relativeTime(fiveMinutesAgo)).toBe("5m ago");
  });

  it("returns hours-ago for a timestamp under a day old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const threeHoursAgo = new Date(NOW - 3 * 60 * 60_000).toISOString();
    expect(relativeTime(threeHoursAgo)).toBe("3h ago");
  });

  it("returns days-ago for a timestamp a day or more old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const twoDaysAgo = new Date(NOW - 2 * 24 * 60 * 60_000).toISOString();
    expect(relativeTime(twoDaysAgo)).toBe("2d ago");
  });

  it("accepts a Date instance directly", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const date = new Date(NOW - 10 * 60_000);
    expect(relativeTime(date)).toBe("10m ago");
  });
});

describe("formatTimestamp", () => {
  it("formats an ISO string into a short localized date/time", () => {
    const formatted = formatTimestamp("2024-06-01T12:34:56.000Z");
    // Avoid asserting an exact locale string (TZ-dependent); assert shape instead.
    expect(formatted).toMatch(/\w{3} \d{1,2},/);
    expect(formatted).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  it("accepts a Date instance directly", () => {
    const formatted = formatTimestamp(new Date("2024-06-01T12:34:56.000Z"));
    expect(typeof formatted).toBe("string");
    expect(formatted.length).toBeGreaterThan(0);
  });
});

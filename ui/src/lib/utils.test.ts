import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("joins simple class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false && "b", undefined, null, "c")).toBe("a c");
  });

  it("merges conflicting tailwind classes, keeping the last one", () => {
    // tailwind-merge should resolve conflicting utilities to the last value
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("supports conditional object syntax from clsx", () => {
    expect(cn({ a: true, b: false }, "c")).toBe("a c");
  });

  it("returns an empty string when given nothing meaningful", () => {
    expect(cn()).toBe("");
    expect(cn(false, undefined, null)).toBe("");
  });
});

describe("relativeTime", () => {
  const NOW = new Date("2024-06-15T12:00:00.000Z").getTime();

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for a timestamp less than 60 seconds ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const thirtySecondsAgo = new Date(NOW - 30 * 1000).toISOString();
    expect(relativeTime(thirtySecondsAgo)).toBe("just now");
  });

  it('returns "just now" at the zero-second boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeTime(new Date(NOW).toISOString())).toBe("just now");
  });

  it("returns minutes ago for timestamps under an hour old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const fiveMinutesAgo = new Date(NOW - 5 * 60 * 1000).toISOString();
    expect(relativeTime(fiveMinutesAgo)).toBe("5m ago");
  });

  it("returns hours ago for timestamps under a day old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const threeHoursAgo = new Date(NOW - 3 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(threeHoursAgo)).toBe("3h ago");
  });

  it("returns days ago for timestamps a day or more old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const twoDaysAgo = new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(twoDaysAgo)).toBe("2d ago");
  });

  it("accepts a Date instance as well as a string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const date = new Date(NOW - 10 * 60 * 1000);
    expect(relativeTime(date)).toBe("10m ago");
  });
});

describe("formatTimestamp", () => {
  it("formats an ISO string into a locale month/day/time string", () => {
    const result = formatTimestamp("2024-01-05T08:30:15.000Z");
    // Avoid asserting on locale-formatted output verbatim (TZ-dependent);
    // instead assert it matches the expected shape: "Mon D, HH:MM:SS AM/PM".
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}:\d{2}\s?(AM|PM)$/);
  });

  it("formats a Date instance the same way as an equivalent ISO string", () => {
    const iso = "2024-03-20T15:45:00.000Z";
    const fromString = formatTimestamp(iso);
    const fromDate = formatTimestamp(new Date(iso));
    expect(fromDate).toBe(fromString);
  });
});

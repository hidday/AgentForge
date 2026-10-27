import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("joins simple class names together", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values (undefined, null, false, empty string)", () => {
    expect(cn("a", undefined, null, false, "", "b")).toBe("a b");
  });

  it("applies conditional classes from objects", () => {
    expect(cn("base", { active: true, hidden: false })).toBe("base active");
  });

  it("lets a later conflicting tailwind class win (tailwind-merge dedup)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("returns an empty string when given nothing meaningful", () => {
    expect(cn(undefined, null, false)).toBe("");
  });
});

describe("relativeTime", () => {
  const NOW = new Date("2024-06-15T12:00:00.000Z");

  afterEach(() => {
    vi.useRealTimers();
  });

  function at(msAgo: number) {
    return new Date(NOW.getTime() - msAgo).toISOString();
  }

  it("returns 'just now' for 0 seconds ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeTime(at(0))).toBe("just now");
  });

  it("returns 'just now' right up to the 59-second boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeTime(at(59 * 1000))).toBe("just now");
  });

  it("flips to minutes at exactly 60 seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeTime(at(60 * 1000))).toBe("1m ago");
  });

  it("reports whole minutes up to the 59-minute boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeTime(at(59 * 60 * 1000))).toBe("59m ago");
  });

  it("flips to hours at exactly 60 minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeTime(at(60 * 60 * 1000))).toBe("1h ago");
  });

  it("reports whole hours up to the 23-hour boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeTime(at(23 * 60 * 60 * 1000))).toBe("23h ago");
  });

  it("flips to days at exactly 24 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeTime(at(24 * 60 * 60 * 1000))).toBe("1d ago");
  });

  it("reports multiple days for a long time ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeTime(at(5 * 24 * 60 * 60 * 1000))).toBe("5d ago");
  });

  it("accepts a Date instance as well as a string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const dateObj = new Date(NOW.getTime() - 5000);
    expect(relativeTime(dateObj)).toBe("just now");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a localized month/day/time string", () => {
    const result = formatTimestamp("2024-03-05T13:04:05.000Z");
    expect(typeof result).toBe("string");
    // Shape: "<Mon> <D>, <H>:<MM>:<SS> <AM|PM>" — avoid asserting the exact
    // hour since it depends on the test runner's timezone.
    expect(result).toMatch(/^[A-Za-z]{3} \d{1,2}, \d{1,2}:\d{2}:\d{2}\s?(AM|PM)$/);
  });

  it("accepts a Date instance as well as a string", () => {
    const result = formatTimestamp(new Date("2024-03-05T13:04:05.000Z"));
    expect(result).toMatch(/^[A-Za-z]{3} \d{1,2}, \d{1,2}:\d{2}:\d{2}\s?(AM|PM)$/);
  });

  it("produces different output for different input dates", () => {
    const a = formatTimestamp("2024-01-01T00:00:00.000Z");
    const b = formatTimestamp("2024-07-04T00:00:00.000Z");
    expect(a).not.toBe(b);
  });
});

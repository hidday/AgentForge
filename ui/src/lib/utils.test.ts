import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("joins simple class strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });

  it("merges conflicting tailwind classes, keeping the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("supports object syntax from clsx", () => {
    expect(cn({ a: true, b: false }, "c")).toBe("a c");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for timestamps less than 60 seconds old", () => {
    const now = new Date("2024-01-01T00:01:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(new Date("2024-01-01T00:00:30.000Z"))).toBe("just now");
  });

  it("returns minutes ago for timestamps under an hour old", () => {
    const now = new Date("2024-01-01T01:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(new Date("2024-01-01T00:55:00.000Z"))).toBe("5m ago");
  });

  it("returns hours ago for timestamps under a day old", () => {
    const now = new Date("2024-01-02T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(new Date("2024-01-01T21:00:00.000Z"))).toBe("3h ago");
  });

  it("returns days ago for timestamps a day or more old", () => {
    const now = new Date("2024-01-10T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(new Date("2024-01-05T00:00:00.000Z"))).toBe("5d ago");
  });

  it("accepts a string date as well as a Date object", () => {
    const now = new Date("2024-01-01T00:01:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2024-01-01T00:00:30.000Z")).toBe("just now");
  });

  it("handles exact boundary of 60 seconds (rolls over to minutes)", () => {
    const now = new Date("2024-01-01T00:01:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(new Date("2024-01-01T00:00:00.000Z"))).toBe("1m ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a localized short form", () => {
    const result = formatTimestamp("2024-03-15T14:30:45.000Z");
    // Avoid asserting on exact locale-dependent text (timezone-sensitive);
    // assert on the stable shape instead.
    expect(result).toMatch(/[A-Za-z]{3} \d{1,2}, \d{2}:\d{2}:\d{2}/);
  });

  it("accepts a Date object as well as a string", () => {
    const result = formatTimestamp(new Date("2024-03-15T14:30:45.000Z"));
    expect(result).toMatch(/[A-Za-z]{3} \d{1,2}, \d{2}:\d{2}:\d{2}/);
  });
});

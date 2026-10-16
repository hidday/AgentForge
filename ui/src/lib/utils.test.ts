import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("joins plain class strings with spaces", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values (false, undefined, null, empty string)", () => {
    expect(cn("a", false, undefined, null, "", "b")).toBe("a b");
  });

  it("supports clsx object syntax for conditional classes", () => {
    expect(cn("a", { b: true, c: false })).toBe("a b");
  });

  it("supports arrays of class values", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });

  it("dedupes conflicting tailwind utility classes, keeping the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("returns an empty string when given no meaningful input", () => {
    expect(cn()).toBe("");
    expect(cn(false, undefined, null)).toBe("");
  });
});

describe("relativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for timestamps less than 60 seconds old", () => {
    expect(relativeTime(new Date("2024-01-01T11:59:30Z"))).toBe("just now");
  });

  it("returns 'just now' for the exact current instant", () => {
    expect(relativeTime(new Date("2024-01-01T12:00:00Z"))).toBe("just now");
  });

  it("returns minutes-ago for timestamps under an hour old", () => {
    expect(relativeTime(new Date("2024-01-01T11:55:00Z"))).toBe("5m ago");
  });

  it("returns hours-ago for timestamps under a day old", () => {
    expect(relativeTime(new Date("2024-01-01T09:00:00Z"))).toBe("3h ago");
  });

  it("returns days-ago for timestamps a day or more old", () => {
    expect(relativeTime(new Date("2023-12-30T12:00:00Z"))).toBe("2d ago");
  });

  it("accepts an ISO date string as well as a Date object", () => {
    expect(relativeTime("2024-01-01T11:59:50Z")).toBe("just now");
  });
});

describe("formatTimestamp", () => {
  it("formats a Date into a short month/day, hour:minute:second string", () => {
    const result = formatTimestamp(new Date("2024-03-15T14:30:45Z"));
    expect(result).toMatch(/^[A-Za-z]{3} \d{1,2}, \d{1,2}:\d{2}:\d{2}\s?(AM|PM)$/);
  });

  it("accepts an ISO date string as well as a Date object", () => {
    const result = formatTimestamp("2024-03-15T14:30:45Z");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("does not include a year in the formatted output", () => {
    const result = formatTimestamp(new Date("1999-07-04T00:00:00Z"));
    expect(result).not.toContain("1999");
  });
});

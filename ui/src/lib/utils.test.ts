import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("joins simple class strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, undefined, null, "", "b")).toBe("a b");
  });

  it("merges conflicting tailwind classes, keeping the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("supports object and array class-value forms", () => {
    expect(cn(["a", { b: true, c: false }])).toBe("a b");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for a timestamp less than 60 seconds old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:30Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("just now");
  });

  it("returns minutes-ago for a timestamp under an hour old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:05:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("5m ago");
  });

  it("returns hours-ago for a timestamp under a day old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T03:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("3h ago");
  });

  it("returns days-ago for a timestamp a day or more old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-04T00:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("3d ago");
  });

  it("accepts a Date instance as well as a string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:30Z"));
    expect(relativeTime(new Date("2024-01-01T00:00:00Z"))).toBe("just now");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a locale-aware short representation", () => {
    const result = formatTimestamp("2024-03-15T14:30:45Z");
    // Avoid asserting on locale-formatted output verbatim (TZ-dependent);
    // just check the expected structural pieces (month, day) are present.
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/15/);
  });

  it("accepts a Date instance", () => {
    const result = formatTimestamp(new Date("2024-03-15T14:30:45Z"));
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

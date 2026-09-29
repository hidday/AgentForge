import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("merges plain class name strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, 0, "b")).toBe("a b");
  });

  it("returns an empty string for no input", () => {
    expect(cn()).toBe("");
  });

  it("merges conflicting tailwind classes, keeping the last one", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("supports conditional object syntax", () => {
    expect(cn({ foo: true, bar: false }, "baz")).toBe("foo baz");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for a time less than 60 seconds ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:30Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("just now");
  });

  it("returns 'just now' for a time exactly 0 seconds ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("just now");
  });

  it("returns minutes ago for times between 1 and 59 minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:05:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("5m ago");
  });

  it("returns hours ago for times between 1 and 23 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T03:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("3h ago");
  });

  it("returns days ago for times of 24 hours or more", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-03T00:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("2d ago");
  });

  it("accepts a Date object as well as a string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:05:00Z"));
    expect(relativeTime(new Date("2024-01-01T00:00:00Z"))).toBe("5m ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a locale string with month/day/time", () => {
    const result = formatTimestamp("2024-03-15T14:30:45Z");
    // Avoid asserting on exact locale timezone conversion; check shape/content.
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/15/);
    expect(typeof result).toBe("string");
  });

  it("accepts a Date object as well as a string", () => {
    const date = new Date("2024-06-01T00:00:00Z");
    const result = formatTimestamp(date);
    expect(result).toMatch(/Jun/);
    expect(result).toMatch(/1/);
  });
});

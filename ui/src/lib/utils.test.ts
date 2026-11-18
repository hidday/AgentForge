import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils";

describe("cn", () => {
  it("joins multiple class strings", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("drops falsy values (undefined, null, false, empty string)", () => {
    expect(cn("a", undefined, null, false, "", "b")).toBe("a b");
  });

  it("merges conflicting tailwind classes, keeping the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("supports conditional object syntax from clsx", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c");
  });

  it("returns an empty string when given no meaningful input", () => {
    expect(cn()).toBe("");
    expect(cn(undefined, null, false)).toBe("");
  });

  it("flattens arrays of class values", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for timestamps under 60 seconds old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:30Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("just now");
  });

  it("returns 'just now' for a timestamp exactly at now", () => {
    vi.useFakeTimers();
    const now = new Date("2024-01-01T00:00:00Z");
    vi.setSystemTime(now);
    expect(relativeTime(now)).toBe("just now");
  });

  it("returns minutes ago for timestamps under an hour old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:05:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("5m ago");
  });

  it("returns hours ago for timestamps under a day old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T05:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("5h ago");
  });

  it("returns days ago for timestamps a day or more old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-04T00:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("3d ago");
  });

  it("accepts a Date instance as well as a string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:05:00Z"));
    expect(relativeTime(new Date("2024-01-01T00:00:00Z"))).toBe("5m ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a short, human-readable timestamp", () => {
    const result = formatTimestamp("2024-03-15T14:30:45Z");
    // Exact text depends on the runner's timezone, but the shape must include
    // month/day and time components produced by toLocaleString.
    expect(result).toMatch(/\w+ \d+/); // "Mar 15" style prefix
    expect(result).toContain(",");
  });

  it("accepts a Date instance as well as a string", () => {
    const d = new Date("2024-03-15T14:30:45Z");
    expect(formatTimestamp(d)).toBe(formatTimestamp(d.toISOString()));
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("merges class names, deduping conflicting tailwind utilities in favor of the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("passes through non-conflicting class names combined", () => {
    expect(cn("text-sm", "font-bold")).toBe("text-sm font-bold");
  });

  it("drops falsy values", () => {
    expect(cn("a", false && "b", undefined, null, "c")).toBe("a c");
  });
});

describe("relativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for a timestamp less than 60 seconds old", () => {
    expect(relativeTime(new Date("2024-06-01T11:59:30Z"))).toBe("just now");
  });

  it("returns '<N>m ago' for a timestamp less than 60 minutes old", () => {
    expect(relativeTime(new Date("2024-06-01T11:55:00Z"))).toBe("5m ago");
  });

  it("returns '<N>h ago' for a timestamp less than 24 hours old", () => {
    expect(relativeTime(new Date("2024-06-01T09:00:00Z"))).toBe("3h ago");
  });

  it("returns '<N>d ago' for a timestamp 24 hours or older", () => {
    expect(relativeTime(new Date("2024-05-30T12:00:00Z"))).toBe("2d ago");
  });

  it("accepts a date string as well as a Date object", () => {
    expect(relativeTime("2024-06-01T11:59:50Z")).toBe("just now");
  });
});

describe("formatTimestamp", () => {
  it("returns a non-empty formatted string containing the month and day", () => {
    const formatted = formatTimestamp(new Date("2024-03-15T10:30:00Z"));
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted).toContain("Mar");
    expect(formatted).toContain("15");
  });

  it("accepts a date string input", () => {
    const formatted = formatTimestamp("2024-12-25T00:00:00Z");
    expect(formatted).toContain("Dec");
  });
});

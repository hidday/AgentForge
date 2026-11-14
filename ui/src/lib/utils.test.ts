import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("merges class names and dedupes conflicting Tailwind utilities", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for timestamps under a minute old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:30Z"));
    expect(relativeTime(new Date("2026-01-01T00:00:00Z"))).toBe("just now");
  });

  it("returns minutes for timestamps under an hour old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:10:00Z"));
    expect(relativeTime(new Date("2026-01-01T00:00:00Z"))).toBe("10m ago");
  });

  it("returns hours for timestamps under a day old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T05:00:00Z"));
    expect(relativeTime(new Date("2026-01-01T00:00:00Z"))).toBe("5h ago");
  });

  it("returns days for timestamps a day or more old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-05T00:00:00Z"));
    expect(relativeTime(new Date("2026-01-01T00:00:00Z"))).toBe("4d ago");
  });

  it("accepts an ISO string in addition to a Date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:30Z"));
    expect(relativeTime("2026-01-01T00:00:00Z")).toBe("just now");
  });
});

describe("formatTimestamp", () => {
  it("formats a date into a short, human-readable timestamp", () => {
    const formatted = formatTimestamp(new Date("2026-03-15T14:05:09Z"));
    expect(formatted).toMatch(/Mar/);
    expect(formatted).toMatch(/15/);
  });

  it("accepts an ISO string", () => {
    expect(() => formatTimestamp("2026-03-15T14:05:09Z")).not.toThrow();
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils";

describe("cn", () => {
  it("merges class names and dedupes conflicting tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for timestamps under a minute old", () => {
    const now = new Date("2026-01-01T00:00:30.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2026-01-01T00:00:00.000Z")).toBe("just now");
  });

  it("returns minutes ago for timestamps under an hour old", () => {
    const now = new Date("2026-01-01T00:10:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2026-01-01T00:00:00.000Z")).toBe("10m ago");
  });

  it("returns hours ago for timestamps under a day old", () => {
    const now = new Date("2026-01-01T05:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2026-01-01T00:00:00.000Z")).toBe("5h ago");
  });

  it("returns days ago for timestamps a day or more old", () => {
    const now = new Date("2026-01-05T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2026-01-01T00:00:00.000Z")).toBe("4d ago");
  });

  it("accepts a Date instance directly", () => {
    const now = new Date("2026-01-01T00:00:30.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(new Date("2026-01-01T00:00:00.000Z"))).toBe("just now");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a short localized timestamp", () => {
    const result = formatTimestamp("2026-03-15T14:30:00.000Z");
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/15/);
  });

  it("accepts a Date instance directly", () => {
    const result = formatTimestamp(new Date("2026-03-15T14:30:00.000Z"));
    expect(result).toMatch(/Mar/);
  });
});

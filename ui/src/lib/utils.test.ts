import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("merges plain class strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("lets a later conflicting tailwind class win over an earlier one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("supports object syntax for conditional classes", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports 'just now' for timestamps under a minute old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:30Z"));
    expect(relativeTime("2026-01-01T00:00:00Z")).toBe("just now");
  });

  it("reports minutes ago for timestamps under an hour old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:10:00Z"));
    expect(relativeTime("2026-01-01T00:00:00Z")).toBe("10m ago");
  });

  it("reports hours ago for timestamps under a day old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T05:00:00Z"));
    expect(relativeTime("2026-01-01T00:00:00Z")).toBe("5h ago");
  });

  it("reports days ago for timestamps a day or more old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-03T00:00:00Z"));
    expect(relativeTime("2026-01-01T00:00:00Z")).toBe("2d ago");
  });

  it("accepts a Date instance as well as a string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:30Z"));
    expect(relativeTime(new Date("2026-01-01T00:00:00Z"))).toBe("just now");
  });

  it("is exactly at the 60s boundary still 'just now' only below it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:01:00Z"));
    expect(relativeTime("2026-01-01T00:00:00Z")).toBe("1m ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a short localized timestamp", () => {
    const result = formatTimestamp("2026-03-15T14:30:00Z");
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/15/);
  });

  it("accepts a Date instance as well as a string", () => {
    const result = formatTimestamp(new Date("2026-03-15T14:30:00Z"));
    expect(result).toMatch(/Mar/);
  });
});

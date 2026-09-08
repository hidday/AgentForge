import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils";

describe("cn", () => {
  it("merges class names, dropping falsy values", () => {
    expect(cn("a", false && "b", undefined, "c")).toBe("a c");
  });

  it("resolves conflicting tailwind classes via tailwind-merge (last wins)", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("returns an empty string when given no meaningful input", () => {
    expect(cn()).toBe("");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for timestamps less than 60 seconds old", () => {
    const now = new Date("2024-01-01T00:01:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(new Date("2024-01-01T00:00:30Z"))).toBe("just now");
  });

  it("returns minutes ago for timestamps under an hour old", () => {
    const now = new Date("2024-01-01T01:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(new Date("2024-01-01T00:55:00Z"))).toBe("5m ago");
  });

  it("returns hours ago for timestamps under a day old", () => {
    const now = new Date("2024-01-02T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(new Date("2024-01-01T21:00:00Z"))).toBe("3h ago");
  });

  it("returns days ago for timestamps a day or more old", () => {
    const now = new Date("2024-01-10T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(new Date("2024-01-05T00:00:00Z"))).toBe("5d ago");
  });

  it("accepts a string date input", () => {
    const now = new Date("2024-01-01T00:01:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime("2024-01-01T00:00:30Z")).toBe("just now");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a locale-aware short representation", () => {
    const formatted = formatTimestamp("2024-03-15T10:30:00Z");
    // Avoid asserting exact locale output (timezone dependent); assert shape/content instead.
    expect(formatted).toMatch(/Mar/);
    expect(formatted).toMatch(/15/);
    expect(formatted).toMatch(/2024|,/); // sanity: non-empty formatted string
  });

  it("accepts a Date object input", () => {
    const formatted = formatTimestamp(new Date("2024-03-15T10:30:00Z"));
    expect(typeof formatted).toBe("string");
    expect(formatted.length).toBeGreaterThan(0);
  });
});

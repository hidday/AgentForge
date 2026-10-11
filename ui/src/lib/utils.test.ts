import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("joins simple class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("merges conflicting tailwind classes, keeping the last one", () => {
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
  });

  it("supports conditional object syntax", () => {
    expect(cn("base", { active: true, hidden: false })).toBe("base active");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for timestamps under a minute old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:30Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("just now");
  });

  it("returns minutes ago for timestamps under an hour old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:05:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("5m ago");
  });

  it("returns hours ago for timestamps under a day old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T03:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("3h ago");
  });

  it("returns days ago for timestamps a day or more old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-05T00:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("4d ago");
  });

  it("accepts a Date object as well as a string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:30Z"));
    expect(relativeTime(new Date("2024-01-01T00:00:00Z"))).toBe("just now");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a short, human-readable timestamp", () => {
    const result = formatTimestamp("2024-03-15T14:30:45Z");
    // Avoid asserting exact locale-dependent hour value (timezone-sensitive);
    // instead assert the overall shape: "Mar 15, HH:MM:SS [AM|PM]"
    expect(result).toMatch(/^Mar 15, \d{2}:\d{2}:\d{2}(\s?[AP]M)?$/);
  });

  it("accepts a Date object", () => {
    const result = formatTimestamp(new Date("2024-03-15T14:30:45Z"));
    expect(result).toMatch(/^Mar 15, \d{2}:\d{2}:\d{2}(\s?[AP]M)?$/);
  });
});

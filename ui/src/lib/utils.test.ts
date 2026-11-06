import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils";

describe("cn", () => {
  it("joins plain class strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values (undefined, null, false, empty string)", () => {
    expect(cn("a", undefined, null, false, "", "b")).toBe("a b");
  });

  it("returns an empty string when called with no args", () => {
    expect(cn()).toBe("");
  });

  it("merges conflicting tailwind classes, keeping the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("supports conditional object syntax from clsx", () => {
    expect(cn("base", { active: true, hidden: false })).toBe("base active");
  });

  it("supports array inputs", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for a timestamp less than 60 seconds ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:30Z"));
    expect(relativeTime("2026-01-01T00:00:00Z")).toBe("just now");
  });

  it("returns minutes ago for a timestamp under an hour old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:05:00Z"));
    expect(relativeTime("2026-01-01T00:00:00Z")).toBe("5m ago");
  });

  it("returns hours ago for a timestamp under a day old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T03:00:00Z"));
    expect(relativeTime("2026-01-01T00:00:00Z")).toBe("3h ago");
  });

  it("returns days ago for a timestamp a day or more old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-05T00:00:00Z"));
    expect(relativeTime("2026-01-01T00:00:00Z")).toBe("4d ago");
  });

  it("accepts a Date object as well as a string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:30Z"));
    expect(relativeTime(new Date("2026-01-01T00:00:00Z"))).toBe("just now");
  });
});

describe("formatTimestamp", () => {
  it("formats a date string into a localized month/day/time string", () => {
    const result = formatTimestamp("2026-03-15T14:30:45Z");
    // Avoid asserting on exact locale-dependent wording; check the key parts.
    expect(result).toContain("15");
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  it("accepts a Date object as well as a string", () => {
    const result = formatTimestamp(new Date("2026-03-15T14:30:45Z"));
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

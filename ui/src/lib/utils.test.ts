import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("joins plain class name strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });

  it("merges conflicting tailwind classes, keeping the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("supports conditional object syntax", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c");
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

  it("returns minutes ago for a time under an hour old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:10:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("10m ago");
  });

  it("returns hours ago for a time under a day old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T05:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("5h ago");
  });

  it("returns days ago for a time a day or more old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-05T00:00:00Z"));
    expect(relativeTime("2024-01-01T00:00:00Z")).toBe("4d ago");
  });

  it("accepts a Date instance as well as a string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:30Z"));
    expect(relativeTime(new Date("2024-01-01T00:00:00Z"))).toBe("just now");
  });
});

describe("formatTimestamp", () => {
  it("formats an ISO date string using the expected locale options", () => {
    const result = formatTimestamp("2024-03-15T14:30:45Z");
    // Avoid asserting an exact locale string (environment-dependent formatting
    // nuances); assert the semantically meaningful parts are present.
    expect(result).toContain("Mar");
    expect(result).toContain("15");
  });

  it("formats a Date instance the same way as an equivalent string", () => {
    const date = new Date("2024-03-15T14:30:45Z");
    expect(formatTimestamp(date)).toBe(formatTimestamp(date.toISOString()));
  });
});

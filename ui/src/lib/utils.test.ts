import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("joins multiple class strings", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, undefined, null, "", "b")).toBe("a b");
  });

  it("merges conflicting tailwind utility classes, keeping the last one", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("merges conditional object syntax from clsx", () => {
    expect(cn("base", { active: true, hidden: false })).toBe("base active");
  });

  it("returns an empty string when given nothing", () => {
    expect(cn()).toBe("");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for a timestamp less than 60 seconds ago", () => {
    const now = new Date("2024-01-01T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const then = new Date(now.getTime() - 30 * 1000).toISOString();
    expect(relativeTime(then)).toBe("just now");
  });

  it("returns 'just now' for a timestamp exactly 0 seconds ago", () => {
    const now = new Date("2024-01-01T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(now.toISOString())).toBe("just now");
  });

  it("returns minutes ago for a timestamp between 1 and 59 minutes ago", () => {
    const now = new Date("2024-01-01T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const then = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    expect(relativeTime(then)).toBe("5m ago");
  });

  it("returns the boundary minute correctly at exactly 60 seconds", () => {
    const now = new Date("2024-01-01T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const then = new Date(now.getTime() - 60 * 1000).toISOString();
    expect(relativeTime(then)).toBe("1m ago");
  });

  it("returns hours ago for a timestamp between 1 and 23 hours ago", () => {
    const now = new Date("2024-01-01T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const then = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(then)).toBe("3h ago");
  });

  it("returns days ago for a timestamp 24 hours or more in the past", () => {
    const now = new Date("2024-01-01T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const then = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(then)).toBe("2d ago");
  });

  it("accepts a Date object directly, not just a string", () => {
    const now = new Date("2024-01-01T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const then = new Date(now.getTime() - 10 * 60 * 1000);
    expect(relativeTime(then)).toBe("10m ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a Date object as month, day, hour:minute:second", () => {
    const d = new Date(2024, 2, 5, 14, 7, 9);
    expect(formatTimestamp(d)).toBe("Mar 5, 02:07:09 PM");
  });

  it("formats an ISO string input the same way as a Date object", () => {
    const d = new Date(2024, 11, 25, 9, 1, 2);
    expect(formatTimestamp(d.toISOString())).toBe(formatTimestamp(d));
  });

  it("pads single-digit hours/minutes/seconds to two digits", () => {
    const d = new Date(2024, 0, 1, 1, 2, 3);
    expect(formatTimestamp(d)).toBe("Jan 1, 01:02:03 AM");
  });
});

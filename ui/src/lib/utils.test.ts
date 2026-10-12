import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils";

describe("cn", () => {
  it("joins simple class strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, 0, "b")).toBe("a b");
  });

  it("applies conditional classes from objects", () => {
    expect(cn("base", { active: true, disabled: false })).toBe("base active");
  });

  it("merges conflicting tailwind utility classes, keeping the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("merges conflicting classes coming from an array", () => {
    expect(cn(["text-sm", "text-lg"])).toBe("text-lg");
  });

  it("returns an empty string when given nothing meaningful", () => {
    expect(cn()).toBe("");
    expect(cn(false, null, undefined)).toBe("");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for a timestamp less than 60 seconds ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:30.000Z"));
    expect(relativeTime("2026-01-01T00:00:00.000Z")).toBe("just now");
  });

  it("returns 'just now' at the exact zero-diff boundary", () => {
    vi.useFakeTimers();
    const now = new Date("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(now);
    expect(relativeTime(now)).toBe("just now");
  });

  it("returns minutes ago for a timestamp between 1 and 59 minutes ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:05:00.000Z"));
    expect(relativeTime("2026-01-01T00:00:00.000Z")).toBe("5m ago");
  });

  it("returns hours ago for a timestamp between 1 and 23 hours ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T03:00:00.000Z"));
    expect(relativeTime("2026-01-01T00:00:00.000Z")).toBe("3h ago");
  });

  it("returns days ago for a timestamp 24 or more hours ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-03T00:00:00.000Z"));
    expect(relativeTime("2026-01-01T00:00:00.000Z")).toBe("2d ago");
  });

  it("accepts a Date instance as well as a string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:05:00.000Z"));
    expect(relativeTime(new Date("2026-01-01T00:00:00.000Z"))).toBe("5m ago");
  });

  it("crosses the minute boundary at exactly 60 seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:01:00.000Z"));
    expect(relativeTime("2026-01-01T00:00:00.000Z")).toBe("1m ago");
  });

  it("crosses the hour boundary at exactly 60 minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T01:00:00.000Z"));
    expect(relativeTime("2026-01-01T00:00:00.000Z")).toBe("1h ago");
  });

  it("crosses the day boundary at exactly 24 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));
    expect(relativeTime("2026-01-01T00:00:00.000Z")).toBe("1d ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a string date into a localized month/day/time string", () => {
    const result = formatTimestamp("2026-03-15T14:05:09.000Z");
    expect(result).toBe(
      new Date("2026-03-15T14:05:09.000Z").toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    );
  });

  it("formats a Date instance the same way as an equivalent string", () => {
    const date = new Date("2026-07-04T09:00:00.000Z");
    expect(formatTimestamp(date)).toBe(formatTimestamp(date.toISOString()));
  });

  it("includes the month, day and a two-digit hour/minute/second", () => {
    const result = formatTimestamp("2026-12-25T08:03:04.000Z");
    expect(result).toContain("Dec");
    expect(result).toContain("25");
  });
});

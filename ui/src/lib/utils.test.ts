import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("merges plain class name strings", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("drops falsy values from the input list", () => {
    expect(cn("foo", false, undefined, null, "bar")).toBe("foo bar");
  });

  it("resolves conflicting tailwind classes, keeping the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("supports conditional object syntax from clsx", () => {
    expect(cn("foo", { bar: true, baz: false })).toBe("foo bar");
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for a timestamp less than a minute ago", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const date = new Date(now.getTime() - 30 * 1000);
    expect(relativeTime(date)).toBe("just now");
  });

  it("returns minutes ago for a timestamp under an hour old", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const date = new Date(now.getTime() - 5 * 60 * 1000);
    expect(relativeTime(date)).toBe("5m ago");
  });

  it("returns hours ago for a timestamp under a day old", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const date = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    expect(relativeTime(date)).toBe("3h ago");
  });

  it("returns days ago for a timestamp a day or more old", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const date = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    expect(relativeTime(date)).toBe("2d ago");
  });

  it("accepts a string date input", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const date = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    expect(relativeTime(date)).toBe("10m ago");
  });
});

describe("formatTimestamp", () => {
  it("formats a Date into a locale-aware short date/time string", () => {
    const date = new Date("2026-03-15T09:05:03Z");
    const formatted = formatTimestamp(date);

    expect(typeof formatted).toBe("string");
    expect(formatted.length > 0).toBe(true);
    expect(formatted).toBe(
      date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    );
  });

  it("accepts a string date input", () => {
    const isoString = "2026-03-15T09:05:03Z";
    const formatted = formatTimestamp(isoString);

    expect(formatted).toBe(
      new Date(isoString).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    );
  });
});

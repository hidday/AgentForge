import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils";

// ---------------------------------------------------------------------------
// cn
// ---------------------------------------------------------------------------
describe("cn", () => {
  it("joins plain string class names with a space", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("drops falsy values (undefined, null, false, empty string)", () => {
    expect(cn("a", undefined, null, false, "", "b")).toBe("a b");
  });

  it("includes classes from object syntax only when their value is truthy", () => {
    expect(cn({ a: true, b: false, c: 1 > 0 })).toBe("a c");
  });

  it("resolves conflicting tailwind utility classes by keeping the last one", () => {
    // tailwind-merge should drop the earlier conflicting padding class.
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("returns an empty string when given no meaningful input", () => {
    expect(cn()).toBe("");
    expect(cn(undefined, null, false)).toBe("");
  });

  it("flattens arrays of class values", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });
});

// ---------------------------------------------------------------------------
// relativeTime
// ---------------------------------------------------------------------------
describe("relativeTime", () => {
  const NOW = new Date("2026-09-11T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for a timestamp less than 60 seconds ago", () => {
    const date = new Date(NOW.getTime() - 30 * 1000);
    expect(relativeTime(date)).toBe("just now");
  });

  it("returns 'just now' at the zero-second boundary", () => {
    expect(relativeTime(NOW)).toBe("just now");
  });

  it("returns minutes ago just past the 60 second boundary", () => {
    const date = new Date(NOW.getTime() - 60 * 1000);
    expect(relativeTime(date)).toBe("1m ago");
  });

  it("returns minutes ago for a timestamp under an hour old", () => {
    const date = new Date(NOW.getTime() - 45 * 60 * 1000);
    expect(relativeTime(date)).toBe("45m ago");
  });

  it("returns hours ago just past the 60 minute boundary", () => {
    const date = new Date(NOW.getTime() - 60 * 60 * 1000);
    expect(relativeTime(date)).toBe("1h ago");
  });

  it("returns hours ago for a timestamp under a day old", () => {
    const date = new Date(NOW.getTime() - 5 * 60 * 60 * 1000);
    expect(relativeTime(date)).toBe("5h ago");
  });

  it("returns days ago just past the 24 hour boundary", () => {
    const date = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    expect(relativeTime(date)).toBe("1d ago");
  });

  it("returns days ago for a timestamp several days old", () => {
    const date = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000);
    expect(relativeTime(date)).toBe("3d ago");
  });

  it("accepts a string date input equivalently to a Date object", () => {
    const iso = new Date(NOW.getTime() - 10 * 60 * 1000).toISOString();
    expect(relativeTime(iso)).toBe("10m ago");
  });
});

// ---------------------------------------------------------------------------
// formatTimestamp
// ---------------------------------------------------------------------------
describe("formatTimestamp", () => {
  it("formats a Date object as a localized month/day/time string", () => {
    const date = new Date("2026-03-05T08:07:09.000Z");
    const result = formatTimestamp(date);
    expect(result).toBe(
      date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    );
    // Sanity-check the shape rather than only re-deriving the same call.
    expect(result).toContain("Mar 5");
  });

  it("formats a string date input equivalently to the Date object it parses to", () => {
    const iso = "2026-12-25T00:00:00.000Z";
    expect(formatTimestamp(iso)).toBe(formatTimestamp(new Date(iso)));
  });
});

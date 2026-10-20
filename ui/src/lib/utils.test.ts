import { describe, it, expect } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils";

// ---------------------------------------------------------------------------
// cn
// ---------------------------------------------------------------------------
describe("cn", () => {
  it("joins simple string class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values (undefined/null/false/empty string)", () => {
    expect(cn("a", undefined, null, false, "", "b")).toBe("a b");
  });

  it("merges conflicting tailwind classes, keeping the last one", () => {
    // tailwind-merge should resolve conflicting utilities to the last value
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("supports conditional object syntax from clsx", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c");
  });

  it("returns an empty string when given no meaningful input", () => {
    expect(cn()).toBe("");
    expect(cn(undefined, null, false)).toBe("");
  });

  it("supports arrays of class values", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });
});

// ---------------------------------------------------------------------------
// relativeTime
// ---------------------------------------------------------------------------
describe("relativeTime", () => {
  it("returns 'just now' for a timestamp less than 60 seconds ago", () => {
    const date = new Date(Date.now() - 10 * 1000);
    expect(relativeTime(date)).toBe("just now");
  });

  it("returns 'just now' for the current instant (0 seconds elapsed)", () => {
    expect(relativeTime(new Date())).toBe("just now");
  });

  it("returns minutes-ago format between 1 minute and 1 hour", () => {
    const date = new Date(Date.now() - 5 * 60 * 1000);
    expect(relativeTime(date)).toBe("5m ago");
  });

  it("returns hours-ago format between 1 hour and 24 hours", () => {
    const date = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(relativeTime(date)).toBe("3h ago");
  });

  it("returns days-ago format for 24 hours or more", () => {
    const date = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect(relativeTime(date)).toBe("2d ago");
  });

  it("accepts an ISO date string in addition to a Date object", () => {
    const iso = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    expect(relativeTime(iso)).toBe("2m ago");
  });

  it("is at the exact 60-second boundary moves from 'just now' to minutes", () => {
    const date = new Date(Date.now() - 60 * 1000);
    expect(relativeTime(date)).toBe("1m ago");
  });

  it("is at the exact 60-minute boundary moves from minutes to hours", () => {
    const date = new Date(Date.now() - 60 * 60 * 1000);
    expect(relativeTime(date)).toBe("1h ago");
  });

  it("is at the exact 24-hour boundary moves from hours to days", () => {
    const date = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(relativeTime(date)).toBe("1d ago");
  });
});

// ---------------------------------------------------------------------------
// formatTimestamp
// ---------------------------------------------------------------------------
describe("formatTimestamp", () => {
  it("formats a Date object into a short month/day/time string", () => {
    const date = new Date("2024-03-15T14:30:45Z");
    const result = formatTimestamp(date);
    // Depends on locale timezone handling — assert shape rather than exact wording
    expect(result).toContain("15");
    expect(result).toMatch(/Mar/);
  });

  it("formats an ISO date string the same way as a Date object", () => {
    const iso = "2024-03-15T14:30:45Z";
    const fromString = formatTimestamp(iso);
    const fromDate = formatTimestamp(new Date(iso));
    expect(fromString).toBe(fromDate);
  });

  it("includes hour, minute, and second components", () => {
    const result = formatTimestamp(new Date("2024-01-01T00:00:00Z"));
    // en-US locale with hour/minute/second should contain at least two colons
    expect(result.split(":").length - 1).toBeGreaterThanOrEqual(2);
  });
});

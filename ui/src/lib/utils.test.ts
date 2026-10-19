import { describe, it, expect } from "vitest";
import { cn, relativeTime, formatTimestamp } from "./utils.ts";

describe("cn", () => {
  it("merges plain class strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy/conditional entries", () => {
    expect(cn("a", false && "b", undefined, null, "c")).toBe("a c");
  });

  it("lets a later conflicting tailwind class win via twMerge", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});

describe("relativeTime", () => {
  it("returns 'just now' for timestamps under 60 seconds old", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 30_000))).toBe("just now");
  });

  it("returns 'just now' at the 59 second boundary", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 59_000))).toBe("just now");
  });

  it("switches to minutes at the 60 second boundary", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 60_000))).toBe("1m ago");
  });

  it("returns minutes for timestamps under an hour old", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 5 * 60_000))).toBe("5m ago");
  });

  it("switches to hours at the 60 minute boundary", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 60 * 60_000))).toBe("1h ago");
  });

  it("returns hours for timestamps under a day old", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 5 * 60 * 60_000))).toBe("5h ago");
  });

  it("switches to days at the 24 hour boundary", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 24 * 60 * 60_000))).toBe("1d ago");
  });

  it("returns days for timestamps well over a day old", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 10 * 24 * 60 * 60_000))).toBe("10d ago");
  });

  it("accepts an ISO date string in addition to a Date instance", () => {
    const iso = new Date(Date.now() - 2 * 60_000).toISOString();
    expect(relativeTime(iso)).toBe("2m ago");
  });
});

describe("formatTimestamp", () => {
  it("matches the locale string produced with the same formatting options", () => {
    const date = new Date("2024-03-15T13:45:30Z");
    const expected = date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    expect(formatTimestamp(date)).toBe(expected);
  });

  it("accepts an ISO string input and produces the same result as a Date instance", () => {
    const iso = "2024-03-15T13:45:30Z";
    expect(formatTimestamp(iso)).toBe(formatTimestamp(new Date(iso)));
  });
});

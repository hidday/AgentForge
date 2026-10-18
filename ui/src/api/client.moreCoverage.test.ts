import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

// Supplementary coverage for client.ts endpoints that the main client.test.ts
// suite does not exercise: reReviewPlan, revisePlan, pauseRun, and resumeRun.
describe("api client – supplementary endpoint coverage", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("builds reReviewPlan POST request with the note included when provided", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, runId: "run-1" }),
    );

    const result = await api.reReviewPlan("run-1", "focus on the test plan");

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/runs/run-1/actions/re-review-plan");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ note: "focus on the test plan" });
    expect(result).toEqual({ ok: true, runId: "run-1" });
  });

  it("omits the note field (undefined) for reReviewPlan when no note is given", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, runId: "run-1" }),
    );

    await api.reReviewPlan("run-1");

    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({});
  });

  it("builds revisePlan POST request with the note included when provided", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, runId: "run-2" }),
    );

    const result = await api.revisePlan("run-2", "tighten the rollout step");

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/runs/run-2/actions/revise-plan");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ note: "tighten the rollout step" });
    expect(result).toEqual({ ok: true, runId: "run-2" });
  });

  it("omits the note field (undefined) for revisePlan when no note is given", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, runId: "run-2" }),
    );

    await api.revisePlan("run-2");

    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({});
  });

  it("builds a POST request with no body for pauseRun", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));

    const result = await api.pauseRun("run-3");

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/runs/run-3/actions/pause");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({});
    expect(result).toEqual({ ok: true });
  });

  it("builds a POST request with no body for resumeRun", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));

    const result = await api.resumeRun("run-4");

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/runs/run-4/actions/resume");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({});
    expect(result).toEqual({ ok: true });
  });
});

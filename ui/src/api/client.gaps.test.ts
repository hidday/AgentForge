import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("api client gaps", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("retryStage posts to the retry action endpoint and returns the parsed retry state", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, state: "Executing", retrying: true }),
    );
    const result = await api.retryStage("r1");
    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/runs/r1/actions/retry");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({});
    expect(result).toEqual({ ok: true, state: "Executing", retrying: true });
  });

  it("getProcessOutput requests the process output sub-resource and returns it", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ processId: "p1", output: "some log output" }),
    );
    const result = await api.getProcessOutput("p1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/processes/p1/output", expect.anything());
    expect(result).toEqual({ processId: "p1", output: "some log output" });
  });

  it("fetchPendingIssues requests the Linear pending-issues endpoint and returns the issue list", async () => {
    const issues = [
      { id: "i1", title: "Fix bug", description: "desc", state: "Todo", labels: [], priority: 2 },
    ];
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ issues }));
    const result = await api.fetchPendingIssues();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/linear/pending", expect.anything());
    expect(result).toEqual({ issues });
  });

  it("answerQuestions posts the answers array and returns the updated run", async () => {
    const answers = [{ questionId: "q1", answer: "yes" }];
    const run = { id: "r1", state: "Planning" };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, run }));
    const result = await api.answerQuestions("r1", answers);
    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/runs/r1/actions/answer-questions");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(options.body)).toEqual({ answers });
    expect(result).toEqual({ ok: true, run });
  });

  it("fetchPendingIssues propagates a server error message when the response is not ok", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ error: "Linear unavailable" }, false, 502),
    );
    await expect(api.fetchPendingIssues()).rejects.toThrow("Linear unavailable");
  });

  it("getArtifacts requests the run's artifacts sub-resource and returns them", async () => {
    const artifacts = [{ id: "a1", runId: "r1", type: "Plan", version: 1, payloadJson: {}, rawText: "", createdAt: "t" }];
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ artifacts }));
    const result = await api.getArtifacts("r1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/artifacts", expect.anything());
    expect(result).toEqual({ artifacts });
  });

  it("getEvents requests the run's events sub-resource and returns them", async () => {
    const events = [{ id: "e1", runId: "r1", eventType: "run:created", source: "system", payloadJson: {}, createdAt: "t" }];
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ events }));
    const result = await api.getEvents("r1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/events", expect.anything());
    expect(result).toEqual({ events });
  });

  it("reReviewPlan posts the note to the re-review-plan action endpoint", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));
    const result = await api.reReviewPlan("r1", "focus on tests");
    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/runs/r1/actions/re-review-plan");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ note: "focus on tests" });
    expect(result).toEqual({ ok: true, runId: "r1" });
  });

  it("reReviewPlan omits the note field (as undefined) when called without one", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));
    await api.reReviewPlan("r1");
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({});
  });

  it("revisePlan posts to the revise-plan action endpoint, omitting the note when not given", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));
    await api.revisePlan("r1");
    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/runs/r1/actions/revise-plan");
    expect(JSON.parse(options.body)).toEqual({});
  });

  it("approveReview posts a bodiless request to the approve-review action endpoint", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "Done" }));
    const result = await api.approveReview("r1");
    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/runs/r1/actions/approve-review");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({});
    expect(result).toEqual({ ok: true, state: "Done" });
  });

  it("resumeRun posts a bodiless request to the resume action endpoint", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
    const result = await api.resumeRun("r1");
    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/runs/r1/actions/resume");
    expect(options.method).toBe("POST");
    expect(result).toEqual({ ok: true });
  });
});
